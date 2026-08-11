import { describe, it, expect } from 'vitest'
import { titleStreaks } from './streak'
import type { Award } from './types'

function champion(entryId: string): Award[] {
  return [{ entryId, position: 1, points: 10 }]
}

describe('titleStreaks', () => {
  it('counts three matchdays won in a row', () => {
    const awards = new Map([
      [1, champion('p1')],
      [2, champion('p1')],
      [3, champion('p1')],
    ])
    const [streak] = titleStreaks(awards, ['p1'])
    expect(streak).toEqual({ entryId: 'p1', longest: 3, current: 3 })
  })

  it('keeps the longest run even after the current one breaks', () => {
    const awards = new Map([
      [1, champion('p1')],
      [2, champion('p1')],
      [3, champion('p2')],
      [4, champion('p1')],
    ])
    const [streak] = titleStreaks(awards, ['p1'])
    expect(streak).toEqual({ entryId: 'p1', longest: 2, current: 1 })
  })

  it('is zero for a player who never won', () => {
    const awards = new Map([[1, champion('p2')]])
    const [streak] = titleStreaks(awards, ['p1'])
    expect(streak).toEqual({ entryId: 'p1', longest: 0, current: 0 })
  })

  it('breaks the run at a matchday the player did not win in the middle of it', () => {
    const awards = new Map([
      [1, champion('p1')],
      [2, champion('p2')],
      [3, champion('p1')],
    ])
    const [streak] = titleStreaks(awards, ['p1'])
    expect(streak).toEqual({ entryId: 'p1', longest: 1, current: 1 })
  })

  it('does not depend on the insertion order of the matchday map', () => {
    const ordered = new Map([
      [1, champion('p1')],
      [2, champion('p1')],
      [3, champion('p1')],
    ])
    const shuffled = new Map([
      [3, champion('p1')],
      [1, champion('p1')],
      [2, champion('p1')],
    ])
    expect(titleStreaks(shuffled, ['p1'])).toEqual(titleStreaks(ordered, ['p1']))
  })

  it('includes a squad member who never appears in any award, at zero', () => {
    const awards = new Map([[1, champion('p2')]])
    const streaks = titleStreaks(awards, ['p1', 'p2'])
    expect(streaks).toContainEqual({ entryId: 'p1', longest: 0, current: 0 })
  })

  it('does not break the run across gaps in matchday numbering', () => {
    const awards = new Map([
      [1, champion('p1')],
      [2, champion('p1')],
      [5, champion('p1')],
    ])
    const [streak] = titleStreaks(awards, ['p1'])
    expect(streak).toEqual({ entryId: 'p1', longest: 3, current: 3 })
  })
})
