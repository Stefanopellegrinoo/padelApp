import { allMatchings } from './matchings'
import { orderByPoints } from './order'
import { sideOf } from './pair-compat'
import { single } from './side'
import type { EntryId, Pair, Side, SideSize } from './types'

export interface PairingInput {
  /**
   * Everyone playing this matchday, guests included. Must be even.
   *
   * Caller invariant: every present player except the guests is expected to
   * appear in `snapshot`. When two or more are missing from it, their relative
   * order falls back to the order they appear in here — so the caller must
   * supply a stable order for `present` or the pairing among those players can
   * change between calls with the same "who's here" set.
   */
  present: EntryId[]
  points: Map<EntryId, number>
  snapshot: EntryId[]
  /**
   * The pair that took championship position 1 in the previous matchday,
   * which is not necessarily the pair that topped the table, since a
   * guest-only pair takes no championship position. Null when there was
   * none.
   */
  defenders: Pair | null
  /** True when the defenders already played their one repeat. */
  defendersAlreadyRepeated: boolean
  previousPairs: Pair[]
  /**
   * This matchday's guests, in the order the admin wants them. They all sit at
   * the tail of the pool, keeping that order among themselves.
   *
   * Careful with what that means for more than one: the balanced draw sends the
   * bottom of the order to the top of the table, so it is the LAST guest in this
   * list who lands on the table leader, not the first. Earlier in the list means
   * ranked higher, exactly like everywhere else in the order.
   */
  guestIds: EntryId[]
  /**
   * Pairs settled before the draw — a visiting team that came to play
   * together. The defenders are NOT listed here: they have their own rule,
   * which can dissolve them.
   */
  fixedPairs: Pair[]
}

export function samePair(left: Pair, right: Pair): boolean {
  return (
    (left.a === right.a && left.b === right.b) || (left.a === right.b && left.b === right.a)
  )
}

export function buildPairs(input: PairingInput): Pair[] {
  const {
    present,
    points,
    snapshot,
    defenders,
    defendersAlreadyRepeated,
    previousPairs,
    guestIds,
    fixedPairs,
  } = input

  if (present.length === 0) {
    throw new Error('No se puede armar una fecha sin jugadores.')
  }
  if (present.length % 2 !== 0) {
    throw new Error(`Hacen falta jugadores en número par: hay ${present.length}.`)
  }

  const settled = resolveSettled(present, defenders, defendersAlreadyRepeated, fixedPairs)
  const taken = new Set(settled.flatMap((pair) => [pair.a, pair.b]))
  const pool = present.filter((entryId) => !taken.has(entryId))

  const ordered = orderPool(pool, points, snapshot, guestIds)
  const position = new Map(ordered.map((entryId, index) => [entryId, index + 1]))
  const idealSum = ordered.length + 1

  const candidates = allMatchings(ordered)
  const legal = candidates.filter(
    (matching) =>
      !matching.some((pair) => previousPairs.some((previous) => samePair(previous, pair))),
  )

  // Proven in the spec (2.5): the no-repeat rule can never rule out everything.
  // A pool of six leaves eight legal draws out of fifteen, and the worst case,
  // a pool of four, still leaves two. If nothing survives here it is a bug, and
  // it must fail loudly rather than pair at random.
  let best = legal[0]
  if (best === undefined) {
    throw new Error(
      `No quedó ningún armado legal para ${ordered.length} jugadores. Esto es un bug: siempre tiene que existir al menos uno.`,
    )
  }
  let bestScore = imbalance(best, position, idealSum)
  for (const matching of legal.slice(1)) {
    const score = imbalance(matching, position, idealSum)
    if (score < bestScore) {
      best = matching
      bestScore = score
    }
  }

  return [...settled, ...best]
}

/** `PairingInput` plus which size the discipline declared (REQ-D5-1/2). */
export interface SideBuildInput extends PairingInput {
  sideSize: SideSize
}

/**
 * The only fork between a side of one and a side of two (design PUNTO 5,
 * decision #5): the size is declared by the discipline and enforced by the
 * base, never chosen here.
 *
 * With `sideSize === 1` there is no partner to find, so none of the
 * pairing machinery applies: no defenders, no fixed pairs, no no-repeat
 * rule — decision #6 is that a fixed duo is a pairing CONSTRAINT, and a
 * constraint on a pairing that never happens constrains nothing. Every
 * present player, guest included, becomes their own side. `orderPool` is
 * the exact function the pair path uses to rank the table and send guests
 * to the tail, so the order invariant documented on `present` above
 * (comment at the top of this file) carries over unchanged — this branch
 * does not add a new one.
 *
 * With `sideSize === 2` this is `buildPairs`, unmodified, mapped through
 * `sideOf` (core/pair-compat.ts) so both branches return the same type.
 */
