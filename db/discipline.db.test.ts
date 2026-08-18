import { execFileSync } from 'node:child_process'
import { describe, it, expect } from 'vitest'
import { defaultConfig } from '@/core'
import { createMatchday, matchdayContextFor } from './matchday'
import { addDiscipline, disciplineConfig, updateDisciplineConfig } from './discipline'
import { awardsOf, derivedSeasonStatus } from './read'
import { squadSeedOrder } from './season'
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
    // W21 (verify-report ronda 6): dato crudo de PostgREST, sin `Number()` a
    // propósito — `numeric(4,2)` YA llega `number`, esto es la prueba de eso
    // (con el wrapper el assert nunca podría detectar lo contrario).
    expect(row?.weight).toBe(1)
    expect(typeof row?.weight).toBe('number')
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

    expect(await disciplineConfig(admin.client, padelId)).toEqual({ config: padelConfig, pairSize: 2 })
    expect(await disciplineConfig(admin.client, fifaId)).toEqual({ config: fifaConfig, pairSize: 2 })
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

    expect(await disciplineConfig(admin.client, padelId)).toEqual({ config: nextPadelConfig, pairSize: 2 })
    expect(await disciplineConfig(admin.client, fifaId)).toEqual({ config: fifaConfig, pairSize: 2 })
  })

  it('rechaza una config inválida antes de escribir (assertValidConfig)', async () => {
    const admin = await createTestUser()
    const { disciplineId } = await createSeason({ admin })
    const broken = { ...defaultConfig(8), tiebreakSnapshotEvery: 0 }

    await expect(updateDisciplineConfig(admin.client, disciplineId, broken)).rejects.toThrow()
    expect(await disciplineConfig(admin.client, disciplineId)).toEqual({ config: defaultConfig(8), pairSize: 2 })
  })

  /*
   * C20 (verify-report ronda 13). `updateDisciplineConfig` es el ÚNICO escritor
   * de `disciplines.config` y validaba con `sideSize` hardcodeado en 2. Sobre
   * una disciplina de a uno eso queda INVERTIDO: rechaza la única config válida
   * y acepta la que la deja inutilizable.
   *
   * El daño no es "no se puede editar". Con una fecha OPEN y los resultados
   * cargados, un solo toque del +/− en Ajustes → Formato (que guarda a cada
   * toque) escribe una config que `matchdayContextFor` después rechaza: la
   * fecha no cierra, y la config no se puede volver atrás desde la misma
   * pantalla porque el escritor sigue exigiendo la aritmética de parejas.
   * Salida sólo por SQL — estrictamente peor que C19, que dejaba cancelar.
   *
   * `validateConfig` exige `points.length === floor(squadSize / sideSize)`, así
   * que con 8 asientos de a uno la config correcta tiene 8 valores, no 4.
   */
  it('valida con el pair_size REAL de la disciplina, no con 2 fijo (C20)', async () => {
    const admin = await createTestUser()
    const soloConfig = { ...defaultConfig(8), points: [8, 7, 6, 5, 4, 3, 2, 1] }
    const { disciplineIds } = await createSeason({
      admin,
      disciplines: [{ kind: 'FIFA', pairSize: 1, config: soloConfig }],
    })
    const [soloId] = disciplineIds
    if (soloId === undefined) throw new Error('Falta la disciplina de a uno.')

    // 1) La config CORRECTA de una disciplina de a uno se acepta.
    const nextSolo = { ...soloConfig, regularMatchdays: 14 }
    await updateDisciplineConfig(admin.client, soloId, nextSolo)
    expect(await disciplineConfig(admin.client, soloId)).toEqual({ config: nextSolo, pairSize: 1 })

    // 2) La config de PAREJAS (4 valores para 8 asientos) se rechaza, y no se
    //    escribe: es la que dejaba la disciplina sin poder armar ni cerrar.
    const pairShaped = { ...soloConfig, points: [10, 7, 5, 3] }
    await expect(updateDisciplineConfig(admin.client, soloId, pairShaped)).rejects.toThrow(
      /8 valores de puntos/,
    )
    expect(await disciplineConfig(admin.client, soloId)).toEqual({ config: nextSolo, pairSize: 1 })
  })

  /*
   * S46 (verify-report ronda 14). Un update de PostgREST que no toca ninguna
   * fila NO es un error: `saveDisciplineConfig` no tiene chequeo de admin
   * propio, se apoya en RLS, y un participante que NO organiza pasa el
   * `select` de `disciplineConfig` (`disciplines_read` usa `is_participant`)
   * y después su update matchea 0 filas contra `disciplines_write` (que usa
   * `is_season_admin`). Sin `count: 'exact'` la pantalla le decía que guardó
   * y al recargar volvía la config vieja.
   *
   * Mismo defecto y mismo remedio que `setMatchdayDate` (db/matchday.ts), que
   * ya lo tenía documentado — esta función era la que faltaba.
   */
  it('a un participante que no organiza le avisa que no guardó, en vez de mentirle (S46)', async () => {
    const admin = await createTestUser()
    const member = await createTestUser()
    const { seasonId, disciplineId } = await createSeason({
      admin,
      squad: [member.playerId],
      config: defaultConfig(8),
    })
    // `createSeason` con `squad: [member.playerId]` ya le siembra el asiento
    // atado a su player, así que `is_participant` da true sin reclamar nada:
    // ve la disciplina (`disciplines_read`) y no la puede escribir
    // (`disciplines_write`). Ése es exactamente el hueco de S46.
    const antes = await disciplineConfig(admin.client, disciplineId)
    const otra = { ...defaultConfig(8), regularMatchdays: 14 }

    await expect(updateDisciplineConfig(member.client, disciplineId, otra)).rejects.toThrow(
      /sólo puede hacerlo quien organiza/,
    )
    // Y no guardó nada, que es la mitad que el mensaje tenía que dejar de tapar.
    expect(await disciplineConfig(admin.client, disciplineId)).toEqual(antes)
  })

  it('sigue exigiendo la aritmética de parejas donde el lado es de dos (C20, no-regresión)', async () => {
    const admin = await createTestUser()
    const { disciplineId } = await createSeason({ admin })
    const soloShaped = { ...defaultConfig(8), points: [8, 7, 6, 5, 4, 3, 2, 1] }

    await expect(updateDisciplineConfig(admin.client, disciplineId, soloShaped)).rejects.toThrow(
      /4 valores de puntos/,
    )
    expect(await disciplineConfig(admin.client, disciplineId)).toEqual({ config: defaultConfig(8), pairSize: 2 })
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

// ── PR 13 — S19 (verify-report ronda 6): (season_id, position) único ───────
// El caso real nunca choca (`createSeason` escribe `position` explícito
// desde S13), así que el índice se prueba armando la colisión a mano: es la
// única forma de ejercitar `disciplines_season_position` (0027) sin esperar
// a que un bug futuro la reproduzca sola.
describe('disciplines_season_position (S19, 0027)', () => {
  it('rechaza una segunda disciplina con el mismo (season_id, position)', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason({ admin }) // PADEL en position 0

    const { error } = await adminClient()
      .from('disciplines')
      .insert({ season_id: seasonId, kind: 'FIFA', config: {}, position: 0 } as never)

    expect(error?.code).toBe('23505')
  })
})

// ── PR 13 — addDiscipline (REQ-D1-2) ────────────────────────────────────────
async function fillerPlayers(count: number): Promise<string[]> {
  const db = adminClient()
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    const { data, error } = await db
      .from('players')
      .insert({ display_name: `Relleno de test ${Date.now()}-${i}-${Math.random()}` })
      .select('id')
      .single()
    if (error || data === null) throw new Error(error?.message)
    ids.push(data.id)
  }
  return ids
}

