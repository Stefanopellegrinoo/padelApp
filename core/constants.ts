/** Fewer than this and the matchday is lopsided: 3 pairs with one idle every round. */
export const MIN_PLAYERS = 8

/**
 * More than this and a matchday runs too many matches for an afternoon —
 * true for sides of two (12 players ⇒ 6 pairs ⇒ 15 round-robin matches).
 *
 * W32: the UNIT this protects is matches, not
 * players, and it changes with `sideSize` — 12 players are 12 sides at
 * `sideSize=1`, which is 66 matches, not 15. That hole is now closed by
 * `config.maxMatches` (per discipline, below), which measures the real unit.
 *
 * Este número tenía TRES trabajos y ahora tiene UNO. Se fueron: el techo de la
 * fecha, que es de partidos y de cada disciplina (`maxMatches`), y el techo de
 * CPU de `allMatchings`, que es `MAX_PAIRING_POOL`. Lo que queda es lo único
 * que siempre midió bien: **cuánta gente entra en un PLANTEL**. Moverlo es una
 * decisión de producto y no arrastra a los otros dos.
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

/**
 * El techo del pool que `allMatchings` (`core/matchings.ts`) puede emparejar
 * por fuerza bruta. Es (n-1)!!: 105 con ocho, **10395 con doce**, 135135 con
 * catorce — o sea 13 veces más por sumar dos.
 *
 * Vale lo mismo que `MAX_PLAYERS` **de casualidad**, y por eso es una constante
 * propia (design PUNTO 3): son dos reglas distintas colgadas del mismo número.
 * `MAX_PLAYERS` es de PRODUCTO —cuánta gente entra en un plantel— y algún día
 * lo puede mover una decisión de Stefano. Esto es un límite de CPU y NO debe
 * moverse desde ninguna pantalla ni seguir a la otra cuando cambie.
 */
export const MAX_PAIRING_POOL = 12

/** The four-player Masters field. */
export const MASTERS_SIZE = 4

/** With four players, there are exactly three unique ways to split them into two pairs. */
export const MASTERS_MATCHES = 3
