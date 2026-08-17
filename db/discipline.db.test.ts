import { execFileSync } from 'node:child_process'
import { describe, it, expect } from 'vitest'
import { defaultConfig } from '@/core'
import { createMatchday, matchdayContextFor } from './matchday'
import { disciplineConfig, updateDisciplineConfig } from './discipline'
import { derivedSeasonStatus } from './read'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser } from './test/users'

// ── PR 1 — fundamento de `disciplines` ──────────────────────────────────────
// Todavía no hay wizard multi-disciplina (llega en PR 11): estos tests
// ejercitan la tabla y sus permisos directamente, con el mismo scaffolding de
// service_role que el resto de `db/*.db.test.ts`.

describe('disciplines', () => {
  it('la temporada nace con exactamente una disciplina PADEL con la forma documentada', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineId, disciplineIds } = await createSeason({ admin })
    expect(disciplineIds).toEqual([disciplineId])

    const db = adminClient()
    const { data, error } = await db
      .from('disciplines')
      .select('id, season_id, kind, status, weight, pair_size, allows_draw, has_masters, position')
      .eq('season_id', seasonId)
    if (error) throw new Error(error.message)

    expect(data).toHaveLength(1)
    const row = data?.[0]
    expect(row?.id).toBe(disciplineId)
    expect(row?.kind).toBe('PADEL')
    expect(row?.status).toBe('SETUP')
    // numeric(4,2) viaja como string por PostgREST (riesgo documentado en el diseño).
    expect(Number(row?.weight)).toBe(1)
    expect(row?.pair_size).toBe(2)
    expect(row?.allows_draw).toBe(false)
    expect(row?.has_masters).toBe(true)
    expect(row?.position).toBe(0)
  })

  // El tripwire disciplines_one_per_season vivió acá desde PR 1 hasta que
  // PR 4 (0018_reopen_cancel_scoped.sql) lo saca en el MISMO archivo que
  // arregla reopen_matchday/cancel_matchday — nunca antes. Esta aserción
  // ("rechaza una segunda disciplina") queda reemplazada por lo opuesto en
  // db/discipline-scope.db.test.ts, que además prueba que reopen/cancel ya
  // operan scopeadas por discipline_id (REQ-D4-3).

  // Sin el grant de columna, esto rebota con "permission denied for table
  // matchdays" — el mismo agujero silencioso que documenta 0002_rls.sql:236,
  // ahora sobre una columna nueva.
  it('un admin autenticado puede insertar discipline_id en matchdays (grant de columna, REQ-NR-6)', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineId } = await createSeason({ admin })

    const { data, error } = await admin.client
      .from('matchdays')
      .insert({ season_id: seasonId, number: 1, discipline_id: disciplineId })
      .select('id')
      .single()

    expect(error).toBeNull()
    expect(data?.id).toBeTypeOf('string')
  })

  // W2 (0020_disciplines_grants.sql): el UPDATE de disciplines.status ya
  // estaba revocado (0015:69); el INSERT era a nivel tabla y lo esquivaba —
  // un admin de temporada (RLS lo deja escribir, `disciplines_write` pide
  // sólo `is_season_admin`) podía crear una disciplina ya en ACTIVE por
  // PostgREST, saltando el trinquete que las funciones (0019) existen para
  // hacer cumplir. Prueba de comportamiento contra la API real, no
  // introspección: `information_schema` no está expuesto por PostgREST
  // (`supabase/config.toml`: `schemas = ["public", "graphql_public"]`), así
  // que la verificación de grants en sí se hizo a mano contra la base
  // (psql), no es alcanzable desde este archivo.
  it('un admin de temporada no puede insertar una disciplina ya en ACTIVE (W2)', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason({ admin })

    const { data, error } = await admin.client
      .from('disciplines')
      .insert({ season_id: seasonId, kind: 'FIFA', config: {}, status: 'ACTIVE' } as never)
      .select('id')

    expect(data).toBeNull()
    expect(error?.code).toBe('42501')
  })
})

