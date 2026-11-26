import { describe, expect, it } from 'vitest'
import { computeAwards } from './awards'
import { ordinal } from './narrate'
import { MAX_RANKING_SCORE, computeRankingAwards, rankScores, rankingScoreError, rankingTallies } from './ranking-fecha'
import { single } from './side'
import type { SeasonConfig } from './types'

const CONFIG: SeasonConfig = {
  squadSize: 6,
  matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true, openScore: true },
  points: [10, 8, 6, 4, 2, 1],
  regularMatchdays: 10,
  countBestOf: 8,
  tiebreakSnapshotEvery: 3,
}

describe('rankScores: la tabla de una fecha por pinos (S4)', () => {
  it('el que más hizo ganó, y para abajo', () => {
    const rows = rankScores([
      { entryId: 'a', score: 120 },
      { entryId: 'b', score: 201 },
      { entryId: 'c', score: 150 },
    ])
    expect(rows.map((row) => [row.side, row.position, row.dayPoints])).toEqual([
      [single('b'), 1, 201],
      [single('c'), 2, 150],
      [single('a'), 3, 120],
    ])
  })

  it('dos con 180 quedan los dos 2°, y el siguiente queda 4°', () => {
    const rows = rankScores([
      { entryId: 'a', score: 200 },
      { entryId: 'b', score: 180 },
      { entryId: 'c', score: 180 },
      { entryId: 'd', score: 150 },
    ])
    expect(rows.map((row) => [row.side.a, row.position])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 2],
      ['d', 4],
    ])
  })

  it('dentro de un empate respeta el orden en que llegaron', () => {
    const rows = rankScores([
      { entryId: 'z', score: 100 },
      { entryId: 'y', score: 100 },
    ])
    expect(rows.map((row) => [row.side.a, row.position])).toEqual([
      ['z', 1],
      ['y', 1],
    ])
  })

  it('cada fila es un lado de uno, sin partidos, games ni sets', () => {
    const [row] = rankScores([{ entryId: 'a', score: 0 }])
    expect(row).toEqual({
      side: single('a'),
      played: 1,
      won: 0,
      drawn: 0,
      dayPoints: 0,
      setsDiff: 0,
      gamesDiff: 0,
      position: 1,
    })
  })

  it('sin pinos no hay tabla', () => {
    expect(rankScores([])).toEqual([])
  })
})

describe('computeRankingAwards: puestos y puntos compartidos (S4)', () => {
  it('los empatados se llevan los puntos de su puesto compartido, y el siguiente los de su puesto', () => {
    const awards = computeRankingAwards(
      rankScores([
        { entryId: 'a', score: 200 },
        { entryId: 'b', score: 180 },
        { entryId: 'c', score: 180 },
        { entryId: 'd', score: 150 },
      ]),
      CONFIG,
    )
    expect(awards).toEqual([
      { entryId: 'a', position: 1, points: 10, lines: [{ reason: `${ordinal(1)} de la fecha`, points: 10 }] },
      { entryId: 'b', position: 2, points: 8, lines: [{ reason: `${ordinal(2)} de la fecha`, points: 8 }] },
      { entryId: 'c', position: 2, points: 8, lines: [{ reason: `${ordinal(2)} de la fecha`, points: 8 }] },
      { entryId: 'd', position: 4, points: 4, lines: [{ reason: `${ordinal(4)} de la fecha`, points: 4 }] },
    ])
  })

  it('un empate de todos paga a todos lo del 1°', () => {
    const awards = computeRankingAwards(
      rankScores([
        { entryId: 'a', score: 90 },
        { entryId: 'b', score: 90 },
        { entryId: 'c', score: 90 },
      ]),
      CONFIG,
    )
    expect(awards.map((award) => [award.position, award.points])).toEqual([
      [1, 10],
      [1, 10],
      [1, 10],
    ])
  })

  it('cada award tiene su propio desglose, no uno compartido', () => {
    const [first, second] = computeRankingAwards(
      rankScores([
        { entryId: 'a', score: 90 },
        { entryId: 'b', score: 90 },
      ]),
      CONFIG,
    )
    expect(first?.lines).not.toBe(second?.lines)
  })

  it('con más jugadores que puntos tira, como computeAwards', () => {
    const scores = Array.from({ length: 7 }, (_, index) => ({ entryId: `e${index}`, score: 100 - index }))
    expect(() => computeRankingAwards(rankScores(scores), CONFIG)).toThrow(
      'La fecha tiene 7 competidores del torneo pero la lista de puntos sólo tiene 6 valores.',
    )
  })
})

describe('computeAwards no cambia con puestos repetidos', () => {
  it('sigue pagando por orden, no por el puesto que traiga la fila', () => {
    const rows = rankScores([
      { entryId: 'a', score: 180 },
      { entryId: 'b', score: 180 },
    ])
    expect(computeAwards(rows, CONFIG, []).map((award) => [award.entryId, award.position, award.points])).toEqual([
      ['a', 1, 10],
      ['b', 2, 8],
    ])
  })
})

describe('rankingScoreError: qué total se puede guardar', () => {
  it('de 0 a 9999, enteros', () => {
    expect(MAX_RANKING_SCORE).toBe(9999)
    for (const ok of [0, 1, 300, 9999]) expect(rankingScoreError(ok)).toBeNull()
    for (const bad of [-1, 10000, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(rankingScoreError(bad)).toBe('Los pinos van de 0 a 9999, sin decimales.')
    }
  })
})

describe('rankingTallies: los pinos de cada uno en el año', () => {
  it('fechas jugadas, total, mejor y promedio redondeado; quien no jugó en cero', () => {
    const byNumber = new Map([
      [1, new Map([['a', 180], ['b', 120]])],
      [2, new Map([['a', 151]])],
    ])
    expect(rankingTallies(byNumber, ['a', 'b', 'c'])).toEqual([
      { entryId: 'a', played: 2, total: 331, best: 180, average: 166 },
      { entryId: 'b', played: 1, total: 120, best: 120, average: 120 },
      { entryId: 'c', played: 0, total: 0, best: 0, average: 0 },
    ])
  })

  it('alguien fuera del plantel no aparece', () => {
    expect(rankingTallies(new Map([[1, new Map([['x', 99]])]]), ['a'])).toEqual([
      { entryId: 'a', played: 0, total: 0, best: 0, average: 0 },
    ])
  })
})
