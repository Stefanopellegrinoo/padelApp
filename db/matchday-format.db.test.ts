import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { defaultConfig, KNOCKOUT_GROUP_COUNTS, knockoutMatchups, single, type MatchdayFormat, type SideStanding } from '@/core'
import {
  closeMatchday,
  createMatchday,
  generatePairs,
  openMatchday,
  saveResult,
  setAttendance,
  setMatchdayFormat,
} from './matchday'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser, type TestUser } from './test/users'

/**
 * Mismo `localSql` que `db/match-phase.db.test.ts` — sesión `postgres` dentro
 * del contenedor, para leer el catálogo real (`pg_get_constraintdef`) en vez
 * de copiar el check a mano.
 */
function localSql(sql: string): string {
  return execFileSync(
    'docker',
    [
      'exec', '-i', 'supabase_db_padelApp',
      'psql', '-U', 'postgres', '-d', 'postgres',
      '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-',
    ],
    { input: sql, encoding: 'utf8' },
  )
}

// ── scaffolding local: los mismos armadores de `db/generate.db.test.ts`,
// mínimos para llegar a OPEN y probar el guard "editable antes de armar".

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

async function markAllPlaying(admin: TestUser, matchdayId: string, entryIds: string[]): Promise<void> {
  for (const entryId of entryIds) {
    await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
  }
}

/**
 * Una fecha en DRAFT con `count` presentes confirmados y lados de tamaño
 * `pairSize` — lo que necesita el guard de W78 (abajo) para saber "cuántos
 * lados hay hoy" sin adivinar. `sides = count / pairSize`. `entryIds` sale
 * también (W84, abajo: hace falta para bajar la asistencia DESPUÉS de
 * elegir formato — los seis call sites viejos lo ignoran sin romperse).
 */
async function draftMatchdayWithSides(
  count: number,
  pairSize: 1 | 2,
): Promise<{ admin: TestUser; matchdayId: string; entryIds: string[] }> {
  const admin = await createTestUser()
  const players = await fillerPlayers(count)
  const { seasonId, entryIds } = await createSeason({
    admin,
    config: defaultConfig(count, pairSize),
    squad: players,
    disciplines: [{ pairSize }],
  })
  const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05')
  await markAllPlaying(admin, matchdayId, entryIds)
  return { admin, matchdayId, entryIds }
}

/**
 * `matchdays.formato` (0040, REQ-D8-1) es el CUARTO column-grant de la misma
 * trampa que `discipline_id` (0015), `pair_size` (0028) y `allows_draw`
 * (0034): `matchdays` tiene grants a nivel COLUMNA (0002_rls.sql:236-238), y
 * sin el grant un insert/update de `authenticated` que manda `formato` falla
 * con "permission denied for table matchdays" — un mensaje que no nombra la
 * columna.
 *
 * A diferencia de los otros tres, `formato` es el ÚNICO que también necesita
 * `grant update`: el formato se elige DESPUÉS de crear la fecha, ANTES de
 * armar (REQ-D8-1, "editable antes de armar") — los otros tres se fijan al
 * crear y no cambian más. Un test que sólo cubra `insert` no alcanza.
 *
 * Los dos verbos se ejercitan con `admin.client` (rol `authenticated`),
 * NUNCA con `adminClient()` (`service_role`): con `service_role` PostgREST no
 * aplica RLS ni column grants, y el test pasaría en verde mintiendo.
 */
async function scene() {
  const admin = await createTestUser()
  const { seasonId, disciplineId } = await createSeason({ admin })
  return { admin, seasonId, disciplineId }
}

const groupsFormat: MatchdayFormat = { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 }

