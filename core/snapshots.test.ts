import { describe, it, expect } from 'vitest'
import { snapshotForMatchday } from './snapshots'
import type { Award, SeasonConfig } from './types'

const SEED = ['p1', 'p2', 'p3', 'p4']

const CONFIG: SeasonConfig = {
  squadSize: 8,
  matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true },
  points: [10, 6, 3, 1],
  regularMatchdays: 10,
  countBestOf: 10,
  mastersSize: 4,
  tiebreakSnapshotEvery: 3,
}

function award(entryId: string, points: number): Award {
  return { entryId, position: 1, points }
}

describe('snapshotForMatchday', () => {
  it('uses the seed order for the first k matchdays', () => {
    const awards = new Map([[1, [award('p4', 10)]]])
    for (const matchday of [1, 2, 3]) {
      const result = snapshotForMatchday(matchday, SEED, awards, CONFIG)
      expect(result).toEqual(SEED)
      expect(result).not.toBe(SEED)
    }
  })

  it('refreshes from the table at the close of matchday k', () => {
    const awards = new Map([
      [1, [award('p4', 10)]],
      [2, [award('p4', 10)]],
      [3, [award('p4', 10)]],
    ])
    expect(snapshotForMatchday(4, SEED, awards, CONFIG)[0]).toBe('p4')
  })

  it('keeps the same snapshot across a whole block of k matchdays', () => {
    const awards = new Map([[1, [award('p4', 10)]], [2, [award('p4', 10)]], [3, [award('p4', 10)]]])
    const fourth = snapshotForMatchday(4, SEED, awards, CONFIG)
    expect(snapshotForMatchday(5, SEED, awards, CONFIG)).toEqual(fourth)
    expect(snapshotForMatchday(6, SEED, awards, CONFIG)).toEqual(fourth)
  })

  it('only counts matchdays up to the cut, ignoring later ones', () => {
    const awards = new Map([
      [1, [award('p4', 10)]],
      [2, [award('p4', 10)]],
      [3, [award('p4', 10)]],
      [4, [award('p1', 10)]],
      [5, [award('p1', 10)]],
    ])
    // The snapshot for matchday 5 is the table at the close of matchday 3.
    expect(snapshotForMatchday(5, SEED, awards, CONFIG)[0]).toBe('p4')
  })

  it('always returns a total order: no player appears twice', () => {
    const awards = new Map([[1, [award('p1', 10), award('p2', 10), award('p3', 10), award('p4', 10)]]])
    const snapshot = snapshotForMatchday(4, SEED, awards, CONFIG)
    expect(new Set(snapshot).size).toBe(SEED.length)
  })

  it('orders a pair that always ties, because the previous snapshot already did', () => {
    // p3 and p4 win everything together: identical points, every single matchday.
    const awards = new Map([
      [1, [award('p3', 10), award('p4', 10)]],
      [2, [award('p3', 10), award('p4', 10)]],
      [3, [award('p3', 10), award('p4', 10)]],
    ])
    const snapshot = snapshotForMatchday(4, SEED, awards, CONFIG)
    expect(snapshot.indexOf('p3')).toBeLessThan(snapshot.indexOf('p4'))
  })

  it('includes every squad member', () => {
    const snapshot = snapshotForMatchday(7, SEED, new Map(), CONFIG)
    expect([...snapshot].sort()).toEqual([...SEED].sort())
  })

  it('reproduces the same snapshot when an old matchday is recalculated', () => {
    const awards = new Map([[1, [award('p4', 10)]], [2, [award('p4', 10)]], [3, [award('p4', 10)]]])
    const first = snapshotForMatchday(4, SEED, awards, CONFIG)
    const again = snapshotForMatchday(4, SEED, awards, CONFIG)
    expect(again).toEqual(first)
  })

  it('follows the chain across several refreshes', () => {
    const awards = new Map([
      [1, [award('p4', 10)]], [2, [award('p4', 10)]], [3, [award('p4', 10)]],
      [4, [award('p3', 10)]], [5, [award('p3', 10)]], [6, [award('p3', 10)]],
    ])
    expect(snapshotForMatchday(7, SEED, awards, CONFIG)[0]).toBe('p4') // 30 vs 30 — snapshot(1) cuts, and it cuts the opposite way from the seed
    expect(snapshotForMatchday(7, SEED, awards, CONFIG)).toEqual(['p4', 'p3', 'p1', 'p2'])
  })

  it('handles a refresh interval of one', () => {
    const everyMatchday = { ...CONFIG, tiebreakSnapshotEvery: 1 }
    const awards = new Map([[1, [award('p4', 10)]]])
    expect(snapshotForMatchday(2, SEED, awards, everyMatchday)[0]).toBe('p4')
  })

  it('applies best-N inside a snapshot link, not the raw total', () => {
    const bestOfTwo = { ...CONFIG, countBestOf: 2 }
    const awards = new Map([
      [1, [award('p4', 10), award('p3', 17)]],
      [2, [award('p4', 6)]],
      [3, [award('p4', 2)]],
    ])
    // p4's best two of [10, 6, 2] total 16; p3's single award is 17, so p3 leads.
    // If countBestOf were ignored, p4's raw total (18) would lead instead.
    expect(snapshotForMatchday(4, SEED, awards, bestOfTwo)[0]).toBe('p3')
  })
})
