import { allMatchings } from './matchings'
import { orderByPoints } from './order'
import type { EntryId, Pair } from './types'

export interface PairingInput {
  /** Everyone playing this matchday, guest included. Must be even. */
  present: EntryId[]
  points: Map<EntryId, number>
  snapshot: EntryId[]
  /** Winners of the previous matchday, or null when there was none. */
  defenders: Pair | null
  /** True when the defenders already played their one repeat. */
  defendersAlreadyRepeated: boolean
  previousPairs: Pair[]
  guestId: EntryId | null
}

export function samePair(left: Pair, right: Pair): boolean {
  return (
    (left.a === right.a && left.b === right.b) || (left.a === right.b && left.b === right.a)
  )
}

export function buildPairs(input: PairingInput): Pair[] {
  const { present, points, snapshot, defenders, defendersAlreadyRepeated, previousPairs, guestId } =
    input

  if (present.length === 0) {
    throw new Error('No se puede armar una fecha sin jugadores.')
  }
  if (present.length % 2 !== 0) {
    throw new Error(`Hacen falta jugadores en número par: hay ${present.length}.`)
  }

  const fixed = resolveDefenders(present, defenders, defendersAlreadyRepeated)
  const pool = fixed
    ? present.filter((id) => id !== fixed.a && id !== fixed.b)
    : [...present]

  const ordered = orderPool(pool, points, snapshot, guestId)
  const position = new Map(ordered.map((id, index) => [id, index + 1]))
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

  return fixed ? [fixed, ...best] : best
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

/** The guest always sits last: nobody knows how they play, so the tail is the neutral spot. */
function orderPool(
  pool: EntryId[],
  points: Map<EntryId, number>,
  snapshot: EntryId[],
  guestId: EntryId | null,
): EntryId[] {
  if (guestId === null || !pool.includes(guestId)) {
    return orderByPoints(pool, points, snapshot)
  }
  const withoutGuest = pool.filter((id) => id !== guestId)
  return [...orderByPoints(withoutGuest, points, snapshot), guestId]
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
