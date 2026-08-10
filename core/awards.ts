import type { Award, EntryId, PairStanding, SeasonConfig } from './types'

/**
 * Points for a finished matchday. Both members of a pair always take the same
 * amount, and a shorter matchday simply uses the leading values of the list,
 * so winning pays ten whether eight or twelve turned up.
 *
 * The guest gets nothing: they are not in the championship. Their partner is
 * paid in full — they played and earned it.
 */
export function computeAwards(
  standings: PairStanding[],
  config: SeasonConfig,
  guestId: EntryId | null,
): Award[] {
  if (standings.length > config.points.length) {
    throw new Error(
      `La fecha tiene ${standings.length} parejas pero la lista de puntos sólo tiene ${config.points.length} valores.`,
    )
  }

  const awards: Award[] = []
  for (const row of standings) {
    const points = config.points[row.position - 1]
    if (points === undefined) {
      throw new Error(`No hay puntos definidos para la posición ${row.position}.`)
    }
    for (const entryId of [row.pair.a, row.pair.b]) {
      if (entryId === guestId) continue
      awards.push({ entryId, position: row.position, points })
    }
  }
  return awards
}