describe('matchdays.formato — column-grant contra authenticated (REQ-D8-1)', () => {
  it('authenticated crea una fecha mandando formato explícito, sin "permission denied"', async () => {
    const { admin, seasonId, disciplineId } = await scene()

    const { data, error } = await admin.client
      .from('matchdays')
      .insert({
        season_id: seasonId,
        discipline_id: disciplineId,
        number: 1,
        played_on: '2026-03-05',
        pair_size: 2,
        allows_draw: false,
        formato: { kind: 'ROUND_ROBIN' },
      })
      .select('id')
      .single()

    expect(error).toBeNull()
    expect(data).not.toBeNull()
  })

  it('authenticated actualiza el formato de una fecha ya creada (editable antes de armar)', async () => {
    const { admin, seasonId, disciplineId } = await scene()
    const { data: created, error: createError } = await admin.client
      .from('matchdays')
      .insert({
        season_id: seasonId,
        discipline_id: disciplineId,
        number: 1,
        played_on: '2026-03-05',
        pair_size: 2,
        allows_draw: false,
      })
      .select('id')
      .single()
    if (createError || created === null) throw new Error(createError?.message)

    const { error: updateError } = await admin.client
      .from('matchdays')
      .update({ formato: groupsFormat })
      .eq('id', created.id)
    expect(updateError).toBeNull()

    const db = adminClient()
    const { data, error } = await db.from('matchdays').select('formato').eq('id', created.id).single()
    if (error || data === null) throw new Error(error?.message)
    expect(data.formato).toEqual(groupsFormat)
  })

  it('una fecha nueva nace con formato ROUND_ROBIN por default (REQ-D7-1, no-regresión)', async () => {
    const { admin, seasonId, disciplineId } = await scene()
    const { data: created, error } = await admin.client
      .from('matchdays')
      .insert({
        season_id: seasonId,
        discipline_id: disciplineId,
        number: 1,
        played_on: '2026-03-05',
        pair_size: 2,
        allows_draw: false,
      })
      .select('formato')
      .single()
    if (error || created === null) throw new Error(error?.message)

    expect(created.formato).toEqual({ kind: 'ROUND_ROBIN' })
  })
})

/**
 * `setMatchdayFormat` (`db/matchday.ts`) es el PRIMER escritor de producción
 * del `grant update (formato)`: hasta acá el `.update()` de arriba lo ejercía
 * a mano, sin ningún caller real. Se pincha el ARGUMENTO que llega a la fila,
 * no sólo que el update no falle (#3957, la regla de las seis veces) —los dos
 * primeros tests eligen kinds DISTINTOS a propósito, para que copiar el
 * default de columna no alcance para pasar los dos.
 *
 * Los dos primeros usan `draftMatchdayWithSides(12, 2)` (6 lados) en vez de
 * `scene()` — desde W78 (abajo) `groupsFormat` (2 grupos) sólo se guarda si
 * es OFRECIBLE para los lados de HOY, y `scene()` no sienta a nadie: con
 * `sides=0` ya no pasaría.
 */
describe('setMatchdayFormat — primer escritor de producción del grant (REQ-D8-1)', () => {
  it('el formato elegido (GROUPS_KNOCKOUT) llega a la fila', async () => {
    const { admin, matchdayId } = await draftMatchdayWithSides(12, 2)

    await setMatchdayFormat(admin.client, matchdayId, groupsFormat)

    const db = adminClient()
    const { data, error } = await db.from('matchdays').select('formato').eq('id', matchdayId).single()
    if (error || data === null) throw new Error(error?.message)
    expect(data.formato).toEqual(groupsFormat)
  })

  it('elegir ROUND_ROBIN después de GROUPS_KNOCKOUT también llega — no es un default fijo', async () => {
    const { admin, matchdayId } = await draftMatchdayWithSides(12, 2)
    await setMatchdayFormat(admin.client, matchdayId, groupsFormat)

    await setMatchdayFormat(admin.client, matchdayId, { kind: 'ROUND_ROBIN' })

    const db = adminClient()
    const { data, error } = await db.from('matchdays').select('formato').eq('id', matchdayId).single()
    if (error || data === null) throw new Error(error?.message)
    expect(data.formato).toEqual({ kind: 'ROUND_ROBIN' })
  })

  it('rechaza cambiar el formato con la fecha ya confirmada: "editable antes de armar"', async () => {
    const admin = await createTestUser()
    const players = await fillerPlayers(8)
    const { seasonId, entryIds } = await createSeason({ admin, config: defaultConfig(8), squad: players })
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05')
    await markAllPlaying(admin, matchdayId, entryIds)
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)

    await expect(setMatchdayFormat(admin.client, matchdayId, groupsFormat)).rejects.toThrow(/en armado/)

    const db = adminClient()
    const { data, error } = await db.from('matchdays').select('formato').eq('id', matchdayId).single()
    if (error || data === null) throw new Error(error?.message)
    expect(data.formato).toEqual({ kind: 'ROUND_ROBIN' }) // no cambió
  })
})

