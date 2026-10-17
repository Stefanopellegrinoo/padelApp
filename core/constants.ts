import type { SideSize } from './types'

/**
 * El piso real, derivado del deporte: la gente que hace falta para que
 * exista UN partido — dos lados, y listo (docs/tipos-de-torneo.md §3.3).
 *
 * El plantel ya no tiene un piso plano de 8: esa era una regla de 2v2
 * (`sideSize = 2`) aplicada a cualquier disciplina, y por eso era incoherente
 * consigo misma — prohibía 6, donde descansa uno, y permitía 10, donde
 * también descansa uno. Con lados de a uno el piso real es 2, no 8: dos
 * amigos ya pueden jugar un partido de FIFA.
 *
 * No generalizada a "N lados" a propósito: hoy sólo existen lados de uno y
 * de dos (`SideSize`), y no hay ningún caso de uso para otra cosa.
 */
export function minSquadFor(sideSize: SideSize): number {
  return 2 * sideSize
}

/**
 * El techo de una fecha, en la unidad que de verdad importa: PARTIDOS.
 *
 * Un techo plano de CABEZAS sólo acertaba con lados de dos: 12 jugadores son
 * 15 partidos en pareja pero 66 de a uno, y un mismo número no puede ser el
 * techo sano de las dos cosas. Medido con las funciones reales, todo el rango legal:
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
 * Es un límite de CPU, no de producto: no depende de cuánta gente decida
 * entrar en un plantel (docs/plan-piso-y-techo-del-plantel.md Task 3 borró
 * ese techo entero) y no debe moverse desde ninguna pantalla. Vale 12 porque
 * ahí (n-1)!! todavía es manejable en el peor caso — no porque coincida con
 * ningún otro número del sistema.
 */
export const MAX_PAIRING_POOL = 12

/** The four-player Masters field. */
export const MASTERS_SIZE = 4

/** With four players, there are exactly three unique ways to split them into two pairs. */
export const MASTERS_MATCHES = 3
