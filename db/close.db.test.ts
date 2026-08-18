import { describe, it, expect } from 'vitest'
import { defaultConfig, type SeasonConfig } from '@/core'
import { addGuest, closeMatchday, createMatchday, generatePairs, openMatchday, saveResult, setAttendance } from './matchday'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser, type TestUser } from './test/users'

// ── scaffolding local a este archivo ────────────────────────────────────────
// No va a db/test/factories.ts: esa lista de archivos es la del plan, y estos
// armadores sólo le sirven al cierre de una fecha.

// `entry_b` es `string | null` en la fila real (0028, REQ-D5-1); esta suite
// sólo ejercita pádel (pair_size=2, siempre con segundo miembro).
function requirePartner(entryB: string | null): string {
  if (entryB === null) throw new Error('Pareja sin segundo miembro en un test que sólo espera pádel.')
  return entryB
}

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
// Producción todavía no puede escribir un `pairs` de `pair_size=1` (W34:
// `insertPairs` no manda esa columna, así que `generatePairs` muere contra
// `pairs_matchday_size`). El escenario se arma con service_role, igual que
// `pairs-side-shape.db.test.ts` — es el único camino que hoy puede crear la
// fila legal que este test necesita.
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
      expect(pointsOf.get(pair.entry_a)).toBe(pointsOf.get(requirePartner(pair.entry_b)))
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
})
