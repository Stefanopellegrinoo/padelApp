/**
 * The public surface of `core/`.
 *
 * Everything the rest of the app is meant to use goes through here. Importing
 * a deep path like `core/pairing` still works — TypeScript cannot forbid it —
 * but this file is the declared boundary, and anything missing from it is an
 * implementation detail that may change without warning.
 *
 * `core/` is pure: no database, no network, no framework, and no `Date`,
 * `Math.random`, `fetch` or `process` anywhere. Every function takes data and
 * returns data. That is what lets a closed matchday be recomputed months later
 * and come out exactly as it did the night it was played.
 */

// ── The format's fixed limits ────────────────────────────────────────────────
// Not configuration. A matchday below MIN_PLAYERS is lopsided, above
// MAX_PLAYERS does not fit an afternoon, and the Masters' three rotating
// matches exist because there are exactly four players.
export { MIN_PLAYERS, MAX_PLAYERS, MASTERS_SIZE, MASTERS_MATCHES } from './constants'

// ── Domain types ─────────────────────────────────────────────────────────────
// `EntryId` is a seat in a season, never a player. Matches reference the seat,
// so claiming a profile is one update and the tournament's history is untouched.
export type {
  EntryId,
  DisciplineId,
  MatchFormat,
  SeasonConfig,
  Pair,
  SetScore,
  MatchResult,
  PairStanding,
  Award,
  RankingRow,
} from './types'

// ── Season configuration ─────────────────────────────────────────────────────
// `validateConfig` RETURNS its problems in Spanish, it never throws — so it
// only protects callers who actually read the result. Call it at every edge.
// Skipping it is not merely untidy: `tiebreakSnapshotEvery: 0` makes the
// snapshot chain loop forever.
export { validateConfig, defaultConfig, pointsErrors } from './config'

// ── Building a matchday ──────────────────────────────────────────────────────
export type { PairingInput } from './pairing'
export { buildPairs, samePair } from './pairing'
export { buildFixture } from './fixture'

// ── El contexto que hereda una fecha de las anteriores ───────────────────────
// Quién defiende no se guarda nunca (spec 3.3): se deriva de las dos fechas
// previas, acá adentro y no en la capa de datos.
export type { MatchdayHistory, PreviousContext } from './history'
export { previousContext } from './history'

// ── Scoring a matchday ───────────────────────────────────────────────────────
export { computeStandings } from './standings'
export { computeAwards } from './awards'

// ── The season ───────────────────────────────────────────────────────────────
export { computeRanking } from './ranking'
export { snapshotForMatchday } from './snapshots'

// El estado real de un torneo con más de una disciplina: DERIVADO, nunca
// leído de una sola columna. `seasons.status` sigue en dual-write hasta el
// contract (PR 27).
export type { SeasonStatus } from './season'
export { seasonStatusOf } from './season'

// ── The Masters ──────────────────────────────────────────────────────────────
export type { MastersFour } from './masters'
export { mastersQualifiers, mastersFixture, mastersChampion } from './masters'

// ── The rules page ───────────────────────────────────────────────────────────
// Generated from the config, so it can never disagree with what the app does.
export type { RulesSection } from './narrate'
export { narrateRules } from './narrate'

// ── Reading the season back ──────────────────────────────────────────────────
// What the read-only screens need on top of the ranking. All derived, nothing
// stored: recomputing is cheap and deterministic, and a stored position would
// drift the first time somebody reopens a matchday.

// Per PLAYER, not per pair: a champion pair plays exactly two matchdays
// together (spec 2.5), so its streak could only ever be 0 or 1.
export type { Streak } from './streak'
export { titleStreaks } from './streak'

// `movement` is null when there is nothing to compare against and 0 when the
// player did not move. The screen draws those two differently.
export type { RankedRow } from './movement'
export { rankingWithMovement } from './movement'

// Counts only. The percentages are the screen's job, which also keeps the
// divide-by-zero decision out of here.
export type { PlayedMatchday, PartnerRecord, PlayerTally } from './playerstats'
export { tallyPlayers, partnerRecords, bestPair } from './playerstats'

/*
 * Deliberately NOT exported — internal to the modules above:
 *
 *   allMatchings   (matchings.ts)  enumerates every way to split a pool into
 *                                  pairs. Only buildPairs needs it, and it
 *                                  throws above MAX_PLAYERS because (n-1)!!
 *                                  reaches 654 million at twenty players.
 *   orderByPoints  (order.ts)      sorts by points with the snapshot as
 *                                  tiebreak. Callers want computeRanking,
 *                                  which returns rows already in order.
 */
