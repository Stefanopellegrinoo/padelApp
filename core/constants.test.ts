import { describe, it, expect } from 'vitest'
import { MIN_PLAYERS, MAX_PLAYERS, MASTERS_SIZE } from './constants'

describe('constants', () => {
  it('defines the matchday size limits from the format', () => {
    expect(MIN_PLAYERS).toBe(8)
    expect(MAX_PLAYERS).toBe(12)
  })

  it('defines the masters size as four', () => {
    expect(MASTERS_SIZE).toBe(4)
  })
})