export function buildSides(input: SideBuildInput): Side[] {
  if (input.sideSize === 1) {
    if (input.present.length === 0) {
      throw new Error('No se puede armar una fecha sin jugadores.')
    }
    return orderPool(input.present, input.points, input.snapshot, input.guestIds).map(single)
  }
  return buildPairs(input).map(sideOf)
}

/**
 * The pairs that are decided before the draw: the defending champions, when
 * their rule holds, and whatever the admin fixed by hand. Anything wrong here
 * is an invariant violation and fails loudly (spec 4.5) rather than quietly
 * pairing somebody twice.
 */
function resolveSettled(
  present: EntryId[],
  defenders: Pair | null,
  alreadyRepeated: boolean,
  fixedPairs: Pair[],
): Pair[] {
  const settled: Pair[] = []
  const taken = new Set<EntryId>()
  // Entries already claimed by the defenders specifically — tracked apart from
  // `taken` so a clash with them gets its own, accurate message: the admin
  // never typed a second fixed pair, the other claimant is the defenders.
  const defendingEntries = new Set<EntryId>()

  const take = (pair: Pair, what: string): void => {
    for (const entryId of [pair.a, pair.b]) {
      if (!present.includes(entryId)) {
        throw new Error(`${what} incluye a ${entryId}, que no juega esta fecha.`)
      }
      if (taken.has(entryId)) {
        if (defendingEntries.has(entryId)) {
          throw new Error(`${entryId} ya está en la pareja defensora.`)
        }
        throw new Error(`${entryId} está en más de una pareja fija.`)
      }
      taken.add(entryId)
    }
    settled.push(pair)
  }

  const defending = resolveDefenders(present, defenders, alreadyRepeated)
  if (defending !== null) {
    take(defending, 'La pareja defensora')
    defendingEntries.add(defending.a)
    defendingEntries.add(defending.b)
  }
  for (const pair of fixedPairs) take(pair, 'Una pareja fija')

  return settled
}

/**
 * The defenders stay together only if both turned up and they have not used
 * their single repeat yet. Otherwise there are no defenders this matchday and
 * every pair comes out of the general draw.
 */
function resolveDefenders(
  present: EntryId[],
  defenders: Pair | null,
  alreadyRepeated: boolean,
): Pair | null {
  if (defenders === null) return null
  if (alreadyRepeated) return null
  const bothPresent = present.includes(defenders.a) && present.includes(defenders.b)
  return bothPresent ? defenders : null
}

/**
 * Guests always sit at the tail, in the order they were given: nobody knows how
 * they play, so the bottom is the neutral spot. Reordering `guestIds` is how the
 * admin moves one of them (spec 2.6).
 *
 * With a single guest that is exactly what the spec asks for — the tail draws the
 * table leader. With several, the leader draws the LAST of them, because the tail
 * is the bottom of the order and the draw pairs the bottom with the top.
 */
function orderPool(
  pool: EntryId[],
  points: Map<EntryId, number>,
  snapshot: EntryId[],
  guestIds: EntryId[],
): EntryId[] {
  const inPool = new Set(pool)
  const guests = [...new Set(guestIds)].filter((entryId) => inPool.has(entryId))
  if (guests.length === 0) {
    return orderByPoints(pool, points, snapshot)
  }
  const isGuest = new Set(guests)
  const squad = pool.filter((entryId) => !isGuest.has(entryId))
  return [...orderByPoints(squad, points, snapshot), ...guests]
}

/**
 * How far a set of pairs is from perfect balance. With n players ranked 1..n,
 * a balanced pair adds up to n+1, so the further each pair strays from that
 * sum, the worse the draw.
 */
function imbalance(matching: Pair[], position: Map<EntryId, number>, idealSum: number): number {
  let total = 0
  for (const pair of matching) {
    const sum = (position.get(pair.a) ?? 0) + (position.get(pair.b) ?? 0)
    total += Math.abs(sum - idealSum)
  }
  return total
}
