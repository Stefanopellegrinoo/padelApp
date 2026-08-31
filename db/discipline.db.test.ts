import { execFileSync } from 'node:child_process'
import { describe, it, expect } from 'vitest'
import { defaultConfig } from '@/core'
import { createMatchday, matchdayContextFor } from './matchday'
import {
  addDiscipline,
  disciplineConfig,
  updateDisciplineConfig,
  updateDisciplineHasMasters,
  updateDisciplineRules,
} from './discipline'
import { awardsOf, seasonHeader } from './read'
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
    // Dato crudo de PostgREST, sin `Number()` a
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

  //(0020_disciplines_grants.sql): el UPDATE de disciplines.status ya
  // estaba revocado (0015:69); el INSERT era a nivel tabla y lo esquivaba —
  // un admin de temporada (RLS lo deja escribir, `disciplines_write` pide
  // sólo `is_season_admin`) podía crear una disciplina ya en ACTIVE por
  // PostgREST, saltando el trinquete que las funciones (0019) existen para
  // hacer cumplir. Prueba de comportamiento contra la API real, no
  // introspección: `information_schema` no está expuesto por PostgREST
  // (`supabase/config.toml`: `schemas = ["public", "graphql_public"]`), así
  // que la verificación de grants en sí se hizo a mano contra la base
  // (psql), no es alcanzable desde este archivo.
  it('un admin de temporada no puede insertar una disciplina ya en ACTIVE', async () => {
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

  //(0020_disciplines_grants.sql): PR 4 nunca la llamó (lee discipline_id
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
// W91: estos dos llamaban a `derivedSeasonStatus`, que tenía CERO callers de
// producción — `seasonHeader` deriva inline con `seasonStatusOf` sobre las
// filas que ya trae. Ahora ejercitan ese camino, que es el que corre la app.
describe('el estado derivado de la temporada (REQ-D3-3)', () => {
  it('temporada recién creada: SETUP', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason({ admin })

    expect((await seasonHeader(admin.client, seasonId)).status).toBe('SETUP')
  })

  it('con la disciplina en ACTIVE: ACTIVE', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineId } = await createSeason({ admin })
    const db = adminClient()
    const { error } = await db.from('disciplines').update({ status: 'ACTIVE' }).eq('id', disciplineId)
    if (error) throw new Error(error.message)

    expect((await seasonHeader(admin.client, seasonId)).status).toBe('ACTIVE')
  })
})

// `supabase/seed.sql` insertaba la temporada demo a mano, sin su disciplina:
// tras un `supabase db reset` limpio, crear una fecha en ese torneo rompía
// con PGRST116 ("No se pudo leer la disciplina de la temporada"). El fix es
// en el seed; esto es la aserción de no-regresión, medida contra la base
// completa —no sólo contra lo que este archivo crea— para que un futuro
// insert manual de `seasons` (acá o en otro seed) no vuelva a dejar una
// temporada huérfana en silencio.
describe('REQ-NR-4 — ninguna temporada se queda sin disciplina', () => {
  // La pregunta la contesta la BASE, con un left join y `count: 'exact'`, y no
  // dos selects cruzados en JavaScript.
  //
  // Esa versión anterior traía `seasons.id` y `disciplines.season_id` enteros y
  // los cruzaba acá. PostgREST corta CADA select en 1000 filas por default y no
  // avisa: la suite comparte una base que no se resetea entre corridas, y en
  // cuanto pasó ese techo (medido: 1447 temporadas y 1635 disciplinas, 0
  // huérfanas de verdad) el cruce empezó a comparar dos listas truncadas y a
  // reportar 248 huérfanas que no existen. Un tripwire que se vuelve falso
  // positivo con el uso es peor que no tener tripwire: enseña a ignorarlo.
  //
  // `!left` + `.is('disciplines', null)` es "temporadas sin ninguna
  // disciplina" resuelto del lado de Postgres, y `head: true` no trae filas,
  // así que no hay página que se pueda cortar.
  it('count(seasons sin disciplinas) = 0', async () => {
    const db = adminClient()
    const { count, error } = await db
      .from('seasons')
      .select('id, disciplines!left(id)', { count: 'exact', head: true })
      .is('disciplines', null)
    if (error) throw new Error(error.message)
    expect(count).toBe(0)
  })
})

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

