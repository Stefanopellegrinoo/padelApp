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
      // p1's award lands on matchday 3, the cut matchday itself. p4 leads on
      // matchdays 1-2 alone (20 to 0), so if the cut filter excluded
      // matchday 3 (`<` instead of `<=`), this would still read p4 first —
      // only including it flips the leader to p1 (50 to 30).
      [3, [award('p4', 10), award('p1', 50)]],
    ])
    expect(snapshotForMatchday(4, SEED, awards, CONFIG)[0]).toBe('p1')
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

  it('is deterministic: the same arguments produce the same snapshot on a second call', () => {
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

  // Pinning test for spec 2.2/2.3 (Capability 2, "Ubicar al que llega en el
  // orden de desempate"). This is a SANCTIONED exception to the RED-first
  // rule: it pins a property `snapshotForMatchday` already has, with zero
  // production code changed. It still earns its place — it fails the day
  // somebody changes how the snapshot derives from the seed order.
  //
  // The claim is spec 2.3's corollary of 2.2: inserting a new seat mid-season
  // must not flip any tiebreak comparison between two players who both
  // already existed. This holds for free here because `orderByPoints`
  // compares `snapshot.indexOf(id)` — a RELATIVE position — and inserting one
  // id into an array without disturbing the others' relative order is exactly
  // what `add_squad_seat`'s shift does (proven separately, at the SQL layer,
  // by `db/entries.db.test.ts`). No live matchday data needed: two seed
  // orders differing only by one inserted id are enough.
  it('an inserted seat never flips the relative order of any two players who existed before it (spec 2.2/2.3)', () => {
    const before = ['p1', 'p2', 'p3', 'p4', 'p5']
    const after = ['p1', 'p2', 'NEW', 'p3', 'p4', 'p5'] // NEW inserted at index 2

    const awards = new Map([
      [1, [award('p4', 10), award('p2', 6)]],
      [2, [award('p1', 10)]],
      [3, [award('p3', 10), award('p5', 3)]],
    ])

    const beforeSnapshot = snapshotForMatchday(5, before, awards, CONFIG)
    const afterSnapshot = snapshotForMatchday(5, after, awards, CONFIG)

    // Every pairwise comparison among the ids that existed before the insert
    // is unchanged: whichever ranked above the other still does.
    for (const left of before) {
      for (const right of before) {
        if (left === right) continue
        const wasAbove = beforeSnapshot.indexOf(left) < beforeSnapshot.indexOf(right)
        const stillAbove = afterSnapshot.indexOf(left) < afterSnapshot.indexOf(right)
        expect(stillAbove).toBe(wasAbove)
      }
    }
  })
})
