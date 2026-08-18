import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { defaultConfig, members, type SeasonConfig } from '@/core'
import {
  addGuest,
  cancelMatchday,
  closeMatchday,
  createMatchday,
  generatePairs,
  lockPair,
  nameGuest,
  openMatchday,
  saveResult,
  setAttendance,
  syncGuestSeat,
} from './matchday'
import { attendancesOf, matchdayDetail, pairLocksOf } from './read'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser, type TestUser } from './test/users'

// ── scaffolding local a este archivo ────────────────────────────────────────
// Igual que en redraft.db.test.ts y reopen.db.test.ts: no va a
// db/test/factories.ts, esa lista de armadores sólo le sirve a la cancelación.

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

async function buildSeasonWithSquad(
  config: SeasonConfig,
  squadSize: number,
): Promise<{ admin: TestUser; seasonId: string; squad: string[] }> {
  const admin = await createTestUser()
  const players = await fillerPlayers(squadSize)
  const { seasonId, entryIds } = await createSeason({ admin, config, squad: players })
  return { admin, seasonId, squad: entryIds }
}

async function markAllPlaying(admin: TestUser, matchdayId: string, entryIds: string[]): Promise<void> {
  for (const entryId of entryIds) {
    await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
  }
}

interface MatchRow {
  id: string
  pair_a: string
  pair_b: string
}

async function matchesOf(matchdayId: string): Promise<MatchRow[]> {
  const db = adminClient()
  const { data, error } = await db
    .from('matches')
    .select('id, pair_a, pair_b')
    .eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return data ?? []
}

async function pairsOf(matchdayId: string): Promise<Array<{ id: string }>> {
  const db = adminClient()
  const { data, error } = await db.from('pairs').select('id').eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return data ?? []
}

