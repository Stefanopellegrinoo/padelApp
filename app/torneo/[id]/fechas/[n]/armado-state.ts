/**
 * El estado del tilde optimista del armado, aparte de la pantalla para que se
 * pueda testear: `armado.tsx` es `'use client'` e importa acciones `'use
 * server'`, así que la suite pura no lo puede importar.
 */

/** Un asiento del plantel, como lo dibuja el armado. */
export interface SeatVM {
  entryId: string
  name: string
  /** Sin fila de asistencia es `true`: el default es venir, y `seedAttendances` hace que la base opine lo mismo. */
  playing: boolean
}

/** Lo que un toque afirma: este asiento juega, o no. Nunca "dalo vuelta". */
export interface SeatTick {
  entryId: string
  playing: boolean
}

/**
 * Aplica un toque sobre el plantel dibujado.
 *
 * `playing` es ABSOLUTO y no un toggle, y de eso depende que el tilde no se dé
 * vuelta solo: React vuelve a aplicar TODA la lista de acciones pendientes
 * contra la base más nueva cada vez que llegan props del servidor. Un toggle
 * reaplicado sobre una base que YA trae el cambio lo invierte de nuevo, y el
 * asiento vuelve al estado del que salió a mitad de la espera. Un valor
 * absoluto es idempotente ante ese replay, así que converger deja de ser
 * suerte y pasa a ser estructural.
 *
 * `armado-state.unit.test.ts` fija justamente eso: sin ese test, cambiar esta
 * función por un toggle deja los 302 unit, el typecheck, el build y el harness
 * en verde, y rompe sólo en producción, en la mano de quien arma la fecha.
 */
export function applySeatTick(current: SeatVM[], tick: SeatTick): SeatVM[] {
  return current.map((seat) =>
    seat.entryId === tick.entryId ? { ...seat, playing: tick.playing } : seat,
  )
}

/** Lo que el sorteo tiene para repartir en esta fecha. */
export interface DrawRoom {
  /** Invitados sueltos librados al sorteo: sin compañero elegido a mano. */
  toTheDraw: number
  /** Jugadores del torneo que vienen y todavía no están con ningún invitado. */
  freeSquad: number
}

/**
 * La cuenta que decide si el sorteo puede con los invitados que hay.
 *
 * Espeja `assertSquadCoversLooseGuests` (db/validate.ts), y espejarla es el
 * punto: el borde rebota la fecha con `toTheDraw > freeSquad`, así que la
 * pantalla apaga "Generar parejas" con la MISMA cuenta en vez de ofrecer un
 * click que vuelve con un error.
 *
 * Por qué el sorteo los separa: `orderPool` manda a los invitados al fondo del
 * pool y `buildPairs` elige el armado de menor desbalance, que empareja el
 * fondo con la cabeza. Cada invitado sale con un jugador del torneo DISTINTO
 * mientras alcancen; pasado eso, el pigeonhole obliga a una pareja
 * invitado-invitado, que no cobra ninguno de los dos.
 *
 * Las parejas invitadas no entran en ninguna de las dos cuentas: van trabadas
 * consigo mismas desde que se crean y nunca tocan al plantel.
 */
export function drawRoom(
  seats: readonly SeatVM[],
  looseGuests: readonly { partnerId: string | null }[],
): DrawRoom {
  const taken = partnersTakenBy(looseGuests)
  return {
    toTheDraw: looseGuests.filter((guest) => guest.partnerId === null).length,
    freeSquad: seats.filter((seat) => seat.playing && !taken.has(seat.entryId)).length,
  }
}

/**
 * Los jugadores del torneo ya trabados con algún invitado.
 *
 * Una sola derivación para dos usos que TIENEN que coincidir: el `<select>` de
 * "Juega con" no los ofrece —elegirlos rebota con "Alguien está fijado en dos
 * parejas a la vez"— y `drawRoom` no los cuenta como libres. Si se separan, la
 * pantalla ofrece un compañero que la cuenta ya dio por gastado.
 */
export function partnersTakenBy(
  looseGuests: readonly { partnerId: string | null }[],
): ReadonlySet<string> {
  return new Set(
    looseGuests.flatMap((guest) => (guest.partnerId === null ? [] : [guest.partnerId])),
  )
}
