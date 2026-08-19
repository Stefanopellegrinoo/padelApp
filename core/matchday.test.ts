import { describe, it, expect } from 'vitest'
import { buildPairs } from './pairing'
import { buildFixture } from './fixture'
import { computeStandings } from './standings'
import { computeAwards } from './awards'
import { computeRanking } from './ranking'
import { snapshotForMatchday } from './snapshots'
import { defaultConfig } from './config'
import { members, sameSide, type Duo } from './side'
import type { Award, MatchResult, SeasonConfig, Side } from './types'

const SQUAD = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']
const CONFIG: SeasonConfig = defaultConfig(8)

/** Plays a whole matchday: pairs, fixture, results, table, points. */
function playMatchday(
  present: string[],
  points: Map<string, number>,
  snapshot: string[],
  previousPairs: Duo[],
  defenders: Duo | null,
  defendersAlreadyRepeated: boolean,
  config: SeasonConfig,
): { pairs: Duo[]; awards: Award[]; champion: Duo } {
  const pairs = buildPairs({
    present,
    points,
    snapshot,
    defenders,
    defendersAlreadyRepeated,
    previousPairs,
    guestIds: [],
    fixedPairs: [],
  })

  const fixture = buildFixture(pairs.length)
  const matches: MatchResult[] = []
  let round = 1
  for (const roundMatches of fixture) {
    for (const [left, right] of roundMatches) {
      const pairA = pairs[left]
      const pairB = pairs[right]
      if (pairA === undefined || pairB === undefined) continue
      // pairA always wins (gamesA is fixed at 4); the left < right ternary only
      // varies the loser's margin, so the table spreads out on games difference.
      // This is fixed rather than random so a season can be replayed and compared.
      // Consequence: buildFixture's circle method always keeps pair 0 in the home
      // slot, and buildPairs always puts the table leader in pair 0, so pair 0 wins
      // every match of every matchday. The simulated season is deliberately
      // lopsided — fine for what these tests check, not a realistic season.
      matches.push({
        round,
        sideA: pairA,
        sideB: pairB,
        sets: [{ gamesA: 4, gamesB: left < right ? 1 : 2 }],
      })
    }
    round++
  }

  // `buildPairs` (no `buildSides`) sigue devolviendo `Side[]`: este test
  // simula una temporada de PÁDEL de punta a punta, y su valor es justamente
  // que la aritmética de a dos no se movió un bit con la migración a `Side`.
  const standings = computeStandings(pairs, matches, config, snapshot, false)
  const awards = computeAwards(standings, config, [])
  const winner = standings[0]
  if (winner === undefined) throw new Error('la fecha no produjo tabla')
  if (winner.side.size !== 2) throw new Error('una fecha de pádel no produce lados de uno')
  return { pairs, awards, champion: winner.side }
}

