import { describe, it, expect } from 'vitest'
import { defaultConfig, type SideSize } from '@/core'
import { EdgeError } from './errors'
import {
  historyWith,
  requestFriendship,
  acceptFriendship,
  friendsOf,
  createCasualMatch,
  updateCasualMatch,
  deleteCasualMatch,
  sportsUsedBy,
  type SharedMatch,
  type TournamentMatch,
  type CasualMatch,
  type CasualMatchInput,
} from './friends'
import { createMatchday, generatePairs, openMatchday, saveResult, setAttendance } from './matchday'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser, type TestUser } from './test/users'

// ── scaffolding local a este archivo ────────────────────────────────────────
// Mismo patrón que `db/entries.db.test.ts`, `db/close.db.test.ts`, etc.: cada
// `*.db.test.ts` trae su propio `fillerPlayers`, no hay un helper compartido.
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

/**
 * Arma una temporada de 8 presentes (MIN_PLAYERS, `core/constants.ts`: menos
 * y `generatePairs` rechaza la fecha), abre una fecha y genera parejas y
 * partidos por el camino real (`generatePairs`, no un insert a mano) — mismo
 * flujo que `db/entries.db.test.ts:56-77` y `db/close.db.test.ts:535-551`.
 * Devuelve el primer partido armado, para ejercitar `match_participants`
 * sobre un partido de verdad, con RLS real de por medio.
 *
 * `squad`, agregado para Task 4 (`dosFechasConYContra` más abajo): el plantel
 * a usar, YA en el orden que se le quiere dar al sorteo — sin especificar,
 * 8 jugadores de relleno anónimos, el caso de siempre. El orden importa
 * porque es literalmente el seed (`squadSeedOrder`, `db/season.ts:23-34`) y
 * el sorteo de la fecha 1 desempata por ese seed (`snapshotForMatchday`,
 * `core/snapshots.ts:24`, sin puntos previos que lo tapen).
 *
 * `abierta`, agregado para Task 2 (plan-historial-entre-amigos-2a): sin él,
 * la fecha queda JUGADA de punta a punta -- parejas, partidos Y resultado --
 * que es lo que promete el nombre del helper y lo que necesita el test que
 * lee `outcome`/`score`. Con `abierta: true` se corta justo antes de cargar
 * resultados: parejas y partidos armados, la fecha abierta, sin un solo set
 * -- el caso real de una fecha que todavía se está jugando. No hay un
 * segundo helper para esto: sería repetir temporada + fecha + parejas para
 * variar sólo el último paso.
 */
async function unaFechaJugada({
  admin,
  pairSize,
  squad,
  abierta,
}: {
  admin: TestUser
  pairSize: SideSize
  squad?: string[]
  abierta?: boolean
}): Promise<{ matchId: string; matchdayId: string; seasonId: string; entryIds: string[] }> {
  const jugadores = squad ?? (await fillerPlayers(8))
  const { seasonId, entryIds, disciplineId } = await createSeason({
    admin,
    squad: jugadores,
    disciplines: [
      {
        kind: pairSize === 1 ? 'FIFA' : 'PADEL',
        pairSize,
        config: defaultConfig(8, pairSize),
      },
    ],
  })

  const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10', disciplineId)
  for (const entryId of entryIds) {
    await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
  }
  await generatePairs(admin.client, matchdayId)
  // `saveResult` exige la fecha OPEN (`match_sets_write`, 0002_rls.sql): sin
  // este paso, cargar un resultado más abajo rebota con RLS en vez de guardar.
  await openMatchday(admin.client, matchdayId)

  const db = adminClient()
  // `.order('id')`: sin esto, `matches[0]` más abajo -- el `matchId` que
  // este helper devuelve -- es la fila que Postgres elija devolver primero,
  // no reproducible entre corridas.
  const { data: matches, error } = await db
    .from('matches')
    .select('id')
    .eq('matchday_id', matchdayId)
    .order('id', { ascending: true })
  if (error || matches === null || matches.length === 0) {
    throw new Error(`No se pudieron leer los partidos de test: ${error?.message}`)
  }

  if (abierta !== true) {
    // Un 4-1 cierra el set (`gamesPerSet: 4` de `defaultConfig`, tie-break):
    // mismo marcador que usa `playAllMatches` en `db/cancel.db.test.ts`. A
    // quién le toca ganar no importa acá -- ningún test de este archivo mira
    // el resultado de un partido que no sea el compartido entre `admin` y
    // `otro`, y ese SÍ sale con un resultado real, no un placeholder.
    for (const match of matches) {
      await saveResult(admin.client, match.id, [{ gamesA: 4, gamesB: 1 }])
    }
  }

  const [primero] = matches
  if (primero === undefined) throw new Error(`La fecha ${matchdayId} no generó partidos.`)

  return { matchId: primero.id, matchdayId, seasonId, entryIds }
}

/** El partido de la fecha donde juegan LOS DOS jugadores dados (a los dos lados de un `match_participants`). */
async function partidoDeLosDos(matchdayId: string, a: string, b: string): Promise<string> {
  const { data, error } = await adminClient()
    .from('match_participants')
    .select('match_id, player_id')
    .eq('matchday_id', matchdayId)
    .in('player_id', [a, b])
  if (error) throw new Error(error.message)

  const porPartido = new Map<string, Set<string>>()
  for (const fila of data ?? []) {
    // `match_participants` es una vista: el generador tipa todo `| null`
    // aunque las columnas base sean NOT NULL (mismo punto que `db/friends.ts`).
    if (fila.match_id === null || fila.player_id === null) {
      throw new Error('match_participants trajo match_id o player_id en null.')
    }
    const jugadores = porPartido.get(fila.match_id) ?? new Set<string>()
    jugadores.add(fila.player_id)
    porPartido.set(fila.match_id, jugadores)
  }
  const conLosDos = [...porPartido.entries()].find(([, jugadores]) => jugadores.size === 2)
  if (conLosDos === undefined) {
    throw new Error(`Ningún partido de la fecha ${matchdayId} tiene a los dos jugadores.`)
  }
  return conLosDos[0]
}

/**
 * El lado ('A'/'B') ESPERADO de `playerId` en `matchId`, leído con
 * `service_role` -- scaffolding para armar la expectativa del test, no un
 * chequeo de permisos (por eso `adminClient()` acá es correcto, a diferencia
 * de los `historyWith` de más abajo, que SÍ pasan por el cliente logueado).
 *
 * Calculado desde `matches.pair_a`/`pair_b` y `pairs.entry_a`/`entry_b` --
 * las columnas BASE que la vista usa para definir `side`
 * (`case when p.id = m.pair_a then 'A' else 'B' end`, 0071) --, NO leyendo
 * `match_participants.side`. Antes este helper leía esa misma columna, la
 * MISMA que `historyWith` lee: si la vista cambiara esa definición algún
 * día, implementación y expectativa se moverían juntas y la suite seguiría
 * en verde con el resultado invertido -- nada la fijaba. Calculado desde las
 * tablas base, un cambio en la vista rompe ESTE test primero.
 */
async function ladoDe(matchId: string, playerId: string): Promise<string> {
  const db = adminClient()
  const { data: match, error: matchError } = await db
    .from('matches')
    .select('pair_a, pair_b')
    .eq('id', matchId)
    .single()
  if (matchError || match === null) {
    throw new Error(`No se pudo leer el partido ${matchId}: ${matchError?.message}`)
  }

  const { data: pairs, error: pairsError } = await db
    .from('pairs')
    .select('id, entry_a, entry_b')
    .in('id', [match.pair_a, match.pair_b])
  if (pairsError || pairs === null) {
    throw new Error(`No se pudieron leer las parejas de ${matchId}: ${pairsError?.message}`)
  }

  // `entry_b` es nullable con disciplinas de a uno (0028): el filtro de abajo
  // sólo entra si no es null, mismo criterio que el `or` de la vista (0071).
  const entryIds = pairs.flatMap((p) => (p.entry_b === null ? [p.entry_a] : [p.entry_a, p.entry_b]))
  const { data: entries, error: entriesError } = await db
    .from('entries')
    .select('id, player_id')
    .in('id', entryIds)
  if (entriesError || entries === null) {
    throw new Error(`No se pudieron leer las entries de ${matchId}: ${entriesError?.message}`)
  }

  const misEntryIds = new Set(entries.filter((e) => e.player_id === playerId).map((e) => e.id))
  const miPar = pairs.find(
    (p) => misEntryIds.has(p.entry_a) || (p.entry_b !== null && misEntryIds.has(p.entry_b)),
  )
  if (miPar === undefined) {
    throw new Error(`${playerId} no juega en el partido ${matchId}.`)
  }
  return miPar.id === match.pair_a ? 'A' : 'B'
}