// ── PR 2 — matchdays scopeadas por disciplina ───────────────────────────────
// El tripwire de PR 1 sigue puesto: todavía no hay forma de tener dos
// disciplinas en la misma temporada para probar el scoping en los dos
// sentidos (eso es PR 4, cuando cae el índice). Lo que sí es de PR 2: que
// `createMatchday` escribe `discipline_id` sola, que `matchday_discipline`
// existe y contesta bien, y que la columna es de verdad NOT NULL.
describe('matchdays.discipline_id (PR 2)', () => {
  it('createMatchday escribe discipline_id sin que el caller lo pase (REQ-D3-1/2)', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineId } = await createSeason({ admin })

    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')

    const db = adminClient()
    const { data, error } = await db
      .from('matchdays')
      .select('discipline_id')
      .eq('id', matchdayId)
      .single()
    if (error || data === null) throw new Error(error?.message)
    expect(data.discipline_id).toBe(disciplineId)
  })

  // W5 (0020_disciplines_grants.sql): PR 4 nunca la llamó (lee discipline_id
  // del mismo `select ... for update` ya bloqueado, más seguro) y quedó
  // expuesta como RPC pública sin un solo consumidor. Se revoca, mismo
  // criterio que 0009 con handle_new_user — ver squad-position.db.test.ts
  // para el mismo patrón con shift_seeds_up.
  it('matchday_discipline no es alcanzable por RPC: nadie tiene el grant', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason({ admin })
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')

    const { data, error } = await admin.client.rpc('matchday_discipline', { p_matchday: matchdayId })

    expect(data).toBeNull()
    expect(error?.code).toBe('42501')
  })

  it('discipline_id es NOT NULL: un insert que lo omite falla (REQ-NR-3)', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason({ admin })

    const db = adminClient()
    // `database.types.ts` ya exige discipline_id acá — bien, es justo lo que
    // este test pinnea —, pero el caso real es un caller que lo saltea (SQL a
    // mano, un tipo desactualizado). El cast fuerza ese payload inválido.
    const { error } = await db
      .from('matchdays')
      .insert({ season_id: seasonId, number: 1 } as never)

    expect(error?.code).toBe('23502')
  })
})

// ── PR 3 — estado derivado ───────────────────────────────────────────────────
// El tripwire sigue puesto: acá sólo se prueba el camino de lectura contra
// UNA disciplina real. El caso completo del spec ("pádel ACTIVE y FIFA
// SETUP → ACTIVE") ya tiene su prueba unitaria en core/season.test.ts, y su
// prueba end-to-end con dos disciplinas de verdad vive en PR 4, que es donde
// el tripwire cae y dos disciplinas concurrentes dejan de ser hipotéticas.
describe('derivedSeasonStatus (PR 3)', () => {
  it('temporada recién creada: SETUP', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason({ admin })

    expect(await derivedSeasonStatus(admin.client, seasonId)).toBe('SETUP')
  })

  it('con la disciplina en ACTIVE: ACTIVE', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineId } = await createSeason({ admin })
    const db = adminClient()
    const { error } = await db.from('disciplines').update({ status: 'ACTIVE' }).eq('id', disciplineId)
    if (error) throw new Error(error.message)

    expect(await derivedSeasonStatus(admin.client, seasonId)).toBe('ACTIVE')
  })
})

// ── REQ-NR-4 (verify-report, hallazgo C3) ───────────────────────────────────
// `supabase/seed.sql` insertaba la temporada demo a mano, sin su disciplina:
// tras un `supabase db reset` limpio, crear una fecha en ese torneo rompía
// con PGRST116 ("No se pudo leer la disciplina de la temporada"). El fix es
// en el seed; esto es la aserción de no-regresión, medida contra la base
// completa —no sólo contra lo que este archivo crea— para que un futuro
// insert manual de `seasons` (acá o en otro seed) no vuelva a dejar una
// temporada huérfana en silencio.
describe('REQ-NR-4 — ninguna temporada se queda sin disciplina', () => {
  it('count(seasons sin disciplinas) = 0', async () => {
    const db = adminClient()
    const { data: seasons, error: seasonsError } = await db.from('seasons').select('id')
    if (seasonsError) throw new Error(seasonsError.message)

    const { data: disciplineRows, error: disciplinesError } = await db.from('disciplines').select('season_id')
    if (disciplinesError) throw new Error(disciplinesError.message)

    const seasonsWithDiscipline = new Set((disciplineRows ?? []).map((row) => row.season_id))
    const orphaned = (seasons ?? []).filter((season) => !seasonsWithDiscipline.has(season.id))
    expect(orphaned).toHaveLength(0)
  })
})

// ── C7/W8 (verify-report ronda 3) ────────────────────────────────────────────
// El gemelo de REQ-NR-4, un nivel más abajo: `supabase/seed.sql` dejaba el
// torneo demo con 8 `entries` SQUAD y CERO filas en `discipline_entries`
// (setAttendance rebotaba con 23503, FK violation), y dos scaffolds de test
// (`db/claim.db.test.ts`, `db/rls.db.test.ts`) armaban `entries` a mano sin su
// contraparte. Medido contra la base completa, igual que REQ-NR-4, para que
// un futuro insert manual de `entries` (acá o en cualquier test nuevo) no
// vuelva a dejar un asiento huérfano en silencio.
//
// UNA sola consulta SQL, no dos round-trips de PostgREST (`entries` y
// `discipline_entries` por separado): con dos consultas independientes esta
// aserción GLOBAL mostró huérfanos fantasma en 3 de ~7 corridas de la suite
// completa — no una regresión real (aislado, en un solo archivo, sale
// 100% estable RED antes del fix y GREEN después), sino la ventana entre las
// dos llamadas HTTP mientras `vitest.db.config.ts` corre otros archivos en
// paralelo (comentario del propio config: "los tests comparten una base,
// aíslan por temporada, no por proceso"). Un `not exists` en una única
// sentencia ve una sola foto consistente de Postgres — el mismo patrón que ya
// usa `db/squad-position.db.test.ts` para forzar el plan del planner.
function countOrphanedSquadEntries(): number {
  const output = execFileSync(
    'docker',
    [
      'exec', '-i', 'supabase_db_padelApp',
      'psql', '-U', 'postgres', '-d', 'postgres',
      '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c',
      `select count(*) from public.entries e
        where e.kind = 'SQUAD'
        and not exists (select 1 from public.discipline_entries de where de.entry_id = e.id);`,
    ],
    { encoding: 'utf8' },
  )
  return Number(output.trim())
}

