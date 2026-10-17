/**
 * El orden de la tabla de una fecha CERRADA, aparte de la pantalla para que se
 * pueda testear: `page.tsx` es un server component `async` que abre el cliente
 * de Supabase al montarse, así que la suite pura no lo puede importar. Mismo
 * precedente que `armado-state.ts` y `sumar-state.ts` en esta carpeta.
 *
 * **Acá se decide el ORDEN, nunca el REPARTO.** `computeAwards` no se importa
 * ni se llama desde este módulo: quien reparte es `closeMatchday`, una sola
 * vez, y una fecha cerrada no vuelve a repartir (C21).
 * Lo fija `fuente-de-puntos.unit.test.ts`, que mira los imports de este archivo
 * además de los de `page.tsx`.
 */

import { members, type EntryId, type SideStanding } from '@/core'

/** Lo único que el orden necesita de un premio congelado. */
interface ConPuesto {
  position: number
}

/** El puesto congelado de un lado, o `null` si no cobró: no es un puesto grande, es ninguno. */
function frozenPositionOf(row: SideStanding, frozen: ReadonlyMap<EntryId, ConPuesto>): number | null {
  const puestos = members(row.side)
    .map((entryId) => frozen.get(entryId)?.position)
    .filter((puesto): puesto is number => puesto !== undefined)
  return puestos.length > 0 ? Math.min(...puestos) : null
}

/**
 * Las filas de la tabla de una fecha CERRADA, en el orden en que se dibujan.
 *
 * W55: el orden sale del puesto CONGELADO, no del que
 * `computeStandings` calcula hoy. El orden en vivo depende del snapshot de
 * desempate, el snapshot depende de `discipline_entries`, y PROMOVER un
 * invitado escribe ahí — así que después de promover la tabla podía reordenarse
 * mientras los puntos seguían congelados. Medido: el primero mostraba 6 puntos
 * y el segundo 8.
 *
 ***el lado que no cobra puntos conserva su LUGAR
 * DEPORTIVO.** Se reordenan entre sí sólo los lados que TIENEN premio; los que
 * no lo tienen se quedan en el índice donde `computeStandings` los puso. Antes
 * un lado sin premio valía `Number.MAX_SAFE_INTEGER` y se iba al fondo, así que
 * la pareja de dos invitados que ganó los 4 partidos con +16 quedaba ÚLTIMA con
 * `PG=4` y `Dif=+16` impresos en su propia fila — y también con `pair_size = 2`,
 * que es el camino de producción. Es exactamente lo que `core/awards.ts` ya
 * decía en prosa: "A pair made only of guests … keeps its place in the matchday
 * table but consumes no paying position".
 */
export function frozenTableRows(
  rows: readonly SideStanding[],
  frozen: ReadonlyMap<EntryId, ConPuesto>,
): SideStanding[] {
  const conPuesto = rows
    .map((row) => ({ row, position: frozenPositionOf(row, frozen) }))
    .filter((fila): fila is { row: SideStanding; position: number } => fila.position !== null)
    .sort((left, right) => left.position - right.position)

  let siguiente = 0
  return rows.map((row) => {
    if (frozenPositionOf(row, frozen) === null) return row
    const premiada = conPuesto[siguiente]
    siguiente += 1
    // `?? row` es inalcanzable: `conPuesto` tiene exactamente una entrada por
    // fila con premio, y acá se consume una por cada una. Está para no mentirle
    // al tipo con un `!` bajo `noUncheckedIndexedAccess`.
    return premiada?.row ?? row
  })
}

/**
 * ¿La tabla dibuja un orden distinto del que `computeStandings` calcula hoy?
 *
 * W56: el pie de la tabla —"Fulano quedó 2° por
 * diferencia de games"— sale de `computeStandings` y es el ÚNICO ordinal que el
 * usuario ve, porque la tabla no imprime puestos. Cuando el orden congelado
 * mueve las filas, el pie afirma un puesto que la tabla desmiente tres
 * centímetros más arriba: decía "quedó 2°" sobre quien la tabla dibuja PRIMERO,
 * citando como mejor a alguien dos filas más abajo. Medido con navegador real.
 *
 * `docs/ui-screens.md:281-282` presupone que el pie explica el orden que la
 * tabla muestra, así que la salida honesta es no dibujarlo cuando ya no lo
 * explica. Con el orden sin mover —el caso normal— el pie se ve igual que
 * siempre.
 *
 * Compara por identidad de fila a propósito: `frozenTableRows` devuelve los
 * MISMOS objetos, así que dos filas empatadas en todo no cuentan como
 * movimiento por ser iguales de contenido.
 */
export function orderMoved(
  live: readonly SideStanding[],
  drawn: readonly SideStanding[],
): boolean {
  return live.some((row, index) => drawn[index] !== row)
}
