/** Fewer than this and the matchday is lopsided: 3 pairs with one idle every round. */
export const MIN_PLAYERS = 8

/**
 * More than this and a matchday runs too many matches for an afternoon —
 * true for sides of two (12 players ⇒ 6 pairs ⇒ 15 round-robin matches).
 *
 * W32: the UNIT this protects is matches, not
 * players, and it changes with `sideSize` — 12 players are 12 sides at
 * `sideSize=1`, which is 66 matches, not 15. That hole is now closed by
 * `MAX_MATCHES` (below), which measures the real unit; this constant keeps
 * only the job it was always right about: how big a SQUAD may get.
 */
export const MAX_PLAYERS = 12

/**
 * El techo de una fecha, en la unidad que de verdad importa: PARTIDOS.
 *
 * `MAX_PLAYERS` era un número haciendo dos trabajos y sólo acertaba con lados
 * de dos. Medido con las funciones reales, todo el rango legal:
 *
 *   2v2  8 jugadores →  4 lados → todos contra todos  6
 *   2v2 10 jugadores →  5 lados → todos contra todos 10
 *   2v2 12 jugadores →  6 lados → todos contra todos 15  ← el peor caso de 2v2
 *   1v1  8 jugadores →  8 lados → todos contra todos 28, 2 grupos 16
 *   1v1 10 jugadores → 10 lados → todos contra todos 45, 2 grupos 24
 *   1v1 12 jugadores → 12 lados → todos contra todos 66, 2 grupos 34, 4 grupos 20
 *
 * Estos son los DEFAULTS, no el techo: cada disciplina lleva el suyo en
 * `config.maxMatches` (decisión de Stefano, design PUNTO 3). Un número global
 * no puede decir que 15 partidos de pádel y 36 de FIFA son la misma tarde —
 * uno dura media hora y el otro diez minutos. Por eso el default se deriva del
 * `sideSize`, que es lo más cerca del deporte que hay sin preguntar.
 *
 * 15 para lados de dos es EXACTAMENTE el peor caso que hoy se puede armar, así
 * que el default no le cambia el comportamiento a ninguna temporada de pádel
 * viva. 36 para lados de uno corta 45, 55 y 66 —las tres explosiones— y deja
 * pasar 28 y 36, que es lo que la app arma hoy.
 */
export function defaultMaxMatches(sideSize: 1 | 2): number {
  return sideSize === 1 ? 36 : 15
}

/**
 * El techo de ESTA disciplina: el suyo si lo tiene, el default de su
 * `sideSize` si no. La clave es OPCIONAL en el jsonb a propósito — una config
 * guardada antes de que esto existiera (las dos que hay en producción) no
 * puede quedar inválida por una clave que no sabía que tenía que traer.
 */
export function maxMatchesOf(
  config: { readonly maxMatches?: number },
  sideSize: 1 | 2,
): number {
  return config.maxMatches ?? defaultMaxMatches(sideSize)
}

/** The four-player Masters field. */
export const MASTERS_SIZE = 4

/** With four players, there are exactly three unique ways to split them into two pairs. */
export const MASTERS_MATCHES = 3