/**
 * W78 (verify-report-pr21-cierre, #4016): `matchdays_formato_kind` (0040)
 * sólo valida la FORMA (`groups ∈ {1,2,4}`), nunca si esos grupos tienen
 * sentido para cuántos lados hay hoy — y `changeMatchdayFormat`
 * (`app/.../actions.ts`) reenvía lo que le llega del cliente sin volver a
 * mirarlo. Medido en el reporte: una fecha FIFA de 8 lados guardaba
 * `groups: 4` (grupos de 2, eliminación cero — descartado por la decisión
 * #4014) y `groups: 1` (siempre round robin + 1 partido, "nunca ahorra
 * nada" según la misma decisión).
 *
 * `offerableFormats` (`core/knockout.ts`) YA es la fuente única de qué
 * `groups` tienen sentido para `sides` lados — el guard la reusa, no repite
 * la regla.
 */
describe('setMatchdayFormat — el groups elegido tiene que ser OFRECIBLE para los lados de HOY (W78)', () => {
  it('rechaza 4 grupos con 8 lados: offerableFormats(8) no los ofrece (decisión #4014)', async () => {
    const { admin, matchdayId } = await draftMatchdayWithSides(8, 1)

    await expect(
      setMatchdayFormat(admin.client, matchdayId, { kind: 'GROUPS_KNOCKOUT', groups: 4, qualifiersPerGroup: 2 }),
    ).rejects.toThrow(/8 lados/)

    const db = adminClient()
    const { data, error } = await db.from('matchdays').select('formato').eq('id', matchdayId).single()
    if (error || data === null) throw new Error(error?.message)
    expect(data.formato).toEqual({ kind: 'ROUND_ROBIN' }) // no cambió
  })

  it('rechaza groups=1 SIEMPRE, sin importar los lados: "1 grupo + llave" nunca se ofrece (decisión #4014)', async () => {
    const { admin, matchdayId } = await draftMatchdayWithSides(12, 1)

    await expect(
      setMatchdayFormat(admin.client, matchdayId, { kind: 'GROUPS_KNOCKOUT', groups: 1, qualifiersPerGroup: 2 }),
    ).rejects.toThrow(/12 lados/)
  })

  it('acepta 2 grupos con 8 lados: SÍ está entre lo ofrecible', async () => {
    const { admin, matchdayId } = await draftMatchdayWithSides(8, 1)

    await setMatchdayFormat(admin.client, matchdayId, { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 })

    const db = adminClient()
    const { data, error } = await db.from('matchdays').select('formato').eq('id', matchdayId).single()
    if (error || data === null) throw new Error(error?.message)
    expect(data.formato).toEqual({ kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 })
  })

  it('acepta ROUND_ROBIN con cualquier cantidad de lados, sin mirar offerableFormats', async () => {
    const { admin, matchdayId } = await draftMatchdayWithSides(8, 2) // 4 lados: offerableFormats(4) sólo tiene RR

    await setMatchdayFormat(admin.client, matchdayId, { kind: 'ROUND_ROBIN' })

    const db = adminClient()
    const { data, error } = await db.from('matchdays').select('formato').eq('id', matchdayId).single()
    if (error || data === null) throw new Error(error?.message)
    expect(data.formato).toEqual({ kind: 'ROUND_ROBIN' })
  })
})

