import { pairOf, sideOf } from './pair-compat'
import { members, sameSide } from './side'
import type { EntryId, MatchResult, Pair, PairStanding, SeasonConfig, Side } from './types'

/**
 * Ephemeral tally for a single matchday's computation — never persisted,
 * never carried across matchdays. `side` replaces `pair` as the identity
 * (design #3801, decision #6): a side is a shape for a matchday's play, not
 * something that accumulates points across time. Points stay per person.
 */
interface Tally {
  side: Side
  played: number
  won: number
  setsWon: number
  setsLost: number
  gamesWon: number
  gamesLost: number
}

/**
 * The matchday table. Ranks pairs by matches won, then games difference, then
 * the head to head between the tied pairs, and finally the snapshot.
 *
 * That last step almost never fires, but it has to exist: in a three-way 2-2-2
 * the head to head is circular and resolves nothing, and without a final cut
 * three pairs would be left arguing over first place.
 *
 * The boundary sits at `sideOf`/`pairOf` (design #3801, PUNTO 4 fila 14,
 * "Borde: pairOf en el retorno"): `MatchResult`/`PairStanding` stay Pair-shaped
 * because their other producers/consumers (core/awards.ts, core/masters.ts,
 * db/**, app/**) have not migrated yet — that migration is PR17+ per the
 * design's own file-by-file table. Internally this function works entirely
 * on `Side` via `sameSide`/`members`, so `bestPlayerRank` and the tally
 * lookup are already correct for a one-member side, ready for the day a real
 * one flows in without this file changing again.
 */
export function computeStandings(
  pairs: Pair[],
  matches: MatchResult[],
  config: SeasonConfig,
  snapshot: EntryId[],
): PairStanding[] {
  const tallies = pairs.map<Tally>((pair) => ({
    side: sideOf(pair),
    played: 0,
    won: 0,
    setsWon: 0,
    setsLost: 0,
    gamesWon: 0,
    gamesLost: 0,
  }))

  const find = (side: Side): Tally | undefined =>
    tallies.find((tally) => sameSide(tally.side, side))

  for (const match of matches) {
    if (match.sets.length === 0) continue // not played yet
    const left = find(sideOf(match.pairA))
    const right = find(sideOf(match.pairB))
    if (left === undefined || right === undefined) continue

    let setsA = 0
    let setsB = 0
    let gamesA = 0
    let gamesB = 0
    for (const set of match.sets) {
      gamesA += set.gamesA
      gamesB += set.gamesB
      if (set.gamesA > set.gamesB) setsA++
      else if (set.gamesB > set.gamesA) setsB++
    }

    left.played++
    right.played++
    left.setsWon += setsA
    left.setsLost += setsB
    right.setsWon += setsB
    right.setsLost += setsA
    left.gamesWon += gamesA
    left.gamesLost += gamesB
    right.gamesWon += gamesB
    right.gamesLost += gamesA
    if (setsA > setsB) left.won++
    else if (setsB > setsA) right.won++
  }

  const snapshotRank = new Map(snapshot.map((id, index) => [id, index]))
  const OUTSIDE = Number.MAX_SAFE_INTEGER
  const bestPlayerRank = (side: Side): number =>
    Math.min(...members(side).map((entryId) => snapshotRank.get(entryId) ?? OUTSIDE))

  const usesSetsDiff = config.matchFormat.setsToWin > 1

  // Step one: the objective criteria, which are transitive and safe to sort with.
  const byObjective = [...tallies].sort((left, right) =>
    compareObjective(left, right, usesSetsDiff),
  )

  // Step two: group whatever came out exactly level.
  const groups: Tally[][] = []
  for (const tally of byObjective) {
    const current = groups[groups.length - 1]
    const head = current?.[0]
    if (current !== undefined && head !== undefined && compareObjective(head, tally, usesSetsDiff) === 0) {
      current.push(tally)
    } else {
      groups.push([tally])
    }
  }

  // Step three: break each group. The head to head only applies to a group of
  // exactly two — with three it is circular and resolves nothing, so the
  // snapshot cuts. Never feed the head to head into a comparator: it is not
  // transitive, and sort would return garbage.
  const sorted = groups.flatMap((group) => {
    if (group.length === 1) return group
    if (group.length === 2) {
      const [first, second] = group
      if (first !== undefined && second !== undefined) {
        const head = headToHead(first.side, second.side, matches)
        if (head !== 0) return head < 0 ? [first, second] : [second, first]
      }
    }
    return [...group].sort((left, right) => bestPlayerRank(left.side) - bestPlayerRank(right.side))
  })

  return sorted.map((tally, index) => ({
    pair: pairOf(tally.side),
    played: tally.played,
    won: tally.won,
    setsDiff: tally.setsWon - tally.setsLost,
    gamesDiff: tally.gamesWon - tally.gamesLost,
    position: index + 1,
  }))
}

/** Matches won, then sets difference when the format has more than one set, then games. */
function compareObjective(left: Tally, right: Tally, usesSetsDiff: boolean): number {
  if (right.won !== left.won) return right.won - left.won
  if (usesSetsDiff) {
    const leftSets = left.setsWon - left.setsLost
    const rightSets = right.setsWon - right.setsLost
    if (rightSets !== leftSets) return rightSets - leftSets
  }
  return right.gamesWon - right.gamesLost - (left.gamesWon - left.gamesLost)
}

/**
 * Negative when left beat right, positive when right beat left, zero
 * otherwise (no meeting, or a draw — draws are unreachable in a
 * disciplines.allows_draw=false matchday, which is every discipline this PR
 * touches; the 4-value `HeadToHead`/`DRAW`/`NOT_PLAYED` split from design
 * PUNTO 6 is PR22's job, once `allows_draw` actually reaches this file).
 */
function headToHead(left: Side, right: Side, matches: MatchResult[]): number {
  for (const match of matches) {
    if (match.sets.length === 0) continue
    const matchLeft = sideOf(match.pairA)
    const matchRight = sideOf(match.pairB)
    const leftIsA = sameSide(matchLeft, left) && sameSide(matchRight, right)
    const leftIsB = sameSide(matchLeft, right) && sameSide(matchRight, left)
    if (!leftIsA && !leftIsB) continue

    let setsA = 0
    let setsB = 0
    for (const set of match.sets) {
      if (set.gamesA > set.gamesB) setsA++
      else if (set.gamesB > set.gamesA) setsB++
    }
    if (setsA === setsB) return 0
    const aWon = setsA > setsB
    if (leftIsA) return aWon ? -1 : 1
    return aWon ? 1 : -1
  }
  return 0
}
