import { describe, it, expect } from 'vitest'
import { allMatchings } from './matchings'
import { members, pair } from './side'

describe('allMatchings', () => {
  it('returns a single empty matching for an empty pool', () => {
    expect(allMatchings([])).toEqual([[]])
  })

  it('returns the only matching for a pool of two', () => {
    expect(allMatchings(['a', 'b'])).toEqual([[pair('a', 'b')]])
  })

  it('returns three matchings for a pool of four', () => {
    expect(allMatchings(['a', 'b', 'c', 'd'])).toHaveLength(3)
  })

  // (n-1)!! — the double factorial of the pool size minus one
  it.each([
    [4, 3],
    [6, 15],
    [8, 105],
    [10, 945],
    [12, 10395],
  ])('returns the double factorial count for a pool of %i', (size, expected) => {
    const pool = Array.from({ length: size }, (_, i) => `p${i}`)
    expect(allMatchings(pool)).toHaveLength(expected)
  })

  it('uses every player exactly once in each matching', () => {
    const pool = ['a', 'b', 'c', 'd', 'e', 'f']
    for (const matching of allMatchings(pool)) {
      const used = matching.flatMap((side) => members(side))
      expect(used.sort()).toEqual([...pool].sort())
    }
  })

  it('never produces the same matching twice', () => {
    const pool = ['a', 'b', 'c', 'd', 'e', 'f']
    const keys = allMatchings(pool).map((matching) =>
      matching
        .map((side) => [...members(side)].sort().join('-'))
        .sort()
        .join('|'),
    )
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('throws on an odd pool, which cannot be paired', () => {
    expect(() => allMatchings(['a', 'b', 'c'])).toThrow(/par/)
  })

  it('throws on a pool larger than MAX_PLAYERS instead of hanging', () => {
    const pool = Array.from({ length: 14 }, (_, i) => `p${i}`)
    expect(() => allMatchings(pool)).toThrow()
  })
})