/**
 * W84 (verify-report-pre-contract #4026): el guard de W78 (arriba) es de
 * MOMENTO DE ESCRITURA — valida `offerableFormats(sides)` contra los
 * presentes de CUANDO SE ELIGE el formato, y nada revalida si esos
 * presentes cambian DESPUÉS. Medido en el reporte: FIFA de 12 acepta
 * "4 grupos" (offerableFormats(12) los ofrece), después bajan 4 ausentes
 * (quedan 8 presentes), y `generatePairs` armaba igual 4 grupos de 2 —
 * tasa de eliminación CERO, textual lo que la decisión #4014 excluye
 * "SIEMPRE, sin excepción".
 *
 * Dónde revalidar, y por qué ACÁ: `generatePairs` ("armar"), no
 * `openMatchday` ni `closeMatchday`. Es el momento en que la app YA sabe
 * cuántos lados hay DE VERDAD — recién leyó `attendances` + invitados vía
 * `pairingContextFor`, la MISMA cuenta que ya usa `setMatchdayFormat` — y es
 * ANTES de `deletePairs`/`insertPairs`, así que un rechazo acá no deja la
 * fecha a medio armar (`generatePairs` no corre en una transacción, S69).
 */
describe('generatePairs — el groups elegido tiene que seguir siendo OFRECIBLE con los presentes de HOY (W84)', () => {
  it('rechaza armar 4 grupos si bajar la asistencia los volvió NO ofrecibles', async () => {
    const { admin, matchdayId, entryIds } = await draftMatchdayWithSides(12, 1)
    await setMatchdayFormat(admin.client, matchdayId, { kind: 'GROUPS_KNOCKOUT', groups: 4, qualifiersPerGroup: 2 })

    // Bajan 4: quedan 8 presentes. offerableFormats(8) no ofrece 4 grupos
    // (grupos de 2, eliminación cero — decisión #4014).
    for (const entryId of entryIds.slice(0, 4)) {
      await setAttendance(admin.client, matchdayId, entryId, 'ABSENT')
    }

    await expect(generatePairs(admin.client, matchdayId)).rejects.toThrow(/8 lados/)

    // Y no arma nada a medias: rechazar ANTES de deletePairs/insertPairs deja
    // la fecha sin parejas, no a medio armar.
    const db = adminClient()
    const { data: pairs } = await db.from('pairs').select('id').eq('matchday_id', matchdayId)
    expect(pairs).toEqual([])
  })

  it('no-regresión: sigue armando cuando el formato SIGUE siendo ofrecible tras bajar la asistencia', async () => {
    const { admin, matchdayId, entryIds } = await draftMatchdayWithSides(12, 1)
    await setMatchdayFormat(admin.client, matchdayId, { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 })

    // Bajan 2: quedan 10 presentes. offerableFormats(10) sigue ofreciendo 2 grupos.
    for (const entryId of entryIds.slice(0, 2)) {
      await setAttendance(admin.client, matchdayId, entryId, 'ABSENT')
    }

    await expect(generatePairs(admin.client, matchdayId)).resolves.toBeUndefined()

    const db = adminClient()
    const { data: pairs, error } = await db.from('pairs').select('id').eq('matchday_id', matchdayId)
    if (error) throw new Error(error.message)
    expect(pairs).toHaveLength(10)
  })

  it('no-regresión: ROUND_ROBIN arma igual sin importar cuánto baje la asistencia', async () => {
    const { admin, matchdayId, entryIds } = await draftMatchdayWithSides(12, 2) // 6 lados

    // Bajan 2 (MIN_PLAYERS=8 sigue satisfecho: quedan 10 presentes, 5 lados).
    // El guard nuevo sólo mira GROUPS_KNOCKOUT — ROUND_ROBIN no lo dispara.
    for (const entryId of entryIds.slice(0, 2)) {
      await setAttendance(admin.client, matchdayId, entryId, 'ABSENT')
    }

    await expect(generatePairs(admin.client, matchdayId)).resolves.toBeUndefined()
  })
})

