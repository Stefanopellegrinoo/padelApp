import { describe, it, expect } from 'vitest'
import { computeStandings } from './standings'
import { pair, single } from './side'
import type { MatchResult, SeasonConfig, Side } from './types'

const SNAPSHOT = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2', 'd1', 'd2']

const PAIRS: Side[] = [
  pair('a1', 'a2'),
  pair('b1', 'b2'),
  pair('c1', 'c2'),
  pair('d1', 'd2'),
]

const CONFIG: SeasonConfig = {
  squadSize: 8,
  matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true, openScore: false },
  points: [10, 6, 3, 1],
  regularMatchdays: 10,
  countBestOf: 8,
  tiebreakSnapshotEvery: 3,
}

function match(left: number, right: number, gamesA: number, gamesB: number): MatchResult {
  const pairA = PAIRS[left]
  const pairB = PAIRS[right]
  if (pairA === undefined || pairB === undefined) throw new Error('bad test fixture')
  return { round: 1, sideA: pairA, sideB: pairB, sets: [{ gamesA, gamesB }] }
}

function order(standings: ReturnType<typeof computeStandings>): string[] {
  return standings.map((row) => row.side.a)
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
    expect(standings[0]?.side.a).toBe('a1')
    expect(standings[1]?.side.a).toBe('b1')
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
    expect(standings[0]?.side.a).toBe('b1')
    expect(standings[1]?.side.a).toBe('a1')
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
    expect(standings.map((row) => row.side.a)).toEqual(['a1', 'b1', 'c1', 'd1'])
  })

  it('gives the same order no matter how the pairs arrive', () => {
    const matches = [
      match(0, 1, 4, 3), match(1, 2, 4, 3), match(0, 2, 3, 4),
      match(0, 3, 4, 3), match(1, 3, 4, 3), match(2, 3, 4, 3),
    ]
    const straight = computeStandings(PAIRS, matches, CONFIG, SNAPSHOT)
    const reversed = computeStandings([...PAIRS].reverse(), matches, CONFIG, SNAPSHOT)
    expect(reversed.map((row) => row.side.a)).toEqual(straight.map((row) => row.side.a))
  })

  it('always produces a total order: no two pairs share a position', () => {
    // Reuses the circular three-way-tie fixture from the test above: a
    // fixture with no ties at all (3-2-1-0) would pass this trivially even
    // if the implementation let duplicate positions through.
    const matches = [
      match(0, 1, 4, 3), match(1, 2, 4, 3), match(0, 2, 3, 4),
      match(0, 3, 4, 3), match(1, 3, 4, 3), match(2, 3, 4, 3),
    ]
    const standings = computeStandings(PAIRS, matches, CONFIG, SNAPSHOT)
    expect(new Set(standings.map((row) => row.position)).size).toBe(PAIRS.length)
  })

  it('counts played, won and games difference per pair', () => {
    const matches = [match(0, 1, 4, 2)]
    const standings = computeStandings(PAIRS, matches, CONFIG, SNAPSHOT)
    const rowA = standings.find((row) => row.side.a === 'a1')
    const rowB = standings.find((row) => row.side.a === 'b1')
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
    const matches: MatchResult[] = [{ round: 1, sideA: pairA, sideB: pairB, sets: [] }]
    const standings = computeStandings(PAIRS, matches, CONFIG, SNAPSHOT)
    expect(standings.every((row) => row.played === 0)).toBe(true)
  })

  it('adds a sets difference step when a match needs more than one set', () => {
    const multiSet: SeasonConfig = {
      ...CONFIG,
      matchFormat: { setsToWin: 2, gamesPerSet: 6, tieBreak: true, openScore: false },
    }
    const pairA = PAIRS[0]
    const pairB = PAIRS[1]
    if (pairA === undefined || pairB === undefined) throw new Error('bad test fixture')
    const matches: MatchResult[] = [
      {
        round: 1,
        sideA: pairA,
        sideB: pairB,
        sets: [
          { gamesA: 6, gamesB: 4 },
          { gamesA: 3, gamesB: 6 },
          { gamesA: 6, gamesB: 3 },
        ],
      },
    ]
    const standings = computeStandings(PAIRS, matches, multiSet, SNAPSHOT)
    const rowA = standings.find((row) => row.side.a === 'a1')
    expect(rowA?.won).toBe(1)
    expect(rowA?.setsDiff).toBe(1)
  })

  it('ranks six pairs as happily as four', () => {
    const sixPairs: Side[] = [...PAIRS, pair('e1', 'e2'), pair('f1', 'f2')]
    const standings = computeStandings(sixPairs, [], CONFIG, [...SNAPSHOT, 'e1', 'e2', 'f1', 'f2'])
    expect(standings).toHaveLength(6)
    expect(standings.map((row) => row.position)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('does not mutate the pairs it receives', () => {
    // Uses real match results, so the internal sort actually reorders tallies
    // (won: 3-2-1-0) — with zero matches every tally ties and a stable sort
    // is a no-op, which would pass even if the implementation sorted `pairs`
    // itself in place.
    const matches = [
      match(0, 1, 4, 2), match(0, 2, 4, 1), match(0, 3, 4, 0),
      match(1, 2, 4, 2), match(1, 3, 4, 1),
      match(2, 3, 4, 3),
    ]
    const input = [...PAIRS]
    computeStandings(input, matches, CONFIG, SNAPSHOT)
    expect(input).toEqual(PAIRS)
  })
})

/**
 * S39 (verify-report ronda 12): hasta acá `computeStandings` no tenía UN SOLO
 * test con lados de uno. La tabla del día de una disciplina `pair_size=1` no la
 * calculaba ni la verificaba nada — el `full_matchday_proof` de `db/` arma su
 * payload de awards por posición de asiento, no derivado de resultados.
 *
 * Estos tests se escriben ANTES de mover el límite público de `Pair` a `Side`,
 * a propósito: son el RED que obliga al cambio, no la ceremonia que lo sigue.
 * La aritmética es la misma que la del bloque de arriba (partidos ganados →
 * diferencia de games → resultado directo → snapshot); lo único que cambia es
 * que cada lado es una persona.
 */
const SOLOS: Side[] = [single('p1'), single('p2'), single('p3'), single('p4')]
const SOLO_SNAPSHOT = ['p1', 'p2', 'p3', 'p4']

function soloMatch(left: number, right: number, gamesA: number, gamesB: number): MatchResult {
  const sideA = SOLOS[left]
  const sideB = SOLOS[right]
  if (sideA === undefined || sideB === undefined) throw new Error('bad test fixture')
  return { round: 1, sideA, sideB, sets: [{ gamesA, gamesB }] }
}

describe('computeStandings con lados de uno (pair_size=1)', () => {
  it('ordena por partidos ganados, igual que de a dos', () => {
    // p1 gana 3, p2 gana 2, p3 gana 1, p4 gana 0.
    const matches = [
      soloMatch(0, 1, 4, 2), soloMatch(0, 2, 4, 1), soloMatch(0, 3, 4, 0),
      soloMatch(1, 2, 4, 2), soloMatch(1, 3, 4, 1),
      soloMatch(2, 3, 4, 3),
    ]
    const standings = computeStandings(SOLOS, matches, CONFIG, SOLO_SNAPSHOT)
    expect(standings.map((row) => row.side.a)).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect(standings.map((row) => row.position)).toEqual([1, 2, 3, 4])
  })

  it('cada fila sigue siendo un lado de uno, no una pareja a medio armar', () => {
    // La garantía que `pairOf` rompía: la fila que sale tiene la MISMA forma
    // que entró. Con el límite viejo esto devolvía `{ a, b: undefined }`.
    const standings = computeStandings(SOLOS, [], CONFIG, SOLO_SNAPSHOT)
    expect(standings).toHaveLength(4)
    expect(standings.every((row) => row.side.size === 1)).toBe(true)
  })

  it('corta un empate de dos por el resultado directo entre los dos jugadores', () => {
    // p1 y p2 ganan 2 y quedan los dos +4 de games. p2 le ganó a p1 4-1, así
    // que el cruce directo —`sameSide` sobre un lado de uno— tiene que cortar.
    const matches = [
      soloMatch(0, 1, 1, 4), soloMatch(0, 2, 4, 0), soloMatch(0, 3, 4, 1),
      soloMatch(1, 2, 4, 1), soloMatch(1, 3, 2, 4),
      soloMatch(2, 3, 4, 2),
    ]
    const standings = computeStandings(SOLOS, matches, CONFIG, SOLO_SNAPSHOT)
    expect(standings[0]?.won).toBe(standings[1]?.won)
    expect(standings[0]?.gamesDiff).toBe(standings[1]?.gamesDiff)
    expect(standings[0]?.side.a).toBe('p2')
    expect(standings[1]?.side.a).toBe('p1')
  })

  it('cuenta jugados, ganados y diferencia de games por jugador', () => {
    const standings = computeStandings(SOLOS, [soloMatch(0, 1, 4, 2)], CONFIG, SOLO_SNAPSHOT)
    const rowA = standings.find((row) => row.side.a === 'p1')
    const rowB = standings.find((row) => row.side.a === 'p2')
    expect(rowA?.played).toBe(1)
    expect(rowA?.won).toBe(1)
    expect(rowA?.gamesDiff).toBe(2)
    expect(rowB?.won).toBe(0)
    expect(rowB?.gamesDiff).toBe(-2)
  })

  it('con 9 jugadores impares tabula los 9: la paridad es de las parejas, no de la tabla', () => {
    // REQ-D5-2: un plantel impar es perfectamente jugable de a uno. La tabla
    // no puede tener un agujero por eso.
    const nine = Array.from({ length: 9 }, (_, index) => single(`s${index + 1}`))
    const standings = computeStandings(nine, [], CONFIG, nine.map((side) => side.a))
    expect(standings).toHaveLength(9)
    expect(standings.map((row) => row.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    // Sin esto el test pasaba en RED: con la lista de partidos vacía, largo y
    // posiciones salen bien aunque cada fila sea una pareja a medio armar.
    expect(standings.map((row) => row.side.a)).toEqual(nine.map((side) => side.a))
  })
})
