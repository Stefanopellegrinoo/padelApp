/**
 * El orden de la tabla de una fecha CERRADA, aparte de la pantalla para que se
 * pueda testear: `page.tsx` es un server component `async` que abre el cliente
 * de Supabase al montarse, así que la suite pura no lo puede importar. Mismo
 * precedente que `armado-state.ts` y `sumar-state.ts` en esta carpeta.
 *
 * **Acá se decide el ORDEN, nunca el REPARTO.** `computeAwards` no se importa
 * ni se llama desde este módulo: quien reparte es `closeMatchday`, una sola
 * vez, y una fecha cerrada no vuelve a repartir (C21, verify-report ronda 14).
 * Lo fija `fuente-de-puntos.unit.test.ts`, que mira los imports de este archivo
 * además de los de `page.tsx`.
 */

import { members, type EntryId, type SideStanding } from '@/core'

/** Lo único que el orden necesita de un premio congelado. */
interface ConPuesto {
  position: number
}

/**
 * W55 (verify-report ronda 16): las filas de una fecha CERRADA se ordenan por
 * el puesto CONGELADO, no por el que `computeStandings` calcula hoy.
 *
 * El orden en vivo depende del snapshot de desempate, el snapshot depende de
 * `discipline_entries`, y PROMOVER un invitado escribe ahí — así que después de
 * promover la tabla podía reordenarse mientras los puntos seguían congelados.
 * Medido: el primero mostraba 6 puntos y el segundo 8.
 */
export function frozenTableRows(
  rows: readonly SideStanding[],
  frozen: ReadonlyMap<EntryId, ConPuesto>,
): SideStanding[] {
  const OUTSIDE = Number.MAX_SAFE_INTEGER
  const frozenPositionOf = (row: SideStanding): number =>
    Math.min(...members(row.side).map((entryId) => frozen.get(entryId)?.position ?? OUTSIDE))
  return [...rows].sort((left, right) => frozenPositionOf(left) - frozenPositionOf(right))
}
