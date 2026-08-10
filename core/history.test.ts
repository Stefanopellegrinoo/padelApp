import { describe, it, expect } from 'vitest'
import { previousContext, type MatchdayHistory } from './history'
import type { Award, Pair } from './types'

function history(pairs: Pair[], champion: Pair | null): MatchdayHistory {
  const awards: Award[] = []
  pairs.forEach((pair, index) => {
    const position = champion !== null && pair === champion ? 1 : index + 2
    for (const entryId of [pair.a, pair.b]) {
      if (entryId.startsWith('g')) continue // guests don't collect points
      awards.push({ entryId, position, points: 10 - position })
    }
  })
  return { pairs, awards }
}

const A: Pair = { a: 'p1', b: 'p2' }
const B: Pair = { a: 'p3', b: 'p4' }
const C: Pair = { a: 'p5', b: 'p6' }

describe('previousContext', () => {
  it('has nothing to inherit on the first matchday', () => {
    expect(previousContext(null, null)).toEqual({
      defenders: null,
      defendersAlreadyRepeated: false,
      previousPairs: [],
    })
  })

  it('the defenders are the pair that collected position 1', () => {
    const context = previousContext(history([A, B, C], B), null)
    expect(context.defenders).toEqual(B)
    expect(context.defendersAlreadyRepeated).toBe(false)
  })

  it('returns every pair from the previous matchday', () => {
    expect(previousContext(history([A, B, C], A), null).previousPairs).toEqual([A, B, C])
  })

  it('marks them as already repeated if they were also together two matchdays ago', () => {
    const context = previousContext(history([A, B, C], A), history([A, B, C], A))
    expect(context.defendersAlreadyRepeated).toBe(true)
  })

  it('does not care about the order of the two players', () => {
    const flipped: Pair = { a: 'p2', b: 'p1' }
    const context = previousContext(history([A, B], A), history([flipped, C], flipped))
    expect(context.defendersAlreadyRepeated).toBe(true)
  })

  it('is not already repeated when the pair before last is a different one', () => {
    const context = previousContext(history([A, B, C], A), history([B, C], null))
    expect(context.defendersAlreadyRepeated).toBe(false)
  })

  it('never returns a guest-only pair, even when it topped the table', () => {
    const guests: Pair = { a: 'g1', b: 'g2' }
    const context = previousContext(history([guests, A, B], A), null)
    expect(context.defenders).toEqual(A)
  })

  it('finds a mixed champion pair by its tournament teammate', () => {
    const mixed: Pair = { a: 'p1', b: 'g1' }
    const context = previousContext(history([mixed, B], mixed), null)
    expect(context.defenders).toEqual(mixed)
  })

  it('has no defenders if the previous matchday never closed', () => {
    const context = previousContext({ pairs: [A, B], awards: [] }, null)
    expect(context.defenders).toBeNull()
    expect(context.previousPairs).toEqual([A, B])
  })

  it('fails if two pairs claim position 1', () => {
    const broken: MatchdayHistory = {
      pairs: [A, B],
      awards: [
        { entryId: 'p1', position: 1, points: 10 },
        { entryId: 'p3', position: 1, points: 10 },
      ],
    }
    expect(() => previousContext(broken, null)).toThrow(/2 parejas en la posición 1/)
  })

  it('fails if the winner is not in any pair', () => {
    const broken: MatchdayHistory = {
      pairs: [A],
      awards: [{ entryId: 'p9', position: 1, points: 10 }],
    }
    expect(() => previousContext(broken, null)).toThrow(/0 parejas en la posición 1/)
  })

  it('fails when the awards exist but none is in position 1', () => {
    const broken: MatchdayHistory = {
      pairs: [A, B],
      awards: [{ entryId: 'p1', position: 2, points: 8 }],
    }
    expect(() => previousContext(broken, null)).toThrow(/awards pero ninguno en la posición 1/)
  })
})
