import type { EntryId } from './types'

/**
 * Orders players by championship points, highest first, breaking ties with the
 * standing snapshot. The snapshot is a permutation, so it always cuts: two
 * players can never share a position in it.
 *
 * Players missing from the snapshot — a guest, most of the time — go last,
 * keeping the order they arrived in so the result stays deterministic.
 */
export function orderByPoints(
  entries: EntryId[],
  points: Map<EntryId, number>,
  snapshot: EntryId[],
): EntryId[] {
  const snapshotRank = new Map(snapshot.map((id, index) => [id, index]))
  const arrivalRank = new Map(entries.map((id, index) => [id, index]))
  const OUTSIDE = Number.MAX_SAFE_INTEGER

  return [...entries].sort((left, right) => {
    const pointsDiff = (points.get(right) ?? 0) - (points.get(left) ?? 0)
    if (pointsDiff !== 0) return pointsDiff

    const leftRank = snapshotRank.get(left) ?? OUTSIDE
    const rightRank = snapshotRank.get(right) ?? OUTSIDE
    if (leftRank !== rightRank) return leftRank - rightRank

    return (arrivalRank.get(left) ?? 0) - (arrivalRank.get(right) ?? 0)
  })
}
