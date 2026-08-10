import { describe, it, expect } from 'vitest'
import { buildPairs, samePair, type PairingInput } from './pairing'
import type { Pair } from './types'

const SNAPSHOT = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p11', 'p12']

function input(overrides: Partial<PairingInput> = {}): PairingInput {
  return {
    present: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'],
    points: new Map(SNAPSHOT.map((id, i) => [id, 100 - i])),
    snapshot: SNAPSHOT,
    defenders: null,
    defendersAlreadyRepeated: false,
    previousPairs: [],
    guestId: null,
    ...overrides,
  }
}

function key(pair: Pair): string {
  return [pair.a, pair.b].sort().join('-')
}

function keys(pairs: Pair[]): string[] {
  return pairs.map(key).sort()
}

describe('samePair', () => {
  it('ignores the order of the two players', () => {
    expect(samePair({ a: 'x', b: 'y' }, { a: 'y', b: 'x' })).toBe(true)
  })

  it('is false for different players', () => {
    expect(samePair({ a: 'x', b: 'y' }, { a: 'x', b: 'z' })).toBe(false)
  })
})

describe('buildPairs — the balanced default', () => {
  it('pairs first with last when nothing constrains it', () => {
    const pairs = buildPairs(input())
    expect(keys(pairs)).toEqual(['p1-p8', 'p2-p7', 'p3-p6', 'p4-p5'])
  })

  it('returns half as many pairs as players', () => {
    expect(buildPairs(input())).toHaveLength(4)
    expect(buildPairs(input({ present: SNAPSHOT.slice(0, 12) }))).toHaveLength(6)
    expect(buildPairs(input({ present: SNAPSHOT.slice(0, 10) }))).toHaveLength(5)
  })

  it('uses every present player exactly once', () => {
    const present = SNAPSHOT.slice(0, 12)
    const used = buildPairs(input({ present })).flatMap((pair) => [pair.a, pair.b])
    expect(used.sort()).toEqual([...present].sort())
  })

  it('gives the same result for the same input', () => {
    expect(keys(buildPairs(input()))).toEqual(keys(buildPairs(input())))
  })

  it('does not depend on the order the present players arrive in', () => {
    const straight = buildPairs(input())
    const shuffled = buildPairs(input({ present: ['p5', 'p1', 'p8', 'p3', 'p7', 'p2', 'p6', 'p4'] }))
    expect(keys(shuffled)).toEqual(keys(straight))
  })
})

describe('buildPairs — the defending champions', () => {
  const defenders: Pair = { a: 'p3', b: 'p4' }

  it('keeps the defenders together and out of the pool', () => {
    const pairs = buildPairs(input({ defenders }))
    expect(keys(pairs)).toContain('p3-p4')
    expect(pairs).toHaveLength(4)
  })

  it('dissolves them when one of the two is missing', () => {
    const pairs = buildPairs(
      input({ defenders, present: ['p1', 'p2', 'p3', 'p5', 'p6', 'p7', 'p8', 'p9'] }),
    )
    expect(keys(pairs)).not.toContain('p3-p4')
  })

  it('dissolves them when they already repeated once', () => {
    const pairs = buildPairs(input({ defenders, defendersAlreadyRepeated: true }))
    expect(keys(pairs)).not.toContain('p3-p4')
  })

  it('builds every pair from scratch when there are no defenders', () => {
    const pairs = buildPairs(input({ defenders: null }))
    expect(pairs).toHaveLength(4)
  })
})

describe('buildPairs — no repeating last matchday', () => {
  it('never repeats a pair from the previous matchday', () => {
    const previousPairs: Pair[] = [
      { a: 'p1', b: 'p8' },
      { a: 'p2', b: 'p7' },
      { a: 'p3', b: 'p6' },
      { a: 'p4', b: 'p5' },
    ]
    const pairs = buildPairs(input({ previousPairs }))
    for (const built of pairs) {
      expect(previousPairs.some((old) => samePair(old, built))).toBe(false)
    }
  })

  it('falls back to the next most balanced when the ideal one repeats', () => {
    const previousPairs: Pair[] = [{ a: 'p1', b: 'p8' }]
    const pairs = buildPairs(input({ previousPairs }))
    expect(keys(pairs)).not.toContain('p1-p8')
    expect(pairs).toHaveLength(4)
  })

  it('still finds a legal set when the table is identical to last matchday', () => {
    const previousPairs: Pair[] = [
      { a: 'p1', b: 'p8' },
      { a: 'p2', b: 'p7' },
      { a: 'p3', b: 'p6' },
      { a: 'p4', b: 'p5' },
    ]
    const pairs = buildPairs(input({ previousPairs, points: new Map() }))
    expect(pairs).toHaveLength(4)
  })

  it('ignores a previous pair whose players are not both present', () => {
    const previousPairs: Pair[] = [{ a: 'p1', b: 'p99' }]
    expect(() => buildPairs(input({ previousPairs }))).not.toThrow()
  })

  it('never runs out of legal options for any allowed size', () => {
    for (const size of [8, 10, 12]) {
      const present = SNAPSHOT.slice(0, size)
      const previousPairs = buildPairs(input({ present }))
      const next = buildPairs(input({ present, previousPairs }))
      expect(next).toHaveLength(size / 2)
      for (const built of next) {
        expect(previousPairs.some((old) => samePair(old, built))).toBe(false)
      }
    }
  })
})

describe('buildPairs — the guest', () => {
  it('places the guest last in the order, so they get the table leader', () => {
    const present = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'guest']
    const points = new Map(present.map((id, i) => [id, 100 - i]))
    points.set('guest', 999) // points must not lift the guest out of last place
    const pairs = buildPairs(input({ present, points, guestId: 'guest' }))
    expect(keys(pairs)).toContain('guest-p1')
  })

  it('pairs the guest normally when they are not flagged as one', () => {
    const present = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']
    expect(buildPairs(input({ present, guestId: null }))).toHaveLength(4)
  })
})

describe('buildPairs — refusing the impossible', () => {
  it('throws on an odd number of present players', () => {
    expect(() => buildPairs(input({ present: ['p1', 'p2', 'p3'] }))).toThrow(/par/)
  })

  it('throws loudly rather than returning nothing', () => {
    expect(() => buildPairs(input({ present: [] }))).toThrow()
  })
})
