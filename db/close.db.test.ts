import { describe, it, expect } from 'vitest'
import { defaultConfig, sideOfRow, type SeasonConfig } from '@/core'
import { addGuest, closeMatchday, createMatchday, generatePairs, openMatchday, saveResult, setAttendance } from './matchday'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser, type TestUser } from './test/users'
import { closedHistoryAll, matchdayDetail } from './read'
import { closedHistory } from './season'

// ── scaffolding local a este archivo ────────────────────────────────────────
// No va a db/test/factories.ts: esa lista de archivos es la del plan, y estos
// armadores sólo le sirven al cierre de una fecha.

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

// Traba una pareja con la llave de service_role: es escenario para el test,
// no algo que un test deba ejercitar con RLS.
async function addLock(seasonId: string, matchdayId: string, a: string, b: string): Promise<void> {
  const db = adminClient()
  const { error } = await db
    .from('pair_locks')
    .insert({ season_id: seasonId, matchday_id: matchdayId, entry_a: a, entry_b: b })
  if (error) throw new Error(error.message)
}

async function markAllPlaying(admin: TestUser, matchdayId: string, entryIds: string[]): Promise<void> {
  for (const entryId of entryIds) {
    await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
  }
}

// `entry_b: string | null` desde 0028 (REQ-D5-1): la fila real ya lo permite,
// aunque esta suite sólo ejercita pádel (pair_size=2, siempre no-nulo).
async function pairsOf(
  matchdayId: string,
): Promise<Array<{ id: string; entry_a: string; entry_b: string | null }>> {
  const db = adminClient()
  const { data, error } = await db
    .from('pairs')
    .select('id, entry_a, entry_b')
    .eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return data ?? []
}

interface MatchRow {
  id: string
  round: number
  pair_a: string
  pair_b: string
}

async function matchesOf(matchdayId: string): Promise<MatchRow[]> {
  const db = adminClient()
  const { data, error } = await db
    .from('matches')
    .select('id, round, pair_a, pair_b')
    .eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return data ?? []
}

