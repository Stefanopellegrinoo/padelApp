/**
 * Per-player aggregates derived from a season's played matchdays.
 *
 * Pure aggregation only: no percentages (`matchesWon / matchesPlayed` is the
 * screen's job, and it dodges the divide-by-zero decision here), no
 * attendance lookups, no sorting for display, and it never touches
 * `computeStandings`.
 *
 * Winner logic mirrors `core/standings.ts`: most sets wins, equal sets is a
 * tie. `standings.ts` does not export that piece, so `matchOutcome` below is
 * a deliberate one-function duplicate of the same rule rather than a
 * reinterpretation of it.
 */
import { members, sameSide } from './side'
import type { EntryId, MatchResult, Side } from './types'

/** One matchday's roster of sides and the matches actually played within it. */
export interface PlayedMatchday {
  number: number
  /** De uno o de dos, según la disciplina de esa fecha. */
  sides: Side[]
  matches: MatchResult[]
}

/** How often two players partnered, and how that partnership fared, from one player's point of view. */
export interface PartnerRecord {
  entryId: EntryId
  partner: EntryId
  together: number
  won: number
  lost: number
}

export interface PlayerTally {
  entryId: EntryId
  matchesPlayed: number
  matchesWon: number
  gamesFor: number
  gamesAgainst: number
  /** Matchdays where the player appears in some pair — the source of attendance. */
  matchdaysPlayed: number
}

interface MatchOutcome {
  gamesA: number
  gamesB: number
  winner: 'A' | 'B' | 'tie'
}

/** Same rule as `computeStandings` in `core/standings.ts`: most sets wins. */
function matchOutcome(match: MatchResult): MatchOutcome {
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
  const winner = setsA > setsB ? 'A' : setsB > setsA ? 'B' : 'tie'
  return { gamesA, gamesB, winner }
}

/**
 * Tallies matches, games and matchdays played per player.
 *
 * `squad` seeds every season member into the result even with zero activity;
 * a guest who is not in `squad` still gets a row if they show up in `history`.
 */
export function tallyPlayers(
  history: readonly PlayedMatchday[],
  squad: readonly EntryId[],
): PlayerTally[] {
  const tallies = new Map<EntryId, PlayerTally>()

  const tallyOf = (entryId: EntryId): PlayerTally => {
    let tally = tallies.get(entryId)
    if (tally === undefined) {
      tally = { entryId, matchesPlayed: 0, matchesWon: 0, gamesFor: 0, gamesAgainst: 0, matchdaysPlayed: 0 }
      tallies.set(entryId, tally)
    }
    return tally
  }

  for (const entryId of squad) tallyOf(entryId)

  for (const matchday of history) {
    const presentToday = new Set<EntryId>()
    // `members(side)` and not `.a`/`.b`: pure enumeration, order never matters
    // here, so this reads the same for a side of any size.
    for (const side of matchday.sides) {
      for (const entryId of members(side)) presentToday.add(entryId)
    }
    for (const entryId of presentToday) tallyOf(entryId).matchdaysPlayed++

    for (const match of matchday.matches) {
      if (match.sets.length === 0) continue // not played yet
      const { gamesA, gamesB, winner } = matchOutcome(match)

      for (const entryId of members(match.sideA)) {
        const tally = tallyOf(entryId)
        tally.matchesPlayed++
        tally.gamesFor += gamesA
        tally.gamesAgainst += gamesB
        if (winner === 'A') tally.matchesWon++
      }
      for (const entryId of members(match.sideB)) {
        const tally = tallyOf(entryId)
        tally.matchesPlayed++
        tally.gamesFor += gamesB
        tally.gamesAgainst += gamesA
        if (winner === 'B') tally.matchesWon++
      }
    }
  }

  return [...tallies.values()]
}

/**
 * `pair` es un lado de DOS, angostado: una sociedad necesita dos personas.
 * Los lados de uno no entran acá y no es una omisión — en una disciplina de a
 * uno nadie tiene compañero, así que `partnerRecords`/`bestPair` devuelven
 * vacío y `null`, que es la respuesta correcta y no un agujero de datos.
 */
interface PairTally {
  pair: Extract<Side, { size: 2 }>
  together: number
  won: number
  lost: number
}

/** Groups matchdays and matches by unordered pair of two, regardless of side. */
function pairTallies(history: readonly PlayedMatchday[]): PairTally[] {
  const tallies: PairTally[] = []

  const tallyOf = (side: Side): PairTally | null => {
    if (side.size === 1) return null
    let tally = tallies.find((candidate) => sameSide(candidate.pair, side))
    if (tally === undefined) {
      tally = { pair: side, together: 0, won: 0, lost: 0 }
      tallies.push(tally)
    }
    return tally
  }

  for (const matchday of history) {
    for (const side of matchday.sides) {
      const tally = tallyOf(side)
      if (tally !== null) tally.together++
    }

    for (const match of matchday.matches) {
      if (match.sets.length === 0) continue // not played yet
      const { winner } = matchOutcome(match)
      if (winner === 'tie') continue
      const won = tallyOf(winner === 'A' ? match.sideA : match.sideB)
      const lost = tallyOf(winner === 'A' ? match.sideB : match.sideA)
      if (won !== null) won.won++
      if (lost !== null) lost.lost++
    }
  }

  return tallies
}

/** Every partnership in `history`, one row per member so each side sees their own record. */
export function partnerRecords(history: readonly PlayedMatchday[]): PartnerRecord[] {
  return pairTallies(history).flatMap((tally) => [
    { entryId: tally.pair.a, partner: tally.pair.b, together: tally.together, won: tally.won, lost: tally.lost },
    { entryId: tally.pair.b, partner: tally.pair.a, together: tally.together, won: tally.won, lost: tally.lost },
  ])
}

/** Most wins first; a tie is broken by who has played together more — the more proven partnership. */
function isBetterPartnership(candidate: PairTally, current: PairTally): boolean {
  if (candidate.won !== current.won) return candidate.won > current.won
  return candidate.together > current.together
}

/** The strongest partnership in `history` by wins, or `null` when nobody has played yet (o cuando se juega de a uno y no hay sociedades). */
export function bestPair(history: readonly PlayedMatchday[]): PartnerRecord | null {
  const tallies = pairTallies(history)
  if (tallies.length === 0) return null
  const best = tallies.reduce((top, tally) => (isBetterPartnership(tally, top) ? tally : top))
  return { entryId: best.pair.a, partner: best.pair.b, together: best.together, won: best.won, lost: best.lost }
}