/**
 * Angosta un `SharedMatch` a su lado de torneo. Todo partido que este archivo
 * arma con `unaFechaJugada`/`dosFechasConYContra` sale de esa fuente, nunca
 * casual -- un `kind` distinto acá sería el test mal armado (un `matchId` que
 * no corresponde), no un caso real que estos tests deban contemplar.
 */
function comoTorneo(
  partido: SharedMatch | undefined,
  matchId: string,
): { kind: 'tournament' } & TournamentMatch {
  if (partido === undefined) throw new Error(`El partido ${matchId} no salió en el historial.`)
  if (partido.kind !== 'tournament') throw new Error(`El partido ${matchId} no es de torneo.`)
  return partido
}

/**
 * Dos fechas — dos temporadas, cada una la fecha 1 de su disciplina — que
 * ponen a `admin` y a `otro` una vez de compañeros y una vez enfrentados.
 *
 * Por qué DOS TEMPORADAS y no dos fechas de la misma: el "no repetir pareja"
 * (`previousContext`, alimentado por `closedHistory`) sólo mira fechas
 * CLOSED (`db/season.ts:126`). Encadenar las dos fechas pediría cerrar la
 * primera --cargar sets, cerrarla-- sólo para forzar el sorteo de la
 * segunda: más aparato del que hace falta para lo que este helper necesita.
 *
 * Por qué NO se usa `lockPair`: es la vía obvia para fijar una pareja antes
 * del sorteo, y se descartó porque no aplica acá.
 * `assertLocksAndGuests` (`db/validate.ts:207-211`) exige que toda pareja
 * fijada a mano incluya a un invitado -- "dos jugadores del torneo no se
 * pueden poner juntos" -- y un invitado (`addGuest`, `db/matchday.ts` arriba
 * de `lockPair`) se crea SIN `player_id`. `match_participants` exige
 * `player_id is not null` (0071): un invitado nunca aparece ahí. Fijar a
 * `admin`+`otro` con un lock es imposible sin volver a uno de los dos un
 * invitado invisible para la vista que este mismo historial necesita leer.
 *
 * Lo que sí se usa es que el sorteo (`buildPairs`, `core/pairing.ts`) es
 * DETERMINISTA y público en su regla: en la fecha 1 de una disciplina nadie
 * tiene puntos todavía, así que el desempate cae entero en el snapshot, que
 * en la fecha 1 ES el orden de seed (`snapshotForMatchday` con
 * `matchdayNumber=1` da `refreshes=0` y devuelve `seedOrder` tal cual,
 * `core/snapshots.ts:21-24`) -- y el seed es el orden de `squad` acá
 * (`squadSeedOrder`, `db/season.ts:23-34`, el mismo que `createSeason` usa
 * para `discipline_entries.seed_position`). `imbalance` (`core/pairing.ts:
 * 259-266`) puntúa cada armado por qué tan lejos queda cada pareja de sumar
 * `n+1`, y con 8 jugadores rankeados 1..8 el ÚNICO armado con score CERO en
 * las cuatro parejas es el que empareja el rank i con el rank `9-i` -- es la
 * única suma-9 posible para cada pareja, así que no hay otro candidato con
 * el que pueda empatar.
 *
 * - `juntos`: `admin` en el rank 1 (primero en `squad`) y `otro` en el rank 8
 *   (último) -- son complementarios (1+8=9), el sorteo los empareja.
 * - `enContra`: `admin` rank 1, `otro` rank 2 -- ninguno es complementario
 *   del otro, así que caen en parejas distintas. Y como el round robin de 4
 *   lados es COMPLETO (verificado en Task 3: 4 lados, 6 partidos, todos
 *   contra todos), la pareja de `admin` se cruza con la de `otro` en
 *   exactamente un partido de la fecha.
 *
 * `seasonName`, agregado para Task 2: el nombre de la temporada de
 * `enContra` -- la única de las dos que los tests de Task 2 leen --, para
 * comparar contra lo que `historyWith` diga que es el torneo de ese
 * partido. `createSeason` (db/test/factories.ts) no lo devuelve -- sólo el
 * id --, así que se relee con `service_role`, mismo criterio que el resto
 * de este archivo usa para leer estado que la app no expone.
 */
async function dosFechasConYContra({
  admin,
  otro,
}: {
  admin: TestUser
  otro: TestUser
}): Promise<{ juntos: string; enContra: string; seasonName: string }> {
  const rellenoJuntos = await fillerPlayers(6)
  const { matchdayId: fechaJuntos } = await unaFechaJugada({
    admin,
    pairSize: 2,
    squad: [admin.playerId, ...rellenoJuntos, otro.playerId],
  })
  const juntos = await partidoDeLosDos(fechaJuntos, admin.playerId, otro.playerId)

  const rellenoEnContra = await fillerPlayers(6)
  const { matchdayId: fechaEnContra, seasonId } = await unaFechaJugada({
    admin,
    pairSize: 2,
    squad: [admin.playerId, otro.playerId, ...rellenoEnContra],
  })
  const enContra = await partidoDeLosDos(fechaEnContra, admin.playerId, otro.playerId)

  const { data: season, error } = await adminClient()
    .from('seasons')
    .select('name')
    .eq('id', seasonId)
    .single()
  if (error || season === null) {
    throw new Error(`No se pudo leer la temporada de test: ${error?.message}`)
  }

  return { juntos, enContra, seasonName: season.name }
}

describe('friendships', () => {
  it('guarda una sola fila por par, con los jugadores ordenados', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const [a, b] =
      uno.playerId < dos.playerId ? [uno.playerId, dos.playerId] : [dos.playerId, uno.playerId]

    const db = adminClient()
    const { error } = await db
      .from('friendships')
      .insert({ player_a: a, player_b: b, requested_by: a })
    expect(error).toBeNull()

    const { error: repetida } = await db
      .from('friendships')
      .insert({ player_a: a, player_b: b, requested_by: b })
    expect(repetida?.code).toBe('23505')
  })

  it('rechaza una amistad con uno mismo', async () => {
    const uno = await createTestUser()
    const a = uno.playerId

    const db = adminClient()
    const { error } = await db
      .from('friendships')
      .insert({ player_a: a, player_b: a, requested_by: a })
    expect(error?.code).toBe('23514')
  })

  it('rechaza el par desordenado, para que no entren dos filas del mismo par', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const [a, b] =
      uno.playerId < dos.playerId ? [uno.playerId, dos.playerId] : [dos.playerId, uno.playerId]

    const db = adminClient()
    const { error } = await db
      .from('friendships')
      .insert({ player_a: b, player_b: a, requested_by: a })
    expect(error?.code).toBe('23514')
  })

  // Los tres tests de acá abajo usan el cliente logueado (`.client`), no
  // `adminClient()`: son los únicos que de verdad pasan por las políticas
  // RLS de escritura, no por los CHECK/UNIQUE de la tabla.
  it('un caller no puede insertar una amistad que ya nace aceptada', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const [a, b] =
      uno.playerId < dos.playerId ? [uno.playerId, dos.playerId] : [dos.playerId, uno.playerId]

    const { error } = await uno.client.from('friendships').insert({
      player_a: a,
      player_b: b,
      requested_by: uno.playerId,
      accepted_at: new Date().toISOString(),
    })

    // Pineado y verificado corriendo el test contra la base local (42501,
    // permission denied): el `with check` de `friendships_request` incluye
    // `accepted_at is null` (0070) -- es el cover que cierra ese clause.
    expect(error?.code).toBe('42501')
  })

  it('quien recibe una solicitud no puede reapuntarla a un par fabricado', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const tres = await createTestUser()
    const [a, b] =
      uno.playerId < dos.playerId ? [uno.playerId, dos.playerId] : [dos.playerId, uno.playerId]

    const { data: creada, error: pedidoError } = await uno.client
      .from('friendships')
      .insert({ player_a: a, player_b: b, requested_by: uno.playerId })
      .select('id')
      .single()
    expect(pedidoError).toBeNull()

    // `dos` es la contraparte: recibió la solicitud de `uno`, nunca la pidió.
    const [fa, fb] =
      dos.playerId < tres.playerId ? [dos.playerId, tres.playerId] : [tres.playerId, dos.playerId]
    await dos.client
      .from('friendships')
      .update({
        player_a: fa,
        player_b: fb,
        requested_by: tres.playerId,
        accepted_at: new Date().toISOString(),
      })
      .eq('id', creada?.id ?? '')

    const { data: fila } = await adminClient()
      .from('friendships')
      .select('player_a, player_b, requested_by, accepted_at')
      .eq('id', creada?.id ?? '')
      .single()
    expect(fila?.player_a).toBe(a)
    expect(fila?.player_b).toBe(b)
    expect(fila?.requested_by).toBe(uno.playerId)
    expect(fila?.accepted_at).toBeNull()
  })

  it('aceptar una solicitud genuina sigue funcionando', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const [a, b] =
      uno.playerId < dos.playerId ? [uno.playerId, dos.playerId] : [dos.playerId, uno.playerId]

    const { data: creada, error: pedidoError } = await uno.client
      .from('friendships')
      .insert({ player_a: a, player_b: b, requested_by: uno.playerId })
      .select('id')
      .single()
    expect(pedidoError).toBeNull()

    const { error: aceptarError } = await dos.client
      .from('friendships')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', creada?.id ?? '')
    expect(aceptarError).toBeNull()

    const { data: fila } = await adminClient()
      .from('friendships')
      .select('accepted_at')
      .eq('id', creada?.id ?? '')
      .single()
    expect(fila?.accepted_at).not.toBeNull()
  })
})

