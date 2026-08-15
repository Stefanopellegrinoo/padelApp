/**
 * La clasificación de los invitados de una fecha cerrada, aparte de la pantalla
 * para que se pueda testear: `sumar.tsx` es `'use client'` e importa acciones
 * `'use server'`, y `page.tsx` es un server component que lee de Supabase — así
 * que la suite pura no puede importar ni uno ni otro.
 */

import type { Pair } from '@/core'

/**
 * Los tres estados en los que puede estar un invitado de una fecha cerrada, y
 * son tres porque `promote_guest` (0014_promote_guest.sql) contesta tres cosas
 * distintas — no dos:
 *
 *   · `PUEDE`            su compañero tiene un award CONGELADO en esta fecha.
 *                        Es el único caso que la base acepta, y `partnerPoints`
 *                        son los puntos de esa fila de `awards` (no un
 *                        recálculo): exactamente lo que se le va a copiar.
 *   · `PAREJA_INVITADA`  alguna pareja suya de esta fecha NO cobró: su
 *                        compañero no tiene award congelado. Casi siempre es
 *                        porque jugó con otro invitado (spec 3.2) y por eso el
 *                        nombre, pero el predicado —el mismo que usa la base,
 *                        el `if exists` de `0014_promote_guest.sql:327-338`, y
 *                        con el MISMO cuantificador porque mira todas sus
 *                        parejas y no la primera— es a propósito más ancho, así
 *                        que el copy nombra la CAUSA (no cobró) y deja el caso
 *                        típico como ejemplo. Esa pareja quedó afuera del
 *                        reparto, y meterlo al plantel desde acá correría las
 *                        posiciones pagas de todos los demás.
 *   · `SIN_PAREJA`       nunca quedó adentro de una pareja de esta fecha. No
 *                        hay nada suyo que conservar, y la base también lo
 *                        refusa. (El spec 3.4 pedía lo contrario —convertirlo
 *                        de una— pero sólo para una fecha NO cerrada, y la
 *                        decisión vigente es refusar toda fecha que no esté
 *                        CLOSED: acá dentro la fecha siempre está cerrada, así
 *                        que 3.4 no aplica a este caso y no lo justifica.)
 *
 * Es un union y no un `partnerPoints: number | null` porque `null` tapaba DOS
 * casos con un solo copy, y el copy afirmaba sólo uno de los dos: un invitado
 * que nunca jugó leía "jugó con otro invitado".
 */
export type GuestPromoteVM = { entryId: string; name: string } & (
  | { estado: 'PUEDE'; partnerPoints: number }
  | { estado: 'PAREJA_INVITADA' }
  | { estado: 'SIN_PAREJA' }
)

/** Lo ya leído de la fecha cerrada. Nada de esto se vuelve a consultar acá. */
export interface GuestPromotionInput {
  /** Los invitados de ESTA fecha (`matchdayDetail`). */
  guestIds: string[]
  /** Las parejas de ESTA fecha. */
  pairs: Pair[]
  /** Los awards CONGELADOS de esta fecha, por entry. Ausente = no cobró. */
  frozenPoints: ReadonlyMap<string, number>
  nameOf: ReadonlyMap<string, string>
}

/**
 * El estado de cada invitado decide si la tarjeta ofrece el botón o la
 * explicación: sin award de compañero, `promote_guest` refusa SIEMPRE desde
 * esta fecha (0014_promote_guest.sql), así que un botón ahí es un rebote
 * garantizado — el defecto que este repo ya nombra en `ajustes/plantel.tsx`.
 *
 * El cuantificador va sobre TODAS sus parejas y no sobre la primera, que es el
 * mismo `every` que decide la base (0014_promote_guest.sql: refusa si EXISTE
 * una pareja suya cuyo compañero no tenga award). Con un `find` esto era un
 * `some` disfrazado: un invitado con dos filas en `pairs` —una que cobró y otra
 * que no— mostraba el botón con los puntos de la primera y rebotaba al
 * mandarlo, que es justo el "botón que siempre rebota" que esta pantalla dice
 * haber sacado. La app no produce ese estado hoy (`generatePairs` borra las
 * `pairs` de la fecha antes de insertar), pero la afirmación de `sumar.tsx`
 * —"el mismo predicado que usa la base"— tiene que ser cierta por construcción
 * y no por suerte. `sumar-state.unit.test.ts` es lo que la sostiene: sin ese
 * test, volver al cuantificador de la primera pareja deja el typecheck, los
 * unit, la suite de base y el build en verde.
 *
 * `undefined` es "no cobró" y `0` es un award real: `0010_points_can_be_zero.sql`
 * hace legal `points = 0`, así que el chequeo es contra `undefined` y nunca
 * contra la falsedad del número.
 */
export function guestsToPromote({
  guestIds,
  pairs,
  frozenPoints,
  nameOf,
}: GuestPromotionInput): GuestPromoteVM[] {
  return guestIds.map((guestId) => {
    const name = nameOf.get(guestId) ?? '?'
    const partnersPoints = pairs
      .filter((candidate) => candidate.a === guestId || candidate.b === guestId)
      .map((pair) => frozenPoints.get(pair.a === guestId ? pair.b : pair.a))
    if (partnersPoints.length === 0) return { entryId: guestId, name, estado: 'SIN_PAREJA' }
    if (partnersPoints.some((points) => points === undefined)) {
      return { entryId: guestId, name, estado: 'PAREJA_INVITADA' }
    }
    // Con más de una pareja y todas cobrando, la base tampoco promueve: el
    // `insert ... select` trae dos filas con la misma clave y el `unique` de
    // `awards` la corta entera (probado en `db/promote.db.test.ts`). El error se
    // ve al mandar; la tarjeta no pretende adivinarlo, sólo promete los puntos
    // de la primera.
    return { entryId: guestId, name, estado: 'PUEDE', partnerPoints: partnersPoints[0]! }
  })
}
