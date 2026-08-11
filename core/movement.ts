import { computeRanking } from './ranking'
import type { Award, EntryId, RankingRow, SeasonConfig } from './types'

/** A ranking row with its table position and movement since the previous matchday. */
export interface RankedRow extends RankingRow {
  /** 1-based position in the table, correlative in `computeRanking`'s order. */
  position: number
  /**
   * Positions gained (positive) or lost (negative) since the previous
   * matchday. `null` when there is nothing to compare against — that is not
   * the same as `0`, which means the player kept their position.
   */
  movement: number | null
}

/**
 * The season table with each entry's position and movement against the
 * previous matchday.
 *
 * Movement is derived, never stored: recomputing the ranking without the
 * last closed matchday and diffing positions is cheap and deterministic, so
 * there is nothing to keep in sync. Closing a matchday can reorder the table
 * even for a player who gained nothing, when the countBestOf cap swaps a
 * better result into someone else's count.
 */
export function rankingWithMovement(
  awardsByMatchday: Map<number, Award[]>,
  squad: readonly EntryId[],
  config: SeasonConfig,
  snapshot: readonly EntryId[],
): RankedRow[] {
  const current = computeRanking(awardsByMatchday, [...squad], config, [...snapshot])
  const previousPosition = previousPositions(awardsByMatchday, squad, config, snapshot)

  return current.map((row, index) => {
    const position = index + 1
    const previous = previousPosition.get(row.entryId)
    return { ...row, position, movement: previous === undefined ? null : previous - position }
  })
}

function previousPositions(
  awardsByMatchday: Map<number, Award[]>,
  squad: readonly EntryId[],
  config: SeasonConfig,
  snapshot: readonly EntryId[],
): Map<EntryId, number> {
  // One matchday, or none, means nothing to compare against.
  if (awardsByMatchday.size < 2) return new Map()

  const previousAwards = new Map(awardsByMatchday)
  previousAwards.delete(Math.max(...previousAwards.keys()))

  const previousRanking = computeRanking(previousAwards, [...squad], config, [...snapshot])
  return new Map(previousRanking.map((row, index) => [row.entryId, index + 1]))
}