describe('ningún asiento SQUAD se queda sin discipline_entries', () => {
  it('count(entries SQUAD sin fila en discipline_entries) = 0', () => {
    expect(countOrphanedSquadEntries()).toBe(0)
  })
})

//── PR 5 — config por disciplina (REQ-D2-1) ─────────────────────────────────
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
      disciplines: [{ config: padelConfig }, { kind: 'FIFA', config: fifaConfig, allowsDraw: true }],
    })
    const [padelId, fifaId] = disciplineIds
    if (padelId === undefined || fifaId === undefined) throw new Error('Faltan disciplinas.')

    //`allowsDraw` viaja en el mismo select desde W61:
    // es la fuente que `createMatchday` necesita para no rebotar contra
    // `matchdays_discipline_draw`, y tampoco se hereda entre disciplinas.
    expect(await disciplineConfig(admin.client, padelId)).toEqual({ config: padelConfig, pairSize: 2, allowsDraw: false, fixedTeams: false })
    expect(await disciplineConfig(admin.client, fifaId)).toEqual({ config: fifaConfig, pairSize: 2, allowsDraw: true, fixedTeams: false })
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

    expect(await disciplineConfig(admin.client, padelId)).toEqual({ config: nextPadelConfig, pairSize: 2, allowsDraw: false, fixedTeams: false })
    expect(await disciplineConfig(admin.client, fifaId)).toEqual({ config: fifaConfig, pairSize: 2, allowsDraw: false, fixedTeams: false })
  })

  it('rechaza una config inválida antes de escribir (assertValidConfig)', async () => {
    const admin = await createTestUser()
    const { disciplineId } = await createSeason({ admin })
    const broken = { ...defaultConfig(8), tiebreakSnapshotEvery: 0 }

    await expect(updateDisciplineConfig(admin.client, disciplineId, broken)).rejects.toThrow()
    expect(await disciplineConfig(admin.client, disciplineId)).toEqual({ config: defaultConfig(8), pairSize: 2, allowsDraw: false, fixedTeams: false })
  })

  /*
   * C20. `updateDisciplineConfig` es el ÚNICO escritor
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
  it('valida con el pair_size REAL de la disciplina, no con 2 fijo', async () => {
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
    expect(await disciplineConfig(admin.client, soloId)).toEqual({ config: nextSolo, pairSize: 1, allowsDraw: false, fixedTeams: false })

    // 2) La config de PAREJAS (4 valores para 8 asientos) se rechaza, y no se
    //    escribe: es la que dejaba la disciplina sin poder armar ni cerrar.
    const pairShaped = { ...soloConfig, points: [10, 7, 5, 3] }
    await expect(updateDisciplineConfig(admin.client, soloId, pairShaped)).rejects.toThrow(
      /8 valores de puntos/,
    )
    expect(await disciplineConfig(admin.client, soloId)).toEqual({ config: nextSolo, pairSize: 1, allowsDraw: false, fixedTeams: false })
  })

  /*
   * S46. Un update de PostgREST que no toca ninguna
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
  it('a un participante que no organiza le avisa que no guardó, en vez de mentirle', async () => {
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
    //(`disciplines_write`). Ése es exactamente el hueco de S46.
    const antes = await disciplineConfig(admin.client, disciplineId)
    const otra = { ...defaultConfig(8), regularMatchdays: 14 }

    await expect(updateDisciplineConfig(member.client, disciplineId, otra)).rejects.toThrow(
      /sólo puede hacerlo quien organiza/,
    )
    // Y no guardó nada, que es la mitad que el mensaje tenía que dejar de tapar.
    expect(await disciplineConfig(admin.client, disciplineId)).toEqual(antes)
  })

  /*
   * C23. La migración 0032 convirtió a la BASE en un
   * segundo escritor de `disciplines.config`: al promover un invitado de a uno
   * agrega un casillero de puntos y sube `squadSize`. `updateDisciplineConfig`
   * siguió siendo un overwrite ciego del blob entero, sin saber contra qué
   * versión se editó.
   *
   * La auditoría lo reprodujo con dos pestañas y clicks reales: Ajustes ›
   * Formato abierto con 8 valores, otra pestaña promueve (la config pasa a 9),
   * y el primer "+" que toca el admin pisa la config con 8 — sin un solo error
   * en pantalla. El casillero se pierde y volvemos a C22: reabrir esa fecha
   * destruye los 8 premios congelados.
   *
   * El guard compara el LARGO de `points` y `squadSize`, que son justo los dos
   * campos que la app se escribe a sí misma. Formato edita VALORES, no el
   * largo ni el plantel (no tiene controles para eso), así que una diferencia
   * ahí sólo puede venir de que la fila cambió abajo.
   */
  it('rechaza un guardado armado sobre una config que ya cambió', async () => {
    const admin = await createTestUser()
    const soloConfig = { ...defaultConfig(8), points: [8, 7, 6, 5, 4, 3, 2, 1] }
    const { disciplineIds } = await createSeason({
      admin,
      disciplines: [{ kind: 'FIFA', pairSize: 1, config: soloConfig }],
    })
    const [soloId] = disciplineIds
    if (soloId === undefined) throw new Error('Falta la disciplina de a uno.')

    // Lo que la pantalla tiene en la mano cuando el admin abre Formato.
    const loQueLaPantallaVio = (await disciplineConfig(admin.client, soloId)).config

    // Mientras tanto la base crece la config, como hace `promote_guest`
    // (0032). Va por service_role y no por `updateDisciplineConfig`: la que
    // escribe acá es la FUNCIÓN SQL, que no pasa por este camino — y además el
    // guard nuevo la rechazaría, porque desde su punto de vista también sería
    // un guardado sobre otra versión.
    const crecida = {
      ...loQueLaPantallaVio,
      squadSize: 9,
      points: [...loQueLaPantallaVio.points, 0],
    }
    const { error: crecerError } = await adminClient()
      .from('disciplines')
      .update({ config: crecida as unknown as never })
      .eq('id', soloId)
    if (crecerError) throw new Error(crecerError.message)

    // Y recién ahora el admin toca el "+" del primer puesto, sobre lo viejo.
    const editadoSobreLoViejo = {
      ...loQueLaPantallaVio,
      points: [9, ...loQueLaPantallaVio.points.slice(1)],
    }
    await expect(updateDisciplineConfig(admin.client, soloId, editadoSobreLoViejo)).rejects.toThrow(
      /cambió mientras editabas/,
    )

    // Y no pisó nada: el casillero que la base agregó sigue ahí.
    expect((await disciplineConfig(admin.client, soloId)).config).toEqual(crecida)
  })

  it('un guardado normal sobre la config vigente sigue pasando (C23, no-regresión)', async () => {
    const admin = await createTestUser()
    const { disciplineId } = await createSeason({ admin })
    const vigente = (await disciplineConfig(admin.client, disciplineId)).config

    // Cambiar VALORES —que es lo único que Formato hace— no toca ni el largo
    // ni el plantel, así que tiene que pasar sin ruido.
    const editada = { ...vigente, points: [12, ...vigente.points.slice(1)] }
    await updateDisciplineConfig(admin.client, disciplineId, editada)
    expect((await disciplineConfig(admin.client, disciplineId)).config).toEqual(editada)
  })

  it('sigue exigiendo la aritmética de parejas donde el lado es de dos (C20, no-regresión)', async () => {
    const admin = await createTestUser()
    const { disciplineId } = await createSeason({ admin })
    const soloShaped = { ...defaultConfig(8), points: [8, 7, 6, 5, 4, 3, 2, 1] }

    await expect(updateDisciplineConfig(admin.client, disciplineId, soloShaped)).rejects.toThrow(
      /4 valores de puntos/,
    )
    expect(await disciplineConfig(admin.client, disciplineId)).toEqual({ config: defaultConfig(8), pairSize: 2, allowsDraw: false, fixedTeams: false })
  })
})

