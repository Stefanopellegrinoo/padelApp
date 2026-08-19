import { describe, it, expect } from 'vitest'
import { computeRanking } from './ranking'
import { rankingWithMovement } from './movement'
import type { Award, SeasonConfig } from './types'

const SQUAD = ['p1', 'p2', 'p3', 'p4']
const SNAPSHOT = ['p1', 'p2', 'p3', 'p4']

const CONFIG: SeasonConfig = {
  squadSize: 8,
  matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true, openScore: false },
  points: [10, 6, 3, 1],
  regularMatchdays: 10,
  countBestOf: 3,
  tiebreakSnapshotEvery: 3,
}

function award(entryId: string, points: number): Award {
  return { entryId, position: 1, points }
}

describe('rankingWithMovement', () => {
  it('assigns positions starting at 1, correlative in the order computeRanking returns', () => {
    const awards = new Map([[1, [award('p2', 10), award('p3', 6), award('p1', 3)]]])
    const expectedOrder = computeRanking(awards, SQUAD, CONFIG, SNAPSHOT).map((row) => row.entryId)

    const rows = rankingWithMovement(awards, SQUAD, CONFIG, SNAPSHOT)

    expect(rows.map((row) => row.entryId)).toEqual(expectedOrder)
    expect(rows.map((row) => row.position)).toEqual(expectedOrder.map((_, index) => index + 1))
  })

  it('treats "no previous data" (null) and "did not move" (0) as different values', () => {
    const oneMatchday = new Map([[1, [award('p1', 10)]]])
    const [nullRow] = rankingWithMovement(oneMatchday, SQUAD, CONFIG, SNAPSHOT)
    expect(nullRow?.entryId).toBe('p1')
    expect(nullRow?.movement).toBe(null)

    const twoMatchdaysSameOrder = new Map([
      [1, [award('p1', 10)]],
      [2, [award('p1', 1)]],
    ])
    const [unchangedRow] = rankingWithMovement(twoMatchdaysSameOrder, SQUAD, CONFIG, SNAPSHOT)
    expect(unchangedRow?.entryId).toBe('p1')
    expect(unchangedRow?.movement).toBe(0)
  })

  it('gives movement null for everyone when no matchday has been closed yet', () => {
    const rows = rankingWithMovement(new Map(), SQUAD, CONFIG, SNAPSHOT)
    expect(rows.every((row) => row.movement === null)).toBe(true)
  })

  it('gives movement null for a player even though they scored, when this is the only matchday on record', () => {
    const awards = new Map([[1, [award('p1', 10)]]])
    const rows = rankingWithMovement(awards, SQUAD, CONFIG, SNAPSHOT)
    expect(rows.find((row) => row.entryId === 'p1')?.movement).toBe(null)
  })

  it('gives a movement of 2 to a player who climbed two positions', () => {
    const awards = new Map([
      [1, [award('p1', 10), award('p2', 6), award('p3', 3), award('p4', 1)]],
      [2, [award('p4', 7)]],
    ])
    const rows = rankingWithMovement(awards, SQUAD, CONFIG, SNAPSHOT)
    expect(rows.find((row) => row.entryId === 'p4')?.movement).toBe(2)
  })

  it('gives a movement of -1 to a player who dropped one position', () => {
    const awards = new Map([
      [1, [award('p1', 10), award('p2', 6), award('p3', 3), award('p4', 1)]],
      [2, [award('p4', 7)]],
    ])
    const rows = rankingWithMovement(awards, SQUAD, CONFIG, SNAPSHOT)
    expect(rows.find((row) => row.entryId === 'p2')?.movement).toBe(-1)
  })

  it('reorders positions when the countBestOf cap swaps in a better result, even though the affected player added nothing new', () => {
    const config: SeasonConfig = { ...CONFIG, countBestOf: 1 }
    const awards = new Map([
      [1, [award('p1', 10), award('p2', 6)]],
      [2, [award('p1', 1), award('p2', 20)]],
    ])

    const rows = rankingWithMovement(awards, ['p1', 'p2'], config, ['p1', 'p2'])
    const p1 = rows.find((row) => row.entryId === 'p1')
    const p2 = rows.find((row) => row.entryId === 'p2')

    expect(p1?.points).toBe(10) // unchanged: the new 1-point award was discarded
    expect(p1?.movement).toBe(-1) // dropped a spot anyway, on p2's discard swap
    expect(p2?.movement).toBe(1)
  })
})
