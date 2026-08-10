import { describe, it, expect } from 'vitest'
import { computeStandings } from './standings'
import type { MatchResult, Pair, SeasonConfig } from './types'

const SNAPSHOT = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2', 'd1', 'd2']

const PAIRS: Pair[] = [
  { a: 'a1', b: 'a2' },
  { a: 'b1', b: 'b2' },
  { a: 'c1', b: 'c2' },
  { a: 'd1', b: 'd2' },
]

const CONFIG: SeasonConfig = {
  squadSize: 8,
  matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true },
  points: [10, 6, 3, 1],
  regularMatchdays: 10,
  countBestOf: 8,
  mastersSize: 4,
  tiebreakSnapshotEvery: 3,
}

function match(left: number, right: number, gamesA: number, gamesB: number): MatchResult {
  const pairA = PAIRS[left]
  const pairB = PAIRS[right]
  if (pairA === undefined || pairB === undefined) throw new Error('bad test fixture')
  return { round: 1, pairA, pairB, sets: [{ gamesA, gamesB }] }
}

function order(standings: ReturnType<typeof computeStandings>): string[] {
  return standings.map((row) => row.pair.a)
}

describe('computeStandings', () => {
  it('ranks by matches won, most first', () => {
    // A wins 3, B wins 2, C wins 1, D wins 0  →  3-2-1-0
    const matches = [
      match(0, 1, 4, 2), match(0, 2, 4, 1), match(0, 3, 4, 0),
      match(1, 2, 4, 2), match(1, 3, 4, 1),
      match(2, 3, 4, 3),
    ]
    const standings = computeStandings(PAIRS, matches, CONFIG, SNAPSHOT)
    expect(order(standings)).toEqual(['a1', 'b1', 'c1', 'd1'])
    expect(standings.map((row) => row.position)).toEqual([1, 2, 3, 4])
  })

  it('breaks a two-way tie on games difference', () => {
    // A and B both win 2. A is +6 on games, B is +2.
    const matches = [
      match(0, 1, 2, 4), match(0, 2, 4, 0), match(0, 3, 4, 0),
      match(1, 2, 4, 3), match(1, 3, 3, 4),
      match(2, 3, 4, 2),
    ]
    const standings = computeStandings(PAIRS, matches, CONFIG, SNAPSHOT)
    expect(standings[0]?.pair.a).toBe('a1')
    expect(standings[1]?.pair.a).toBe('b1')
  })

  it('breaks a two-way tie on the head to head when games difference is equal', () => {
    // A and B both win 2 and both finish +4 on games. B beat A 4-1.
    const matches = [
      match(0, 1, 1, 4), match(0, 2, 4, 0), match(0, 3, 4, 1),
      match(1, 2, 4, 1), match(1, 3, 2, 4),
      match(2, 3, 4, 2),
    ]
    const standings = computeStandings(PAIRS, matches, CONFIG, SNAPSHOT)
    expect(standings[0]?.won).toBe(standings[1]?.won)
    expect(standings[0]?.gamesDiff).toBe(standings[1]?.gamesDiff)
    expect(standings[0]?.pair.a).toBe('b1')
    expect(standings[1]?.pair.a).toBe('a1')
  })

  it('falls back to the snapshot on a three-way tie, where the head to head is circular', () => {
    // A beats B, B beats C, C beats A — and all three beat D. Every match 4-3,
    // so A, B and C finish level on wins and on games difference too.
    const matches = [
      match(0, 1, 4, 3), match(1, 2, 4, 3), match(0, 2, 3, 4),
      match(0, 3, 4, 3), match(1, 3, 4, 3), match(2, 3, 4, 3),
    ]
    const standings = computeStandings(PAIRS, matches, CONFIG, SNAPSHOT)
    // Circular head to head resolves nothing, so the snapshot cuts: a1 < b1 < c1.
    expect(standings.map((row) => row.pair.a)).toEqual(['a1', 'b1', 'c1', 'd1'])
  })

  it('gives the same order no matter how the pairs arrive', () => {
    const matches = [
      match(0, 1, 4, 3), match(1, 2, 4, 3), match(0, 2, 3, 4),
      match(0, 3, 4, 3), match(1, 3, 4, 3), match(2, 3, 4, 3),
    ]
    const straight = computeStandings(PAIRS, matches, CONFIG, SNAPSHOT)
    const reversed = computeStandings([...PAIRS].reverse(), matches, CONFIG, SNAPSHOT)
    expect(reversed.map((row) => row.pair.a)).toEqual(straight.map((row) => row.pair.a))
  })

  it('always produces a total order: no two pairs share a position', () => {
    const matches = [
      match(0, 1, 4, 3), match(0, 2, 4, 3), match(0, 3, 4, 3),
      match(1, 2, 4, 3), match(1, 3, 4, 3),
      match(2, 3, 4, 3),
    ]
    const standings = computeStandings(PAIRS, matches, CONFIG, SNAPSHOT)
    expect(new Set(standings.map((row) => row.position)).size).toBe(PAIRS.length)
  })

  it('counts played, won and games difference per pair', () => {
    const matches = [match(0, 1, 4, 2)]
    const standings = computeStandings(PAIRS, matches, CONFIG, SNAPSHOT)
    const rowA = standings.find((row) => row.pair.a === 'a1')
    const rowB = standings.find((row) => row.pair.a === 'b1')
    expect(rowA?.played).toBe(1)
    expect(rowA?.won).toBe(1)
    expect(rowA?.gamesDiff).toBe(2)
    expect(rowB?.won).toBe(0)
    expect(rowB?.gamesDiff).toBe(-2)
  })

  it('ignores matches that have not been played yet', () => {
    const pairA = PAIRS[0]
    const pairB = PAIRS[1]
    if (pairA === undefined || pairB === undefined) throw new Error('bad test fixture')
    const matches: MatchResult[] = [{ round: 1, pairA, pairB, sets: [] }]
    const standings = computeStandings(PAIRS, matches, CONFIG, SNAPSHOT)
    expect(standings.every((row) => row.played === 0)).toBe(true)
  })

  it('adds a sets difference step when a match needs more than one set', () => {
    const multiSet: SeasonConfig = {
      ...CONFIG,
      matchFormat: { setsToWin: 2, gamesPerSet: 6, tieBreak: true },
    }
    const pairA = PAIRS[0]
    const pairB = PAIRS[1]
    if (pairA === undefined || pairB === undefined) throw new Error('bad test fixture')
    const matches: MatchResult[] = [
      {
        round: 1,
        pairA,
        pairB,
        sets: [
          { gamesA: 6, gamesB: 4 },
          { gamesA: 3, gamesB: 6 },
          { gamesA: 6, gamesB: 3 },
        ],
      },
    ]
    const standings = computeStandings(PAIRS, matches, multiSet, SNAPSHOT)
    const rowA = standings.find((row) => row.pair.a === 'a1')
    expect(rowA?.won).toBe(1)
    expect(rowA?.setsDiff).toBe(1)
  })

  it('ranks six pairs as happily as four', () => {
    const sixPairs: Pair[] = [
      ...PAIRS,
      { a: 'e1', b: 'e2' },
      { a: 'f1', b: 'f2' },
    ]
    const standings = computeStandings(sixPairs, [], CONFIG, [...SNAPSHOT, 'e1', 'e2', 'f1', 'f2'])
    expect(standings).toHaveLength(6)
    expect(standings.map((row) => row.position)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('does not mutate the pairs it receives', () => {
    const input = [...PAIRS]
    computeStandings(input, [], CONFIG, SNAPSHOT)
    expect(input).toEqual(PAIRS)
  })
})
