import { describe, it, expect } from 'vitest'
import { computeRanking } from './ranking'
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
  return { entryId, position: 1, points, lines: [] }
}

describe('computeRanking', () => {
  it('adds up every award when there are fewer matchdays than countBestOf', () => {
    const awards = new Map([
      [1, [award('p1', 10)]],
      [2, [award('p1', 6)]],
    ])
    const rows = computeRanking(awards, SQUAD, CONFIG, SNAPSHOT)
    expect(rows.find((row) => row.entryId === 'p1')?.points).toBe(16)
  })

  it('keeps only the best countBestOf results', () => {
    const awards = new Map([
      [1, [award('p1', 10)]],
      [2, [award('p1', 1)]],
      [3, [award('p1', 6)]],
      [4, [award('p1', 3)]],
    ])
    const row = computeRanking(awards, SQUAD, CONFIG, SNAPSHOT).find((r) => r.entryId === 'p1')
    expect(row?.points).toBe(19) // 10 + 6 + 3, dropping the 1
    expect(row?.counted).toEqual([10, 6, 3])
    expect(row?.discarded).toEqual([1])
  })

  it('gives a player with no awards zero points', () => {
    const rows = computeRanking(new Map(), SQUAD, CONFIG, SNAPSHOT)
    expect(rows.every((row) => row.points === 0)).toBe(true)
    expect(rows).toHaveLength(4)
  })

  it('includes every squad member even if they never played', () => {
    const awards = new Map([[1, [award('p1', 10)]]])
    const rows = computeRanking(awards, SQUAD, CONFIG, SNAPSHOT)
    expect(rows.map((row) => row.entryId).sort()).toEqual([...SQUAD].sort())
  })

  it('ignores awards from anyone outside the squad, like a guest', () => {
    const awards = new Map([[1, [award('p1', 10), award('guest', 10)]]])
    const rows = computeRanking(awards, SQUAD, CONFIG, SNAPSHOT)
    expect(rows.map((row) => row.entryId)).not.toContain('guest')
  })

  it('sorts by points, highest first', () => {
    const awards = new Map([
      [1, [award('p1', 1), award('p2', 10), award('p3', 6)]],
    ])
    const rows = computeRanking(awards, SQUAD, CONFIG, SNAPSHOT)
    expect(rows.map((row) => row.entryId)).toEqual(['p2', 'p3', 'p1', 'p4'])
  })

  it('breaks ties with the snapshot', () => {
    const awards = new Map([[1, [award('p3', 10), award('p2', 10)]]])
    const rows = computeRanking(awards, SQUAD, CONFIG, SNAPSHOT)
    expect(rows[0]?.entryId).toBe('p2')
    expect(rows[1]?.entryId).toBe('p3')
  })

  it('sums two awards from the same matchday, which should not happen but must not silently drop one', () => {
    const awards = new Map([[1, [award('p1', 10), award('p1', 6)]]])
    const row = computeRanking(awards, SQUAD, CONFIG, SNAPSHOT).find((r) => r.entryId === 'p1')
    expect(row?.counted.length).toBe(2)
  })

  it('is deterministic', () => {
    const awards = new Map([[1, [award('p1', 10), award('p2', 10)]]])
    const first = computeRanking(awards, SQUAD, CONFIG, SNAPSHOT)
    const second = computeRanking(awards, SQUAD, CONFIG, SNAPSHOT)
    expect(first).toEqual(second)
  })
})