describe('friendships — RLS', () => {
  it('un tercero no ve la amistad ajena', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const ajeno = await createTestUser()
    const [a, b] =
      uno.playerId < dos.playerId ? [uno.playerId, dos.playerId] : [dos.playerId, uno.playerId]

    const { data: fila } = await adminClient()
      .from('friendships')
      .insert({ player_a: a, player_b: b, requested_by: a })
      .select('id')
      .single()

    // Chequeo positivo primero: si la lectura fuera negada para todos (no
    // sólo acotada a los miembros), `uno` también vería `[]` y este test
    // pasaría igual sin haber probado nada — como de hecho pasaba con la
    // versión anterior, que sólo miraba a `ajeno`.
    const { data: propia } = await uno.client.from('friendships').select('id')
    expect(propia).toEqual([{ id: fila!.id }])

    const { data: ajena } = await ajeno.client.from('friendships').select('id')
    expect(ajena).toEqual([])
  })

  it('nadie puede inventar una amistad entre dos terceros', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const ajeno = await createTestUser()
    const [a, b] =
      uno.playerId < dos.playerId ? [uno.playerId, dos.playerId] : [dos.playerId, uno.playerId]

    const { error } = await ajeno.client
      .from('friendships')
      .insert({ player_a: a, player_b: b, requested_by: a })
    expect(error?.code).toBe('42501')
  })

  it('quien pidió no puede aceptar su propia solicitud', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const [a, b] =
      uno.playerId < dos.playerId ? [uno.playerId, dos.playerId] : [dos.playerId, uno.playerId]
    const pidio = uno.playerId === a ? uno : dos

    const { data: fila } = await adminClient()
      .from('friendships')
      .insert({ player_a: a, player_b: b, requested_by: a })
      .select('id')
      .single()

    const { data } = await pidio.client
      .from('friendships')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', fila!.id)
      .select('id')
    expect(data).toEqual([])
  })
})

describe('match_participants', () => {
  it('devuelve los cuatro jugadores de un partido de parejas, con su lado', async () => {
    const admin = await createTestUser()
    const { matchId } = await unaFechaJugada({ admin, pairSize: 2 })

    const { data, error } = await adminClient()
      .from('match_participants')
      .select('match_id, side, player_id')
      .eq('match_id', matchId)
    if (error) throw new Error(error.message)

    expect(data).toHaveLength(4)
    expect(new Set(data!.map((f) => f.side))).toEqual(new Set(['A', 'B']))
  })

  it('NO pierde el partido de a uno, donde entry_b viene en null', async () => {
    const admin = await createTestUser()
    const { matchId } = await unaFechaJugada({ admin, pairSize: 1 })

    const { data } = await adminClient()
      .from('match_participants')
      .select('match_id, side')
      .eq('match_id', matchId)

    expect(data).toHaveLength(2)
  })

  it('no le muestra a un tercero los partidos de una temporada ajena', async () => {
    const admin = await createTestUser()
    const ajeno = await createTestUser()
    const { matchId } = await unaFechaJugada({ admin, pairSize: 2 })

    // Chequeo positivo primero, mismo criterio que la RLS de `friendships`
    // arriba (`'un tercero no ve la amistad ajena'`): si la vista negara la
    // lectura para CUALQUIER autenticado (no sólo para quien no participa),
    // `admin` también vería `[]` y este test pasaría igual sin haber probado
    // el aislamiento — sólo que la vista estaría rota, no protegida.
    const { data: propia } = await admin.client
      .from('match_participants')
      .select('match_id')
      .eq('match_id', matchId)
    expect(propia).toHaveLength(4)

    const { data } = await ajeno.client
      .from('match_participants')
      .select('match_id')
      .eq('match_id', matchId)
    expect(data).toEqual([])
  })
})

describe('historyWith', () => {
  it('distingue los partidos jugados juntos de los jugados en contra', async () => {
    const admin = await createTestUser()
    const otro = await createTestUser()
    // Una temporada donde los dos juegan: una fecha los pone en la MISMA
    // pareja, otra en parejas ENFRENTADAS. Ver `dosFechasConYContra` arriba.
    const { juntos, enContra } = await dosFechasConYContra({ admin, otro })

    const historia = await historyWith(admin.client, otro.playerId)

    expect(comoTorneo(historia.find((m) => m.matchId === juntos), juntos).together).toBe(true)
    expect(comoTorneo(historia.find((m) => m.matchId === enContra), enContra).together).toBe(false)
  })

  it('no devuelve nada de una temporada en la que el caller no está', async () => {
    const ajeno = await createTestUser()
    const admin = await createTestUser()
    const otro = await createTestUser()
    await dosFechasConYContra({ admin, otro })

    const historia = await historyWith(ajeno.client, otro.playerId)
    expect(historia).toEqual([])
  })

  it('trae la fecha, el torneo y el resultado de cada partido', async () => {
    const admin = await createTestUser()
    const otro = await createTestUser()
    const { juntos, enContra, seasonName } = await dosFechasConYContra({ admin, otro })

    const historia = await historyWith(admin.client, otro.playerId)

    // `enContra`: `unaFechaJugada` guarda 4-1 a favor de `pair_a` en TODO
    // partido (ver su doc) -- el lado de `admin` en ESTE partido, leído de
    // la vista real, decide si ese 4-1 es su `outcome`/`score` o el
    // opuesto. Sumar `mine + theirs` (como hacía la versión anterior de este
    // test) no distingue un 4-1 de un 1-4: pasa igual si `mine`/`theirs`
    // están invertidos. Esto sí lo distingue.
    const partido = comoTorneo(historia.find((m) => m.matchId === enContra), enContra)
    const lado = await ladoDe(enContra, admin.playerId)
    expect(partido.seasonName).toBe(seasonName)
    expect(partido.matchdayNumber).toBe(1)
    // `unaFechaJugada` crea la fecha con '2026-08-10' (ver su doc) -- es lo
    // único que hoy fija `playedOn`, del que dependen tanto el orden de la
    // lista (`porFechaDescendente`, `db/friends.ts` -- el único lugar que lo
    // define; la pantalla sólo dibuja lo que recibe) como la fecha que
    // muestra cada fila, y que ningún test de esta suite chequeaba.
    expect(partido.playedOn).toBe('2026-08-10')
    expect(partido.score).toEqual(lado === 'A' ? { mine: 4, theirs: 1 } : { mine: 1, theirs: 4 })
    expect(partido.outcome).toBe(lado === 'A' ? 'won' : 'lost')

    // `juntos`: `admin` y `otro` comparten lado, así que `outcome` es lo que
    // le pasó a LA PAREJA -- no "lo mío contra nadie". Mismo mapeo lado→won,
    // ahora sobre el partido donde el lado de los dos es el mismo.
    const partidoJuntos = comoTorneo(historia.find((m) => m.matchId === juntos), juntos)
    const ladoJuntos = await ladoDe(juntos, admin.playerId)
    expect(partidoJuntos.outcome).toBe(ladoJuntos === 'A' ? 'won' : 'lost')
  })

  it('un partido sin resultado cargado sale con outcome y score en null', async () => {
    const admin = await createTestUser()
    const otro = await createTestUser()
    const relleno = await fillerPlayers(6)
    // Fecha ABIERTA (flag de `unaFechaJugada`): parejas y partidos armados,
    // sin resultado -- el caso real de una fecha que todavía se está jugando.
    const { matchdayId } = await unaFechaJugada({
      admin,
      pairSize: 2,
      squad: [admin.playerId, otro.playerId, ...relleno],
      abierta: true,
    })
    const matchId = await partidoDeLosDos(matchdayId, admin.playerId, otro.playerId)

    const historia = await historyWith(admin.client, otro.playerId)
    const partido = historia.find((m) => m.matchId === matchId)

    expect(partido?.outcome).toBeNull()
    expect(partido?.score).toBeNull()
  })

  // El test que es el punto de la Tarea 2 (plan-historial-entre-amigos-2b):
  // un casual y un torneo entre los mismos dos, mezclados y ordenados por
  // fecha entre las DOS fuentes -- no cada fuente ordenada por su lado.
  it('mezcla un partido casual con uno de torneo, ordenados por fecha descendente entre las dos fuentes', async () => {
    const admin = await createTestUser()
    const otro = await createTestUser()
    const [a, b] =
      admin.playerId < otro.playerId ? [admin.playerId, otro.playerId] : [otro.playerId, admin.playerId]
    await adminClient()
      .from('friendships')
      .insert({
        player_a: a,
        player_b: b,
        requested_by: admin.playerId,
        accepted_at: new Date().toISOString(),
      })

    // El de torneo: `unaFechaJugada` lo juega el '2026-08-10' (ver su doc).
    const relleno = await fillerPlayers(6)
    const { matchdayId } = await unaFechaJugada({
      admin,
      pairSize: 2,
      squad: [admin.playerId, otro.playerId, ...relleno],
    })
    const torneoMatchId = await partidoDeLosDos(matchdayId, admin.playerId, otro.playerId)

    // El casual: cargado el '2026-08-30', DESPUÉS del de torneo -- tiene que
    // salir primero en la lista. `winner: a` con un marcador asimétrico
    // (3 contra 1, no 2 contra 2): si la orientación se calculara del lado
    // fijo `player_a`/`player_b` en vez de `my_player_id()`, este test lo
    // nota apenas `admin` resulte ser `b` en vez de `a`.
    const { data: casual, error: casualError } = await admin.client
      .from('casual_matches')
      .insert({
        player_a: a,
        player_b: b,
        sport: 'FIFA',
        played_on: '2026-08-30',
        winner: a,
        score_a: 3,
        score_b: 1,
        team_a: 'River',
        team_b: 'Boca',
        created_by: admin.playerId,
        updated_by: admin.playerId,
      })
      .select('id')
      .single()
    expect(casualError).toBeNull()
    if (casual === null) throw new Error('No se pudo cargar el partido casual de test.')

    const historia = await historyWith(admin.client, otro.playerId)

    const casualPartido = historia.find((m) => m.matchId === casual.id)
    const torneoPartido = historia.find((m) => m.matchId === torneoMatchId)
    if (casualPartido === undefined) throw new Error('El partido casual no salió en el historial.')
    if (torneoPartido === undefined) throw new Error('El partido de torneo no salió en el historial.')
    expect(casualPartido.kind).toBe('casual')
    expect(torneoPartido.kind).toBe('tournament')

    // La mezcla es el punto del test: el casual (30/8) es más nuevo que el
    // de torneo (10/8), así que va ANTES en la lista final -- ordenados
    // entre las dos fuentes, no cada fuente por su lado.
    expect(historia.indexOf(casualPartido)).toBeLessThan(historia.indexOf(torneoPartido))

    // Orientación derivada de LA FILA BASE (`a`/`b`, lo que se insertó), no
    // releída del propio resultado bajo test -- mismo criterio que `ladoDe`
    // más arriba para el partido de torneo.
    if (casualPartido.kind !== 'casual') throw new Error('El partido casual no tiene kind "casual".')
    const meEsA = admin.playerId === a
    expect(casualPartido.score).toEqual(meEsA ? { mine: 3, theirs: 1 } : { mine: 1, theirs: 3 })
    expect(casualPartido.outcome).toBe(meEsA ? 'won' : 'lost')
    expect(casualPartido.teams).toEqual(
      meEsA ? { mine: 'River', theirs: 'Boca' } : { mine: 'Boca', theirs: 'River' },
    )
    expect(casualPartido.sport).toBe('FIFA')
    expect(casualPartido.playedOn).toBe('2026-08-30')

    // `createdBy`/`updatedBy` corren la sexta consulta de verdad (RLS de
    // `players` incluida) -- sin esto, un `?? ''` que fallara en silencio
    // (mapa mal armado, id que no matchea) pasaría de punta a punta sin que
    // ningún test lo note. `admin` cargó y no lo tocó nadie más: los dos
    // campos son su propio nombre.
    const { data: creador } = await adminClient()
      .from('players')
      .select('display_name')
      .eq('id', admin.playerId)
      .single()
    expect(casualPartido.createdBy).toBe(creador?.display_name)
    expect(casualPartido.updatedBy).toBe(creador?.display_name)
  })
})

