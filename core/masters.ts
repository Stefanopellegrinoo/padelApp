import { MASTERS_SIZE } from './constants'
import type { EntryId, MatchResult, Pair, RankingRow } from './types'

export type MastersFour = [EntryId, EntryId, EntryId, EntryId]

/** The top four of the annual ranking, in ranking order. */
export function mastersQualifiers(ranking: RankingRow[]): MastersFour {
  if (ranking.length < MASTERS_SIZE) {
    throw new Error(`Hacen falta ${MASTERS_SIZE} jugadores para el Masters, hay ${ranking.length}.`)
  }
  const [first, second, third, fourth] = ranking
  if (
    first === undefined ||
    second === undefined ||
    third === undefined ||
    fourth === undefined
  ) {
    throw new Error('El ranking no tiene suficientes filas para el Masters.')
  }
  return [first.entryId, second.entryId, third.entryId, fourth.entryId]
}

/**
 * Three matches with rotating partners, so everyone plays once with everyone.
 * This is what separates two players who spent the season winning together and
 * therefore finished on identical points.
 */
export function mastersFixture(four: MastersFour): Array<{ pairA: Pair; pairB: Pair }> {
  const [one, two, three, fourth] = four
  return [
    { pairA: { a: one, b: fourth }, pairB: { a: two, b: three } },
    { pairA: { a: one, b: three }, pairB: { a: two, b: fourth } },
    { pairA: { a: one, b: two }, pairB: { a: three, b: fourth } },
  ]
}

/**
 * The champion of the year.
 *
 * The format only allows two outcomes: someone wins all three, or three players
 * tie on two and one is left on zero. The head to head cannot break that tie —
 * everyone played with and against everyone — so the cut is the annual ranking:
 * finishing higher does not hand you the title, but it settles any tie in your
 * favour, which is what makes the regular season worth something.
 */
export function mastersChampion(four: MastersFour, matches: MatchResult[]): EntryId {
  const wins = new Map<EntryId, number>(four.map((id) => [id, 0]))
  const rank = new Map<EntryId, number>(four.map((id, index) => [id, index]))

  for (const match of matches) {
    if (match.sets.length === 0) continue
    let setsA = 0
    let setsB = 0
    for (const set of match.sets) {
      if (set.gamesA > set.gamesB) setsA++
      else if (set.gamesB > set.gamesA) setsB++
    }
    if (setsA === setsB) continue
    const winner = setsA > setsB ? match.pairA : match.pairB
    for (const id of [winner.a, winner.b]) {
      if (!wins.has(id)) continue
      wins.set(id, (wins.get(id) ?? 0) + 1)
    }
  }

  const OUTSIDE = Number.MAX_SAFE_INTEGER
  const champion = [...four].sort((left, right) => {
    const winDiff = (wins.get(right) ?? 0) - (wins.get(left) ?? 0)
    if (winDiff !== 0) return winDiff
    return (rank.get(left) ?? OUTSIDE) - (rank.get(right) ?? OUTSIDE)
  })[0]

  if (champion === undefined) {
    throw new Error('No se pudo determinar el campeón del Masters.')
  }
  return champion
}