async function setsOf(
  matchId: string,
): Promise<Array<{ set_number: number; games_a: number; games_b: number }>> {
  const db = adminClient()
  const { data, error } = await db
    .from('match_sets')
    .select('set_number, games_a, games_b')
    .eq('match_id', matchId)
    .order('set_number', { ascending: true })
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

// ── C17 (verify-report ronda 10) ────────────────────────────────────────────
// N26 (verify-report ronda 12): PR18a hizo que `insertPairs` SÍ escriba una
// fila `pair_size=1` (`generatePairs` ya arma sola una disciplina de a uno,
// ver `full_matchday_proof` más abajo y `db/generate.db.test.ts`) — este
// helper con service_role sigue siendo el más corto para ESTE test puntual:
// arma la fecha con un solo `insert` en vez de todo el pipeline real
// (asistencia/draw/apertura) que el escenario de G6/C17 de abajo no necesita.
async function insertOpenSingleMatchday(seasonId: string, disciplineId: string, number: number): Promise<string> {
  const db = adminClient()
  const { data, error } = await db
    .from('matchdays')
    .insert({ season_id: seasonId, discipline_id: disciplineId, number, pair_size: 1, status: 'OPEN' })
    .select('id')
    .single()
  if (error || data === null) throw new Error(error?.message)
  return data.id
}

async function insertSingle(matchdayId: string, seasonId: string, entryId: string): Promise<void> {
  const db = adminClient()
  const { error } = await db
    .from('pairs')
    .insert({ matchday_id: matchdayId, season_id: seasonId, entry_a: entryId, entry_b: null, pair_size: 1 })
  if (error) throw new Error(error.message)
}

/**
 * Carga un resultado por cada partido de la fecha. `winnerOf` recibe los dos
 * `pair_a`/`pair_b` de cada partido y devuelve cuál gana; el ganador se manda
 * 4-0, que siempre es un resultado válido con `defaultConfig` (un set a 4 con
 * tie-break).
 */
async function playAllMatches(
  admin: TestUser,
  matchdayId: string,
  winnerOf: (pairA: string, pairB: string) => string,
): Promise<void> {
  const matches = await matchesOf(matchdayId)
  for (const match of matches) {
    const winner = winnerOf(match.pair_a, match.pair_b)
    const sets = winner === match.pair_a ? [{ gamesA: 4, gamesB: 0 }] : [{ gamesA: 0, gamesB: 4 }]
    await saveResult(admin.client, match.id, sets)
  }
}

describe('saveResult', () => {
  it('guarda el set de un partido', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, squad)
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)
    const [match] = await matchesOf(matchdayId)
    if (match === undefined) throw new Error('No se generó ningún partido.')

    await saveResult(admin.client, match.id, [{ gamesA: 4, gamesB: 1 }])

    expect(await setsOf(match.id)).toEqual([{ set_number: 1, games_a: 4, games_b: 1 }])
  })

  it('rechaza un 5-2 en un set a 4, con el motivo', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, squad)
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)
    const [match] = await matchesOf(matchdayId)
    if (match === undefined) throw new Error('No se generó ningún partido.')

    await expect(saveResult(admin.client, match.id, [{ gamesA: 5, gamesB: 2 }])).rejects.toThrow(
      /no es un resultado posible/,
    )
  })

  it('rechaza un 4-4', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, squad)
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)
    const [match] = await matchesOf(matchdayId)
    if (match === undefined) throw new Error('No se generó ningún partido.')

    await expect(saveResult(admin.client, match.id, [{ gamesA: 4, gamesB: 4 }])).rejects.toThrow(
      /no hay empates/,
    )
  })

  it('reemplaza el resultado anterior en vez de duplicarlo', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, squad)
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)
    const [match] = await matchesOf(matchdayId)
    if (match === undefined) throw new Error('No se generó ningún partido.')

    await saveResult(admin.client, match.id, [{ gamesA: 4, gamesB: 1 }])
    await saveResult(admin.client, match.id, [{ gamesA: 4, gamesB: 3 }])

    expect(await setsOf(match.id)).toEqual([{ set_number: 1, games_a: 4, games_b: 3 }])
  })

  it('no se puede cargar en una fecha cerrada', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, squad)
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)
    await playAllMatches(admin, matchdayId, (pairA) => pairA)
    await closeMatchday(admin.client, matchdayId)
    const [match] = await matchesOf(matchdayId)
    if (match === undefined) throw new Error('No se generó ningún partido.')
    const setsBefore = await setsOf(match.id)

    await expect(saveResult(admin.client, match.id, [{ gamesA: 4, gamesB: 0 }])).rejects.toThrow()

    // saveResult wraps the Postgres error and drops its code, so hit the RLS
    // policy directly: "refused" and "destroyed, then refused" look the same
    // to a plain .rejects.toThrow() if the surviving rows are never checked.
    await admin.client.from('match_sets').delete().eq('match_id', match.id)
    const { error } = await admin.client
      .from('match_sets')
      .insert({ match_id: match.id, set_number: 1, games_a: 4, games_b: 0 })

    expect(error?.code).toBe('42501')
    expect(await setsOf(match.id)).toEqual(setsBefore)
  })
})

