/**
 * El estado del tilde optimista del armado, aparte de la pantalla para que se
 * pueda testear: `armado.tsx` es `'use client'` e importa acciones `'use
 * server'`, así que la suite pura no lo puede importar.
 */

import {
  defaultMaxMatches,
  MAX_PLAYERS,
  matchCountForFormat,
  MIN_PLAYERS,
  suggestFormat,
  type MatchdayFormat,
  type Duo,
  type SideSize,
} from '@/core'

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
  /** El techo de partidos de esta disciplina — el selector ofrece su menú, no el de un techo global. */
  maxMatches: number
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
  maxMatches = defaultMaxMatches(sideSize),
  formato,
}: {
  confirmed: number
  /** Invitados sueltos ya sentados: juegan con alguien del torneo. */
  looseGuests: number
  /** Parejas invitadas: suman DOS personas cada una. */
  guestPairs: number
  sideSize: SideSize
  /** El techo de partidos de ESTA disciplina. Sin pasarlo rige el default de su `sideSize`. */
  maxMatches?: number
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
    suggestedFormat: suggestFormat(eventualSize, sideSize, maxMatches),
    // Viaja en el shape para que el selector ofrezca el menú de ESTA disciplina
    // y no el de un techo global — es todo el punto de que el techo sea suyo.
    maxMatches,
  }
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
 *
 * Los DEFENSORES tampoco quedan libres. `buildPairs` los mete en `settled`
 * junto con los locks, antes de que exista el pool, así que no hay con qué
 * acompañar a un invitado con ellos. Vienen ya filtrados por la repetición —el
 * mismo dato que dibuja el chip "Defensora"— y acá se les pide lo que les pide
 * `resolveDefenders`: que los dos estén presentes, o la pareja se disuelve y
 * los dos vuelven al pool.
 */
export function drawRoom(
  seats: readonly SeatVM[],
  looseGuests: readonly { partnerId: string | null }[],
  /** Los defensores YA filtrados por la repetición: `null` si la gastaron. */
  defenders: Duo | null,
): DrawRoom {
  const taken = partnersTakenBy(looseGuests)
  const playing = seats.filter((seat) => seat.playing)
  const isPlaying = new Set(playing.map((seat) => seat.entryId))
  const defending = new Set(
    defenders !== null && isPlaying.has(defenders.a) && isPlaying.has(defenders.b)
      ? [defenders.a, defenders.b]
      : [],
  )

  return {
    toTheDraw: looseGuests.filter((guest) => guest.partnerId === null).length,
    freeSquad: playing.filter(
      (seat) => !taken.has(seat.entryId) && !defending.has(seat.entryId),
    ).length,
  }
}

/**
 * El asiento de invitado que la paridad EXIGE, y por eso el único sin cruz: con
 * el plantel impar y un solo suelto, sacarlo es un no-op —`removeLooseGuestSeat`
 * cierra con `syncGuestSeat`, que lo repone en el acto— y una cruz que no hace
 * nada confunde igual que una que rompe. Con el plantel par, o con un segundo
 * suelto en pantalla, el asiento se lo puede llevar.
 *
 * Vivía inline en `armado.tsx` y decide qué se puede sacar y qué no, que es
 * exactamente la clase de decisión que tiene que poder testearse.
 */
export function parityGuestSeat(seats: readonly SeatVM[], looseGuestCount: number): boolean {
  const confirmed = seats.filter((seat) => seat.playing).length
  return confirmed % 2 !== 0 && looseGuestCount === 1
}

/**
 * El invitado quedó trabado con alguien que no juega esta fecha.
 *
 * `toggleAttendance` no toca `pair_locks`: el admin traba a un invitado con
 * alguien del torneo, ese alguien avisa que no va y el lock sobrevive
 * apuntándolo. La fecha rebota en `assertLocksArePlaying`, así que la pantalla
 * lo tiene que decir ANTES del click en vez de ofrecer un botón verde.
 *
 * Un `partnerId` que no está en el plantel dibujado cuenta como ausente: es lo
 * mismo que hace el borde, que pregunta por `present`.
 */
export function guestPartnerAbsent(
  seats: readonly SeatVM[],
  guest: { partnerId: string | null },
): boolean {
  if (guest.partnerId === null) return false
  return !seats.some((seat) => seat.entryId === guest.partnerId && seat.playing)
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
