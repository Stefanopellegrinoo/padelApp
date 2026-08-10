import { describe, it, expect } from 'vitest'
import { buildFixture } from './fixture'

function allMatches(fixture: Array<Array<[number, number]>>): Array<[number, number]> {
  return fixture.flat()
}

describe('buildFixture', () => {
  it('builds six matches in three rounds for four pairs', () => {
    const fixture = buildFixture(4)
    expect(fixture).toHaveLength(3)
    expect(allMatches(fixture)).toHaveLength(6)
    for (const round of fixture) expect(round).toHaveLength(2)
  })

  it('builds ten matches in five rounds for five pairs, one idle each round', () => {
    const fixture = buildFixture(5)
    expect(fixture).toHaveLength(5)
    expect(allMatches(fixture)).toHaveLength(10)
    for (const round of fixture) expect(round).toHaveLength(2)
  })

  it('builds fifteen matches in five rounds for six pairs', () => {
    const fixture = buildFixture(6)
    expect(fixture).toHaveLength(5)
    expect(allMatches(fixture)).toHaveLength(15)
    for (const round of fixture) expect(round).toHaveLength(3)
  })

  it.each([4, 5, 6])('has every pair meet every other exactly once with %i pairs', (count) => {
    const seen = new Set<string>()
    for (const [left, right] of allMatches(buildFixture(count))) {
      const key = [left, right].sort((a, b) => a - b).join('-')
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
    expect(seen.size).toBe((count * (count - 1)) / 2)
  })

  it.each([4, 5, 6])('never schedules a pair twice in one round with %i pairs', (count) => {
    for (const round of buildFixture(count)) {
      const playing = round.flat()
      expect(new Set(playing).size).toBe(playing.length)
    }
  })

  it.each([4, 5, 6])('gives every pair the same number of matches with %i pairs', (count) => {
    const played = new Map<number, number>()
    for (const [left, right] of allMatches(buildFixture(count))) {
      played.set(left, (played.get(left) ?? 0) + 1)
      played.set(right, (played.get(right) ?? 0) + 1)
    }
    expect([...played.values()]).toEqual(Array.from({ length: count }, () => count - 1))
  })

  it('only ever uses valid pair indices', () => {
    for (const [left, right] of allMatches(buildFixture(6))) {
      expect(left).toBeGreaterThanOrEqual(0)
      expect(right).toBeGreaterThanOrEqual(0)
      expect(left).toBeLessThan(6)
      expect(right).toBeLessThan(6)
    }
  })

  it('gives the same fixture for the same input', () => {
    expect(buildFixture(6)).toEqual(buildFixture(6))
  })

  it('throws below two pairs, where there is nothing to play', () => {
    expect(() => buildFixture(1)).toThrow(/2 parejas/)
  })
})