describe('closeMatchday', () => {
  it('congela los awards y pasa a CLOSED', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, squad)
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)
    await playAllMatches(admin, matchdayId, (pairA) => pairA)

    await closeMatchday(admin.client, matchdayId)

    expect(await matchdayStatus(matchdayId)).toBe('CLOSED')
    const awards = await awardsOf(matchdayId)
    expect(awards).toHaveLength(8) // 4 parejas de 2 jugadores cada una
    const config = defaultConfig(8)
    const totalPoints = awards.reduce((sum, award) => sum + award.points, 0)
    expect(totalPoints).toBe(2 * config.points.reduce((sum, points) => sum + points, 0))
  })

  // El torneo puede decidir que el último no sume. Antes, `awards_points_check`
  // lo rebotaba recién ACÁ —con los resultados ya cargados y la fecha a medio
  // cerrar—, que es el peor momento para enterarse.
  it('cierra una fecha donde el último no suma nada', async () => {
    const sinPuntosElUltimo: SeasonConfig = { ...defaultConfig(8), points: [10, 6, 3, 0] }
    const { admin, seasonId, squad } = await buildSeasonWithSquad(sinPuntosElUltimo, 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, squad)
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)
    await playAllMatches(admin, matchdayId, (pairA) => pairA)

    await closeMatchday(admin.client, matchdayId)

    expect(await matchdayStatus(matchdayId)).toBe('CLOSED')
    const awards = await awardsOf(matchdayId)
    // Los 8 cobran fila, incluidos los dos del último que cobran 0.
    expect(awards).toHaveLength(8)
    expect(awards.filter((award) => award.points === 0)).toHaveLength(2)
  })

  it('los dos de la pareja cobran lo mismo', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, squad)
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)
    await playAllMatches(admin, matchdayId, (pairA) => pairA)

    await closeMatchday(admin.client, matchdayId)

    const pairs = await pairsOf(matchdayId)
    const awards = await awardsOf(matchdayId)
    const pointsOf = new Map(awards.map((award) => [award.entry_id, award.points]))
    for (const pair of pairs) {
      // W38 (verify-report ronda 12): `requirePartner` retirado — `sideOfRow`
      // (core/side.ts) es el hogar único. `2` es literal, no leído de la fila:
      // esta suite sólo ejercita pádel (pair_size=2, siempre con `entry_b`).
      const side = sideOfRow(2, pair.entry_a, pair.entry_b)
      const partner = side.size === 2 ? side.b : pair.entry_a
      expect(pointsOf.get(pair.entry_a)).toBe(pointsOf.get(partner))
    }
  })

  it('el invitado no cobra y su compañero sí', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const playing = squad.slice(0, 7)
    const partner = playing[0]
    if (partner === undefined) throw new Error('Falta un jugador para el test.')
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, playing)
    const guest = await addGuest(admin.client, matchdayId, { displayName: 'Invitado' })
    await addLock(seasonId, matchdayId, guest, partner)
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)
    await playAllMatches(admin, matchdayId, (pairA) => pairA)

    await closeMatchday(admin.client, matchdayId)

    const awards = await awardsOf(matchdayId)
    expect(awards.find((award) => award.entry_id === guest)).toBeUndefined()
    const partnerAward = awards.find((award) => award.entry_id === partner)
    expect(partnerAward).toBeDefined()
    expect(partnerAward?.points).toBeGreaterThan(0)
  })

  it('una pareja de invitados no ocupa puesto: el torneo cobra 1, 2, 3...', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const playing = squad.slice(0, 6)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, playing)
    const guest1 = await addGuest(admin.client, matchdayId, { displayName: 'Invitado Uno' })
    const guest2 = await addGuest(admin.client, matchdayId, { displayName: 'Invitado Dos' })
    await addLock(seasonId, matchdayId, guest1, guest2)
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)

    const pairs = await pairsOf(matchdayId)
    const guestPair = pairs.find(
      (pair) =>
        (pair.entry_a === guest1 && pair.entry_b === guest2) ||
        (pair.entry_a === guest2 && pair.entry_b === guest1),
    )
    if (guestPair === undefined) throw new Error('No se armó la pareja de invitados.')
    const squadPairs = pairs.filter((pair) => pair.id !== guestPair.id)
    const [pairA, pairB, pairC] = squadPairs
    if (pairA === undefined || pairB === undefined || pairC === undefined) {
      throw new Error('Faltan parejas del torneo para el test.')
    }

    // El invitado gana sus tres partidos; entre las del torneo, A le gana a
    // B y a C, y B le gana a C: un orden total sin empates, para no depender
    // del snapshot para desempatar.
    const rank = (pairId: string): number => {
      if (pairId === guestPair.id) return 0
      if (pairId === pairA.id) return 1
      if (pairId === pairB.id) return 2
      return 3
    }
    await playAllMatches(admin, matchdayId, (idA, idB) => (rank(idA) < rank(idB) ? idA : idB))

    await closeMatchday(admin.client, matchdayId)

    const awards = await awardsOf(matchdayId)
    expect(awards.some((award) => award.entry_id === guest1)).toBe(false)
    expect(awards.some((award) => award.entry_id === guest2)).toBe(false)

    const positionOf = (entryId: string): number | undefined =>
      awards.find((award) => award.entry_id === entryId)?.position
    // La pareja de invitados salió 1° en la tabla y no ocupa puesto: el
    // torneo arranca a cobrar en 1, no en 2.
    expect(positionOf(pairA.entry_a)).toBe(1)
    expect(positionOf(pairB.entry_a)).toBe(2)
    expect(positionOf(pairC.entry_a)).toBe(3)

    const config = defaultConfig(8)
    const pointsOf = (entryId: string): number | undefined =>
      awards.find((award) => award.entry_id === entryId)?.points
    expect(pointsOf(pairA.entry_a)).toBe(config.points[0])
    expect(pointsOf(pairB.entry_a)).toBe(config.points[1])
    expect(pointsOf(pairC.entry_a)).toBe(config.points[2])
  })

  it('no cierra con partidos sin cargar', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, squad)
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)

    await expect(closeMatchday(admin.client, matchdayId)).rejects.toThrow(/resultado/)
  })

  it('no cierra una fecha que no está en juego', async () => {
    const { admin, seasonId } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')

    await expect(closeMatchday(admin.client, matchdayId)).rejects.toThrow(/en juego/)
  })

  it('cerrar dos veces no duplica awards', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, squad)
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)
    await playAllMatches(admin, matchdayId, (pairA) => pairA)
    await closeMatchday(admin.client, matchdayId)
    const awardsAfterFirstClose = await awardsOf(matchdayId)

    await expect(closeMatchday(admin.client, matchdayId)).rejects.toThrow(/en juego/)

    const awardsAfterSecondAttempt = await awardsOf(matchdayId)
    expect(awardsAfterSecondAttempt).toHaveLength(awardsAfterFirstClose.length)
  })

  it('si el insert de awards falla, la fecha sigue OPEN', async () => {
    // Se fuerza pasando un award con points NEGATIVO, que el check de la tabla
    // rechaza. Es la prueba de que la transacción existe.
    //
    // Antes la palanca era un 0, y dejó de servir cuando el torneo pasó a poder
    // decidir que el último no sume (0010_points_can_be_zero.sql): el insert
    // entraba, la fecha cerraba, y este test se ponía rojo avisando que su
    // propia palanca ya no rompía nada. El negativo sigue sin significar nada y
    // sigue prohibido.
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, squad)
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)
    await playAllMatches(admin, matchdayId, (pairA) => pairA)
    const entryId = squad[0]
    if (entryId === undefined) throw new Error('Falta un asiento para el test.')

    const { error } = await admin.client.rpc('close_matchday', {
      p_matchday: matchdayId,
      p_awards: [{ entryId, position: 1, points: -1 }],
    })

    expect(error).not.toBeNull()
    expect(await matchdayStatus(matchdayId)).toBe('OPEN')
  })

  it('a stranger calling the RPC directly gets "sólo quien organiza"', async () => {
    const { admin, seasonId } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    const stranger = await createTestUser()

    const { error } = await stranger.client.rpc('close_matchday', {
      p_matchday: matchdayId,
      p_awards: [],
    })

    expect(error?.message).toMatch(/Sólo quien organiza/)
  })

  it('rejects a direct RPC call with an award for a player who did not play this matchday', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const playing = squad.slice(0, 7)
    const benched = squad[7]
    const partner = playing[0]
    if (benched === undefined || partner === undefined) throw new Error('Falta un jugador para el test.')
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, playing)
    const guest = await addGuest(admin.client, matchdayId, { displayName: 'Invitado' })
    await addLock(seasonId, matchdayId, guest, partner)
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)
    await playAllMatches(admin, matchdayId, (pairA) => pairA)

    const { error } = await admin.client.rpc('close_matchday', {
      p_matchday: matchdayId,
      p_awards: [{ entryId: benched, position: 1, points: 100 }],
    })

    expect(error?.message).toBe('Hay puntos para alguien que no jugó esta fecha.')
    expect(await matchdayStatus(matchdayId)).toBe('OPEN')
  })

  it('rejects a direct RPC call with an award for a player who did not play this matchday (pair_size=1)', async () => {
    const admin = await createTestUser()
    const filler = await fillerPlayers(3)
    const { seasonId, disciplineIds, entryIds } = await createSeason({
      admin,
      squad: filler,
      disciplines: [{ kind: 'FIFA', pairSize: 1 }],
    })
    const [fifaId] = disciplineIds
    const [playerA, playerB, benched] = entryIds
    if (fifaId === undefined || playerA === undefined || playerB === undefined || benched === undefined) {
      throw new Error('Falta escenario de test.')
    }
    const matchdayId = await insertOpenSingleMatchday(seasonId, fifaId, 1)
    await insertSingle(matchdayId, seasonId, playerA)
    await insertSingle(matchdayId, seasonId, playerB)

    const { error } = await admin.client.rpc('close_matchday', {
      p_matchday: matchdayId,
      p_awards: [{ entryId: benched, position: 1, points: 100 }],
    })

    expect(error?.message).toBe('Hay puntos para alguien que no jugó esta fecha.')
    expect(await matchdayStatus(matchdayId)).toBe('OPEN')
  })

  /**
   * PR18a: el mismo guard que arriba, pero bajo CARGA REAL en vez de una
   * "fecha" armada a mano con service_role. El draw (`buildSides`, wired esta
   * PR), la asistencia y los resultados pasan por los caminos TS reales
   * (`generatePairs`/`setAttendance` vía `markAllPlaying`/`saveResult`), no
   * por un insert directo en `pairs`. Antes de esta PR esto era imposible de
   * armar: `generatePairs` moría en la FK `pairs_matchday_size` (W34) para
   * cualquier disciplina `pair_size=1`. `closeMatchday()` (el wrapper TS) NO
   * se usa acá: sigue llamando a `computeStandings`, cuyo límite público
   * seguía `Pair` in/out hasta que `core/types.ts`/`app/**` migraron (design
   * #3801 PUNTO 4) — `resultsOf` (db/matchday.ts) tira con un lado de uno por
   * diseño (ver el comentario de `pairFromRow` ahí). Se llama al RPC
   * `close_matchday` directo, con un payload armado a mano, igual que el
   * resto de este describe.
   */
  it('C17 bajo carga real: el guard rechaza a quien no jugó una fecha de a uno armada por el flujo real', async () => {
    const admin = await createTestUser()
    const filler = await fillerPlayers(9)
    const config: SeasonConfig = { ...defaultConfig(9), points: [9, 8, 7, 6, 5, 4, 3, 2, 1] }
    const { seasonId, entryIds } = await createSeason({
      admin,
      squad: filler,
      disciplines: [{ kind: 'FIFA', pairSize: 1, config }],
    })
    const playing = entryIds.slice(0, 8)
    const benched = entryIds[8]
    if (benched === undefined) throw new Error('Falta un jugador para el test.')
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, playing)

    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)
    await playAllMatches(admin, matchdayId, (pairA) => pairA)

    const { error } = await admin.client.rpc('close_matchday', {
      p_matchday: matchdayId,
      p_awards: [{ entryId: benched, position: 1, points: 100 }],
    })

    expect(error?.message).toBe('Hay puntos para alguien que no jugó esta fecha.')
    expect(await matchdayStatus(matchdayId)).toBe('OPEN')
  })

  /**
   * `full_matchday_proof` (PR18a): draw → asistencia → resultados → close,
   * los cuatro pasos por el camino real, para una disciplina `pair_size=1`.
   * `close_matchday` (el RPC) se llama directo con un payload legítimo — el
   * wrapper TS `closeMatchday()` queda para 18b/19 (mismo corte que el test
   * de arriba). Esto es lo que W34 describía como "todavía no puede": hoy
   * puede, de punta a punta.
   *
   * C19 (verify-report ronda 12): una sola fecha no alcanza para probar el
   * lifecycle — `closedHistory` sólo entra en juego cuando existe una fecha
   * CERRADA antes en el calendario de la disciplina, así que el bug recién
   * aparece desde la fecha 2. Este test cierra la fecha 1 y después arma y
   * abre la fecha 2, ejercitando el mismo camino que recorre cada draw real.
   */
  it('cierra la fecha 1 de una disciplina de a uno, y arma y abre la fecha 2 sin romperse (C19)', async () => {
    const admin = await createTestUser()
    const filler = await fillerPlayers(8)
    const config: SeasonConfig = { ...defaultConfig(8), points: [8, 7, 6, 5, 4, 3, 2, 1] }
    const { seasonId, entryIds } = await createSeason({
      admin,
      squad: filler,
      disciplines: [{ kind: 'FIFA', pairSize: 1, config }],
    })
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, entryIds)

    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)
    await playAllMatches(admin, matchdayId, (pairA) => pairA)

    const awards = entryIds.map((entryId, index) => ({
      entryId,
      position: index + 1,
      points: config.points[index] ?? 0,
    }))
    const { error: closeError } = await admin.client.rpc('close_matchday', {
      p_matchday: matchdayId,
      p_awards: awards,
    })

    expect(closeError).toBeNull()
    expect(await matchdayStatus(matchdayId)).toBe('CLOSED')
    const stored = await awardsOf(matchdayId)
    expect(stored).toHaveLength(8)
    expect(new Set(stored.map((row) => row.entry_id))).toEqual(new Set(entryIds))

    // C19: con la fecha 1 CLOSED, el draw de la fecha 2 pasa por
    // `pairingContextFor` → `closedHistory(discipline, 1)` — exactamente el
    // camino que moría antes de este fix.
    const matchday2Id = await createMatchday(admin.client, seasonId, '2026-08-17')
    await markAllPlaying(admin, matchday2Id, entryIds)

    await generatePairs(admin.client, matchday2Id)
    await openMatchday(admin.client, matchday2Id)

    const pairs2 = await pairsOf(matchday2Id)
    expect(pairs2).toHaveLength(8)
    expect(pairs2.every((pair) => pair.entry_b === null)).toBe(true)
    expect(await matchdayStatus(matchday2Id)).toBe('OPEN')
  })

  /**
   * W40 (verify-report ronda 12) — el otro lado de C19, y el que quedó SIN
   * PROBAR hasta acá: 18a habilitó ESCRIBIR una fecha de a uno que ninguna
   * lectura podía devolver. `pairsAndMatchesOf` (db/read.ts), `resultsOf`
   * (db/matchday.ts) y `closedHistory` (db/season.ts) componían `pairFromRow`,
   * que tiraba con `pair_size=1`.
   *
   * Este test recorre las TRES lecturas sobre una fecha de a uno cerrada, y la
   * cierra con el wrapper TS `closeMatchday()` —no con el RPC directo, que es
   * lo que hace `full_matchday_proof`— porque ese wrapper es el que pasa por
   * `resultsOf` + `computeStandings` + `computeAwards`. O sea: prueba de punta
   * a punta que la tabla del día de una disciplina de a uno se calcula, se
   * graba y se lee.
   */
  it('cierra una fecha de a uno con el wrapper TS y las tres lecturas la devuelven (W40)', async () => {
    const admin = await createTestUser()
    const filler = await fillerPlayers(8)
    const config: SeasonConfig = { ...defaultConfig(8), points: [8, 7, 6, 5, 4, 3, 2, 1] }
    const { seasonId, entryIds, disciplineId } = await createSeason({
      admin,
      squad: filler,
      disciplines: [{ kind: 'FIFA', pairSize: 1, config }],
    })
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, entryIds)
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)
    // El de `pair_a` gana siempre: con el round robin completo eso deja un
    // orden total y estricto, así que la tabla del día no se resuelve por
    // desempate y el primero es el que ganó de verdad — que es justo lo que
    // S39 decía que ningún test comprobaba.
    await playAllMatches(admin, matchdayId, (pairA) => pairA)

    // 1) `resultsOf` + `computeStandings` + `computeAwards`, por el wrapper.
    await closeMatchday(admin.client, matchdayId)
    expect(await matchdayStatus(matchdayId)).toBe('CLOSED')
    const stored = await awardsOf(matchdayId)
    expect(stored).toHaveLength(8)
    expect(new Set(stored.map((row) => row.entry_id))).toEqual(new Set(entryIds))
    // Los 8 puntos de la config se repartieron enteros y sin repetir: cada
    // jugador es su propio lado, así que hay 8 posiciones pagas y no 4.
    expect([...stored.map((row) => row.points)].sort((a, b) => b - a)).toEqual(config.points)

    // 2) `matchdayDetail` (db/read.ts) — el que alimenta la pantalla de fecha.
    const detail = await matchdayDetail(admin.client, matchdayId)
    expect(detail.sides).toHaveLength(8)
    expect(detail.sides.every((side) => side.size === 1)).toBe(true)
    expect(new Set(detail.sides.map((side) => side.a))).toEqual(new Set(entryIds))
    expect(detail.matches).toHaveLength(28)
    expect(detail.matches.every((match) => match.sideA.size === 1 && match.sideB.size === 1)).toBe(true)

    // 3) `closedHistory` (db/season.ts) — el que alimenta el draw siguiente,
    // y `closedHistoryAll` (db/read.ts) — el que alimenta /stats y /jugador.
    const history = await closedHistory(admin.client, disciplineId, 1)
    expect(history?.sides).toHaveLength(8)
    expect(history?.sides.every((side) => side.size === 1)).toBe(true)
    const all = await closedHistoryAll(admin.client, seasonId)
    expect(all).toHaveLength(1)
    expect(all[0]?.sides.every((side) => side.size === 1)).toBe(true)
  })

  it('rejects a direct RPC call when a match still has no result loaded', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, squad)
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)

    const { error } = await admin.client.rpc('close_matchday', {
      p_matchday: matchdayId,
      p_awards: [],
    })

    expect(error?.message).toBe('Faltan resultados por cargar.')
  })

  it('rejects a direct RPC call with a malformed (null) awards payload', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, squad)
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)

    const { error } = await admin.client.rpc('close_matchday', {
      p_matchday: matchdayId,
      p_awards: null,
    })

    expect(error?.message).toBe('La lista de puntos llegó mal formada.')
  })

  // S36 (verify-report ronda 11): G1 no tenía ni un test — cancel.db.test.ts:528
  // cubre la misma frase para `cancel_matchday`, una función distinta.
  it('rejects a direct RPC call for a matchday that does not exist', async () => {
    const { admin } = await buildSeasonWithSquad(defaultConfig(8), 8)

    const { error } = await admin.client.rpc('close_matchday', {
      p_matchday: '00000000-0000-0000-0000-000000000000',
      p_awards: [],
    })

    expect(error?.message).toBe('La fecha no existe.')
  })

  // S36: la mitad de G4 (`p_awards` no nulo pero tampoco array) no tenía test —
  // sólo el caso `null`, arriba, cubría la otra mitad del `or`.
  it('rejects a direct RPC call with a malformed (non-array) awards payload', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, squad)
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)

    const { error } = await admin.client.rpc('close_matchday', {
      p_matchday: matchdayId,
      p_awards: { not: 'an array' },
    })

    expect(error?.message).toBe('La lista de puntos llegó mal formada.')
  })

  // S36: G6 tampoco tenía test de su `raise` — masters.db.test.ts:225 sólo
  // prueba el paso a través con lista vacía. El premio tiene que ser para
  // alguien que SÍ jugó: el guard de premios (G5) corre antes y taparía a G6.
  it('rejects a direct RPC call awarding points on the Masters', async () => {
    const admin = await createTestUser()
    const filler = await fillerPlayers(2)
    const { seasonId, disciplineId, entryIds } = await createSeason({ admin, squad: filler })
    const [a, b] = entryIds
    if (a === undefined || b === undefined) throw new Error('Falta escenario de test.')
    const db = adminClient()
    const { data: matchday, error: matchdayError } = await db
      .from('matchdays')
      .insert({ season_id: seasonId, discipline_id: disciplineId, number: 1, kind: 'MASTERS', status: 'OPEN' })
      .select('id')
      .single()
    if (matchdayError || matchday === null) throw new Error(matchdayError?.message)
    const { error: pairError } = await db
      .from('pairs')
      .insert({ matchday_id: matchday.id, season_id: seasonId, entry_a: a, entry_b: b })
    if (pairError) throw new Error(pairError.message)

    const { error } = await admin.client.rpc('close_matchday', {
      p_matchday: matchday.id,
      p_awards: [{ entryId: a, position: 1, points: 100 }],
    })

    expect(error?.message).toBe('El Masters no reparte puntos.')
  })
})