// `matchdayContextFor` (lo que arma `closeMatchday`) seguía resolviendo
// `config` con `seasonConfig()` (`seasons.config`), que `updateDisciplineConfig`
// nunca escribe desde PR 5: el admin editaba Reglas, Ajustes mostraba el valor
// nuevo, y cerrar la fecha repartía los puntos VIEJOS en silencio.
//`disciplineConfig` existía desde PR 5 sin un solo caller de producción.
describe('la config editada llega al motor de puntajes', () => {
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

//── PR 13 — S19: (season_id, position) único ───────
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

//── PR 13 — addDiscipline (REQ-D1-2) ────────────────────────────────────────
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
    //10 asientos, no 8: la guarda de C13 exige que config.squadSize coincida
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

  // C37 / decisión #4044: "una disciplina nueva COPIA el orden de la primaria
  // como punto de partida". Hasta acá lo copiaba de `entries.seed_position`,
  // que el contract relaja a `null` para el SQUAD — y `discipline_entries.
  // seed_position` es `not null check (>= 0)`, así que el `drop not null` no
  // degradaba esto: lo reventaba entero (REQ-D1-2 completo).
  //
  // La divergencia es a propósito: mientras el dual-write siga vivo los dos
  // órdenes coinciden y copiar del lugar equivocado pasaría igual.
  it('copia el orden de la PRIMARIA, no el de entries.seed_position (C37)', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineId: padelId, entryIds } = await createSeason({
      admin,
      squad: [admin.playerId, ...(await fillerPlayers(7))],
    })
    if (entryIds.length !== 8) throw new Error('Faltan asientos.')

    // Pádel (la primaria) queda al revés que `entries.seed_position`, que
    // sigue en 0..7. Parking de dos pasadas por `discipline_entries_seed`.
    const db = adminClient()
    const reversed = [...entryIds].reverse()
    for (const [index, entryId] of reversed.entries()) {
      const { error } = await db
        .from('discipline_entries')
        .update({ seed_position: index + 100 })
        .eq('discipline_id', padelId)
        .eq('entry_id', entryId)
      if (error) throw new Error(error.message)
    }
    for (const [index, entryId] of reversed.entries()) {
      const { error } = await db
        .from('discipline_entries')
        .update({ seed_position: index })
        .eq('discipline_id', padelId)
        .eq('entry_id', entryId)
      if (error) throw new Error(error.message)
    }

    const fifaId = await addDiscipline(admin.client, seasonId, { kind: 'FIFA', config: defaultConfig(8) })
    expect(await squadSeedOrder(admin.client, fifaId)).toEqual(reversed)
  })

  // La otra mitad de #4044 acá: quien no juega la primaria no tiene orden que
  // copiar. Va al final — no se pierde (seguiría siendo asiento de la
  // temporada) y no rompe el `not null` de `discipline_entries`.
  it('manda al final a quien no juega la primaria al sembrar la nueva (C37)', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineId: padelId, entryIds } = await createSeason({
      admin,
      squad: [admin.playerId, ...(await fillerPlayers(7))],
    })
    const orphan = entryIds[1]
    if (orphan === undefined || entryIds.length !== 8) throw new Error('Faltan asientos.')

    const db = adminClient()
    const { error } = await db
      .from('discipline_entries')
      .delete()
      .eq('discipline_id', padelId)
      .eq('entry_id', orphan)
    if (error) throw new Error(error.message)

    const fifaId = await addDiscipline(admin.client, seasonId, { kind: 'FIFA', config: defaultConfig(8) })
    expect(await squadSeedOrder(admin.client, fifaId)).toEqual([
      ...entryIds.filter((id) => id !== orphan),
      orphan,
    ])
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

    //8 valores de puntos, no los 4 de `defaultConfig(8)` (C16, 
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

  //`config.squadSize` no se comparaba contra
  // los asientos realmente sembrados — mismo agujero que `createSeason`
  // (db/season.ts:240) ya tapa para el wizard.
  it('rechaza una config cuyo squadSize no coincide con los asientos sembrados', async () => {
    const admin = await createTestUser()
    const { seasonId, entryIds } = await createSeason({
      admin,
      squad: [admin.playerId, ...(await fillerPlayers(9))], // 10 asientos
    })

    await expect(
      addDiscipline(admin.client, seasonId, { kind: 'PADEL', config: defaultConfig(10) }, entryIds.slice(0, 9)),
    ).rejects.toThrow()
  })

  /**
   * Decisión #4029, parte 1: `has_masters` nace por `pair_size`, automático,
   * sin que nadie lo pase. Antes de esta tanda la columna nacía en `true`
   * por default (0015) y nada la escribía — el camino que C34 destrabó
   * (`create_masters`/`close_matchday`/`reopen_matchday` YA la leen, tanda
   * anterior) seguía sin un solo productor que la pusiera en `false`.
   */
  it('con pairSize=1, la disciplina nace con has_masters=false (decisión #4029)', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason({
      admin,
      squad: [admin.playerId, ...(await fillerPlayers(7))],
    })

    const fifaId = await addDiscipline(admin.client, seasonId, {
      kind: 'FIFA',
      config: { ...defaultConfig(8), points: [8, 7, 6, 5, 4, 3, 2, 1] },
      pairSize: 1,
    })

    const { data } = await adminClient().from('disciplines').select('has_masters').eq('id', fifaId).single()
    expect(data?.has_masters).toBe(false)
  })

  it('con pairSize=2 (o sin pasarlo), la disciplina nace con has_masters=true -- no-regresión', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason({
      admin,
      squad: [admin.playerId, ...(await fillerPlayers(7))],
    })

    const padelId = await addDiscipline(admin.client, seasonId, { kind: 'PADEL', config: defaultConfig(8) })

    const { data } = await adminClient().from('disciplines').select('has_masters').eq('id', padelId).single()
    expect(data?.has_masters).toBe(true)
  })
})

