import { samePair } from './pairing'
import type { EntryId, MatchResult, Pair, PairStanding, SeasonConfig } from './types'

interface Tally {
  pair: Pair
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
 */
export function computeStandings(
  pairs: Pair[],
  matches: MatchResult[],
  config: SeasonConfig,
  snapshot: EntryId[],
): PairStanding[] {
  const tallies = pairs.map<Tally>((pair) => ({
    pair,
    played: 0,
    won: 0,
    setsWon: 0,
    setsLost: 0,
    gamesWon: 0,
    gamesLost: 0,
  }))

  const find = (pair: Pair): Tally | undefined =>
    tallies.find((tally) => samePair(tally.pair, pair))

  for (const match of matches) {
    if (match.sets.length === 0) continue // not played yet
    const left = find(match.pairA)
    const right = find(match.pairB)
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
  const bestPlayerRank = (pair: Pair): number =>
    Math.min(snapshotRank.get(pair.a) ?? OUTSIDE, snapshotRank.get(pair.b) ?? OUTSIDE)

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
        const head = headToHead(first.pair, second.pair, matches)
        if (head !== 0) return head < 0 ? [first, second] : [second, first]
      }
    }
    return [...group].sort((left, right) => bestPlayerRank(left.pair) - bestPlayerRank(right.pair))
  })

  return sorted.map((tally, index) => ({
    pair: tally.pair,
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

/** Negative when left beat right, positive when right beat left, zero otherwise. */
function headToHead(left: Pair, right: Pair, matches: MatchResult[]): number {
  for (const match of matches) {
    if (match.sets.length === 0) continue
    const leftIsA = samePair(match.pairA, left) && samePair(match.pairB, right)
    const leftIsB = samePair(match.pairA, right) && samePair(match.pairB, left)
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