describe('requestFriendship', () => {
  it('crea una solicitud pendiente que la contraparte puede ver', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()

    await requestFriendship(uno.client, dos.playerId)

    const { data: fila } = await adminClient()
      .from('friendships')
      .select('player_a, player_b, requested_by, accepted_at')
      .or(`player_a.eq.${uno.playerId},player_b.eq.${uno.playerId}`)
      .single()
    expect(fila?.requested_by).toBe(uno.playerId)
    expect(fila?.accepted_at).toBeNull()
    expect([fila?.player_a, fila?.player_b].sort()).toEqual([uno.playerId, dos.playerId].sort())
  })

  it('no deja pedirse amistad a uno mismo', async () => {
    const uno = await createTestUser()
    await expect(requestFriendship(uno.client, uno.playerId)).rejects.toThrow(EdgeError)
  })

  it('rechaza una segunda solicitud entre el mismo par, con un mensaje legible', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    await requestFriendship(uno.client, dos.playerId)

    await expect(requestFriendship(dos.client, uno.playerId)).rejects.toThrow(EdgeError)
  })

  // Los dos tests de acá abajo son Item 5 del fix wave: un uuid bien formado
  // que no es de nadie da 23503 (FK), uno mal formado da 22P02 (cast). Los
  // dos hoy llegan crudos al mensaje del EdgeError -- nombre de constraint o
  // "invalid input syntax" en inglés -- y eso es lo que estos tests fijan
  // ANTES de agregar las ramas, para verlos fallar por el motivo correcto.
  it('un uuid bien formado que no es de nadie da un mensaje legible, no el nombre del constraint', async () => {
    const uno = await createTestUser()
    const fantasma = '00000000-0000-0000-0000-000000000000'

    const error: unknown = await requestFriendship(uno.client, fantasma).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EdgeError)
    expect((error as EdgeError).message).not.toMatch(/fkey|constraint/i)
    expect((error as EdgeError).message).toBe('No existe ningún jugador con ese ID.')
  })

  it('un uuid mal formado da un mensaje legible, no el error crudo de Postgres', async () => {
    const uno = await createTestUser()

    const error: unknown = await requestFriendship(uno.client, 'no-es-un-uuid').catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(EdgeError)
    expect((error as EdgeError).message).not.toMatch(/invalid input syntax/i)
    expect((error as EdgeError).message).toBe('Ese ID no es válido.')
  })
})

describe('acceptFriendship', () => {
  it('la contraparte acepta y la amistad queda activa', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const [a, b] =
      uno.playerId < dos.playerId ? [uno.playerId, dos.playerId] : [dos.playerId, uno.playerId]
    const { data: creada } = await adminClient()
      .from('friendships')
      .insert({ player_a: a, player_b: b, requested_by: uno.playerId })
      .select('id')
      .single()

    await acceptFriendship(dos.client, creada!.id)

    const { data: fila } = await adminClient()
      .from('friendships')
      .select('accepted_at')
      .eq('id', creada!.id)
      .single()
    expect(fila?.accepted_at).not.toBeNull()
  })

  it('quien pidió no puede aceptar su propia solicitud', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const [a, b] =
      uno.playerId < dos.playerId ? [uno.playerId, dos.playerId] : [dos.playerId, uno.playerId]
    const pidio = uno.playerId === a ? uno : dos
    const { data: creada } = await adminClient()
      .from('friendships')
      .insert({ player_a: a, player_b: b, requested_by: a })
      .select('id')
      .single()

    await expect(acceptFriendship(pidio.client, creada!.id)).rejects.toThrow(EdgeError)
  })
})

describe('friendsOf', () => {
  it('lista amistades aceptadas y pendientes, con quién las pidió', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const tres = await createTestUser()

    // `dos` le pide a `uno`, y `uno` acepta.
    await requestFriendship(dos.client, uno.playerId)
    const { data: pendienteConDos } = await adminClient()
      .from('friendships')
      .select('id')
      .or(`player_a.eq.${dos.playerId},player_b.eq.${dos.playerId}`)
      .single()
    await acceptFriendship(uno.client, pendienteConDos!.id)

    // `uno` le pide a `tres`, sin aceptar todavía.
    await requestFriendship(uno.client, tres.playerId)

    const amigos = await friendsOf(uno.client)

    const conDos = amigos.find((f) => f.playerId === dos.playerId)
    expect(conDos?.accepted).toBe(true)
    expect(conDos?.theyAsked).toBe(true)
    expect(conDos?.displayName.length).toBeGreaterThan(0)

    const conTres = amigos.find((f) => f.playerId === tres.playerId)
    expect(conTres?.accepted).toBe(false)
    expect(conTres?.theyAsked).toBe(false)
  })

  it('no ve amistades ajenas', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const ajeno = await createTestUser()
    await requestFriendship(uno.client, dos.playerId)

    const amigos = await friendsOf(ajeno.client)
    expect(amigos).toEqual([])
  })
})