describe('a full matchday, end to end', () => {
  it('runs eight players from pairs to points', () => {
    const { pairs, awards } = playMatchday(
      SQUAD, new Map(), SQUAD, [], null, false, CONFIG,
    )
    expect(pairs).toHaveLength(4)
    expect(awards).toHaveLength(8)
    expect(awards.every((award) => award.points > 0)).toBe(true)
  })

  it('gives both members of every pair the same points', () => {
    const { pairs, awards } = playMatchday(SQUAD, new Map(), SQUAD, [], null, false, CONFIG)
    const byEntry = new Map(awards.map((award) => [award.entryId, award.points]))
    for (const side of pairs) {
      const [first, second] = members(side)
      expect(byEntry.get(first!)).toBe(byEntry.get(second!))
    }
  })

  it('runs twelve players just as happily', () => {
    const twelve = [...SQUAD, 'p9', 'p10', 'p11', 'p12']
    const config = defaultConfig(12)
    const { pairs, awards } = playMatchday(twelve, new Map(), twelve, [], null, false, config)
    expect(pairs).toHaveLength(6)
    expect(awards).toHaveLength(12)
  })

  it('keeps the champions together for exactly two matchdays', () => {
    const first = playMatchday(SQUAD, new Map(), SQUAD, [], null, false, CONFIG)
    const pointsAfterFirst = pointsFrom([first.awards], CONFIG)

    const second = playMatchday(
      SQUAD, pointsAfterFirst, SQUAD, first.pairs, first.champion, false, CONFIG,
    )
    expect(second.pairs.some((pair) => sameAs(pair, first.champion))).toBe(true)

    const pointsAfterSecond = pointsFrom([first.awards, second.awards], CONFIG)
    const third = playMatchday(
      SQUAD, pointsAfterSecond, SQUAD, second.pairs, first.champion, true, CONFIG,
    )
    expect(third.pairs.some((pair) => sameAs(pair, first.champion))).toBe(false)

    // The assertion above is not isolated: previousPairs (second.pairs) already
    // contains the champion pair, so the ordinary no-repeat-vs-previous-matchday
    // rule would exclude it regardless of what defendersAlreadyRepeated does. This
    // call removes that confound: previousPairs is empty, so only resolveDefenders
    // honoring defendersAlreadyRepeated can keep the pair apart.
    const isolated = buildPairs({
      present: SQUAD,
      points: pointsAfterSecond,
      snapshot: SQUAD,
      defenders: first.champion,
      defendersAlreadyRepeated: true,
      previousPairs: [],
      guestIds: [],
      fixedPairs: [],
    })
    expect(isolated.some((pair) => sameAs(pair, first.champion))).toBe(false)
  })

  it('never repeats a pair from the immediately previous matchday', () => {
    let previousPairs: Duo[] = []
    let points = new Map<string, number>()
    const everyAward: Award[][] = []

    for (let matchday = 1; matchday <= 6; matchday++) {
      const snapshot = snapshotForMatchday(
        matchday, SQUAD, new Map(everyAward.map((a, i) => [i + 1, a])), CONFIG,
      )
      const result = playMatchday(SQUAD, points, snapshot, previousPairs, null, false, CONFIG)
      for (const built of result.pairs) {
        expect(previousPairs.some((old) => sameAs(old, built))).toBe(false)
      }
      previousPairs = result.pairs
      everyAward.push(result.awards)
      points = pointsFrom(everyAward, CONFIG)
    }
  })

  it('builds a ranking that adds up across a whole season', () => {
    const everyAward: Award[][] = []
    let previousPairs: Duo[] = []
    let points = new Map<string, number>()

    for (let matchday = 1; matchday <= 10; matchday++) {
      const snapshot = snapshotForMatchday(
        matchday, SQUAD, new Map(everyAward.map((a, i) => [i + 1, a])), CONFIG,
      )
      const result = playMatchday(SQUAD, points, snapshot, previousPairs, null, false, CONFIG)
      previousPairs = result.pairs
      everyAward.push(result.awards)
      points = pointsFrom(everyAward, CONFIG)
    }

    const awardsByMatchday = new Map(everyAward.map((awards, i) => [i + 1, awards]))
    const snapshot = snapshotForMatchday(11, SQUAD, awardsByMatchday, CONFIG)
    const ranking = computeRanking(awardsByMatchday, SQUAD, CONFIG, snapshot)

    expect(ranking).toHaveLength(8)
    expect(new Set(ranking.map((row) => row.entryId)).size).toBe(8)
    for (const row of ranking) {
      expect(row.counted.length).toBe(CONFIG.countBestOf)
      expect(row.discarded.length).toBe(10 - CONFIG.countBestOf)
    }
    for (let i = 1; i < ranking.length; i++) {
      const above = ranking[i - 1]
      const below = ranking[i]
      if (above === undefined || below === undefined) continue
      expect(above.points).toBeGreaterThanOrEqual(below.points)
    }
  })

  it('replays a whole season identically', () => {
    const run = () => {
      const everyAward: Award[][] = []
      let previousPairs: Duo[] = []
      let points = new Map<string, number>()
      for (let matchday = 1; matchday <= 5; matchday++) {
        const snapshot = snapshotForMatchday(
          matchday, SQUAD, new Map(everyAward.map((a, i) => [i + 1, a])), CONFIG,
        )
        const result = playMatchday(SQUAD, points, snapshot, previousPairs, null, false, CONFIG)
        previousPairs = result.pairs
        everyAward.push(result.awards)
        points = pointsFrom(everyAward, CONFIG)
      }
      return everyAward
    }
    expect(run()).toEqual(run())
  })
})

function pointsFrom(everyAward: Award[][], config: SeasonConfig): Map<string, number> {
  const awardsByMatchday = new Map(everyAward.map((awards, index) => [index + 1, awards]))
  // The snapshot only decides the ORDER of the rows; the values come from
  // here either way, so any permutation yields the same Map. SQUAD works
  // because it is deterministic.
  const ranking = computeRanking(awardsByMatchday, SQUAD, config, SQUAD)
  return new Map(ranking.map((row) => [row.entryId, row.points]))
}

function sameAs(left: Side, right: Side): boolean {
  return sameSide(left, right)
}
