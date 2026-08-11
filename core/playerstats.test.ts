import { describe, it, expect } from 'vitest'
import { tallyPlayers, partnerRecords, bestPair } from './playerstats'
import type { PlayedMatchday } from './playerstats'
import type { MatchResult, Pair } from './types'

function match(pairA: Pair, pairB: Pair, gamesA: number, gamesB: number, round = 1): MatchResult {
  return { round, pairA, pairB, sets: [{ gamesA, gamesB }] }
}

describe('tallyPlayers', () => {
  it('counts matches played and won for a player', () => {
    const pairA: Pair = { a: 'a1', b: 'a2' }
    const pairB: Pair = { a: 'b1', b: 'b2' }
    const history: PlayedMatchday[] = [
      {
        number: 1,
        pairs: [pairA, pairB],
        matches: [
          match(pairA, pairB, 4, 2, 1),
          match(pairA, pairB, 4, 3, 2),
          match(pairA, pairB, 2, 4, 3),
        ],
      },
    ]
    const tallies = tallyPlayers(history, ['a1', 'a2', 'b1', 'b2'])
    const a1 = tallies.find((t) => t.entryId === 'a1')
    expect(a1?.matchesPlayed).toBe(3)
    expect(a1?.matchesWon).toBe(2)
  })

  it('counts games from the player side, whether their pair was pairA or pairB', () => {
    // x1 sits in pairA on matchday 1 and in pairB on matchday 2 — a side-swap
    // bug in gamesFor/gamesAgainst would pass unnoticed with only one side.
    const pairX: Pair = { a: 'x1', b: 'x2' }
    const pairY: Pair = { a: 'y1', b: 'y2' }
    const pairZ: Pair = { a: 'z1', b: 'z2' }
    const history: PlayedMatchday[] = [
      { number: 1, pairs: [pairX, pairY], matches: [match(pairX, pairY, 4, 2)] },
      { number: 2, pairs: [pairZ, pairX], matches: [match(pairZ, pairX, 3, 5)] },
    ]
    const tallies = tallyPlayers(history, ['x1', 'x2', 'y1', 'y2', 'z1', 'z2'])
    const x1 = tallies.find((t) => t.entryId === 'x1')
    expect(x1?.gamesFor).toBe(9) // 4 (as pairA) + 5 (as pairB)
    expect(x1?.gamesAgainst).toBe(5) // 2 (as pairA) + 3 (as pairB)
  })

  it('includes a guest who played even though they are not in the squad', () => {
    const pairA: Pair = { a: 'a1', b: 'a2' }
    const pairGuest: Pair = { a: 'guest', b: 'b2' }
    const history: PlayedMatchday[] = [
      { number: 1, pairs: [pairA, pairGuest], matches: [match(pairA, pairGuest, 4, 2)] },
    ]
    const tallies = tallyPlayers(history, ['a1', 'a2', 'b2'])
    const guest = tallies.find((t) => t.entryId === 'guest')
    expect(guest?.matchesPlayed).toBe(1)
  })

  it('counts matchdaysPlayed once per matchday the player appears in a pair', () => {
    const pairA: Pair = { a: 'a1', b: 'a2' }
    const pairB: Pair = { a: 'b1', b: 'b2' }
    const history: PlayedMatchday[] = [
      {
        number: 1,
        pairs: [pairA, pairB],
        matches: [match(pairA, pairB, 4, 2), match(pairA, pairB, 4, 1)],
      },
      { number: 2, pairs: [pairA, pairB], matches: [match(pairA, pairB, 4, 3)] },
    ]
    const tallies = tallyPlayers(history, ['a1', 'a2', 'b1', 'b2'])
    const a1 = tallies.find((t) => t.entryId === 'a1')
    expect(a1?.matchdaysPlayed).toBe(2)
  })
})

describe('partnerRecords', () => {
  it('is symmetric: a row exists for both members of the pair', () => {
    const pairA: Pair = { a: 'a1', b: 'a2' }
    const pairB: Pair = { a: 'b1', b: 'b2' }
    const history: PlayedMatchday[] = [
      { number: 1, pairs: [pairA, pairB], matches: [match(pairA, pairB, 4, 2)] },
    ]
    const records = partnerRecords(history)
    const a1WithA2 = records.find((r) => r.entryId === 'a1' && r.partner === 'a2')
    const a2WithA1 = records.find((r) => r.entryId === 'a2' && r.partner === 'a1')
    expect(a1WithA2).toBeDefined()
    expect(a2WithA1).toBeDefined()
    expect(a1WithA2?.together).toBe(a2WithA1?.together)
    expect(a1WithA2?.won).toBe(a2WithA1?.won)
  })

  it('counts a pair that played two matchdays together as together: 2', () => {
    const pairA: Pair = { a: 'a1', b: 'a2' }
    const pairB: Pair = { a: 'b1', b: 'b2' }
    const history: PlayedMatchday[] = [
      { number: 1, pairs: [pairA, pairB], matches: [] },
      { number: 2, pairs: [pairA, pairB], matches: [] },
    ]
    const records = partnerRecords(history)
    const a1WithA2 = records.find((r) => r.entryId === 'a1' && r.partner === 'a2')
    expect(a1WithA2?.together).toBe(2)
  })
})

describe('bestPair', () => {
  it('returns null for an empty history', () => {
    expect(bestPair([])).toBeNull()
  })

  it('breaks a tie in wins by whoever played together more matchdays', () => {
    // Both pairs win exactly once. The veteran pair shares a second matchday
    // (no result that day) that the rookie pair never gets — that is the
    // criterion this test locks in, decided here before the implementation.
    const veteranPair: Pair = { a: 'v1', b: 'v2' }
    const rookiePair: Pair = { a: 'r1', b: 'r2' }
    const opponent: Pair = { a: 'o1', b: 'o2' }
    const history: PlayedMatchday[] = [
      { number: 1, pairs: [veteranPair, opponent], matches: [match(veteranPair, opponent, 4, 2)] },
      { number: 2, pairs: [veteranPair, opponent], matches: [] },
      { number: 3, pairs: [rookiePair, opponent], matches: [match(rookiePair, opponent, 4, 1)] },
    ]
    const best = bestPair(history)
    expect(best?.entryId).toBe('v1')
    expect(best?.partner).toBe('v2')
    expect(best?.won).toBe(1)
  })
})