async function matchSetsOf(matchIds: string[]): Promise<Array<{ id: string }>> {
  if (matchIds.length === 0) return []
  const db = adminClient()
  const { data, error } = await db.from('match_sets').select('id').in('match_id', matchIds)
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Carga un 4-1 en cada partido de la fecha, con `winnerOf` decidiendo quién gana. */
async function playAllMatches(
  admin: TestUser,
  matchdayId: string,
  winnerOf: (pairA: string, pairB: string) => string,
): Promise<void> {
  const matches = await matchesOf(matchdayId)
  for (const match of matches) {
    const winner = winnerOf(match.pair_a, match.pair_b)
    const sets = winner === match.pair_a ? [{ gamesA: 4, gamesB: 1 }] : [{ gamesA: 1, gamesB: 4 }]
    await saveResult(admin.client, match.id, sets)
  }
}

async function matchdayStatus(matchdayId: string): Promise<string> {
  const db = adminClient()
  const { data, error } = await db
    .from('matchdays')
    .select('status')
    .eq('id', matchdayId)
    .single()
  if (error || data === null) throw new Error(error?.message)
  return data.status
}

async function matchdayExists(matchdayId: string): Promise<boolean> {
  const db = adminClient()
  const { data, error } = await db.from('matchdays').select('id').eq('id', matchdayId).maybeSingle()
  if (error) throw new Error(error.message)
  return data !== null
}

async function entryExists(entryId: string): Promise<boolean> {
  const db = adminClient()
  const { data, error } = await db.from('entries').select('id').eq('id', entryId).maybeSingle()
  if (error) throw new Error(error.message)
  return data !== null
}

async function seasonStatus(seasonId: string): Promise<string> {
  const db = adminClient()
  const { data, error } = await db.from('seasons').select('status').eq('id', seasonId).single()
  if (error || data === null) throw new Error(error?.message)
  return data.status
}

async function matchdayRowsOf(seasonId: string): Promise<Array<{ id: string; number: number }>> {
  const db = adminClient()
  const { data, error } = await db
    .from('matchdays')
    .select('id, number')
    .eq('season_id', seasonId)
    .order('number', { ascending: true })
  if (error) throw new Error(error.message)
  return data ?? []
}

async function awardsOf(
  matchdayId: string,
): Promise<Array<{ entry_id: string; position: number; points: number }>> {
  const db = adminClient()
  const { data, error } = await db
    .from('awards')
    .select('entry_id, position, points')
    .eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return data ?? []
}

async function guestEntriesOf(matchdayId: string): Promise<Array<{ id: string; display_name: string }>> {
  const db = adminClient()
  const { data, error } = await db
    .from('entries')
    .select('id, display_name')
    .eq('matchday_id', matchdayId)
    .eq('kind', 'GUEST')
  if (error) throw new Error(error.message)
  return data ?? []
}

/** El plantel de la temporada — sólo SQUAD, nunca tocado por cancelar una fecha (spec 1.3). */
async function squadEntriesOf(
  seasonId: string,
): Promise<Array<{ id: string; seed_position: number; display_name: string }>> {
  const db = adminClient()
  const { data, error } = await db
    .from('entries')
    .select('id, seed_position, display_name')
    .eq('season_id', seasonId)
    .eq('kind', 'SQUAD')
    .order('seed_position', { ascending: true })
  if (error) throw new Error(error.message)
  return data ?? []
}

/**
 * SQL crudo contra la Postgres local, adentro del contenedor del stack de
 * Supabase (`supabase_db_<project_id>`; el project_id es "padelApp" y vive en
 * supabase/config.toml — si alguien lo cambia, esto revienta ruidosamente, que
 * es lo que corresponde). Mismo mecanismo que `db/entries.db.test.ts`, y por el
 * mismo motivo: hay cosas que supabase-js no puede hacer porque habla
 * PostgREST. Ahí era elegir el plan; acá es tener una SEGUNDA sesión que
 * mantenga una transacción abierta.
 *
 * Va por `docker exec` y no por un `psql` del host a propósito: el stack local
 * ya exige Docker, un cliente de Postgres instalado en la máquina no. Y por
 * construcción pega contra el contenedor local, así que no hay forma de que se
 * escape a una base real ni salteándose `db/test/env.ts`.
 *
 * Un solo `-c` con varios statements es UNA transacción implícita, que es
 * justamente lo que hace falta para que la traba de fila sobreviva al sleep.
 */
const execFileAsync = promisify(execFile)

function localSqlAsync(sql: string): Promise<{ stdout: string }> {
  return execFileAsync('docker', [
    'exec', 'supabase_db_padelApp',
    'psql', '-U', 'postgres', '-d', 'postgres',
    '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql,
  ])
}

/** Cuánto espera la sesión bloqueadora antes de borrar la fila y soltar la traba. */
const BLOCKER_WINDOW_SECONDS = 3

/**
 * Espera a que la sesión bloqueadora esté DURMIENDO. Su `pg_sleep` corre
 * después del `select … for update`, así que verla en `PgSleep` prueba que la
 * traba de fila ya está tomada — que es la condición que el test necesita
 * antes de largar la otra sesión. El uuid de la fecha adentro del texto de la
 * consulta es lo que la identifica: `pg_stat_activity.query` guarda el string
 * entero del `-c`.
 */
async function waitUntilBlockerHoldsTheRow(matchdayId: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const { stdout } = await localSqlAsync(
      `select count(*) from pg_stat_activity
        where wait_event = 'PgSleep' and query like '%${matchdayId}%';`,
    )
    if (stdout.trim() === '1') return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('La sesión bloqueadora nunca llegó a trabar la fila.')
}

/**
 * Espera a que ALGUIEN quede encolado DETRÁS de la traba de la sesión
 * bloqueadora. Eso —y no el mensaje de error— es lo único que prueba que el
 * entrelazado ocurrió.
 *
 * Hace falta porque las DOS guardas de `cancel_matchday` levantan el mismo
 * texto ('La fecha no existe.'): la primera cuando `matchday_season` no
 * encuentra la fecha, la segunda cuando la fila se fue debajo del `select …
 * for update`. La ventana del bloqueador son `BLOCKER_WINDOW_SECONDS`; si el
 * handshake de arriba la observara tarde y el delete ya hubiera commiteado, la
 * sesión A entraría con la fecha borrada, se iría por la PRIMERA guarda y el
 * test daría verde sin haber tocado nunca la rama que existe para pinnear.
 *
 * `pg_blocking_pids` es la respuesta directa: devuelve quién traba a quién. Al
 * bloqueador se lo identifica igual que arriba, por el uuid adentro del texto
 * de su consulta. La sesión que corre ESTA consulta también lleva el uuid en
 * su texto, pero no traba a nadie, así que nunca aparece como bloqueadora.
 */
async function waitUntilSomeoneQueuesBehindTheBlocker(matchdayId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const { stdout } = await localSqlAsync(
      `select count(*) from pg_stat_activity blocked
         join lateral unnest(pg_blocking_pids(blocked.pid)) as holder(pid) on true
         join pg_stat_activity blocker on blocker.pid = holder.pid
        where blocker.query like '%${matchdayId}%';`,
    )
    if (Number(stdout.trim()) > 0) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}

/** Arma y confirma una fecha regular DENTRO de una temporada ya existente. */
async function openMatchdayIn(
  admin: TestUser,
  seasonId: string,
  squad: string[],
  playedOn: string,
): Promise<string> {
  const matchdayId = await createMatchday(admin.client, seasonId, playedOn)
  await markAllPlaying(admin, matchdayId, squad)
  await generatePairs(admin.client, matchdayId)
  await openMatchday(admin.client, matchdayId)
  return matchdayId
}

/** Arma, juega y cierra una fecha regular DENTRO de una temporada ya existente. */
async function closedMatchdayIn(
  admin: TestUser,
  seasonId: string,
  squad: string[],
  playedOn: string,
): Promise<string> {
  const matchdayId = await openMatchdayIn(admin, seasonId, squad, playedOn)
  await playAllMatches(admin, matchdayId, (pairA) => pairA)
  await closeMatchday(admin.client, matchdayId)
  return matchdayId
}

describe('cancelMatchday', () => {
  it('borra una fecha DRAFT con asistencias, invitados y una pareja trabada', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, squad)

    const guestA = await addGuest(admin.client, matchdayId, { displayName: 'Invitado A' })
    const guestB = await addGuest(admin.client, matchdayId, { displayName: 'Invitado B' })
    await lockPair(admin.client, matchdayId, guestA, guestB)

    expect(await attendancesOf(admin.client, matchdayId)).not.toHaveLength(0)
    expect(await guestEntriesOf(matchdayId)).toHaveLength(2)
    expect(await pairLocksOf(admin.client, matchdayId)).toHaveLength(1)

    await cancelMatchday(admin.client, matchdayId)

    // Las tres lecturas de después van con `service_role` y no con
    // `admin.client`, y no es un detalle: `attendances_read` y `pair_locks_read`
    // (0002_rls.sql:179 y :187) exigen `is_participant(matchday_season(...))`, y
    // una vez que la fecha no existe eso es falso siempre. Con la llave del
    // admin estas dos líneas devolvían `[]` con las filas borradas Y con las
    // filas intactas: aserciones que no podían fallar.
    expect(await matchdayExists(matchdayId)).toBe(false)
    expect(await attendancesOf(adminClient(), matchdayId)).toHaveLength(0)
    expect(await guestEntriesOf(matchdayId)).toHaveLength(0)
    expect(await pairLocksOf(adminClient(), matchdayId)).toHaveLength(0)
  })

  it('borra una fecha OPEN con parejas, partidos y resultados ya cargados', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await openMatchdayIn(admin, seasonId, squad, '2026-08-10')

    const [firstMatch] = await matchesOf(matchdayId)
    if (firstMatch === undefined) throw new Error('Falta un partido de test.')
    await saveResult(admin.client, firstMatch.id, [{ gamesA: 4, gamesB: 1 }])
    const matchIdsBefore = (await matchesOf(matchdayId)).map((match) => match.id)

    expect(await pairsOf(matchdayId)).not.toHaveLength(0)
    expect(matchIdsBefore).not.toHaveLength(0)
    expect(await matchSetsOf(matchIdsBefore)).not.toHaveLength(0)

    await cancelMatchday(admin.client, matchdayId)

    expect(await matchdayExists(matchdayId)).toBe(false)
    expect(await pairsOf(matchdayId)).toHaveLength(0)
    expect(await matchesOf(matchdayId)).toHaveLength(0)
    expect(await matchSetsOf(matchIdsBefore)).toHaveLength(0)
  })

  // `pairs.entry_a/entry_b → entries` es `on delete no action`
  // (0001_schema.sql:170-171): el FK que puede FRENAR el borrado en vez de
  // acompañarlo, porque las entries GUEST se van con la fecha y las parejas las
  // apuntan. No es el único con esa forma —`awards.entry_id → entries`
  // (0001_schema.sql:225) también es `no action`— pero sí el único que esta
  // función se cruza: `awards` sólo tiene filas en una fecha CLOSED, y CLOSED
  // no entra a la lista blanca. Sólo se ejercita con un invitado ADENTRO de
  // una pareja. El plantel presente impar es UNA de las formas de llegar ahí
  // —`addGuestPair` traba dos invitados entre sí con el plantel par y es
  // otra—, y es la que se usa acá porque sale de `syncGuestSeat`, que es lo
  // mismo que corre la acción real. El primer test tiene invitados pero nunca
  // genera parejas, y el segundo genera parejas con plantel par y sin
  // invitados, así que ninguno de los dos lo toca.
  it('borra una fecha con un invitado adentro de una pareja: el FK que podría frenar el borrado no frena', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(10), 10)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, squad)

    // Uno se cae, el presente queda impar (9) y `syncGuestSeat` —lo mismo que
    // corre `toggleAttendance` en la acción real— suma el invitado que devuelve
    // el número a par. Es la única forma de que el sorteo lo meta en una pareja.
    await setAttendance(admin.client, matchdayId, squad[0]!, 'ABSENT')
    await syncGuestSeat(admin.client, matchdayId)
    const [guestId] = (await matchdayDetail(admin.client, matchdayId)).guestIds
    if (guestId === undefined) throw new Error('syncGuestSeat no agregó invitado.')
    await nameGuest(admin.client, guestId, 'Invitado de test')

    await generatePairs(admin.client, matchdayId)
    const inPairs = new Set(
      (await matchdayDetail(admin.client, matchdayId)).sides.flatMap((side) => [...members(side)]),
    )
    expect(await pairsOf(matchdayId)).not.toHaveLength(0)
    expect(inPairs.has(guestId)).toBe(true)

    await cancelMatchday(admin.client, matchdayId)

    expect(await matchdayExists(matchdayId)).toBe(false)
    expect(await entryExists(guestId)).toBe(false)
    expect(await guestEntriesOf(matchdayId)).toHaveLength(0)
    expect(await pairsOf(matchdayId)).toHaveLength(0)
    expect(await matchesOf(matchdayId)).toHaveLength(0)
  })

  // El trinquete `SETUP → ACTIVE` de `open_matchday` (0005:37) al revés. Sin
  // esto la temporada se queda ACTIVE con cero fechas, y "En curso" en Mis
  // torneos (`app/torneos/page.tsx:27`) para algo que no empezó.
  it('borrar la única fecha devuelve la temporada a SETUP y el número 1 vuelve a quedar libre', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await openMatchdayIn(admin, seasonId, squad, '2026-08-10')
    // Confirmar la primera fecha es lo que la mueve a ACTIVE. Sin esta línea el
    // test pasaría por vacuidad si algún día dejara de moverla.
    expect(await seasonStatus(seasonId)).toBe('ACTIVE')

    await cancelMatchday(admin.client, matchdayId)

    expect(await seasonStatus(seasonId)).toBe('SETUP')
    expect(await matchdayRowsOf(seasonId)).toHaveLength(0)

    // `createMatchday` numera con `max(number) + 1`, así que sin fechas vuelve a
    // arrancar en 1: no queda ningún hueco en la numeración.
    await createMatchday(admin.client, seasonId, '2026-08-17')
    expect((await matchdayRowsOf(seasonId)).map((row) => row.number)).toEqual([1])
  })

  it('rechaza una fecha cerrada (CLOSED), y el mensaje manda a reabrir, no a borrar', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await closedMatchdayIn(admin, seasonId, squad, '2026-08-10')

    await expect(cancelMatchday(admin.client, matchdayId)).rejects.toThrow(/reabr/i)

    expect(await matchdayStatus(matchdayId)).toBe('CLOSED')
  })

  it('cancelar una fecha no toca ninguna otra fecha de la temporada ni el plantel', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const closedId = await closedMatchdayIn(admin, seasonId, squad, '2026-08-10')
    const awardsBefore = await awardsOf(closedId)
    const squadBefore = await squadEntriesOf(seasonId)
    expect(awardsBefore).not.toHaveLength(0)

    const openId = await openMatchdayIn(admin, seasonId, squad, '2026-08-17')

    await cancelMatchday(admin.client, openId)

    expect(await matchdayExists(openId)).toBe(false)
    expect(await matchdayStatus(closedId)).toBe('CLOSED')
    expect(await awardsOf(closedId)).toEqual(awardsBefore)
    expect(await squadEntriesOf(seasonId)).toEqual(squadBefore)
    // Y la temporada NO vuelve a SETUP: la reversión del trinquete es sólo para
    // cuando no quedó ninguna fecha. Con una jugada encima, "sin empezar" sería
    // mentira.
    expect(await seasonStatus(seasonId)).toBe('ACTIVE')
  })

  it('un jugador del plantel, sin ser el admin, recibe "sólo quien organiza" y no mueve nada', async () => {
    const admin = await createTestUser()
    const member = await createTestUser()
    const filler = await fillerPlayers(7)
    const { seasonId, entryIds } = await createSeason({
      admin,
      config: defaultConfig(8),
      squad: [member.playerId, ...filler],
    })
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, entryIds)

    await expect(cancelMatchday(member.client, matchdayId)).rejects.toThrow(/Sólo quien organiza/)

    expect(await matchdayExists(matchdayId)).toBe(true)
    expect(await matchdayStatus(matchdayId)).toBe('DRAFT')
  })

  it('un desconocido recibe "sólo quien organiza" y no borra nada', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await openMatchdayIn(admin, seasonId, squad, '2026-08-10')
    const stranger = await createTestUser()

    const { error } = await stranger.client.rpc('cancel_matchday', { p_matchday: matchdayId })

    expect(error?.message).toMatch(/Sólo quien organiza/)
    expect(await matchdayExists(matchdayId)).toBe(true)
  })

  it('un DELETE directo sobre matchdays sigue sin poder nada: sólo la función abre la puerta', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await openMatchdayIn(admin, seasonId, squad, '2026-08-10')

    const { data, error } = await admin.client.from('matchdays').delete().eq('id', matchdayId).select()

    expect(data).toBeNull()
    expect(error?.code).toBe('42501')
    expect(await matchdayExists(matchdayId)).toBe(true)
  })

  // La rama del null de `0012_cancel_matchday.sql`, que es la mitad de la lista
  // blanca y hasta acá no tenía NINGÚN test que la pudiera hacer fallar: los
  // otros nueve pasan enteros con el deny-list de antes (`if v_status =
  // 'CLOSED'`, sin rama de null), porque todos entran con un status real.
  //
  // El escenario es el que describe el comentario de la migración: la fila
  // desaparece ENTRE `matchday_season` —que ya devolvió la temporada— y el
  // `select … for update`. Con el deny-list, `null = 'CLOSED'` da null, ninguna
  // rama dispara, el delete borra 0 filas, el `update seasons` la devuelve a
  // SETUP y la función **contesta éxito**: la pantalla redirige a una temporada
  // que ya no existe. Con la lista blanca, refusa y no toca nada.
  it('la fecha que desaparece entre la lectura y la traba se REFUSA, no devuelve éxito con cero filas borradas', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await openMatchdayIn(admin, seasonId, squad, '2026-08-10')
    // Confirmar la primera fecha es lo que mueve la temporada a ACTIVE, y eso
    // es la mitad de la aserción de abajo.
    expect(await seasonStatus(seasonId)).toBe('ACTIVE')

    // Sesión B: traba la FILA de la fecha, espera a que la sesión A quede
    // encolada detrás de esa traba, y recién ahí la borra. Los tres statements
    // viajan en un solo `-c`, así que Postgres los corre en UNA transacción
    // implícita: la traba dura desde el `for update` hasta el commit del final.
    const blocker = localSqlAsync(`
      select id from public.matchdays where id = '${matchdayId}' for update;
      select pg_sleep(${BLOCKER_WINDOW_SECONDS});
      delete from public.matchdays where id = '${matchdayId}';
    `)
    // El handshake NO es un sleep del lado de Node: si la sesión A arrancara
    // antes de que B tenga la traba, borraría la fecha limpio y el test daría
    // un rojo mentiroso. `pg_sleep` corre DESPUÉS del `for update` en la misma
    // sesión, así que ver a B durmiendo es la prueba de que la traba ya está.
    await waitUntilBlockerHoldsTheRow(matchdayId)

    // Sesión A: `matchday_season` e `is_season_admin` ya leyeron la fila; el
    // `select … for update` se cuelga esperando a B. Cuando B commitea su
    // delete, READ COMMITTED reevalúa la fila, no la encuentra, y v_status
    // queda en null.
    //
    // El `.then()` no es decorativo: lo que devuelve `rpc()` es un thenable
    // PEREZOSO —el request sale recién cuando alguien lo consume—, así que sin
    // esto la sesión A no arrancaría hasta el `await` de abajo, o sea después
    // del poll, y el entrelazado no pasaría nunca.
    const sessionA = admin.client.rpc('cancel_matchday', { p_matchday: matchdayId }).then((r) => r)
    // Sin await todavía: mientras A está en vuelo hay que VERLA encolada
    // detrás de B. Las dos guardas devuelven el mismo mensaje, así que sin
    // esto el test también pasa cuando A entra tarde, con la fecha ya borrada,
    // y se va por la primera guarda sin ejercitar nunca la rama del null.
    const queuedBehindTheLock = await waitUntilSomeoneQueuesBehindTheBlocker(matchdayId)
    const { error } = await sessionA
    await blocker

    expect(queuedBehindTheLock).toBe(true)
    expect(error?.message).toBe('La fecha no existe.')
    // El `raise` deshace la función entera, así que el trinquete de la
    // temporada tampoco se movió. Es la segunda mitad de la mutación: con el
    // deny-list la temporada vuelve a SETUP sin que nadie se lo pida.
    expect(await seasonStatus(seasonId)).toBe('ACTIVE')
  })
})
