/**
 * Los puntos que la tabla de una fecha CERRADA muestra por jugador, aparte de
 * la pantalla para que se pueda testear: `page.tsx` es un server component que
 * lee de Supabase. Mismo patrón que `armado-state.ts`, `sumar-state.ts` y
 * `tabla-state.ts`.
 */

import { computeAwards, type EntryId, type SeasonConfig, type SideStanding } from '@/core'

export interface DayPointsInput {
  /** La tabla del día ya calculada, en orden de posición. */
  standings: SideStanding[]
  config: SeasonConfig
  /** Los invitados de ESTA fecha, HOY — no los que había al cerrarla. */
  guestIds: EntryId[]
  /** Los `awards` CONGELADOS de esta fecha, por entry. Ausente = no cobró. */
  frozenPoints: ReadonlyMap<EntryId, number>
}

/**
 * Los puntos de una fecha cerrada, por asiento.
 */
export function dayPoints({
  standings,
  config,
  guestIds,
  frozenPoints,
}: DayPointsInput): ReadonlyMap<EntryId, number> {
  void frozenPoints
  return new Map(computeAwards(standings, config, guestIds).map((award) => [award.entryId, award.points]))
}
