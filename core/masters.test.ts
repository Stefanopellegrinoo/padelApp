import { describe, it, expect } from 'vitest'
import { mastersQualifiers, mastersFixture, mastersChampion, type MastersFour } from './masters'
import { members, pair } from './side'
import type { MatchResult, RankingRow, Side } from './types'

function row(entryId: string, points: number): RankingRow {
  return { entryId, points, counted: [points], discarded: [] }
}

const RANKING: RankingRow[] = [row('p1', 50), row('p2', 40), row('p3', 30), row('p4', 20), row('p5', 10)]
const FOUR: MastersFour = ['p1', 'p2', 'p3', 'p4']

function played(sideA: Side, sideB: Side, aWins: boolean): MatchResult {
  return {
    round: 1,
    fase: 'GRUPO',
    grupo: 1,
    sideA,
    sideB,
    sets: [aWins ? { gamesA: 4, gamesB: 1 } : { gamesA: 1, gamesB: 4 }],
  }
}

describe('mastersQualifiers', () => {
  it('takes the top four of the ranking', () => {
    expect(mastersQualifiers(RANKING)).toEqual(['p1', 'p2', 'p3', 'p4'])
  })

  it('throws when fewer than four players finished the season', () => {
    expect(() => mastersQualifiers(RANKING.slice(0, 3))).toThrow(/4/)
  })

  it('trusts the ranking order, which already resolved its own ties', () => {
    const tied = [row('p2', 40), row('p1', 40), row('p3', 30), row('p4', 20)]
    expect(mastersQualifiers(tied)).toEqual(['p2', 'p1', 'p3', 'p4'])
  })
})

describe('mastersFixture', () => {
  it('builds the three rotating matches', () => {
    const fixture = mastersFixture(FOUR)
    expect(fixture).toHaveLength(3)
    expect(fixture[0]).toEqual({ sideA: pair('p1', 'p4'), sideB: pair('p2', 'p3') })
    expect(fixture[1]).toEqual({ sideA: pair('p1', 'p3'), sideB: pair('p2', 'p4') })
    expect(fixture[2]).toEqual({ sideA: pair('p1', 'p2'), sideB: pair('p3', 'p4') })
  })

  it('has everyone partner everyone exactly once', () => {
    const partners = new Map<string, string[]>()
    for (const { sideA, sideB } of mastersFixture(FOUR)) {
      for (const side of [sideA, sideB]) {
        // El Masters es siempre de a dos: `mastersFixture` construye con
        // `pair()`, así que este angostado no puede fallar y el `throw` sólo
        // existe para que el compilador vea la rama.
        if (side.size !== 2) throw new Error('el Masters no arma lados de uno')
        partners.set(side.a, [...(partners.get(side.a) ?? []), side.b])
        partners.set(side.b, [...(partners.get(side.b) ?? []), side.a])
      }
    }
    for (const player of FOUR) {
      const seen = partners.get(player) ?? []
      expect(seen).toHaveLength(3)
      expect(new Set(seen).size).toBe(3)
      expect(seen).not.toContain(player)
    }
  })

  it('gives everyone three matches', () => {
    const played = new Map<string, number>()
    for (const { sideA, sideB } of mastersFixture(FOUR)) {
      for (const id of [...members(sideA), ...members(sideB)]) {
        played.set(id, (played.get(id) ?? 0) + 1)
      }
    }
    expect([...played.values()]).toEqual([3, 3, 3, 3])
  })
})

describe('mastersChampion', () => {
  it('crowns the player who won all three', () => {
    const fixture = mastersFixture(FOUR)
    // p1 is in pairA of every match, so pairA winning three times means p1 wins three.
    const matches = fixture.map((m) => played(m.sideA, m.sideB, true))
    expect(mastersChampion(FOUR, matches)).toBe('p1')
  })

  it('breaks a three-way tie with the annual ranking position', () => {
    const fixture = mastersFixture(FOUR)
    const [first, second, third] = fixture
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('bad test fixture')
    }
    // p4 loses all three, so p1, p2 and p3 all finish on two wins:
    //   match 1  (p1,p4) vs (p2,p3)  →  p2 and p3 win
    //   match 2  (p1,p3) vs (p2,p4)  →  p1 and p3 win
    //   match 3  (p1,p2) vs (p3,p4)  →  p1 and p2 win
    const matches = [
      played(first.sideA, first.sideB, false),
      played(second.sideA, second.sideB, true),
      played(third.sideA, third.sideB, true),
    ]
    // p1 was first in the annual ranking, so the tie goes their way.
    expect(mastersChampion(FOUR, matches)).toBe('p1')
  })

  it('prefers the better ranked player when two finish level', () => {
    const fixture = mastersFixture(FOUR)
    const first = fixture[0]
    if (first === undefined) throw new Error('bad test fixture')
    // Only one match played: p1 and p4 each on one win, everyone else on zero.
    // p1 is ranked first, so p1 takes it.
    const matches = [played(first.sideA, first.sideB, true)]
    expect(mastersChampion(FOUR, matches)).toBe('p1')
  })

  it('falls back to the ranking when nothing has been played', () => {
    expect(mastersChampion(FOUR, [])).toBe('p1')
  })

  it('ignores matches that have not been played', () => {
    const fixture = mastersFixture(FOUR)
    const first = fixture[0]
    if (first === undefined) throw new Error('bad test fixture')
    const matches: MatchResult[] = [
      { round: 1, fase: 'GRUPO', grupo: 1, sideA: first.sideA, sideB: first.sideB, sets: [] },
    ]
    expect(mastersChampion(FOUR, matches)).toBe('p1')
  })

  it('only ever produces a clean sweep or a three-way tie', () => {
    const fixture = mastersFixture(FOUR)
    for (let mask = 0; mask < 8; mask++) {
      const matches = fixture.map((m, i) => played(m.sideA, m.sideB, (mask & (1 << i)) !== 0))
      const wins = new Map<string, number>(FOUR.map((id) => [id, 0]))
      for (const match of matches) {
        const winner = match.sets[0] !== undefined && match.sets[0].gamesA > match.sets[0].gamesB
          ? match.sideA
          : match.sideB
        for (const id of members(winner)) wins.set(id, (wins.get(id) ?? 0) + 1)
      }
      const tally = [...wins.values()].sort((a, b) => b - a)
      // Verified over all eight possible outcomes: a clean sweep or a three-way
      // tie, never anything in between. This is why the head to head cannot cut.
      expect(['3,1,1,1', '2,2,2,0']).toContain(tally.join(','))
    }
  })
})
