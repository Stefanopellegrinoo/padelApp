import { describe, it, expect } from 'vitest'
import { tallyPlayers, partnerRecords, bestPair } from './playerstats'
import type { PlayedMatchday } from './playerstats'
import { pair, single } from './side'
import type { MatchResult, Side } from './types'

function match(sideA: Side, sideB: Side, gamesA: number, gamesB: number, round = 1): MatchResult {
  return { round, sideA, sideB, sets: [{ gamesA, gamesB }] }
}

describe('tallyPlayers', () => {
  it('counts matches played and won for a player', () => {
    const pairA = pair('a1', 'a2')
    const pairB = pair('b1', 'b2')
    const history: PlayedMatchday[] = [
      {
        number: 1,
        sides: [pairA, pairB],
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
    const pairX = pair('x1', 'x2')
    const pairY = pair('y1', 'y2')
    const pairZ = pair('z1', 'z2')
    const history: PlayedMatchday[] = [
      { number: 1, sides: [pairX, pairY], matches: [match(pairX, pairY, 4, 2)] },
      { number: 2, sides: [pairZ, pairX], matches: [match(pairZ, pairX, 3, 5)] },
    ]
    const tallies = tallyPlayers(history, ['x1', 'x2', 'y1', 'y2', 'z1', 'z2'])
    const x1 = tallies.find((t) => t.entryId === 'x1')
    expect(x1?.gamesFor).toBe(9) // 4 (as pairA) + 5 (as pairB)
    expect(x1?.gamesAgainst).toBe(5) // 2 (as pairA) + 3 (as pairB)
  })

  it('includes a guest who played even though they are not in the squad', () => {
    const pairA = pair('a1', 'a2')
    const pairGuest = pair('guest', 'b2')
    const history: PlayedMatchday[] = [
      { number: 1, sides: [pairA, pairGuest], matches: [match(pairA, pairGuest, 4, 2)] },
    ]
    const tallies = tallyPlayers(history, ['a1', 'a2', 'b2'])
    const guest = tallies.find((t) => t.entryId === 'guest')
    expect(guest?.matchesPlayed).toBe(1)
  })

  it('counts matchdaysPlayed once per matchday the player appears in a pair', () => {
    const pairA = pair('a1', 'a2')
    const pairB = pair('b1', 'b2')
    const history: PlayedMatchday[] = [
      {
        number: 1,
        sides: [pairA, pairB],
        matches: [match(pairA, pairB, 4, 2), match(pairA, pairB, 4, 1)],
      },
      { number: 2, sides: [pairA, pairB], matches: [match(pairA, pairB, 4, 3)] },
    ]
    const tallies = tallyPlayers(history, ['a1', 'a2', 'b1', 'b2'])
    const a1 = tallies.find((t) => t.entryId === 'a1')
    expect(a1?.matchdaysPlayed).toBe(2)
  })
})

describe('partnerRecords', () => {
  it('is symmetric: a row exists for both members of the pair', () => {
    const pairA = pair('a1', 'a2')
    const pairB = pair('b1', 'b2')
    const history: PlayedMatchday[] = [
      { number: 1, sides: [pairA, pairB], matches: [match(pairA, pairB, 4, 2)] },
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
    const pairA = pair('a1', 'a2')
    const pairB = pair('b1', 'b2')
    const history: PlayedMatchday[] = [
      { number: 1, sides: [pairA, pairB], matches: [] },
      { number: 2, sides: [pairA, pairB], matches: [] },
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
    const veteranPair = pair('v1', 'v2')
    const rookiePair = pair('r1', 'r2')
    const opponent = pair('o1', 'o2')
    const history: PlayedMatchday[] = [
      { number: 1, sides: [veteranPair, opponent], matches: [match(veteranPair, opponent, 4, 2)] },
      { number: 2, sides: [veteranPair, opponent], matches: [] },
      { number: 3, sides: [rookiePair, opponent], matches: [match(rookiePair, opponent, 4, 1)] },
    ]
    const best = bestPair(history)
    expect(best?.entryId).toBe('v1')
    expect(best?.partner).toBe('v2')
    expect(best?.won).toBe(1)
  })
})

/**
 * PR18b: una disciplina de a uno pasa por acá igual que una de a dos, y las
 * dos mitades del módulo responden distinto A PROPÓSITO. Los tallies por
 * PERSONA (partidos, games, fechas) valen igual — jugar solo sigue siendo
 * jugar. Las sociedades no existen: `partnerRecords` y `bestPair` devuelven
 * vacío y `null`, que es la respuesta correcta y no un agujero de datos.
 */
describe('lados de uno (pair_size=1)', () => {
  const s1 = single('s1')
  const s2 = single('s2')
  const s3 = single('s3')
  const soloHistory: PlayedMatchday[] = [
    {
      number: 1,
      sides: [s1, s2, s3],
      matches: [match(s1, s2, 4, 1), match(s1, s3, 4, 2), match(s2, s3, 1, 4)],
    },
  ]

  it('cuenta partidos, games y fechas por persona igual que de a dos', () => {
    const tallies = tallyPlayers(soloHistory, ['s1', 's2', 's3'])
    const one = tallies.find((t) => t.entryId === 's1')
    expect(one?.matchesPlayed).toBe(2)
    expect(one?.matchesWon).toBe(2)
    expect(one?.gamesFor).toBe(8)
    expect(one?.gamesAgainst).toBe(3)
    expect(one?.matchdaysPlayed).toBe(1)
  })

  it('no inventa sociedades: nadie tiene compañero jugando solo', () => {
    expect(partnerRecords(soloHistory)).toEqual([])
    expect(bestPair(soloHistory)).toBeNull()
  })

  it('en un torneo mixto sólo cuentan las sociedades de la disciplina de a dos', () => {
    const duo = pair('d1', 'd2')
    const rival = pair('r1', 'r2')
    const mixed: PlayedMatchday[] = [
      ...soloHistory,
      { number: 2, sides: [duo, rival], matches: [match(duo, rival, 4, 0)] },
    ]
    const records = partnerRecords(mixed)
    expect(records.map((row) => row.entryId).sort()).toEqual(['d1', 'd2', 'r1', 'r2'])
    expect(bestPair(mixed)?.entryId).toBe('d1')
  })
})
