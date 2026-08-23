import { describe, it, expect } from 'vitest'
import { snapshotForMatchday } from './snapshots'
import type { Award, SeasonConfig } from './types'

const SEED = ['p1', 'p2', 'p3', 'p4']

const CONFIG: SeasonConfig = {
  squadSize: 8,
  matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true, openScore: false },
  points: [10, 6, 3, 1],
  regularMatchdays: 10,
  countBestOf: 10,
  tiebreakSnapshotEvery: 3,
}

function award(entryId: string, points: number): Award {
  return { entryId, position: 1, points, lines: [] }
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
  // production code changed.
  //
  // The claim is spec 2.3's corollary of 2.2: inserting a new seat mid-season
  // must not flip any tiebreak comparison between two players who both
  // already existed. It holds because `orderByPoints` breaks ties on
  // `snapshot.indexOf(id)` — a RELATIVE position — and inserting one id into
  // the seed shifts everyone after it by the same +1 (the SQL side of that
  // shift is proven separately in `db/entries.db.test.ts`).
  //
  // Both snapshots are asserted against HAND-COMPUTED literals, never against
  // each other. An earlier version of this test compared `beforeSnapshot` and
  // `afterSnapshot` pairwise, which was a tautology: both sides came out of
  // the same function, so any transformation applied to both — deleting the
  // refresh loop entirely, or returning the snapshot reversed — kept the
  // assertion green. Fixed literals kill both mutants.
  it('an inserted seat never flips the relative order of any two players who existed before it (spec 2.2/2.3)', () => {
    const before = ['p1', 'p2', 'p3', 'p4', 'p5']
    const after = ['p1', 'p2', 'NEW', 'p3', 'p4', 'p5'] // NEW inserted at index 2

    const awards = new Map([
      [1, [award('p4', 10), award('p2', 6)]],
      [2, [award('p1', 10)]],
      [3, [award('p3', 10), award('p5', 3)]],
    ])

    // Matchday 5 with tiebreakSnapshotEvery 3 refreshes once, over matchdays
    // 1-3. Totals: p1 10, p3 10, p4 10, p2 6, p5 3. The three tied on 10 are
    // cut by their seed index — p1 (0), p3 (2), p4 (3) — so the table reads
    // p1, p3, p4, p2, p5, which is NOT the seed order: a snapshot that ignored
    // the awards, or one that ignored the seed, misses this.
    const EXPECTED_BEFORE = ['p1', 'p3', 'p4', 'p2', 'p5']
    // Same awards, NEW inserted at seed index 2. NEW scored nothing, so it
    // lands last; p3, p4 and p5 each move one seed slot down, all by the same
    // amount, so no tie among the old five is cut differently.
    const EXPECTED_AFTER = ['p1', 'p3', 'p4', 'p2', 'p5', 'NEW']

    expect(snapshotForMatchday(5, before, awards, CONFIG)).toEqual(EXPECTED_BEFORE)
    expect(snapshotForMatchday(5, after, awards, CONFIG)).toEqual(EXPECTED_AFTER)
    // What makes those two literals a statement of spec 2.3 and not just two
    // frozen outputs: drop the newcomer from the second and it IS the first.
    expect(EXPECTED_AFTER.filter((id) => id !== 'NEW')).toEqual(EXPECTED_BEFORE)
  })
})