/**
 * `matchdays_formato_kind` (0040) validaba SÓLO `kind` — `{"kind":
 * "GROUPS_KNOCKOUT"}` sin `groups`/`qualifiersPerGroup` era una fila LEGAL, y
 * con `grant update (formato)` abierto cualquier `authenticated` podía
 * escribirla. `generatePairs` (`groupedMatches`, `db/matchday.ts`) confía en
 * esa forma sin volver a validarla — con `groups=undefined`,
 * `groupSides(storedSides, undefined)` no dispara su guard (`undefined < 1`
 * es `false`), `Array.from({length: undefined})` da `[]`, y revienta DESPUÉS
 * de haber borrado y reinsertado las parejas (S69: `generatePairs` sin
 * transacción), con un mensaje que culpa al código ("El grupo 0 no existe.
 * Esto es un bug.") cuando el problema es el DATO.
 *
 * La base RECHAZA, no un `if` de aplicación (REQ-D5-1, mismo idioma que
 * `pairs_side_shape`): el check ahora exige la FORMA completa de
 * `GROUPS_KNOCKOUT` — `groups` y `qualifiersPerGroup` presentes, numéricos, y
 * dentro de lo que `knockoutMatchups` (`core/knockout.ts`) sabe armar (G∈
 * {1,2,4}, P=2). `groups: "hola"` tiene que RECHAZAR la fila
 * (`error.code === '23514'`, check_violation), no explotar con un error de
 * casteo (`22P02`) — un CHECK que TIRA no es lo mismo que un CHECK que
 * RECHAZA.
 */
describe('matchdays_formato_kind — GROUPS_KNOCKOUT exige su forma completa (REQ-D5-1)', () => {
  it('rechaza GROUPS_KNOCKOUT sin groups/qualifiersPerGroup', async () => {
    const { admin, seasonId, disciplineId } = await scene()

    const { error } = await admin.client.from('matchdays').insert({
      season_id: seasonId,
      discipline_id: disciplineId,
      number: 1,
      played_on: '2026-03-05',
      pair_size: 2,
      allows_draw: false,
      formato: { kind: 'GROUPS_KNOCKOUT' },
    })

    expect(error).not.toBeNull()
    expect(error?.code).toBe('23514') // check_violation, no un permission denied ni un cast error
  })

  it('rechaza groups=3: knockoutMatchups sólo sabe armar 1, 2 o 4', async () => {
    const { admin, seasonId, disciplineId } = await scene()

    const { error } = await admin.client.from('matchdays').insert({
      season_id: seasonId,
      discipline_id: disciplineId,
      number: 1,
      played_on: '2026-03-05',
      pair_size: 2,
      allows_draw: false,
      formato: { kind: 'GROUPS_KNOCKOUT', groups: 3, qualifiersPerGroup: 2 },
    })

    expect(error).not.toBeNull()
    expect(error?.code).toBe('23514')
  })

  it('rechaza un groups no numérico SIN explotar en un error de casteo', async () => {
    const { admin, seasonId, disciplineId } = await scene()

    const { error } = await admin.client.from('matchdays').insert({
      season_id: seasonId,
      discipline_id: disciplineId,
      number: 1,
      played_on: '2026-03-05',
      pair_size: 2,
      allows_draw: false,
      formato: { kind: 'GROUPS_KNOCKOUT', groups: 'hola', qualifiersPerGroup: 2 },
    })

    expect(error).not.toBeNull()
    // check_violation (23514), NO invalid_text_representation (22P02): el
    // check tiene que RECHAZAR el dato basura, no reventar tratando de
    // castearlo a entero.
    expect(error?.code).toBe('23514')
  })

  it('acepta GROUPS_KNOCKOUT con la forma completa y soportada', async () => {
    const { admin, seasonId, disciplineId } = await scene()

    const { error } = await admin.client.from('matchdays').insert({
      season_id: seasonId,
      discipline_id: disciplineId,
      number: 1,
      played_on: '2026-03-05',
      pair_size: 2,
      allows_draw: false,
      formato: { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 },
    })

    expect(error).toBeNull()
  })

  it('acepta ROUND_ROBIN sin pedirle campos de grupos', async () => {
    const { admin, seasonId, disciplineId } = await scene()

    const { error } = await admin.client.from('matchdays').insert({
      season_id: seasonId,
      discipline_id: disciplineId,
      number: 1,
      played_on: '2026-03-05',
      pair_size: 2,
      allows_draw: false,
      formato: { kind: 'ROUND_ROBIN' },
    })

    expect(error).toBeNull()
  })
})

