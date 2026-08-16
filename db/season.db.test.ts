import { beforeAll, describe, expect, it } from 'vitest'
import {
  computeRanking,
  defaultConfig,
  samePair,
  snapshotForMatchday,
  type Pair,
  type SeasonConfig,
} from '@/core'
import {
  addGuest,
  closeMatchday,
  createMatchday,
  generatePairs,
  lockPair,
  openMatchday,
  reopenMatchday,
  saveResult,
  setAttendance,
} from './matchday'
import { awardsBefore, squadSeedOrder, updateSeasonConfig } from './season'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser, type TestUser } from './test/users'
import type { Json } from './database.types'

// ── scaffolding local a este archivo ────────────────────────────────────────
// Igual que en generate.db.test.ts y reopen.db.test.ts: no va a
// db/test/factories.ts, estos armadores sólo le sirven a esta temporada
// simulada.
//
// La regla determinista del harness: en las rondas impares gana la pareja
// peor rankeada entrando a la fecha, en las pares la mejor. Eso hace que la
// tabla se mueva de verdad y que el campeón rote — a diferencia del harness
// de core/matchday.test.ts, que deja ganar siempre a la pareja 0.

type AwardRow = { entry_id: string; position: number; points: number }

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

/** Arma la temporada con `squadSize - 1` asientos ya reclamados y el último libre, para poder reclamarlo en el test 7. */
async function createWalkthroughSeason(
  admin: TestUser,
  config: SeasonConfig,
  squadSize: number,
): Promise<{
  seasonId: string
  disciplineId: string
  entryIds: string[]
  openSeatEntryId: string
  inviteToken: string
}> {
  const db = adminClient()
  const { data: season, error: seasonError } = await db
    .from('seasons')
    .insert({
      name: `Temporada de test ${Date.now()}`,
      config: config as unknown as Json,
      created_by: admin.userId,
    })
    .select('id, invite_token')
    .single()
  if (seasonError || season === null) throw new Error(seasonError?.message)

  // createMatchday necesita una disciplina para resolver discipline_id: esta
  // temporada no pasa por db/test/factories.ts, así que se arma acá.
  const { data: discipline, error: disciplineError } = await db
    .from('disciplines')
    .insert({ season_id: season.id, kind: 'PADEL', config: config as unknown as Json })
    .select('id')
    .single()
  if (disciplineError || discipline === null) throw new Error(disciplineError?.message)

  const players = await fillerPlayers(squadSize - 1)
  const entryIds: string[] = []
  for (let index = 0; index < squadSize; index++) {
    const playerId = players[index]
    const { data: entry, error } = await db
      .from('entries')
      .insert({
        season_id: season.id,
        player_id: playerId ?? null,
        display_name: playerId === undefined ? 'Asiento libre de test' : `Jugador de test ${index + 1}`,
        kind: 'SQUAD',
        seed_position: index,
      })
      .select('id')
      .single()
    if (error || entry === null) throw new Error(error?.message)
    entryIds.push(entry.id)
  }
  const openSeatEntryId = entryIds[entryIds.length - 1]
  if (openSeatEntryId === undefined) throw new Error('Falta el asiento libre de test.')
  return {
    seasonId: season.id,
    disciplineId: discipline.id,
    entryIds,
    openSeatEntryId,
    inviteToken: season.invite_token,
  }
}

async function markPlaying(admin: TestUser, matchdayId: string, entryIds: string[]): Promise<void> {
  for (const entryId of entryIds) {
    await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
  }
}

async function pairsOf(
  matchdayId: string,
): Promise<Array<{ id: string; entry_a: string; entry_b: string }>> {
  const db = adminClient()
  const { data, error } = await db
    .from('pairs')
    .select('id, entry_a, entry_b')
    .eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return data ?? []
}

async function matchesOf(
  matchdayId: string,
): Promise<Array<{ id: string; round: number; pair_a: string; pair_b: string }>> {
  const db = adminClient()
  const { data, error } = await db
    .from('matches')
    .select('id, round, pair_a, pair_b')
    .eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return data ?? []
}