//── Decisión #4029, partes 2 y 3 — editable en Ajustes, con guard ──────────
describe('updateDisciplineHasMasters (decisión #4029, parte 2)', () => {
  it('un admin puede apagar y volver a prender el Masters de una disciplina de a dos', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineId } = await createSeason({ admin })

    await updateDisciplineHasMasters(admin.client, disciplineId, false)
    expect((await adminClient().from('disciplines').select('has_masters').eq('id', disciplineId).single()).data)
      .toEqual({ has_masters: false })

    await updateDisciplineHasMasters(admin.client, disciplineId, true)
    expect((await adminClient().from('disciplines').select('has_masters').eq('id', disciplineId).single()).data)
      .toEqual({ has_masters: true })
  })

  /**
   * Parte 3 de la decisión: NO se puede encender el Masters en una
   * disciplina de a uno -- ahí sigue roto (`generateMastersPairs`,
   * `db/matchday.ts`, rechaza siempre `pair_size=1`). Ofrecerlo sería
   * ofrecer algo que la app rechaza después.
   */
  it('rechaza encender el Masters en una disciplina de a uno, y no escribe nada', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason({
      admin,
      squad: [admin.playerId, ...(await fillerPlayers(7))],
    })
    const soloId = await addDiscipline(admin.client, seasonId, {
      kind: 'FIFA',
      config: { ...defaultConfig(8), points: [8, 7, 6, 5, 4, 3, 2, 1] },
      pairSize: 1,
    })

    await expect(updateDisciplineHasMasters(admin.client, soloId, true)).rejects.toThrow(
      /una disciplina de a uno/,
    )
    const { data } = await adminClient().from('disciplines').select('has_masters').eq('id', soloId).single()
    expect(data?.has_masters).toBe(false)
  })

  it('apagar el Masters de una disciplina de a uno (ya apagado) no rebota -- idempotente', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason({
      admin,
      squad: [admin.playerId, ...(await fillerPlayers(7))],
    })
    const soloId = await addDiscipline(admin.client, seasonId, {
      kind: 'FIFA',
      config: { ...defaultConfig(8), points: [8, 7, 6, 5, 4, 3, 2, 1] },
      pairSize: 1,
    })

    await expect(updateDisciplineHasMasters(admin.client, soloId, false)).resolves.toBeUndefined()
  })
})

