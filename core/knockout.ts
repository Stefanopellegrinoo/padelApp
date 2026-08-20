/**
 * La llave de una fecha con fases (design PUNTO 7, PR21). `buildFixture`
 * (core/fixture.ts) NO se toca: opera sobre índices numéricos y sigue
 * generando UNA ronda round-robin; con `GROUPS_KNOCKOUT` se lo llama una vez
 * por grupo. Este módulo es lo que sabe en qué fase está la fecha y cuándo
 * esa fase terminó — nada de esto se guarda en una columna nueva.
 */
import { PHASE_ORDER, type MatchResult, type Phase } from './types'

/**
 * La fase actual: la más avanzada con partidos creados (REQ-D7-3). Sin
 * partidos, no hay fase — no `'GRUPO'` por default, porque eso confundiría
 * "fecha recién armada" con "fecha sin armar todavía".
 *
 * MISMO criterio que `matchday_phase` (`supabase/migrations/0039_match_phase.sql`):
 * `array_position` sobre `PHASE_ORDER` y el máximo. Acá no hace falta un SQL
 * `order by ... limit 1` — un solo recorrido alcanza.
 */
export function currentPhase(matches: readonly MatchResult[]): Phase | null {
  let latest: Phase | null = null
  let latestIndex = -1
  for (const match of matches) {
    const index = PHASE_ORDER.indexOf(match.fase)
    if (index > latestIndex) {
      latestIndex = index
      latest = match.fase
    }
  }
  return latest
}

/**
 * Si TODOS los partidos de `fase` ya se jugaron. Un partido "jugado" es el
 * mismo criterio que `headToHead` (`core/standings.ts`): tiene al menos un
 * set cargado. Sin partidos en esa fase, no está completa — no hay nada que
 * cerrar todavía, y sería vacuamente `true` si se devolviera lo contrario.
 */
export function phaseIsComplete(matches: readonly MatchResult[], fase: Phase): boolean {
  const inPhase = matches.filter((match) => match.fase === fase)
  return inPhase.length > 0 && inPhase.every((match) => match.sets.length > 0)
}

/**
 * La fase que le corresponde a una llave de `matchups` partidos. Sólo conoce
 * potencias de 2 hasta 8 (el techo real: `groupSides`/`knockoutMatchups`,
 * Rebanada B2, no arman llaves más grandes) — cualquier otro número es un bug
 * de quien arma la llave, no un caso a tolerar en silencio.
 */
export function faseForCount(matchups: number): Phase {
  switch (matchups) {
    case 8:
      return 'OCTAVOS'
    case 4:
      return 'CUARTOS'
    case 2:
      return 'SEMI'
    case 1:
      return 'FINAL'
    default:
      throw new Error(`Una llave de ${matchups} partidos no es una fase conocida.`)
  }
}
