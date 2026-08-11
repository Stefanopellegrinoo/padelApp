import { samePair } from './pairing'
import type { Award, Pair } from './types'

/** One closed matchday, as it was stored. */
export interface MatchdayHistory {
  pairs: Pair[]
  /** Frozen at close. Empty for a matchday that never closed. */
  awards: Award[]
}

/** What the draw of the next matchday needs to know about the ones before it. */
export interface PreviousContext {
  defenders: Pair | null
  defendersAlreadyRepeated: boolean
  previousPairs: Pair[]
}

/**
 * The champion-defender rule, derived from the two matchdays before this one.
 *
 * Nothing about it is stored (spec 3.3): `pairs` carries no defender flag,
 * because that would be duplicated state waiting to drift the first time
 * somebody reopens a matchday. Whether the defenders actually stay together is
 * not decided here — `buildPairs` decides that, since it is the one that knows
 * who turned up.
 *
 * `last` and `beforeLast` are the two matchdays immediately before, in that
 * order, or null when the season has not played that many — closed or not; a
 * matchday that never closed simply carries no awards, so it yields no
 * defenders while still contributing its pairs.
 */
export function previousContext(
  last: MatchdayHistory | null,
  beforeLast: MatchdayHistory | null,
): PreviousContext {
  if (last === null) {
    return { defenders: null, defendersAlreadyRepeated: false, previousPairs: [] }
  }

  const defenders = championsOf(last)
  const alreadyRepeated =
    defenders !== null && (beforeLast?.pairs ?? []).some((pair) => samePair(pair, defenders))

  return { defenders, defendersAlreadyRepeated: alreadyRepeated, previousPairs: last.pairs }
}

/**
 * The champions are whichever pair took championship position one in the frozen
 * awards. A pair made only of guests collects no award, so it can never come out
 * of here — which is the rule, not an accident.
 */
function championsOf(matchday: MatchdayHistory): Pair | null {
  const winners = new Set(
    matchday.awards.filter((award) => award.position === 1).map((award) => award.entryId),
  )
  if (winners.size === 0) {
    if (matchday.awards.length > 0) {
      throw new Error('La fecha anterior tiene awards pero ninguno en la posición 1.')
    }
    return null
  }

  const champions = matchday.pairs.filter(
    (pair) => winners.has(pair.a) || winners.has(pair.b),
  )
  if (champions.length !== 1) {
    throw new Error(
      `La fecha anterior tiene ${champions.length} parejas en la posición 1; tiene que haber exactamente una.`,
    )
  }
  return champions[0] ?? null
}