/**
 * El guard de aplicación no alcanza solo (#3989): `grant update (...,
 * has_masters, ...) to authenticated` (0015:70) es de COLUMNA, no de
 * función -- un `PATCH` directo a `disciplines` salta `updateDisciplineHasMasters`
 * entero. El CHECK de la migración 0053 es lo que de verdad no se puede
 * esquivar, y por eso este describe entra por la tabla directo, con
 * `admin.client` (`authenticated`) y NUNCA `service_role` (regla del repo:
 * nunca `service_role` para probar lo que ejecuta `authenticated`).
 */
describe('disciplines_has_masters_needs_pair (decisión #4029, parte 3, guard de base)', () => {
  it('un UPDATE directo que prende has_masters en pair_size=1 lo rechaza la base, no TypeScript', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason({
      admin,
      squad: [admin.playerId, ...(await fillerPlayers(7))],
    })
    const soloId = await addDiscipline(admin.client, seasonId, {
      kind: 'FIFA',
      config: { ...defaultConfig(8), points: [8, 7, 6, 5, 4, 3, 2, 1] },
      pairSize: 1,
    })

    const { error } = await admin.client.from('disciplines').update({ has_masters: true }).eq('id', soloId)
    expect(error?.code).toBe('23514') // check_violation, no un rechazo de aplicación
  })

  it('un INSERT directo con pair_size=1 y has_masters=true también lo rechaza la base', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason({ admin })

    const { error } = await admin.client
      .from('disciplines')
      .insert({ season_id: seasonId, kind: 'FIFA', config: {}, position: 1, pair_size: 1, has_masters: true } as never)
    expect(error?.code).toBe('23514')
  })

  it('las tres combinaciones legales (2/true, 2/false, 1/false) siguen pasando -- no-regresión', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason({
      admin,
      squad: [admin.playerId, ...(await fillerPlayers(7))],
    })

    const pairsOn = await admin.client
      .from('disciplines')
      .insert({ season_id: seasonId, kind: 'PADEL', config: {}, position: 1, pair_size: 2, has_masters: true } as never)
    const pairsOff = await admin.client
      .from('disciplines')
      .insert({ season_id: seasonId, kind: 'PADEL', config: {}, position: 2, pair_size: 2, has_masters: false } as never)
    const soloOff = await admin.client
      .from('disciplines')
      .insert({ season_id: seasonId, kind: 'FIFA', config: {}, position: 3, pair_size: 1, has_masters: false } as never)

    expect(pairsOn.error).toBeNull()
    expect(pairsOff.error).toBeNull()
    expect(soloOff.error).toBeNull()
  })
})