/**
 * W68 (verify-report-pr21, #4004): `grant update (formato)` (0040) deja
 * PATCHear `formato` en CUALQUIER estado, salteando `setMatchdayFormat` —
 * cuyo guard ("editable antes de armar") es SÓLO de TypeScript. Mismo
 * patrón que #3989 (guards en serie): un test que entra por
 * `setMatchdayFormat` no prueba nada de esto, porque el wrapper ya rechaza
 * antes de llegar al UPDATE real. Acá se hace el `.update()` DIRECTO, con
 * `admin.client` (`authenticated`, el mismo rol que ejecuta en producción,
 * nunca `service_role`).
 *
 * El guard tiene que vivir en la BASE (trigger), porque nada en TypeScript
 * puede interceptar un PATCH que llega directo a PostgREST.
 */
describe('trigger de base: formato inmutable fuera de DRAFT (W68)', () => {
  it('un PATCH directo a formato rechaza con la fecha OPEN', async () => {
    const admin = await createTestUser()
    const players = await fillerPlayers(8)
    const { seasonId, entryIds } = await createSeason({ admin, config: defaultConfig(8), squad: players })
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05')
    await markAllPlaying(admin, matchdayId, entryIds)
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)

    const { error } = await admin.client
      .from('matchdays')
      .update({ formato: groupsFormat })
      .eq('id', matchdayId)

    expect(error).not.toBeNull()

    const db = adminClient()
    const { data } = await db.from('matchdays').select('formato').eq('id', matchdayId).single()
    expect(data?.formato).toEqual({ kind: 'ROUND_ROBIN' }) // no cambió
  })

  it('un PATCH directo a formato rechaza con la fecha CLOSED (la más peligrosa: desbloquea el cierre)', async () => {
    const admin = await createTestUser()
    const players = await fillerPlayers(8)
    const { seasonId, entryIds } = await createSeason({ admin, config: defaultConfig(8), squad: players })
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05')
    await markAllPlaying(admin, matchdayId, entryIds)
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)
    const db = adminClient()
    const { data: matches } = await db.from('matches').select('id').eq('matchday_id', matchdayId)
    for (const match of matches ?? []) {
      await saveResult(admin.client, match.id, [{ gamesA: 4, gamesB: 0 }])
    }
    await closeMatchday(admin.client, matchdayId)

    const { error } = await admin.client
      .from('matchdays')
      .update({ formato: groupsFormat })
      .eq('id', matchdayId)

    expect(error).not.toBeNull()
  })

  it('no-regresión: un PATCH directo SIGUE andando con la fecha en DRAFT', async () => {
    const { admin, seasonId, disciplineId } = await scene()
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05', disciplineId)

    const { error } = await admin.client
      .from('matchdays')
      .update({ formato: groupsFormat })
      .eq('id', matchdayId)

    expect(error).toBeNull()
  })
})

// ── W74 (verify-report-pr21 #4004) ──────────────────────────────────────────

function standingAt(position: number): SideStanding {
  return { side: single(`w74-${position}`), played: 0, won: 0, drawn: 0, dayPoints: 0, setsDiff: 0, gamesDiff: 0, position }
}

/** `groupCount` grupos con 2 clasificados cada uno — lo mínimo que `knockoutMatchups` necesita para no tirar por falta de clasificados. */
function fakeGroups(groupCount: number): SideStanding[][] {
  return Array.from({ length: groupCount }, (_unused, index) => [standingAt(index * 2 + 1), standingAt(index * 2 + 2)])
}

/** Qué `groups` sabe armar `knockoutMatchups` HOY, probado con fixtures reales — no una lista repetida a mano. */
function probeSupportedGroupCounts(): Set<number> {
  const actualGroups = new Set<number>()
  for (let groupCount = 1; groupCount <= 8; groupCount++) {
    try {
      knockoutMatchups(fakeGroups(groupCount), 2)
      actualGroups.add(groupCount)
    } catch {
      // knockoutMatchups no sabe armar cruces para esta cantidad de grupos
    }
  }
  return actualGroups
}