async function insertMatchday(
  seasonId: string,
  disciplineId: string,
  number: number,
  status: 'OPEN' | 'CLOSED',
): Promise<string> {
  const { data, error } = await adminClient()
    .from('matchdays')
    .insert({ season_id: seasonId, discipline_id: disciplineId, number, status })
    .select('id')
    .single()
  if (error || data === null) throw new Error(error?.message)
  return data.id
}

async function insertAward(
  matchdayId: string,
  seasonId: string,
  entryId: string,
  position: number,
  points: number,
): Promise<void> {
  const { error } = await adminClient()
    .from('awards')
    .insert({ matchday_id: matchdayId, season_id: seasonId, entry_id: entryId, position, points })
  if (error) throw new Error(error.message)
}

describe('addDiscipline (PR 13, REQ-D1-2)', () => {
  it('crea la disciplina en SETUP con position explícito, sin tocar la existente (awards intactos, D3-1 simultánea)', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineId: padelId, entryIds } = await createSeason({
      admin,
      squad: [admin.playerId, ...(await fillerPlayers(7))], // MIN_PLAYERS = 8
    })
    const [a, b] = entryIds
    if (a === undefined || b === undefined) throw new Error('Faltan asientos.')
    const db = adminClient()
    await db.from('disciplines').update({ status: 'ACTIVE' }).eq('id', padelId)

    // pádel ACTIVE, 2 fechas cerradas con awards, una tercera abierta (D3-1).
    const md1 = await insertMatchday(seasonId, padelId, 1, 'CLOSED')
    await insertAward(md1, seasonId, a, 1, 10)
    await insertAward(md1, seasonId, b, 2, 6)
    const md2 = await insertMatchday(seasonId, padelId, 2, 'CLOSED')
    await insertAward(md2, seasonId, a, 1, 10)
    const mdOpen = await insertMatchday(seasonId, padelId, 3, 'OPEN')
    const awardsBefore = await awardsOf(admin.client, seasonId)

    const fifaId = await addDiscipline(admin.client, seasonId, { kind: 'FIFA', config: defaultConfig(8) })

    // pádel: bit a bit igual — nada de esto lo tocó addDiscipline.
    expect(await awardsOf(admin.client, seasonId)).toEqual(awardsBefore)
    const { data: padelRow } = await db.from('disciplines').select('status').eq('id', padelId).single()
    expect(padelRow?.status).toBe('ACTIVE')
    const { data: mdOpenRow } = await db.from('matchdays').select('status').eq('id', mdOpen).single()
    expect(mdOpenRow?.status, 'REQ-D3-1: la OPEN de pádel sigue OPEN mientras se suma FIFA').toBe('OPEN')

    // FIFA: nueva, SETUP, position explícito (nunca el default 0 — S19).
    const { data: fifaRow } = await db.from('disciplines').select('status, position').eq('id', fifaId).single()
    expect(fifaRow?.status).toBe('SETUP')
    expect(fifaRow?.position).toBe(1)
  })

  it('siembra discipline_entries: todo el plantel por default, un subconjunto si se pasa entryIds (REQ-D1-4)', async () => {
    const admin = await createTestUser()
    // 10 asientos, no 8: la guarda de C13 exige que config.squadSize coincida
    // con lo sembrado, y el subconjunto no-contiguo de abajo necesita quedar
    // en un tamaño válido ({8,10,12}) distinto del total.
    const { seasonId, entryIds } = await createSeason({
      admin,
      squad: [admin.playerId, ...(await fillerPlayers(9))],
    })
    const [, skip1, , skip2] = entryIds
    if (skip1 === undefined || skip2 === undefined) throw new Error('Faltan asientos.')
    const db = adminClient()

    const allId = await addDiscipline(admin.client, seasonId, { kind: 'FIFA', config: defaultConfig(10) })
    expect(await squadSeedOrder(admin.client, allId)).toEqual(entryIds)

    await db.from('disciplines').delete().eq('id', allId)
    const subset = entryIds.filter((id) => id !== skip1 && id !== skip2)
    const partialId = await addDiscipline(
      admin.client,
      seasonId,
      { kind: 'FIFA', config: defaultConfig(subset.length) },
      subset,
    )
    expect(await squadSeedOrder(admin.client, partialId)).toEqual(subset)
  })

  // PR14 slice A — mismo contrato que createSeason: addDiscipline también
  // puede declarar pair_size/allows_draw explícitos al sumar una disciplina
  // a un torneo en curso (REQ-D2-1, decisión #5).
  it('acepta pair_size/allows_draw explícitos al agregar una disciplina', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason({
      admin,
      squad: [admin.playerId, ...(await fillerPlayers(7))],
    })

    // 8 valores de puntos, no los 4 de `defaultConfig(8)` (C16, verify-report
    // ronda 9): con `pairSize: 1`, 8 presentes son 8 lados, no 4 parejas.
    const fifaId = await addDiscipline(admin.client, seasonId, {
      kind: 'FIFA',
      config: { ...defaultConfig(8), points: [8, 7, 6, 5, 4, 3, 2, 1] },
      pairSize: 1,
      allowsDraw: true,
    })

    const { data } = await adminClient()
      .from('disciplines')
      .select('pair_size, allows_draw')
      .eq('id', fifaId)
      .single()
    expect(data).toEqual({ pair_size: 1, allows_draw: true })
  })

  // C13 (verify-report ronda 7): `config.squadSize` no se comparaba contra
  // los asientos realmente sembrados — mismo agujero que `createSeason`
  // (db/season.ts:240) ya tapa para el wizard.
  it('rechaza una config cuyo squadSize no coincide con los asientos sembrados (C13)', async () => {
    const admin = await createTestUser()
    const { seasonId, entryIds } = await createSeason({
      admin,
      squad: [admin.playerId, ...(await fillerPlayers(9))], // 10 asientos
    })

    await expect(
      addDiscipline(admin.client, seasonId, { kind: 'PADEL', config: defaultConfig(10) }, entryIds.slice(0, 9)),
    ).rejects.toThrow()
  })
})
