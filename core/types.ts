/** A seat in a season. Matches always reference this, never a player. */
export type EntryId = string

export interface MatchFormat {
  setsToWin: number
  gamesPerSet: number
  tieBreak: boolean
}

export interface SeasonConfig {
  /** Squad size, not matchday size. Even, between MIN_PLAYERS and MAX_PLAYERS. */
  squadSize: number
  matchFormat: MatchFormat
  /** Exactly squadSize / 2 values, strictly descending, all above zero. */
  points: number[]
  regularMatchdays: number
  countBestOf: number
  tiebreakSnapshotEvery: number
}

export interface Pair {
  a: EntryId
  b: EntryId
}

export interface SetScore {
  gamesA: number
  gamesB: number
}

export interface MatchResult {
  round: number
  pairA: Pair
  pairB: Pair
  /** Empty while the match has not been played. */
  sets: SetScore[]
}

export interface PairStanding {
  pair: Pair
  played: number
  won: number
  setsDiff: number
  gamesDiff: number
  /** 1-based final position within the matchday. */
  position: number
}

export interface Award {
  entryId: EntryId
  position: number
  points: number
}

export interface RankingRow {
  entryId: EntryId
  points: number
  /** Points that counted toward the total, best first. */
  counted: number[]
  /** Points dropped because only the best countBestOf results count. */
  discarded: number[]
}
