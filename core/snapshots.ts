import { computeRanking } from './ranking'
import type { Award, EntryId, SeasonConfig } from './types'

/**
 * The tiebreak order in force for a given matchday.
 *
 * A snapshot stores positions, not points: it is a permutation of the squad,
 * and in a permutation no two players can share a place. That is why it always
 * cuts, and why no further criterion is needed underneath.
 *
 * Nothing is stored. The chain is rebuilt from the awards and the seed order
 * every time, which is what makes reopening an old matchday reproduce exactly
 * the order it had back then.
 */
export function snapshotForMatchday(
  matchdayNumber: number,
  seedOrder: EntryId[],
  awardsByMatchday: Map<number, Award[]>,
  config: SeasonConfig,
): EntryId[] {
  const every = config.tiebreakSnapshotEvery
  const refreshes = Math.floor((matchdayNumber - 1) / every)

  let snapshot = [...seedOrder]
  for (let step = 1; step <= refreshes; step++) {
    const closesAfter = step * every
    const upToCut = new Map(
      [...awardsByMatchday].filter(([number]) => number <= closesAfter),
    )
    // Each link is the table at that cut, tiebroken with the previous link.
    snapshot = computeRanking(upToCut, seedOrder, config, snapshot).map((row) => row.entryId)
  }
  return snapshot
}