// ── casual_matches (plan-historial-entre-amigos-2b, tarea 1) ────────────────
// Sólo la tabla y su RLS -- todavía no hay `db/casual.ts` (tarea 2), así que
// estos tests hablan con `casual_matches` directo, como los de `friendships`
// de más arriba antes de que existiera esa capa. Todos por cliente
// AUTENTICADO salvo el andamiaje de la amistad (crear la fila de
// `friendships` en el estado que cada test necesita no es lo que se está
// probando acá -- eso lo cubre `describe('friendships', ...)`).
describe('casual_matches', () => {
  it('dos amigos con amistad aceptada pueden cargar un partido casual', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const [a, b] =
      uno.playerId < dos.playerId ? [uno.playerId, dos.playerId] : [dos.playerId, uno.playerId]
    await adminClient()
      .from('friendships')
      .insert({
        player_a: a,
        player_b: b,
        requested_by: uno.playerId,
        accepted_at: new Date().toISOString(),
      })

    const { data, error } = await uno.client
      .from('casual_matches')
      .insert({
        player_a: a,
        player_b: b,
        sport: 'FIFA',
        played_on: '2026-08-30',
        created_by: uno.playerId,
        updated_by: uno.playerId,
      })
      .select('id')
      .single()

    expect(error).toBeNull()
    expect(data).not.toBeNull()
  })

  // El test que cierra §4.5: sin ninguna fila de `friendships` entre los
  // dos, el insert tiene que rebotar -- si esto pasara, cualquiera podría
  // fabricar historial contra el `playerId` de un desconocido.
  it('sin ninguna amistad, el insert se rechaza', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const [a, b] =
      uno.playerId < dos.playerId ? [uno.playerId, dos.playerId] : [dos.playerId, uno.playerId]

    const { data, error } = await uno.client
      .from('casual_matches')
      .insert({
        player_a: a,
        player_b: b,
        sport: 'FIFA',
        played_on: '2026-08-30',
        created_by: uno.playerId,
        updated_by: uno.playerId,
      })
      .select()

    expect(data).toBeNull()
    expect(error?.code).toBe('42501')
  })

  it('con la solicitud pendiente (sin aceptar), también se rechaza', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const [a, b] =
      uno.playerId < dos.playerId ? [uno.playerId, dos.playerId] : [dos.playerId, uno.playerId]
    // Pendiente: mismo insert que `friendships_request`, sin `accepted_at`.
    // No se asertaba nada acá antes (Minor 4, review round 1): sin este check,
    // "sin amistad" y "amistad pendiente" son el mismo escenario para el
    // test si el seed fallara en silencio -- un typo futuro en `accepted_at`
    // dejaría este test en verde sin haber sembrado una amistad pendiente.
    const { error: seedError } = await adminClient()
      .from('friendships')
      .insert({ player_a: a, player_b: b, requested_by: uno.playerId })
    expect(seedError).toBeNull()

    const { data, error } = await uno.client
      .from('casual_matches')
      .insert({
        player_a: a,
        player_b: b,
        sport: 'FIFA',
        played_on: '2026-08-30',
        created_by: uno.playerId,
        updated_by: uno.playerId,
      })
      .select()

    expect(data).toBeNull()
    expect(error?.code).toBe('42501')
  })

  it('un tercero no ve el partido casual de otros dos', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const ajeno = await createTestUser()
    const [a, b] =
      uno.playerId < dos.playerId ? [uno.playerId, dos.playerId] : [dos.playerId, uno.playerId]
    await adminClient()
      .from('friendships')
      .insert({
        player_a: a,
        player_b: b,
        requested_by: uno.playerId,
        accepted_at: new Date().toISOString(),
      })
    const { data: creado } = await uno.client
      .from('casual_matches')
      .insert({
        player_a: a,
        player_b: b,
        sport: 'FIFA',
        played_on: '2026-08-30',
        created_by: uno.playerId,
        updated_by: uno.playerId,
      })
      .select('id')
      .single()

    // Chequeo positivo primero, mismo criterio que el resto del archivo: si
    // la lectura estuviera cerrada para cualquiera (no sólo para quien no
    // participa), `ajeno` también vería `[]` y este test pasaría sin haber
    // probado el aislamiento.
    const { data: propio } = await uno.client.from('casual_matches').select('id')
    expect(propio).toEqual([{ id: creado!.id }])

    const { data: ajenoVe } = await ajeno.client.from('casual_matches').select('id')
    expect(ajenoVe).toEqual([])
  })

  it('nadie puede mover player_a con un update', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const otro = await createTestUser()
    const [a, b] =
      uno.playerId < dos.playerId ? [uno.playerId, dos.playerId] : [dos.playerId, uno.playerId]
    await adminClient()
      .from('friendships')
      .insert({
        player_a: a,
        player_b: b,
        requested_by: uno.playerId,
        accepted_at: new Date().toISOString(),
      })
    const { data: creado } = await uno.client
      .from('casual_matches')
      .insert({
        player_a: a,
        player_b: b,
        sport: 'FIFA',
        played_on: '2026-08-30',
        created_by: uno.playerId,
        updated_by: uno.playerId,
      })
      .select('id')
      .single()

    // Lo frena el grant de columna, no una política: `player_a` no tiene
    // permiso de UPDATE otorgado (0072), así que ni evalúa ninguna política.
    const { data, error } = await uno.client
      .from('casual_matches')
      .update({ player_a: otro.playerId })
      .eq('id', creado!.id)
      .select()

    expect(data).toBeNull()
    expect(error?.code).toBe('42501')
  })

  // Los tres de acá abajo son la review round 1 (Important 1): las cinco
  // tests originales no ejercitaban la RLS que de verdad protege el
  // partido de un extraño -- `nadie puede mover player_a` de arriba se
  // frena por el GRANT de columna, antes de que ninguna política corra.
  it('un tercero no puede reescribir el partido de otros dos', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const ajeno = await createTestUser()
    const [a, b] =
      uno.playerId < dos.playerId ? [uno.playerId, dos.playerId] : [dos.playerId, uno.playerId]
    await adminClient()
      .from('friendships')
      .insert({
        player_a: a,
        player_b: b,
        requested_by: uno.playerId,
        accepted_at: new Date().toISOString(),
      })
    const { data: creado } = await uno.client
      .from('casual_matches')
      .insert({
        player_a: a,
        player_b: b,
        sport: 'FIFA',
        played_on: '2026-08-30',
        created_by: uno.playerId,
        updated_by: uno.playerId,
      })
      .select('id')
      .single()

    // Corregido tres veces en la review round 2/3. En orden:
    //
    // 1. El payload `{ score_a: 99 }` (round 1) violaba `casual_score_pair`
    //    (0072) por su cuenta -- si las tres capas de RLS hubieran estado
    //    anuladas, ESE constraint habría parado igual la escritura, y el
    //    rojo no habría probado RLS. `score_b: 0` lo deja bien formado.
    // 2. Sacar `.eq(...)` para lograr un UPDATE sin `WHERE` (round 2) no es
    //    viable: `.eq('id', ...)` es obligatorio porque un update/delete sin
    //    filtro da SQLSTATE 21000 (`cardinality_violation`) -- un error de
    //    POSTGRES, no de PostgREST -- levantado por `safeupdate`, una
    //    librería precargada en el rol `authenticator` de Supabase
    //    (`pg_roles.rolconfig` de ese rol trae
    //    `session_preload_libraries=supautils, safeupdate`, verificado
    //    contra la base local). Round 2 decía "PostgREST lo rechaza antes de
    //    llegar a Postgres" -- FALSO, el rechazo pasa DENTRO de Postgres, y
    //    depende de un ajuste de rol de la plataforma que este repo ni fija
    //    ni assertea en ningún lado: si `safeupdate` se sacara de
    //    `authenticator`, esta protección se cae. Confirmado además con un
    //    filtro "bulto" sobre `created_at` (no apunta a una fila puntual):
    //    Postgres exigió igual `casual_matches_read.using`, incluso para EL
    //    DUEÑO legítimo de la fila. Con `safeupdate` siempre exigiendo un
    //    `WHERE`, esta app nunca invoca `casual_matches_update`/`_delete`
    //    sin que Postgres también exija `casual_matches_read` -- éste es el
    //    único test honesto para esa combinación (revisado también en
    //    0072, junto a la política de lectura).
    // 3. `data` en cero filas sin `RETURNING` da `null` igual que en un
    //    error (round 2 lo asumía, pero nunca miró `error`) -- por eso el
    //    positivo de abajo sigue siendo necesario, PERO `error` sí distingue:
    //    un `using` que filtra da `error: null` (verificado: 204, sin
    //    error), así que se assertea también.
    const { error } = await ajeno.client
      .from('casual_matches')
      .update({ score_a: 99, score_b: 0 })
      .eq('id', creado!.id)
    expect(error).toBeNull()

    const { data: intacto } = await uno.client
      .from('casual_matches')
      .select('score_a')
      .eq('id', creado!.id)
      .single()
    expect(intacto?.score_a).toBeNull()
  })

  it('un tercero no puede borrar el partido de otros dos', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const ajeno = await createTestUser()
    const [a, b] =
      uno.playerId < dos.playerId ? [uno.playerId, dos.playerId] : [dos.playerId, uno.playerId]
    await adminClient()
      .from('friendships')
      .insert({
        player_a: a,
        player_b: b,
        requested_by: uno.playerId,
        accepted_at: new Date().toISOString(),
      })
    const { data: creado } = await uno.client
      .from('casual_matches')
      .insert({
        player_a: a,
        player_b: b,
        sport: 'FIFA',
        played_on: '2026-08-30',
        created_by: uno.playerId,
        updated_by: uno.playerId,
      })
      .select('id')
      .single()

    // `.eq('id', ...)` es obligatorio, no una elección: un delete sin filtro
    // da SQLSTATE 21000 (`cardinality_violation`), un error de POSTGRES
    // levantado por `safeupdate` -- librería precargada en el rol
    // `authenticator` (`session_preload_libraries=supautils, safeupdate` en
    // `pg_roles.rolconfig`, verificado contra la base local), no un rechazo
    // de PostgREST antes de tocar la base. Ver el comentario largo del
    // update de arriba para el detalle completo -- mismo mecanismo acá:
    // "aislar" `casual_matches_delete.using` sacando el filtro no es
    // alcanzable desde esta app, y el AND con `casual_matches_read.using`
    // tampoco depende de que el filtro sea por `id` (probado también con un
    // filtro "bulto" sobre `created_at`, negándole al DUEÑO legítimo su
    // propio delete). Las dos políticas están combinadas por construcción
    // en todo camino de escritura real, mientras `safeupdate` siga en
    // `authenticator` -- documentado también en 0072.
    //
    // Un `delete` frenado por `using` da `error: null` (verificado: 204) --
    // se assertea, y el positivo de abajo (releído con `uno`) es la otra
    // mitad de la prueba real.
    const { error } = await ajeno.client.from('casual_matches').delete().eq('id', creado!.id)
    expect(error).toBeNull()

    const { data: sigue } = await uno.client.from('casual_matches').select('id')
    expect(sigue).toEqual([{ id: creado!.id }])
  })

  it('un tercero no puede fabricar un partido entre otros dos, aunque sean amigos', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const ajeno = await createTestUser()
    const [a, b] =
      uno.playerId < dos.playerId ? [uno.playerId, dos.playerId] : [dos.playerId, uno.playerId]
    // `uno` y `dos` SON amigos aceptados: no alcanza con que EL PAR sea
    // amigo, `ajeno` tiene que ser uno de los dos. Verificado con sabotaje
    // (fix report) que la condición 1 del insert es redundante en la
    // práctica -- la propia RLS de `friendships_read` ya le niega a `ajeno`
    // ver esa fila de amistad (no es uno de sus dos jugadores), así que el
    // `exists(...)` de la condición 3 da falso para él aunque la amistad
    // exista. Este test fija el COMPORTAMIENTO ("ajeno no puede fabricar
    // esto"), no cuál capa específica lo frena -- eso puede cambiar sin que
    // este test deba cambiar con él.
    //
    // El error del seed se assertea (Minor 4, mismo defecto): si esta
    // amistad fallara en silencio, "aunque sean amigos" dejaría de ser
    // cierto y el test seguiría en verde por la razón EQUIVOCADA (ajeno
    // rechazado por no haber amistad, no por no ser miembro).
    const { error: seedError } = await adminClient()
      .from('friendships')
      .insert({
        player_a: a,
        player_b: b,
        requested_by: uno.playerId,
        accepted_at: new Date().toISOString(),
      })
    expect(seedError).toBeNull()

    const { data, error } = await ajeno.client
      .from('casual_matches')
      .insert({
        player_a: a,
        player_b: b,
        sport: 'FIFA',
        played_on: '2026-08-30',
        created_by: ajeno.playerId,
        updated_by: ajeno.playerId,
      })
      .select()

    expect(data).toBeNull()
    expect(error?.code).toBe('42501')
  })

  // Los tres de acá abajo son la review round 2, items d/e/f: no son
  // redundancia con lo de arriba -- son vectores de mentira sobre §3.2. Los
  // dos primeros (d, e) los frena un MIEMBRO legítimo del partido que
  // intenta apropiarse falsamente de `created_by`/`updated_by`, no un
  // extraño -- así que ni `casual_matches_read` ni `casual_authors_play`
  // entran en juego (el impostor SÍ es uno de los dos jugadores): lo único
  // que puede pararlos es la condición 2 del insert y el `with check` del
  // update, respectivamente.
  it('un miembro no puede insertar diciendo que lo cargó el otro', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const [a, b] =
      uno.playerId < dos.playerId ? [uno.playerId, dos.playerId] : [dos.playerId, uno.playerId]
    const { error: seedError } = await adminClient()
      .from('friendships')
      .insert({
        player_a: a,
        player_b: b,
        requested_by: uno.playerId,
        accepted_at: new Date().toISOString(),
      })
    expect(seedError).toBeNull()

    // `uno` inserta de verdad (es uno de los dos, la amistad existe), pero
    // pone `created_by: dos.playerId` -- miente sobre quién lo cargó.
    // `casual_authors_play` no lo frena (`dos` SÍ es uno de los dos); sólo
    // la condición 2 (`created_by = my_player_id()`) lo hace.
    const { data, error } = await uno.client
      .from('casual_matches')
      .insert({
        player_a: a,
        player_b: b,
        sport: 'FIFA',
        played_on: '2026-08-30',
        created_by: dos.playerId,
        updated_by: uno.playerId,
      })
      .select()

    expect(data).toBeNull()
    expect(error?.code).toBe('42501')
  })

  it('un miembro no puede editar diciendo que lo editó el otro', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const [a, b] =
      uno.playerId < dos.playerId ? [uno.playerId, dos.playerId] : [dos.playerId, uno.playerId]
    const { error: seedError } = await adminClient()
      .from('friendships')
      .insert({
        player_a: a,
        player_b: b,
        requested_by: uno.playerId,
        accepted_at: new Date().toISOString(),
      })
    expect(seedError).toBeNull()
    const { data: creado } = await uno.client
      .from('casual_matches')
      .insert({
        player_a: a,
        player_b: b,
        sport: 'FIFA',
        played_on: '2026-08-30',
        created_by: uno.playerId,
        updated_by: uno.playerId,
      })
      .select('id, updated_at')
      .single()

    // `dos` SÍ es dueño de la fila -- pasa el `using` del update sin
    // problema -- pero pone `updated_by: uno.playerId`, mintiendo que fue
    // `uno` quien editó. El `with check (updated_by = my_player_id())` lo
    // frena a él solo, sin ayuda de ninguna otra capa: acá SÍ hay error --
    // a diferencia de un `using` que filtra en silencio, un `with check`
    // que falla sobre una fila que el `using` YA aceptó tira 403/42501
    // (verificado en vivo -- "new row violates row-level security policy").
    const { error } = await dos.client
      .from('casual_matches')
      .update({ score_a: 4, score_b: 1, updated_by: uno.playerId })
      .eq('id', creado!.id)
    expect(error?.code).toBe('42501')

    // `updated_by` NO discrimina acá: ya nacía en `uno.playerId` (el insert)
    // y el propio ataque también lo manda a `uno.playerId`, así que vale
    // igual si el update pasó o no -- lo saqué. `updated_at`, que el
    // TRIGGER (0072) avanza en cualquier update real, sí discrimina: si el
    // ataque se hubiera colado, habría cambiado igual que en el positivo de
    // "el trigger avanza updated_at" de abajo.
    const { data: intacto } = await uno.client
      .from('casual_matches')
      .select('score_a, updated_at')
      .eq('id', creado!.id)
      .single()
    expect(intacto?.score_a).toBeNull()
    expect(intacto?.updated_at).toBe(creado?.updated_at)
  })

  it('un miembro legítimo actualiza el partido, y el trigger avanza updated_at', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const [a, b] =
      uno.playerId < dos.playerId ? [uno.playerId, dos.playerId] : [dos.playerId, uno.playerId]
    const { error: seedError } = await adminClient()
      .from('friendships')
      .insert({
        player_a: a,
        player_b: b,
        requested_by: uno.playerId,
        accepted_at: new Date().toISOString(),
      })
    expect(seedError).toBeNull()
    const { data: creado } = await uno.client
      .from('casual_matches')
      .insert({
        player_a: a,
        player_b: b,
        sport: 'FIFA',
        played_on: '2026-08-30',
        created_by: uno.playerId,
        updated_by: uno.playerId,
      })
      .select('id, updated_at')
      .single()

    // El positivo de todo lo de arriba: nada en la suite ejercitaba un
    // escritor de verdad -- el trigger, el grant recortado, el camino que
    // SÍ tiene que andar. `dos` es el OTRO miembro (§3.1, cualquiera de los
    // dos edita), y firma como quien tocó último de verdad.
    const { data: actualizado, error } = await dos.client
      .from('casual_matches')
      .update({ score_a: 4, score_b: 1, updated_by: dos.playerId })
      .eq('id', creado!.id)
      .select('updated_at, updated_by')
      .single()

    expect(error).toBeNull()
    expect(actualizado?.updated_by).toBe(dos.playerId)
    // `updated_at` la escribe el TRIGGER (0072), no el cliente -- ya no está
    // en el grant de columna. Si el trigger se borrara o el grant volviera
    // a incluirla sin que nadie la mande, esto seguiría en null-vs-null o
    // en el mismo valor, y es lo único en la suite que lo notaría.
    expect(actualizado?.updated_at).not.toBe(creado?.updated_at)
  })
})