/**
 * `groups ∈ {1,2,4}` y `qualifiersPerGroup = 2` están escritos DOS veces: el
 * check `matchdays_formato_kind` (0040, SQL) y `knockoutMatchups`
 * (`core/knockout.ts`, TS) — hasta acá sólo un COMENTARIO las ataba ("las dos
 * listas están acopladas A PROPÓSITO... si mañana knockoutMatchups aprende a
 * armar 8 grupos, este check es el segundo lugar que hay que tocar").
 *
 * Mismo molde que `db/match-phase.db.test.ts` (`PHASE_ORDER` contra
 * `pg_get_constraintdef`/`pg_get_functiondef`): lee el catálogo real, no una
 * copia a mano del check. El lado de TypeScript se deriva EJECUTANDO
 * `knockoutMatchups` con fixtures reales (1..8 grupos, 1..4 clasificados) y
 * quedándose con lo que NO tira — no una lista repetida en el test.
 */
describe('groups ∈ {1,2,4} + qualifiersPerGroup=2 no driftea entre matchdays_formato_kind y knockoutMatchups (W74)', () => {
  it('el ARRAY de groups del check SQL es EXACTAMENTE el que knockoutMatchups sabe armar', () => {
    const checkDef = localSql(`
      select pg_get_constraintdef(oid) from pg_constraint
       where conrelid = 'public.matchdays'::regclass and conname = 'matchdays_formato_kind';
    `)
    const arrayLiteral = checkDef.match(/'groups'[^)]*\)\)::integer = ANY \(ARRAY\[([^\]]+)\]\)/)
    if (arrayLiteral?.[1] === undefined) {
      throw new Error('matchdays_formato_kind ya no valida groups con "= ANY (ARRAY[...])" — revisar este test.')
    }
    const sqlGroups = new Set(arrayLiteral[1].split(',').map((value) => Number(value.trim())))

    expect(probeSupportedGroupCounts()).toEqual(sqlGroups)
  })

  it('el qualifiersPerGroup del check SQL es EXACTAMENTE el que knockoutMatchups sabe armar', () => {
    const checkDef = localSql(`
      select pg_get_constraintdef(oid) from pg_constraint
       where conrelid = 'public.matchdays'::regclass and conname = 'matchdays_formato_kind';
    `)
    const equality = checkDef.match(/'qualifiersPerGroup'[^)]*\)\)::integer = (\d+)/)
    if (equality?.[1] === undefined) {
      throw new Error('matchdays_formato_kind ya no valida qualifiersPerGroup con una igualdad — revisar este test.')
    }
    const sqlQualifiers = Number(equality[1])

    const actualQualifiers = new Set<number>()
    for (let qualifiers = 1; qualifiers <= 4; qualifiers++) {
      try {
        knockoutMatchups(fakeGroups(2), qualifiers)
        actualQualifiers.add(qualifiers)
      } catch {
        // knockoutMatchups sólo arma cruces con 2 clasificados por grupo
      }
    }

    expect(actualQualifiers).toEqual(new Set([sqlQualifiers]))
  })

  /**
   * W81 (verify-report-pr21-cierre, #4016): `offerableFormats`
   * (`core/knockout.ts`) tenía su PROPIA lista hardcodeada (`[2, 4]`) — una
   * TERCERA copia de "qué `groups` sabe armar `knockoutMatchups`" que este
   * tripwire (arriba) sólo ataba de a DOS: si mañana `knockoutMatchups`
   * aprendiera a armar 8 grupos y el check SQL se actualizara junto con él,
   * los dos tests de arriba seguían verdes y `offerableFormats` seguía
   * ofreciendo sólo 2 y 4 en silencio.
   *
   * `KNOCKOUT_GROUP_COUNTS` es ahora la fuente ÚNICA: `offerableFormats` LEE
   * de ahí (filtrando el `1`, que la decisión #4014 excluye siempre por
   * motivo de negocio, no de forma) en vez de repetir la lista. Este test
   * ata esa fuente al mismo catálogo real que ya prueban los dos de arriba
   * — la tercera copia deja de poder existir porque no hay una tercera
   * lista, hay una sola constante que los tres lugares comparten.
   */
  it('KNOCKOUT_GROUP_COUNTS (la fuente de offerableFormats) es EXACTAMENTE lo que knockoutMatchups sabe armar', () => {
    expect(new Set(KNOCKOUT_GROUP_COUNTS)).toEqual(probeSupportedGroupCounts())
  })
})