//── Rebanada 2 de "reglas por disciplina" — updateDisciplineRules (R8, R12) ──
// Reemplaza a `updateSeasonRules` (db/season.ts, borrada en esta misma
// rebanada): mismo patrón `count: 'exact'` que `updateDisciplineConfig`/
// `updateDisciplineHasMasters` de arriba, más el dual-write a
// `seasons.rules_text` en la disciplina DEFAULT (design rev 2 §4) -- eso es
// lo que mantiene un `git revert` de esta rebanada sin pérdida de datos.
describe('updateDisciplineRules (rebanada 2, R8/R12)', () => {
  it('un admin guarda el texto de su disciplina -- prueba el grant de columna, no un 403 silencioso', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineId } = await createSeason({ admin })

    await expect(
      updateDisciplineRules(admin.client, seasonId, disciplineId, 'Se juega los jueves.'),
    ).resolves.toBeUndefined()

    const { data } = await adminClient().from('disciplines').select('rules_text').eq('id', disciplineId).single()
    expect(data?.rules_text).toBe('Se juega los jueves.')
  })

  it('a un participante que no organiza le avisa que no guardó (mismo posture que updateSeasonRules)', async () => {
    const admin = await createTestUser()
    const member = await createTestUser()
    const { seasonId, disciplineId } = await createSeason({ admin, squad: [member.playerId] })

    await expect(
      updateDisciplineRules(member.client, seasonId, disciplineId, 'texto ajeno'),
    ).rejects.toThrow(/sólo puede hacerlo quien organiza/)

    const { data } = await adminClient().from('disciplines').select('rules_text').eq('id', disciplineId).single()
    expect(data?.rules_text).toBe('')
  })

  it('editar el texto de una disciplina no toca el de la otra', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineIds } = await createSeason({
      admin,
      disciplines: [{}, { kind: 'FIFA' }],
    })
    const [padelId, fifaId] = disciplineIds
    if (padelId === undefined || fifaId === undefined) throw new Error('Faltan disciplinas.')

    await updateDisciplineRules(admin.client, seasonId, fifaId, 'Reglas de FIFA')

    const db = adminClient()
    const { data: padelRow } = await db.from('disciplines').select('rules_text').eq('id', padelId).single()
    const { data: fifaRow } = await db.from('disciplines').select('rules_text').eq('id', fifaId).single()
    expect(padelRow?.rules_text).toBe('')
    expect(fifaRow?.rules_text).toBe('Reglas de FIFA')
  })

  it('escribir la disciplina DEFAULT también actualiza seasons.rules_text (dual-write)', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineId } = await createSeason({ admin }) // única disciplina = default

    await updateDisciplineRules(admin.client, seasonId, disciplineId, 'Reglas nuevas')

    const { data } = await adminClient().from('seasons').select('rules_text').eq('id', seasonId).single()
    expect(data?.rules_text).toBe('Reglas nuevas')
  })

  it('escribir una disciplina NO default deja seasons.rules_text intacto', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineIds } = await createSeason({
      admin,
      disciplines: [{}, { kind: 'FIFA' }],
    })
    const [, fifaId] = disciplineIds
    if (fifaId === undefined) throw new Error('Falta la segunda disciplina.')

    await updateDisciplineRules(admin.client, seasonId, fifaId, 'Reglas de FIFA')

    const { data } = await adminClient().from('seasons').select('rules_text').eq('id', seasonId).single()
    expect(data?.rules_text).toBe('')
  })

  // Confused-deputy (design rev 2 §4): un admin de DOS temporadas no puede
  // escribir la disciplina de la temporada B pasando el seasonId de la A --
  // el `.eq('season_id', seasonId)` corta el update ANTES de que RLS decida,
  // porque RLS sola SÍ autorizaría (el admin organiza la B real).
  it('.eq(season_id) bloquea escribir la disciplina de otra temporada propia', async () => {
    const admin = await createTestUser()
    const { seasonId: seasonAId } = await createSeason({ admin })
    const { seasonId: seasonBId, disciplineId: disciplineBId } = await createSeason({ admin })
    void seasonBId

    await expect(
      updateDisciplineRules(admin.client, seasonAId, disciplineBId, 'intento cruzado'),
    ).rejects.toThrow(/sólo puede hacerlo quien organiza/)

    const { data } = await adminClient().from('disciplines').select('rules_text').eq('id', disciplineBId).single()
    expect(data?.rules_text).toBe('')
  })
})
