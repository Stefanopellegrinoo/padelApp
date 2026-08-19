/** Fewer than this and the matchday is lopsided: 3 pairs with one idle every round. */
export const MIN_PLAYERS = 8

/**
 * More than this and a matchday runs too many matches for an afternoon —
 * true for sides of two (12 players ⇒ 6 pairs ⇒ 15 round-robin matches).
 *
 *The UNIT this protects is matches, not
 * players, and it changes with `sideSize` — 12 players are 12 sides at
 * `sideSize=1`, which is 66 matches, not 15. Left unconditioned on purpose:
 * the per-discipline ceiling is design PUNTO 3 (`DisciplineConfig.maxPlayers`),
 * deferred, no migration lands it yet. The product decision for what a
 * singles ceiling should be has NOT been made — until it is, a `sideSize=1`
 * matchday can silently reach a size this constant was never sized for. The
 * FLOOR (`MIN_PLAYERS`) does not have this problem: 8 people are 8 valid
 * competitors regardless of `sideSize`.
 */
export const MAX_PLAYERS = 12

/** The four-player Masters field. */
export const MASTERS_SIZE = 4

/** With four players, there are exactly three unique ways to split them into two pairs. */
export const MASTERS_MATCHES = 3