// ── camino de escritura (Task 4) ────────────────────────────────────────────
// Todo lo de arriba habla con `casual_matches` directo -- fija la RLS. Acá
// abajo se ejercita la CAPA que usa la pantalla: `createCasualMatch`,
// `updateCasualMatch`, `deleteCasualMatch`. El riesgo de esta tarea es uno
// solo (task-4-brief.md): que un camino de escritura se olvide de
// `updated_by` y la garantía de §3.2 se pudra en silencio -- por eso cada uno
// de los tres tiene su propio test que lo assertea explícitamente, no un
// solo test de "editar" en general.

async function amistadAceptada(a: string, b: string): Promise<void> {
  const [playerA, playerB] = a < b ? [a, b] : [b, a]
  const { error } = await adminClient()
    .from('friendships')
    .insert({ player_a: playerA, player_b: playerB, requested_by: a, accepted_at: new Date().toISOString() })
  if (error !== null) throw new Error(`No se pudo sembrar la amistad de test: ${error.message}`)
}

// Los siete campos tal cual los manda un `<form>` -- string crudo, incluidos
// los números y el marcador vacío (`''`, no `null`): es EXACTAMENTE lo que
// `FormData.get()` entrega, y es a propósito que el helper no "ayude"
// tipando mejor de lo que la capa de abajo puede confiar.
function entradaCasual(overrides: Partial<CasualMatchInput> = {}): CasualMatchInput {
  return {
    sport: 'FIFA',
    playedOn: '2026-08-30',
    outcome: 'won',
    scoreMine: '3',
    scoreTheirs: '1',
    teamMine: 'River',
    teamTheirs: 'Boca',
    ...overrides,
  }
}

