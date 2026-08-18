import { members } from './side'
import type { Award, EntryId, SeasonConfig, SideStanding } from './types'

/**
 * Points for a finished matchday. Both members of a pair always take the same
 * amount, and a shorter matchday simply uses the leading values of the list,
 * so winning pays ten whether eight or twelve turned up.
 *
 * Guests get nothing: they are not in the championship. Their partner is paid
 * in full — they played and earned it.
 *
 * A pair made only of guests is outside the championship altogether. It keeps
 * its place in the matchday table but consumes no paying position, so visitors
 * can never walk off with the ten points of a championship they are not in.
 */
export function computeAwards(
  standings: SideStanding[],
  config: SeasonConfig,
  guestIds: readonly EntryId[],
): Award[] {
  const guests = new Set(guestIds)
  // `members(row.side)` instead of `[row.pair.a, row.pair.b]` (design #3801,
  // PUNTO 4 fila 16): a one-member side pays its single member, the natural
  // generalization of "both members of a pair get the same points" — not a new
  // rule. Desde PR18b `row.side` YA es un `Side` real, así que el lado de uno
  // que llega acá cobra de verdad; con `size: 2` es byte a byte lo de antes.
  const championshipMembers = (row: SideStanding): EntryId[] =>
    members(row.side).filter((entryId) => !guests.has(entryId))

  // computeStandings already hands these over in order; sorting a copy by
  // position keeps the result honest for any other caller.
  const paying = [...standings]
    .sort((left, right) => left.position - right.position)
    .filter((row) => championshipMembers(row).length > 0)

  if (paying.length > config.points.length) {
    throw new Error(
      `La fecha tiene ${paying.length} parejas del torneo pero la lista de puntos sólo tiene ${config.points.length} valores.`,
    )
  }

  const awards: Award[] = []
  for (const [index, row] of paying.entries()) {
    const points = config.points[index]
    // Unreachable: paying.length is checked against points.length above, so
    // every index here is inside the list. Only to satisfy
    // noUncheckedIndexedAccess.
    if (points === undefined) {
      throw new Error(`No hay puntos definidos para la posición ${index + 1}.`)
    }
    for (const entryId of championshipMembers(row)) {
      awards.push({ entryId, position: index + 1, points })
    }
  }
  return awards
}