describe('ningún asiento SQUAD se queda sin discipline_entries (C7, W8)', () => {
  it('count(entries SQUAD sin fila en discipline_entries) = 0', () => {
    expect(countOrphanedSquadEntries()).toBe(0)
  })
})

// ── PR 5 — config por disciplina (REQ-D2-1) ─────────────────────────────────
// `disciplines.config` existe desde PR 1 (0015), pero hasta acá el único
// escritor era `updateSeasonConfig`, que sólo toca `seasons.config` — dos
// disciplinas de la misma temporada podían divergir sin que nada las leyera
// de vuelta. `disciplineConfig`/`updateDisciplineConfig` son el primer par
// lectura/escritura que trata `disciplines.config` como la fuente real, POR
// disciplina, sin herencia cruzada entre pádel y FIFA.
describe('disciplineConfig / updateDisciplineConfig (PR 5, REQ-D2-1)', () => {
  it('cada disciplina devuelve su propia config, sin herencia cruzada', async () => {
    const admin = await createTestUser()
    const padelConfig = defaultConfig(8)
    const fifaConfig = { ...defaultConfig(10), regularMatchdays: 6 }
    const { disciplineIds } = await createSeason({
      admin,
      disciplines: [{ config: padelConfig }, { kind: 'FIFA', config: fifaConfig }],
    })
    const [padelId, fifaId] = disciplineIds
    if (padelId === undefined || fifaId === undefined) throw new Error('Faltan disciplinas.')

    expect(await disciplineConfig(admin.client, padelId)).toEqual(padelConfig)
    expect(await disciplineConfig(admin.client, fifaId)).toEqual(fifaConfig)
  })

  it('updateDisciplineConfig sólo toca la disciplina destino', async () => {
    const admin = await createTestUser()
    const padelConfig = defaultConfig(8)
    const fifaConfig = defaultConfig(10)
    const { disciplineIds } = await createSeason({
      admin,
      disciplines: [{ config: padelConfig }, { kind: 'FIFA', config: fifaConfig }],
    })
    const [padelId, fifaId] = disciplineIds
    if (padelId === undefined || fifaId === undefined) throw new Error('Faltan disciplinas.')

    const nextPadelConfig = { ...padelConfig, regularMatchdays: 14 }
    await updateDisciplineConfig(admin.client, padelId, nextPadelConfig)

    expect(await disciplineConfig(admin.client, padelId)).toEqual(nextPadelConfig)
    expect(await disciplineConfig(admin.client, fifaId)).toEqual(fifaConfig)
  })

  it('rechaza una config inválida antes de escribir (assertValidConfig)', async () => {
    const admin = await createTestUser()
    const { disciplineId } = await createSeason({ admin })
    const broken = { ...defaultConfig(8), tiebreakSnapshotEvery: 0 }

    await expect(updateDisciplineConfig(admin.client, disciplineId, broken)).rejects.toThrow()
    expect(await disciplineConfig(admin.client, disciplineId)).toEqual(defaultConfig(8))
  })
})

// ── C5, verify-report ronda 3 ────────────────────────────────────────────────
// `matchdayContextFor` (lo que arma `closeMatchday`) seguía resolviendo
// `config` con `seasonConfig()` (`seasons.config`), que `updateDisciplineConfig`
// nunca escribe desde PR 5: el admin editaba Reglas, Ajustes mostraba el valor
// nuevo, y cerrar la fecha repartía los puntos VIEJOS en silencio.
// `disciplineConfig` existía desde PR 5 sin un solo caller de producción (W7).
describe('la config editada llega al motor de puntajes (C5, verify-report ronda 3)', () => {
  it('matchdayContextFor recalcula con la config NUEVA después de updateDisciplineConfig', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineId } = await createSeason({ admin })
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')

    const newConfig = { ...defaultConfig(8), points: [100, 60, 30, 10], regularMatchdays: 42 }
    await updateDisciplineConfig(admin.client, disciplineId, newConfig)

    const context = await matchdayContextFor(admin.client, matchdayId)
    expect(context.config.points).toEqual([100, 60, 30, 10])
    expect(context.config.regularMatchdays).toBe(42)
  })
})