function comoCasual(partido: SharedMatch | undefined): CasualMatch {
  if (partido === undefined) throw new Error('El partido casual no salió en el historial.')
  if (partido.kind !== 'casual') throw new Error('El partido no es de kind "casual".')
  return partido
}

describe('createCasualMatch', () => {
  it('un partido cargado por el camino real aparece en historyWith, mezclado con uno de torneo', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    await amistadAceptada(uno.playerId, dos.playerId)

    // El de torneo: mismo andamiaje que la mezcla de Task 2/3, para probar
    // que el camino de escritura de Task 4 se integra con lo que ya existía,
    // no sólo que inserta una fila suelta.
    const relleno = await fillerPlayers(6)
    const { matchdayId } = await unaFechaJugada({
      admin: uno,
      pairSize: 2,
      squad: [uno.playerId, dos.playerId, ...relleno],
    })
    const torneoMatchId = await partidoDeLosDos(matchdayId, uno.playerId, dos.playerId)

    const matchId = await createCasualMatch(uno.client, dos.playerId, entradaCasual())

    const historia = await historyWith(uno.client, dos.playerId)
    const casual = comoCasual(historia.find((m) => m.matchId === matchId))
    const torneo = historia.find((m) => m.matchId === torneoMatchId)
    if (torneo === undefined) throw new Error('El partido de torneo no salió en el historial.')
    expect(torneo.kind).toBe('tournament')

    expect(casual.sport).toBe('FIFA')
    expect(casual.playedOn).toBe('2026-08-30')
    expect(casual.outcome).toBe('won')
    expect(casual.score).toEqual({ mine: 3, theirs: 1 })
    expect(casual.teams).toEqual({ mine: 'River', theirs: 'Boca' })
  })

  it('created_by y updated_by quedan en quien cargó -- el riesgo de esta tarea', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    await amistadAceptada(uno.playerId, dos.playerId)

    const matchId = await createCasualMatch(uno.client, dos.playerId, entradaCasual())

    // Contra la fila real, no contra el nombre resuelto por `historyWith` --
    // esta es la aserción que de verdad fija el riesgo de la tarea.
    const { data: fila } = await adminClient()
      .from('casual_matches')
      .select('created_by, updated_by')
      .eq('id', matchId)
      .single()
    expect(fila?.created_by).toBe(uno.playerId)
    expect(fila?.updated_by).toBe(uno.playerId)
  })

  it('sin amistad aceptada, se rechaza con un mensaje legible, no un 42501 crudo', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()

    const error: unknown = await createCasualMatch(uno.client, dos.playerId, entradaCasual()).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(EdgeError)
    // Fix round 1, Important 1: `not.toContain('42501')` es vacuamente
    // cierto -- PostgREST nunca mete el SQLSTATE en `error.message`, sale en
    // `error.code`, así que esa aserción pasaba para CUALQUIER rechazo, no
    // sólo el de la amistad. Pinnear el mensaje es lo único que prueba que
    // ESTE es el motivo.
    expect((error as EdgeError).message).toContain('amigos aceptados')
  })

  it('un marcador a medias se rechaza con un mensaje para humanos, no un 23514 crudo', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    await amistadAceptada(uno.playerId, dos.playerId)

    const error: unknown = await createCasualMatch(
      uno.client,
      dos.playerId,
      entradaCasual({ scoreMine: '3', scoreTheirs: '' }),
    ).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EdgeError)
    // Fix round 1, Important 2: `not.toContain('23514')` es vacuamente
    // cierto por la misma razón que el de arriba -- el SQLSTATE nunca vive en
    // `.message`. Pinnear el texto real es lo único que prueba que el mensaje
    // es legible para una persona, que es lo que el título del test afirma.
    expect((error as EdgeError).message).toContain('los dos números')

    // Nada se insertó: el rechazo es ANTES de tocar la base -- `parseCasualInput`
    // corre antes que cualquier `.insert()`.
    const { data: filas } = await uno.client.from('casual_matches').select('id')
    expect(filas).toEqual([])
  })

  it('un equipo vacío no rompe contra el CHECK -- se guarda como null, no como string vacío', async () => {
    // Fix round 1, Minor 7: el comentario original citaba `casual_authors_play`
    // -- ese es el check de pertenencia de `created_by`/`updated_by` (0072:51-53),
    // no tiene nada que ver con `team_a`. El que se ejercita acá es el CHECK
    // sin nombre `team_a is null or length(trim(team_a)) > 0` (0072:27):
    // `length(trim('')) > 0` es falso, así que un `''` sin normalizar tira
    // 23514 en el caso MÁS común del formulario (nadie carga equipo en
    // pádel). Prueba la normalización, no sólo que no explote.
    const uno = await createTestUser()
    const dos = await createTestUser()
    await amistadAceptada(uno.playerId, dos.playerId)

    const matchId = await createCasualMatch(
      uno.client,
      dos.playerId,
      entradaCasual({ teamMine: '  ', teamTheirs: '' }),
    )
    const { data: fila } = await adminClient()
      .from('casual_matches')
      .select('team_a, team_b')
      .eq('id', matchId)
      .single()
    expect(fila?.team_a).toBeNull()
    expect(fila?.team_b).toBeNull()
  })

  // Fix round 1, Minor 4: `CASUAL_DATE` sólo validaba la FORMA
  // (`\d{4}-\d{2}-\d{2}`), no que la fecha exista -- un `<input type="date">`
  // nunca manda un 31 de febrero, pero un POST armado a mano sí, y sin este
  // chequeo llegaba a Postgres como `date/time field value out of range`, el
  // mismo tipo de mensaje crudo que `parseCasualInput` existe para evitar.
  it('una fecha que no existe en el calendario se rechaza con un mensaje legible, no el error crudo de Postgres', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    await amistadAceptada(uno.playerId, dos.playerId)

    const error: unknown = await createCasualMatch(
      uno.client,
      dos.playerId,
      entradaCasual({ playedOn: '2026-02-31' }),
    ).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EdgeError)
    expect((error as EdgeError).message).toBe('Elegí una fecha real.')
  })

  // Fix round 1, Minor 4 (marcador): `Number.isFinite` dejaba pasar `3.5`
  // hacia `score_a`/`score_b`, columnas `int` (0072).
  it('un marcador con decimales se rechaza -- la columna es un entero', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    await amistadAceptada(uno.playerId, dos.playerId)

    const error: unknown = await createCasualMatch(
      uno.client,
      dos.playerId,
      entradaCasual({ scoreMine: '3.5', scoreTheirs: '1' }),
    ).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EdgeError)
    expect((error as EdgeError).message).toContain('número entero')
  })

  // Fix round 1, Minor 5: mismo guard que `requestFriendship` ya tiene
  // (`no deja pedirse amistad a uno mismo`, arriba) y por el mismo motivo --
  // `/amigos/{miPropioId}` es una URL que cualquiera puede tipear, y
  // `page.tsx` monta el formulario ahí igual.
  it('no deja cargar un partido con uno mismo', async () => {
    const uno = await createTestUser()
    await expect(createCasualMatch(uno.client, uno.playerId, entradaCasual())).rejects.toThrow(EdgeError)
  })

  // Fix round 1, Minor 6: `requestFriendship` traduce un uuid mal formado a
  // un mensaje legible (test "un uuid mal formado da un mensaje legible",
  // arriba) -- `createCasualMatch` no lo hacía. `friendPlayerId` viaja en un
  // input oculto, así que sólo un POST armado a mano lo manda así.
  it('un friendPlayerId mal formado da un mensaje legible, no el error crudo de Postgres', async () => {
    const uno = await createTestUser()
    const error: unknown = await createCasualMatch(uno.client, 'no-es-un-uuid', entradaCasual()).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(EdgeError)
    expect((error as EdgeError).message).toBe('Ese ID no es válido.')
  })
})

