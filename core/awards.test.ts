import { describe, it, expect } from 'vitest'
import { computeAwards } from './awards'
import type { PairStanding, SeasonConfig } from './types'

const CONFIG: SeasonConfig = {
  squadSize: 12,
  matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true },
  points: [10, 7, 5, 3, 2, 1],
  regularMatchdays: 10,
  countBestOf: 8,
  tiebreakSnapshotEvery: 3,
}

function standing(a: string, b: string, position: number): PairStanding {
  return { pair: { a, b }, played: 3, won: 0, setsDiff: 0, gamesDiff: 0, position }
}

describe('computeAwards', () => {
  it('gives both members of a pair exactly the same points', () => {
    const awards = computeAwards([standing('a1', 'a2', 1)], CONFIG, null)
    expect(awards).toHaveLength(2)
    expect(awards[0]?.points).toBe(10)
    expect(awards[1]?.points).toBe(10)
  })

  it('uses the leading values of the list for a four pair matchday', () => {
    const standings = [
      standing('a1', 'a2', 1),
      standing('b1', 'b2', 2),
      standing('c1', 'c2', 3),
      standing('d1', 'd2', 4),
    ]
    const byEntry = new Map(computeAwards(standings, CONFIG, null).map((a) => [a.entryId, a.points]))
    expect(byEntry.get('a1')).toBe(10)
    expect(byEntry.get('b1')).toBe(7)
    expect(byEntry.get('c1')).toBe(5)
    expect(byEntry.get('d1')).toBe(3)
  })

  it('uses the whole list for a six pair matchday', () => {
    const standings = [
      standing('a1', 'a2', 1),
      standing('b1', 'b2', 2),
      standing('c1', 'c2', 3),
      standing('d1', 'd2', 4),
      standing('e1', 'e2', 5),
      standing('f1', 'f2', 6),
    ]
    const byEntry = new Map(computeAwards(standings, CONFIG, null).map((a) => [a.entryId, a.points]))
    expect(byEntry.get('a1')).toBe(10)
    expect(byEntry.get('f1')).toBe(1)
  })

  it('pays ten for the win regardless of how many pairs played', () => {
    const four = computeAwards([standing('a1', 'a2', 1)], CONFIG, null)
    const six = computeAwards(
      [standing('a1', 'a2', 1), standing('b1', 'b2', 2)],
      CONFIG,
      null,
    )
    expect(four[0]?.points).toBe(10)
    expect(six[0]?.points).toBe(10)
  })

  it('never awards zero, so turning up always beats staying home', () => {
    const standings = Array.from({ length: 6 }, (_, i) => standing(`p${i}a`, `p${i}b`, i + 1))
    for (const award of computeAwards(standings, CONFIG, null)) {
      expect(award.points).toBeGreaterThan(0)
    }
  })

  it('skips the guest, who is not in the championship', () => {
    const awards = computeAwards([standing('a1', 'guest', 1)], CONFIG, 'guest')
    expect(awards).toHaveLength(1)
    expect(awards[0]?.entryId).toBe('a1')
  })

  it('still pays the guest partner in full', () => {
    const awards = computeAwards([standing('a1', 'guest', 1)], CONFIG, 'guest')
    expect(awards[0]?.points).toBe(10)
  })

  it('records the position alongside the points', () => {
    const awards = computeAwards([standing('a1', 'a2', 3)], CONFIG, null)
    expect(awards[0]?.position).toBe(3)
  })

  it('throws when the standings are longer than the points list', () => {
    const tooMany = Array.from({ length: 7 }, (_, i) => standing(`p${i}a`, `p${i}b`, i + 1))
    expect(() => computeAwards(tooMany, CONFIG, null)).toThrow(/puntos/)
  })
})
