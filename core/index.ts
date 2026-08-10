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
export { validateConfig, defaultConfig } from './config'

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

// ── The Masters ──────────────────────────────────────────────────────────────
export type { MastersFour } from './masters'
export { mastersQualifiers, mastersFixture, mastersChampion } from './masters'

// ── The rules page ───────────────────────────────────────────────────────────
// Generated from the config, so it can never disagree with what the app does.
export type { RulesSection } from './narrate'
export { narrateRules } from './narrate'

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
