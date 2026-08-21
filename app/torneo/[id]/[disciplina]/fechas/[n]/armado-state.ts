/**
 * El estado del tilde optimista del armado, aparte de la pantalla para que se
 * pueda testear: `armado.tsx` es `'use client'` e importa acciones `'use
 * server'`, así que la suite pura no lo puede importar.
 */

import { MAX_PLAYERS, matchCountForFormat, MIN_PLAYERS, suggestFormat, type MatchdayFormat, type SideSize } from '@/core'

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

/** La forma de la fecha que se está armando, derivada de quién viene. */
export interface MatchdayShape {
  /** Personas adentro: plantel confirmado más invitados. */
  size: number
  /** Lados que salen de esas personas. De a uno, uno por cabeza. */
  sides: number
  /**
   * Los partidos reales de la fecha, según el `formato` GUARDADO — round
   * robin completo (`C(sides, 2)`) si es `ROUND_ROBIN`, grupos + llave si es
   * `GROUPS_KNOCKOUT` (W72, verify-report-pr21 #4004). Antes de esta cuenta
   * era SIEMPRE la fórmula del round robin, incluso con grupos ya elegidos
   * y guardados en la base.
   */
  matches: number
  /** Todos entran en lados completos. De a uno es siempre cierto. */
  complete: boolean
  /** Falta el invitado suelto que `syncGuestSeat` agrega para emparejar. */
  needsLooseGuest: boolean
  /** El tamaño que la fecha VA a tener, contando el suelto que todavía no está. */
  eventualSize: number
  tooFew: boolean
  tooMany: boolean
  /**
   * El formato que `suggestFormat` propone para el tamaño que la fecha VA a
   * tener (REQ-D8-1) — editable antes de armar, es el selector de
   * `armado.tsx` el que lo hace editable, esto sólo expone la sugerencia
   * real. Usa `eventualSize`, no `confirmed`: el suelto que falta para
   * emparejar cuenta para la sugerencia igual que cuenta para `matches`.
   */
  suggestedFormat: MatchdayFormat
}

/**
 * La aritmética del armado, condicionada por el tamaño del lado.
 *
 * S31: esto vivía suelto adentro de `armado.tsx` con
 * el `2` hardcodeado en las dos puntas — `confirmed % 2` para pedir invitado y
 * `size / 2` para contar parejas. La base dejó de hacer eso en PR14
 * (`assertMatchdaySize` condiciona la paridad por `sideSize`, W24) y la
 * pantalla quedó atrás: con una disciplina de a uno pedía un invitado que no
 * hace falta y mostraba media pareja.
 *
 * `sideSize === 1` colapsa las tres reglas de emparejado a la vez y no por
 * casualidad: la paridad, el invitado que la arregla y la fecha "incompleta"
 * son todas la misma regla —que la gente entre en lados de dos— y sin esa
 * regla no queda nada que chequear. Cada persona es su propio lado.
 *
 * El PISO y el TECHO se quedan sin condicionar a propósito: `assertMatchdaySize`
 * (`db/validate.ts`) todavía aplica `MIN_PLAYERS`/`MAX_PLAYERS` planos para las
 * dos formas, y una pantalla que prometa un límite distinto del que el servidor
 * va a aplicar es peor que una que no lo muestre. W32 sigue abierto y la
 * decisión de producto es que se cierra con el formato de grupos (REQ-D8-1,
 * PR21), no con una constante nueva — por eso `matches` existe: de a uno, 12
 * jugadores son 66 partidos, y ése es el número que hace pedir ese formato.
 *
 * `formato` es OBLIGATORIO y sin default, mismo criterio que `allowsDraw` en
 * `computeStandings` (design #3801): sin él, `matches` seguía prometiendo el
 * round robin incluso DESPUÉS de que el admin ya hubiera elegido y guardado
 * grupos (W72, verify-report-pr21 #4004) — un default a `ROUND_ROBIN` acá
 * habría escondido ese mismo bug otra vez, en vez de obligar a cada llamador
 * a decir de qué formato está hablando.
 */
export function matchdayShape({
  confirmed,
  looseGuests,
  guestPairs,
  sideSize,
  formato,
}: {
  confirmed: number
  /** Invitados sueltos ya sentados: juegan con alguien del torneo. */
  looseGuests: number
  /** Parejas invitadas: suman DOS personas cada una. */
  guestPairs: number
  sideSize: SideSize
  /** El `matchdays.formato` GUARDADO hoy — no la sugerencia. */
  formato: MatchdayFormat
}): MatchdayShape {
  const size = confirmed + looseGuests + guestPairs * 2
  // La línea de "son impares" describe al suelto que `syncGuestSeat` agrega, y
  // ése se decide por la paridad del PLANTEL: la pareja invitada suma dos y no
  // la cambia. Sólo con `sideSize === 2`, donde emparejar significa algo.
  const needsLooseGuest = sideSize === 2 && confirmed % 2 !== 0 && looseGuests === 0
  const eventualSize = size + (needsLooseGuest ? 1 : 0)
  const sides = Math.floor(size / sideSize)
  return {
    size,
    sides,
    matches: matchCountForFormat(formato, sides),
    complete: size % sideSize === 0,
    needsLooseGuest,
    eventualSize,
    tooFew: eventualSize < MIN_PLAYERS,
    tooMany: eventualSize > MAX_PLAYERS,
    suggestedFormat: suggestFormat(eventualSize, sideSize),
  }
}
