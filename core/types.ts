/** A seat in a season. Matches always reference this, never a player. */
export type EntryId = string

/**
 * Distinto NOMINALMENTE de un season id (N2, verify-report ronda 2 de
 * torneo-multi-disciplina): son dos strings con la misma forma (uuid) pero
 * significados que no se pueden confundir sin que el compilador lo note.
 * `awardsBefore`/`closedHistory` (db/season.ts) cambiaron su 2º parámetro de
 * "season" a "discipline" con el MISMO tipo (`string`) — un caller que
 * pasara el id equivocado compilaba limpio. La marca se aplica en la FUENTE
 * (`db/read.ts: toMatchdaySummary`, `db/matchday.ts: requireMatchday`,
 * `db/season.ts: defaultDisciplineId`): de ahí en más `disciplineId` ya es
 * `DisciplineId` y `seasonId` sigue siendo `string` a secas, así que pasar
 * uno por el otro es error de compilación en el call site, sin necesitar un
 * cast repetido en cada uno.
 */
export type DisciplineId = string & { readonly __brand: 'DisciplineId' }

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
  /**
   * Position in the championship, not in the matchday table. A pair made only
   * of guests is skipped, so the two can differ: with a guest pair second, the
   * championship pair that came third is award position two.
   */
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