describe('updateCasualMatch', () => {
  it('el OTRO jugador edita, y funciona -- updated_by pasa a ser quien editó', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    await amistadAceptada(uno.playerId, dos.playerId)
    const matchId = await createCasualMatch(uno.client, dos.playerId, entradaCasual())

    // `dos` NO cargó el partido -- es la contraparte, editando (§3.1).
    // `outcome: 'lost'` desde la perspectiva de `dos`: el mismo partido que
    // para `uno` fue "ganaste vos" pasa a guardarse como "ganó `uno`".
    const friendPlayerId = await updateCasualMatch(
      dos.client,
      matchId,
      entradaCasual({ outcome: 'lost', scoreMine: '1', scoreTheirs: '3' }),
    )
    // Fix round 1, Minor 11: el valor que `editCasualMatch` (`app/amigos/actions.ts`)
    // usa para el redirect. Desde la perspectiva de `dos` (quien editó), "el
    // amigo" es `uno`.
    expect(friendPlayerId).toBe(uno.playerId)

    const { data: fila } = await adminClient()
      .from('casual_matches')
      .select('updated_by, winner, score_a, score_b')
      .eq('id', matchId)
      .single()
    expect(fila?.updated_by).toBe(dos.playerId)
    expect(fila?.winner).toBe(uno.playerId)
  })

  it('un tercero no puede editar un partido ajeno', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const ajeno = await createTestUser()
    await amistadAceptada(uno.playerId, dos.playerId)
    const matchId = await createCasualMatch(uno.client, dos.playerId, entradaCasual())

    const error: unknown = await updateCasualMatch(ajeno.client, matchId, entradaCasual({ outcome: 'drew' })).catch(
      (e: unknown) => e,
    )
    // Fix round 1, Important 3: `toBeInstanceOf(EdgeError)` sólo prueba que
    // ALGO se rechazó -- todo camino de rechazo de `updateCasualMatch` tira
    // `EdgeError` (uuid mal formado, partido inexistente, marcador a medias),
    // así que esto pasaba igual si `ajeno` fuera rechazado por la razón
    // equivocada. Este test nunca llega a `casual_matches_update`: el
    // `select` previo (`db/friends.ts`) ya devuelve `null` para un no
    // miembro, y ESE es el motivo que hay que pinnear.
    expect(error).toBeInstanceOf(EdgeError)
    expect((error as EdgeError).message).toContain('no existe o no te corresponde')

    const { data: intacto } = await adminClient()
      .from('casual_matches')
      .select('updated_by, winner')
      .eq('id', matchId)
      .single()
    expect(intacto?.updated_by).toBe(uno.playerId)
    expect(intacto?.winner).toBe(uno.playerId)
  })

  it('un marcador a medias se rechaza al editar también, sin tocar la fila', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    await amistadAceptada(uno.playerId, dos.playerId)
    const matchId = await createCasualMatch(uno.client, dos.playerId, entradaCasual())

    const error: unknown = await updateCasualMatch(
      uno.client,
      matchId,
      entradaCasual({ scoreMine: '', scoreTheirs: '5' }),
    ).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EdgeError)
    // Fix round 1, Important 2 (lado de `updateCasualMatch`): mismo defecto
    // que su par en `createCasualMatch` -- `not.toContain` vacuamente cierto.
    expect((error as EdgeError).message).toContain('los dos números')

    // `score_a` no es necesariamente "el de `uno`" -- depende de si `uno`
    // cayó del lado `a` o `b` en el orden canónico (0072), que se decide por
    // comparación de uuid y no es determinista entre corridas. Se lee
    // `player_a` para saber qué lado mirar, en vez de asumirlo.
    const { data: intacto } = await adminClient()
      .from('casual_matches')
      .select('player_a, score_a, score_b')
      .eq('id', matchId)
      .single()
    const scoreDeUno = intacto?.player_a === uno.playerId ? intacto?.score_a : intacto?.score_b
    expect(scoreDeUno).toBe(3)
  })

  // Fix round 1, Minor 6: mismo defecto que `createCasualMatch` -- un
  // `matchId` mal formado (el hidden field de `editCasualMatch`) llegaba
  // como el error crudo de Postgres.
  it('un matchId mal formado da un mensaje legible, no el error crudo de Postgres', async () => {
    const uno = await createTestUser()
    const error: unknown = await updateCasualMatch(uno.client, 'no-es-un-uuid', entradaCasual()).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(EdgeError)
    expect((error as EdgeError).message).toBe('Ese ID no es válido.')
  })
})

describe('deleteCasualMatch', () => {
  it('el otro jugador puede borrar el partido, aunque no lo haya cargado', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    await amistadAceptada(uno.playerId, dos.playerId)
    const matchId = await createCasualMatch(uno.client, dos.playerId, entradaCasual())

    await deleteCasualMatch(dos.client, matchId)

    const { data: sigue } = await adminClient().from('casual_matches').select('id').eq('id', matchId)
    expect(sigue).toEqual([])
  })

  it('un tercero no puede borrar un partido ajeno', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const ajeno = await createTestUser()
    await amistadAceptada(uno.playerId, dos.playerId)
    const matchId = await createCasualMatch(uno.client, dos.playerId, entradaCasual())

    const error: unknown = await deleteCasualMatch(ajeno.client, matchId).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EdgeError)

    const { data: sigue } = await adminClient().from('casual_matches').select('id').eq('id', matchId)
    expect(sigue).toEqual([{ id: matchId }])
  })

  // Fix round 1, Minor 6: mismo defecto -- `matchId` mal formado en el botón
  // "Borrar" (`removeCasualMatch`, un hidden field también).
  it('un matchId mal formado da un mensaje legible, no el error crudo de Postgres', async () => {
    const uno = await createTestUser()
    const error: unknown = await deleteCasualMatch(uno.client, 'no-es-un-uuid').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EdgeError)
    expect((error as EdgeError).message).toBe('Ese ID no es válido.')
  })
})

describe('sportsUsedBy', () => {
  it('devuelve los deportes ya cargados por el caller, sin repetidos', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const tres = await createTestUser()
    await amistadAceptada(uno.playerId, dos.playerId)
    await amistadAceptada(uno.playerId, tres.playerId)

    await createCasualMatch(uno.client, dos.playerId, entradaCasual({ sport: 'FIFA' }))
    await createCasualMatch(uno.client, tres.playerId, entradaCasual({ sport: 'FIFA' }))
    await createCasualMatch(uno.client, dos.playerId, entradaCasual({ sport: 'Ping pong' }))

    const deportes = await sportsUsedBy(uno.client)
    expect(deportes).toEqual(['FIFA', 'Ping pong'])
  })

  it('sin ningún partido casual cargado, devuelve una lista vacía', async () => {
    const uno = await createTestUser()
    expect(await sportsUsedBy(uno.client)).toEqual([])
  })
})
