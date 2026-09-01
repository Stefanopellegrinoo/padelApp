import { describe, it, expect } from 'vitest'
import { defaultConfig, type SideSize } from '@/core'
import { EdgeError } from './errors'
import { historyWith, requestFriendship, acceptFriendship, friendsOf } from './friends'
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

    expect(historia.find((m) => m.matchId === juntos)?.together).toBe(true)
    expect(historia.find((m) => m.matchId === enContra)?.together).toBe(false)
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
    const partido = historia.find((m) => m.matchId === enContra)
    const lado = await ladoDe(enContra, admin.playerId)
    expect(partido?.seasonName).toBe(seasonName)
    expect(partido?.matchdayNumber).toBe(1)
    // `unaFechaJugada` crea la fecha con '2026-08-10' (ver su doc) -- es lo
    // único que hoy fija `playedOn`, del que dependen tanto el orden de la
    // lista (`compararDescendente`, `app/amigos/historial.tsx`) como la
    // fecha que muestra cada fila, y que ningún test de esta suite chequeaba.
    expect(partido?.playedOn).toBe('2026-08-10')
    expect(partido?.score).toEqual(lado === 'A' ? { mine: 4, theirs: 1 } : { mine: 1, theirs: 4 })
    expect(partido?.outcome).toBe(lado === 'A' ? 'won' : 'lost')

    // `juntos`: `admin` y `otro` comparten lado, así que `outcome` es lo que
    // le pasó a LA PAREJA -- no "lo mío contra nadie". Mismo mapeo lado→won,
    // ahora sobre el partido donde el lado de los dos es el mismo.
    const partidoJuntos = historia.find((m) => m.matchId === juntos)
    const ladoJuntos = await ladoDe(juntos, admin.playerId)
    expect(partidoJuntos?.outcome).toBe(ladoJuntos === 'A' ? 'won' : 'lost')
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

    // Verificado con sabotaje (fix report) que este ataque está frenado
    // por TRES capas a la vez, no sólo por el `using` de
    // `casual_matches_update`: Postgres además exige, para todo UPDATE, el
    // `using` de la política de SELECT sobre la fila (`casual_matches_read`
    // -- documentado en la página de `CREATE POLICY`), y el `with check`
    // (`updated_by = my_player_id()`) también la rechaza sola, porque
    // `ajeno` no toca esa columna y la fila conserva el `updated_by` de
    // `uno`. Hizo falta anular las tres a la vez para ver esto en rojo.
    //
    // Un `using`/`with check` que falla FILTRA filas -- no tira error. Por
    // eso el chequeo positivo de abajo, releído con `uno` (no con `ajeno`),
    // es lo que de verdad prueba que el partido no cambió: un `data: []`
    // solo no lo distingue de "actualizó cero filas porque no había ninguna".
    const { data } = await ajeno.client
      .from('casual_matches')
      .update({ score_a: 99 })
      .eq('id', creado!.id)
      .select()
    expect(data).toEqual([])

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

    // Igual que en el update de arriba: Postgres exige, para todo DELETE,
    // TANTO el `using` de `casual_matches_delete` COMO el de la política
    // de SELECT (`casual_matches_read`) sobre la misma fila -- verificado
    // con sabotaje (fix report), anular sólo uno de los dos no alcanzó
    // para ver esto en rojo. Y un `delete` frenado por `using` no tira
    // error, borra cero filas en silencio -- el positivo de abajo es la
    // prueba real.
    await ajeno.client.from('casual_matches').delete().eq('id', creado!.id)

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
    await adminClient()
      .from('friendships')
      .insert({
        player_a: a,
        player_b: b,
        requested_by: uno.playerId,
        accepted_at: new Date().toISOString(),
      })

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
})
