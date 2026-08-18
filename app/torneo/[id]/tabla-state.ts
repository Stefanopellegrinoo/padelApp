/**
 * La derivación de los defensores de la Tabla, aparte de la pantalla para que
 * se pueda testear: `tabla-view.tsx` es un componente y la suite pura no lo
 * puede importar. Mismo motivo y mismo patrón que `armado-state.ts` y
 * `sumar-state.ts`.
 */

import type { SideSize } from '@/core'

/** Una fecha cerrada con los premios que se congelaron al cerrarla. */
export interface ClosedMatchdayAwards {
  number: number
  awards: readonly { entryId: string; position: number }[]
}

export interface Defenders {
  matchdayNumber: number
  names: string[]
}

/**
 * Quién defiende el título de la fecha anterior, o `null` cuando no defiende
 * nadie.
 *
 * Nada de esto se guarda (spec 3.3): sale de los `awards` congelados, igual
 * que `previousContext` en `core/history.ts`. Quien ya repitió gastó su
 * defensa y no vuelve a aparecer.
 */
export function defendersOf(
  closedRegular: readonly ClosedMatchdayAwards[],
  nameOf: ReadonlyMap<string, string>,
  _sideSize: SideSize,
): Defenders | null {
  const sorted = [...closedRegular].sort((a, b) => b.number - a.number)
  const last = sorted[0]
  const beforeLast = sorted[1]

  const winnersOf = (matchday: ClosedMatchdayAwards | undefined): string[] =>
    matchday === undefined
      ? []
      : matchday.awards.filter((award) => award.position === 1).map((award) => award.entryId)

  const lastWinnerIds = winnersOf(last)
  const beforeLastWinnerIds = new Set(winnersOf(beforeLast))
  const alreadyRepeated =
    lastWinnerIds.length > 0 &&
    lastWinnerIds.length === beforeLastWinnerIds.size &&
    lastWinnerIds.every((entryId) => beforeLastWinnerIds.has(entryId))

  if (last === undefined || lastWinnerIds.length === 0 || alreadyRepeated) return null
  return {
    matchdayNumber: last.number,
    names: lastWinnerIds.map((entryId) => nameOf.get(entryId) ?? ''),
  }
}