async function awardsOf(matchdayId: string): Promise<AwardRow[]> {
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

const sortByEntry = <T extends { entry_id: string }>(rows: T[]): T[] =>
  [...rows].sort((left, right) => left.entry_id.localeCompare(right.entry_id))

/** El ranking tal como lo vería el sorteo o el cierre de `matchdayNumber`: sólo lo cerrado antes cuenta. */
async function rankingBefore(
  admin: TestUser,
  seasonId: string,
  disciplineId: string,
  matchdayNumber: number,
  config: SeasonConfig,
) {
  const seedOrder = await squadSeedOrder(admin.client, seasonId)
  const awardsByMatchday = await awardsBefore(admin.client, disciplineId, matchdayNumber)
  const snapshot = snapshotForMatchday(matchdayNumber, seedOrder, awardsByMatchday, config)
  return computeRanking(awardsByMatchday, seedOrder, config, snapshot)
}

/** La pareja que se quedó con la posición 1 de premios, o null si la fecha no pagó a nadie. */
function championPairOf(awards: AwardRow[], pairs: Pair[]): Pair | null {
  const winners = new Set(
    awards.filter((award) => award.position === 1).map((award) => award.entry_id),
  )
  if (winners.size === 0) return null
  return pairs.find((pair) => winners.has(pair.a) || winners.has(pair.b)) ?? null
}

/**
 * Juega todos los partidos de una fecha ya abierta con la regla determinista
 * del harness: rondas impares para la pareja peor rankeada entrando a la
 * fecha, rondas pares para la mejor. El ranking de referencia es el mismo que
 * usaría el sorteo — computado antes de tocar ningún resultado.
 */
async function playByRankRule(
  admin: TestUser,
  seasonId: string,
  disciplineId: string,
  matchdayId: string,
  matchdayNumber: number,
  config: SeasonConfig,
): Promise<void> {
  const ranking = await rankingBefore(admin, seasonId, disciplineId, matchdayNumber, config)
  const rankIndex = new Map(ranking.map((row, index) => [row.entryId, index]))
  const worst = ranking.length // los invitados quedan afuera del ranking del plantel: valen como el peor posible

  const pairs = await pairsOf(matchdayId)
  const pairRank = new Map(
    pairs.map((pair) => [
      pair.id,
      Math.min(rankIndex.get(pair.entry_a) ?? worst, rankIndex.get(pair.entry_b) ?? worst),
    ]),
  )

  const matches = await matchesOf(matchdayId)
  for (const match of matches) {
    const rankA = pairRank.get(match.pair_a) ?? worst
    const rankB = pairRank.get(match.pair_b) ?? worst
    const aIsBetterRanked = rankA < rankB
    const oddRound = match.round % 2 === 1
    const aWins = oddRound ? !aIsBetterRanked : aIsBetterRanked
    const sets = aWins ? [{ gamesA: 4, gamesB: 0 }] : [{ gamesA: 0, gamesB: 4 }]
    await saveResult(admin.client, match.id, sets)
  }
}

interface PlayMatchdayOptions {
  playing: string[]
  guestNames?: string[]
  /** Índices dentro de `guestNames` que se traban entre sí antes del sorteo. */
  guestLock?: [number, number]
}

/** DRAFT → CLOSED de una fecha: presentismo, invitados, sorteo, apertura, resultados y cierre. */
async function playMatchday(
  admin: TestUser,
  seasonId: string,
  disciplineId: string,
  matchdayId: string,
  matchdayNumber: number,
  config: SeasonConfig,
  { playing, guestNames = [], guestLock }: PlayMatchdayOptions,
): Promise<{ guestIds: string[] }> {
  await markPlaying(admin, matchdayId, playing)

  const guestIds: string[] = []
  for (const displayName of guestNames) {
    guestIds.push(await addGuest(admin.client, matchdayId, { displayName }))
  }
  if (guestLock !== undefined) {
    const [left, right] = guestLock
    const a = guestIds[left]
    const b = guestIds[right]
    if (a === undefined || b === undefined) {
      throw new Error('Falta un invitado para la pareja trabada de test.')
    }
    await lockPair(admin.client, matchdayId, a, b)
  }

  await generatePairs(admin.client, matchdayId)
  await openMatchday(admin.client, matchdayId)
  await playByRankRule(admin, seasonId, disciplineId, matchdayId, matchdayNumber, config)
  await closeMatchday(admin.client, matchdayId)

  return { guestIds }
}

interface WalkthroughSeason {
  admin: TestUser
  seasonId: string
  disciplineId: string
  config: SeasonConfig
  squad: string[]
  openSeatEntryId: string
  inviteToken: string
  matchdayIds: string[] // índice 0 → fecha 1, ..., índice 9 → fecha 10
  pairsByMatchday: Map<number, Pair[]>
  awardsRightAfterClose: Map<number, AwardRow[]>
  /** El del plantel que falta en la fecha 6 — nunca uno de los defensores que entran a esa fecha. */
  absentee: string
  loneGuestEntryId: string
  guestPairEntryIds: [string, string]
}

function matchdayIdOf(season: WalkthroughSeason, number: number): string {
  const id = season.matchdayIds[number - 1]
  if (id === undefined) throw new Error(`Falta el id de la fecha ${number} en la temporada de test.`)
  return id
}

/**
 * Arma y juega una temporada de 10 fechas de punta a punta:
 *  - fechas 1-4 y 7, 9-10: plantel completo, sin invitados.
 *  - fecha 5: se cambia la escala de puntos antes de sortear/cerrarla.
 *  - fecha 6: un invitado suelto cubre al ausente — nunca a un defensor.
 *  - fecha 8: un equipo invitado (dos invitados trabados entre sí).
 */
async function buildWalkthroughSeason(): Promise<WalkthroughSeason> {
  const admin = await createTestUser()
  let config = defaultConfig(8)
  const {
    seasonId,
    disciplineId,
    entryIds: squad,
    openSeatEntryId,
    inviteToken,
  } = await createWalkthroughSeason(admin, config, 8)

  const matchdayIds: string[] = []
  const pairsByMatchday = new Map<number, Pair[]>()
  const awardsRightAfterClose = new Map<number, AwardRow[]>()
  const playedOn = (day: number) => `2026-01-${String(day).padStart(2, '0')}`

  const recordClose = async (matchdayId: string, number: number): Promise<void> => {
    matchdayIds[number - 1] = matchdayId
    pairsByMatchday.set(
      number,
      (await pairsOf(matchdayId)).map((row) => ({ a: row.entry_a, b: row.entry_b })),
    )
    awardsRightAfterClose.set(number, sortByEntry(await awardsOf(matchdayId)))
  }

  for (let number = 1; number <= 4; number++) {
    const matchdayId = await createMatchday(admin.client, seasonId, playedOn(number))
    await playMatchday(admin, seasonId, disciplineId, matchdayId, number, config, { playing: squad })
    await recordClose(matchdayId, number)
  }

  // Fecha 5: cambia la escala de puntos antes de sortearla. Lo cerrado antes no se tiene que mover (test 5).
  config = { ...config, points: [12, 7, 4, 1] }
  await updateSeasonConfig(admin.client, seasonId, config)
  const md5 = await createMatchday(admin.client, seasonId, playedOn(5))
  await playMatchday(admin, seasonId, disciplineId, md5, 5, config, { playing: squad })
  await recordClose(md5, 5)

  // Fecha 6: invitado suelto por el ausente — nunca uno de los defensores que entran a esta fecha.
  const md5Champion = championPairOf(awardsRightAfterClose.get(5) ?? [], pairsByMatchday.get(5) ?? [])
  const defending = new Set(md5Champion === null ? [] : [md5Champion.a, md5Champion.b])
  const absentee = squad.find((entryId) => !defending.has(entryId))
  if (absentee === undefined) throw new Error('No hay a quién ausentar sin tocar a los defensores.')
  const md6 = await createMatchday(admin.client, seasonId, playedOn(6))
  const { guestIds: md6Guests } = await playMatchday(admin, seasonId, disciplineId, md6, 6, config, {
    playing: squad.filter((entryId) => entryId !== absentee),
    guestNames: ['Invitado suelto'],
  })
  await recordClose(md6, 6)
  const loneGuestEntryId = md6Guests[0]
  if (loneGuestEntryId === undefined) throw new Error('Falta el invitado suelto de test.')

  // Fecha 7: vuelve el plantel completo.
  const md7 = await createMatchday(admin.client, seasonId, playedOn(7))
  await playMatchday(admin, seasonId, disciplineId, md7, 7, config, { playing: squad })
  await recordClose(md7, 7)

  // Fecha 8: equipo invitado — dos invitados trabados entre sí, plantel completo alrededor.
  const md8 = await createMatchday(admin.client, seasonId, playedOn(8))
  const { guestIds: md8Guests } = await playMatchday(admin, seasonId, disciplineId, md8, 8, config, {
    playing: squad,
    guestNames: ['Equipo invitado 1', 'Equipo invitado 2'],
    guestLock: [0, 1],
  })
  await recordClose(md8, 8)
  const [guestA, guestB] = md8Guests
  if (guestA === undefined || guestB === undefined) throw new Error('Falta el equipo invitado de test.')

  // Fechas 9-10: cierran la temporada regular con el plantel completo.
  for (let number = 9; number <= 10; number++) {
    const matchdayId = await createMatchday(admin.client, seasonId, playedOn(number))
    await playMatchday(admin, seasonId, disciplineId, matchdayId, number, config, { playing: squad })
    await recordClose(matchdayId, number)
  }

  return {
    admin,
    seasonId,
    disciplineId,
    config,
    squad,
    openSeatEntryId,
    inviteToken,
    matchdayIds,
    pairsByMatchday,
    awardsRightAfterClose,
    absentee,
    loneGuestEntryId,
    guestPairEntryIds: [guestA, guestB],
  }
}

/** Juega una temporada corta, simple (sin invitados ni cambios de config), para el test de reproducibilidad. */
async function playDeterministicSeason(
  matchdayCount: number,
): Promise<Array<Array<{ seedPosition: number; position: number; points: number }>>> {
  const admin = await createTestUser()
  const config = defaultConfig(8)
  const players = await fillerPlayers(8)
  const { seasonId, disciplineId, entryIds } = await createSeason({ admin, config, squad: players })
  const seedPositionOf = new Map(entryIds.map((entryId, index) => [entryId, index]))

  const seasonAwards: Array<Array<{ seedPosition: number; position: number; points: number }>> = []
  for (let number = 1; number <= matchdayCount; number++) {
    const matchdayId = await createMatchday(
      admin.client,
      seasonId,
      `2026-02-${String(number).padStart(2, '0')}`,
    )
    await playMatchday(admin, seasonId, disciplineId, matchdayId, number, config, { playing: entryIds })
    const awards = await awardsOf(matchdayId)
    const bySeed = awards
      .map((award) => ({
        seedPosition: seedPositionOf.get(award.entry_id) ?? -1,
        position: award.position,
        points: award.points,
      }))
      .sort((left, right) => left.seedPosition - right.seedPosition)
    seasonAwards.push(bySeed)
  }
  return seasonAwards
}

describe('a whole season played end to end', () => {
  let season: WalkthroughSeason

  beforeAll(async () => {
    season = await buildWalkthroughSeason()
  }, 90_000)

  it('plays 10 matchdays and closes a season-long ranking', async () => {
    for (const matchdayId of season.matchdayIds) {
      expect(await matchdayStatus(matchdayId)).toBe('CLOSED')
    }

    const ranking = await rankingBefore(season.admin, season.seasonId, season.disciplineId, 11, season.config)
    expect(ranking).toHaveLength(8)
    expect(new Set(ranking.map((row) => row.entryId)).size).toBe(8)
    for (const row of ranking) {
      expect(row.counted.length).toBe(season.config.countBestOf)
    }
    for (let i = 1; i < ranking.length; i++) {
      const previous = ranking[i - 1]
      const current = ranking[i]
      if (previous === undefined || current === undefined) continue
      expect(previous.points).toBeGreaterThanOrEqual(current.points)
    }
  })

  it('never repeats a pair from the matchday right before it, except the defending champions', () => {
    for (let number = 2; number <= 10; number++) {
      const previous = season.pairsByMatchday.get(number - 1) ?? []
      const current = season.pairsByMatchday.get(number) ?? []
      const repeated = current.filter((pair) => previous.some((old) => samePair(old, pair)))

      expect(repeated.length).toBeLessThanOrEqual(1)
      if (repeated.length === 1) {
        const onlyRepeat = repeated[0]
        const champion = championPairOf(season.awardsRightAfterClose.get(number - 1) ?? [], previous)
        if (onlyRepeat === undefined || champion === null) {
          throw new Error('Bug de test: se esperaba una pareja repetida con campeón.')
        }
        expect(samePair(onlyRepeat, champion)).toBe(true)
      }
    }
  })

  it('a champion pair that attends in full plays exactly two matchdays together', () => {
    const champion1 = championPairOf(
      season.awardsRightAfterClose.get(1) ?? [],
      season.pairsByMatchday.get(1) ?? [],
    )
    if (champion1 === null) throw new Error('La fecha 1 no tuvo campeón.')

    const pairsMd2 = season.pairsByMatchday.get(2) ?? []
    const pairsMd3 = season.pairsByMatchday.get(3) ?? []
    expect(pairsMd2.some((pair) => samePair(pair, champion1))).toBe(true)
    expect(pairsMd3.some((pair) => samePair(pair, champion1))).toBe(false)
  })

  it("the table discards its worst results as of matchday 9's close", async () => {
    const before9 = await rankingBefore(season.admin, season.seasonId, season.disciplineId, 9, season.config)
    expect(before9.every((row) => row.discarded.length === 0)).toBe(true)

    const before10 = await rankingBefore(season.admin, season.seasonId, season.disciplineId, 10, season.config)
    const absenteeRow = before10.find((row) => row.entryId === season.absentee)
    expect(absenteeRow?.discarded.length).toBe(0)

    const others = before10.filter((row) => row.entryId !== season.absentee)
    expect(others.length).toBeGreaterThan(0)
    expect(others.every((row) => row.discarded.length === 1)).toBe(true)
  })

  it("changing the points at matchday 5 does not touch the previous four matchdays' awards", async () => {
    for (let number = 1; number <= 4; number++) {
      const current = sortByEntry(await awardsOf(matchdayIdOf(season, number)))
      expect(current).toEqual(season.awardsRightAfterClose.get(number))
    }
  })

  it('reopening the last matchday and closing it again leaves everything the same', async () => {
    const md10Id = matchdayIdOf(season, 10)
    const before = sortByEntry(await awardsOf(md10Id))

    await reopenMatchday(season.admin.client, md10Id)
    await closeMatchday(season.admin.client, md10Id)

    expect(await matchdayStatus(md10Id)).toBe('CLOSED')
    expect(sortByEntry(await awardsOf(md10Id))).toEqual(before)
  })

  it('claiming a profile does not alter any historical result', async () => {
    const before: AwardRow[][] = []
    for (const matchdayId of season.matchdayIds) {
      before.push(sortByEntry(await awardsOf(matchdayId)))
    }

    const claimer = await createTestUser()
    const { data, error } = await claimer.client.rpc('claim_seat', {
      p_token: season.inviteToken,
      p_entry: season.openSeatEntryId,
    })
    expect(error).toBeNull()
    expect(data).toBe(season.seasonId)

    const after: AwardRow[][] = []
    for (const matchdayId of season.matchdayIds) {
      after.push(sortByEntry(await awardsOf(matchdayId)))
    }
    expect(after).toEqual(before)
  })

  it('one matchday with a lone guest and another with a visiting pair', () => {
    const md6Pairs = season.pairsByMatchday.get(6) ?? []
    const md6Awards = season.awardsRightAfterClose.get(6) ?? []
    expect(md6Pairs).toHaveLength(4)
    expect(md6Pairs.some((pair) => pair.a === season.loneGuestEntryId || pair.b === season.loneGuestEntryId)).toBe(
      true,
    )
    expect(md6Awards.some((award) => award.entry_id === season.loneGuestEntryId)).toBe(false)
    expect(md6Awards.some((award) => award.entry_id === season.absentee)).toBe(false)
    expect(md6Awards).toHaveLength(7) // el plantel presente, sin el invitado

    const md8Pairs = season.pairsByMatchday.get(8) ?? []
    const md8Awards = season.awardsRightAfterClose.get(8) ?? []
    const [guestA, guestB] = season.guestPairEntryIds
    expect(md8Pairs).toHaveLength(5)
    expect(md8Pairs.some((pair) => samePair(pair, { a: guestA, b: guestB }))).toBe(true)
    expect(md8Awards.some((award) => award.entry_id === guestA || award.entry_id === guestB)).toBe(false)
    expect(md8Awards).toHaveLength(8) // el plantel completo, ninguno de los dos invitados
  })

  it('the same season, played twice, gives the same awards', async () => {
    const first = await playDeterministicSeason(5)
    const second = await playDeterministicSeason(5)
    expect(second).toEqual(first)
  })
})
