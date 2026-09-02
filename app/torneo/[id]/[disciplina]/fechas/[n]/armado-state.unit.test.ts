import { describe, expect, it } from 'vitest'
import { pair, type MatchdayFormat } from '@/core'
import {
  applySeatTick,
  drawRoom,
  guestPartnerAbsent,
  matchdayShape,
  parityGuestSeat,
  type SeatVM,
} from './armado-state'

const ROUND_ROBIN: MatchdayFormat = { kind: 'ROUND_ROBIN' }

const squad: SeatVM[] = [
  { entryId: 'a', name: 'Ana', playing: true },
  { entryId: 'b', name: 'Beto', playing: true },
  { entryId: 'c', name: 'Cami', playing: false },
]

describe('applySeatTick', () => {
  it('marca que un asiento no viene, sin tocar a los demás', () => {
    const next = applySeatTick(squad, { entryId: 'a', playing: false })

    expect(next.map((seat) => seat.playing)).toEqual([false, true, false])
  })

  it('marca que un asiento vuelve a venir', () => {
    const next = applySeatTick(squad, { entryId: 'c', playing: true })

    expect(next.map((seat) => seat.playing)).toEqual([true, true, true])
  })

  /**
   * El test que existe por el bug que NO ocurre.
   *
   * React vuelve a aplicar la lista de acciones pendientes contra la base más
   * nueva cada vez que llegan props del servidor. Si el toque dijera "dalo
   * vuelta" en lugar de "queda así", este replay sobre una base que ya trae el
   * cambio lo invertiría, y el asiento volvería solo a mitad de la espera.
   *
   * Con un toggle esta aserción da `true` y el test falla.
   */
  it('reaplicado sobre una base que ya trae el cambio, no lo da vuelta', () => {
    const tick = { entryId: 'a', playing: false }
    const baseDelServidor = applySeatTick(squad, tick)

    const replay = applySeatTick(baseDelServidor, tick)

    expect(replay[0]?.playing).toBe(false)
  })

  it('dos toques al mismo asiento terminan en el último que se pidió', () => {
    const apagado = applySeatTick(squad, { entryId: 'b', playing: false })
    const prendido = applySeatTick(apagado, { entryId: 'b', playing: true })

    expect(prendido[1]?.playing).toBe(true)
  })

  it('no muta el plantel que recibe', () => {
    applySeatTick(squad, { entryId: 'a', playing: false })

    expect(squad[0]?.playing).toBe(true)
  })

  it('deja el plantel igual si el asiento no existe', () => {
    const next = applySeatTick(squad, { entryId: 'fantasma', playing: false })

    expect(next.map((seat) => seat.playing)).toEqual([true, true, false])
  })
})

/**
 * S31: `armado.tsx` tenía `confirmed % 2` y
 * `{size / 2} parejas` hardcodeados — los espejos en la pantalla de los bugs
 * de aridad que la base ya tiene arreglados (`assertMatchdaySize` condiciona
 * la paridad por `sideSize` desde PR14/W24). Con una disciplina de a uno, esa
 * pantalla pedía un invitado que no hace falta y dividía por 2 un número que
 * no se divide.
 *
 * La cuenta se saca de la pantalla para poder probarla, mismo motivo y mismo
 * patrón que `sumar-state.ts`: `armado.tsx` es `'use client'` e importa
 * acciones `'use server'`.
 *
 * `matches` es nuevo y no es cosmético: la pantalla decía "La fecha es de 12"
 * sin que nadie pudiera saber que eso son 66 partidos de a uno contra 15 de a
 * dos. Ese es el número que hace pedir el formato de grupos (REQ-D8-1, PR21),
 * que es la respuesta real al techo — W32 NO se cierra con una constante.
 */
describe('matchdayShape', () => {
  describe('de a dos (pair_size=2)', () => {
    it('parte el plantel en parejas y cuenta el round robin', () => {
      const shape = matchdayShape({ confirmed: 12, looseGuests: 0, guestPairs: 0, sideSize: 2, formato: ROUND_ROBIN })
      expect(shape.size).toBe(12)
      expect(shape.sides).toBe(6)
      expect(shape.matches).toBe(15)
      expect(shape.complete).toBe(true)
      expect(shape.needsLooseGuest).toBe(false)
    })

    it('con plantel impar pide el invitado suelto que empareja', () => {
      const shape = matchdayShape({ confirmed: 7, looseGuests: 0, guestPairs: 0, sideSize: 2, formato: ROUND_ROBIN })
      expect(shape.needsLooseGuest).toBe(true)
      expect(shape.eventualSize).toBe(8)
      // 7 solos no bloquea por piso: van a ser 8.
      expect(shape.tooFew).toBe(false)
    })

    it('no vuelve a pedir un suelto cuando ya hay uno', () => {
      const shape = matchdayShape({ confirmed: 7, looseGuests: 1, guestPairs: 0, sideSize: 2, formato: ROUND_ROBIN })
      expect(shape.needsLooseGuest).toBe(false)
      expect(shape.size).toBe(8)
      expect(shape.complete).toBe(true)
    })

    it('una pareja invitada suma dos y no cambia la paridad', () => {
      const shape = matchdayShape({ confirmed: 8, looseGuests: 0, guestPairs: 1, sideSize: 2, formato: ROUND_ROBIN })
      expect(shape.size).toBe(10)
      expect(shape.sides).toBe(5)
      expect(shape.needsLooseGuest).toBe(false)
    })

    it('marca la fecha incompleta cuando queda alguien sin pareja', () => {
      // Plantel par con un suelto YA nombrado: `syncGuestSeat` lo conserva a
      // propósito y la fecha queda impar. Es el caso que el comentario de
      // `armado.tsx` nombraba como no dibujado.
      const shape = matchdayShape({ confirmed: 8, looseGuests: 1, guestPairs: 0, sideSize: 2, formato: ROUND_ROBIN })
      expect(shape.size).toBe(9)
      expect(shape.complete).toBe(false)
    })
  })

  describe('de a uno (pair_size=1)', () => {
    it('cada jugador es su propio lado: la paridad no existe', () => {
      const shape = matchdayShape({ confirmed: 9, looseGuests: 0, guestPairs: 0, sideSize: 1, formato: ROUND_ROBIN })
      expect(shape.sides).toBe(9)
      expect(shape.needsLooseGuest).toBe(false)
      expect(shape.complete).toBe(true)
      expect(shape.eventualSize).toBe(9)
    })

    it('nunca pide un invitado para emparejar, ni con plantel impar', () => {
      for (const confirmed of [7, 8, 9, 10, 11]) {
        const shape = matchdayShape({ confirmed, looseGuests: 0, guestPairs: 0, sideSize: 1, formato: ROUND_ROBIN })
        expect(shape.needsLooseGuest).toBe(false)
        expect(shape.complete).toBe(true)
      }
    })

    it('cuenta los partidos que la fecha va a tener de verdad', () => {
      // El número que W32 nombra y la pantalla nunca mostró: 12 de a uno son
      // 66 partidos donde 12 de a dos son 15.
      expect(matchdayShape({ confirmed: 8, looseGuests: 0, guestPairs: 0, sideSize: 1, formato: ROUND_ROBIN }).matches).toBe(28)
      expect(matchdayShape({ confirmed: 12, looseGuests: 0, guestPairs: 0, sideSize: 1, formato: ROUND_ROBIN }).matches).toBe(66)
      expect(matchdayShape({ confirmed: 12, looseGuests: 0, guestPairs: 0, sideSize: 2, formato: ROUND_ROBIN }).matches).toBe(15)
    })

    /**
     * W72 (verify-report-pr21 #4004): con "2 grupos + llave" ya elegido y
     * GUARDADO en la base, la banda seguía prometiendo el round robin —28,
     * la fórmula vieja hardcodeada— cuando los partidos reales son 12 de
     * grupo + 4 de llave (semis, final y tercer puesto) = 16. `matches`
     * tiene que mirar el `formato` que llega, no asumir siempre round robin.
     */
    it('con "2 grupos + llave" ya elegido, cuenta los partidos reales — no el round robin', () => {
      const grupos2: MatchdayFormat = { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 }
      const shape = matchdayShape({ confirmed: 8, looseGuests: 0, guestPairs: 0, sideSize: 1, formato: grupos2 })
      expect(shape.matches).toBe(16)
    })

    it('una pareja invitada suma dos jugadores que juegan solos', () => {
      // La matriz tenía `guestPairs` sólo con
      //`sideSize: 2`. Este es el caso que produjo W41 — el servidor rechazaba
      // esta misma fecha mientras la pantalla la mostraba armable.
      const shape = matchdayShape({ confirmed: 8, looseGuests: 0, guestPairs: 1, sideSize: 1, formato: ROUND_ROBIN })
      expect(shape.size).toBe(10)
      expect(shape.sides).toBe(10)
      expect(shape.matches).toBe(45)
      expect(shape.complete).toBe(true)
      expect(shape.needsLooseGuest).toBe(false)
      // Y el servidor tiene que estar de acuerdo: con W41 arreglado,
      // `assertPointsCoverMatchday` cuenta 8 competidores del torneo para esta
      // misma fecha —los 2 invitados son dos lados que no cobran—, así que la
      // pantalla y la base dicen lo mismo. Antes de W41 el botón estaba
      // habilitado y el sorteo rebotaba.
      expect(shape.tooMany).toBe(false)
    })

    it('respeta el piso derivado del deporte, y el mismo techo que la base enforcea hoy', () => {
      // El PISO ahora se deriva de `sideSize` (`minSquadFor`, docs/tipos-de-
      // torneo.md §3.3) igual que `assertMatchdaySize` (db/validate.ts): de a
      // uno el piso real es 2, no el MIN_PLAYERS=8 plano heredado del 2v2. El
      // TECHO sigue plano (MAX_PLAYERS) — W32 sigue abierto, reasignado a
      // PR21/grupos, y esta rebanada no lo toca.
      expect(matchdayShape({ confirmed: 1, looseGuests: 0, guestPairs: 0, sideSize: 1, formato: ROUND_ROBIN }).tooFew).toBe(true)
      expect(matchdayShape({ confirmed: 2, looseGuests: 0, guestPairs: 0, sideSize: 1, formato: ROUND_ROBIN }).tooFew).toBe(false)
      expect(matchdayShape({ confirmed: 13, looseGuests: 0, guestPairs: 0, sideSize: 1, formato: ROUND_ROBIN }).tooMany).toBe(true)
      expect(matchdayShape({ confirmed: 12, looseGuests: 0, guestPairs: 0, sideSize: 1, formato: ROUND_ROBIN }).tooMany).toBe(false)
    })
  })

  /**
   * REQ-D8-1: `matchdayShape` expone el `suggestedFormat` de `suggestFormat`,
   * editable antes de armar (el selector de `armado.tsx` es lo que lo hace
   * editable — acá sólo se fija que la SUGERENCIA que ve la pantalla es la
   * real y no una copia). Usa `eventualSize`, no `confirmed`: el suelto que
   * `syncGuestSeat` va a sumar para emparejar cuenta para la sugerencia igual
   * que cuenta para `matches`.
   */
  describe('suggestedFormat (REQ-D8-1)', () => {
    it('8 presentes de a uno sugieren 2 grupos + llave, el ejemplo del requisito', () => {
      const shape = matchdayShape({ confirmed: 8, looseGuests: 0, guestPairs: 0, sideSize: 1, formato: ROUND_ROBIN })
      expect(shape.suggestedFormat).toEqual({ kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 })
    })

    it('12 de a uno sugieren 4 grupos: la salida real de W32, no 66 partidos de round robin', () => {
      const shape = matchdayShape({ confirmed: 12, looseGuests: 0, guestPairs: 0, sideSize: 1, formato: ROUND_ROBIN })
      expect(shape.suggestedFormat).toEqual({ kind: 'GROUPS_KNOCKOUT', groups: 4, qualifiersPerGroup: 2 })
    })

    it('un plantel chico sugiere todos contra todos, de a uno o de a dos', () => {
      expect(matchdayShape({ confirmed: 5, looseGuests: 0, guestPairs: 0, sideSize: 1, formato: ROUND_ROBIN }).suggestedFormat).toEqual({
        kind: 'ROUND_ROBIN',
      })
      expect(matchdayShape({ confirmed: 8, looseGuests: 0, guestPairs: 0, sideSize: 2, formato: ROUND_ROBIN }).suggestedFormat).toEqual({
        kind: 'ROUND_ROBIN',
      })
    })

    it('cuenta el suelto que todavía no está: la sugerencia usa eventualSize, no confirmed', () => {
      // 7 confirmados de a dos piden un suelto (eventualSize 8, 4 lados) — la
      // sugerencia tiene que mirar esos 4 lados, no los 3 lados y pico de 7.
      const shape = matchdayShape({ confirmed: 7, looseGuests: 0, guestPairs: 0, sideSize: 2, formato: ROUND_ROBIN })
      expect(shape.eventualSize).toBe(8)
      expect(shape.suggestedFormat).toEqual({ kind: 'ROUND_ROBIN' })
    })
  })
})

/**
 * Cuántos invitados puede acomodar el sorteo, que es la cuenta que decide si
 * "Generar parejas" se ofrece o se apaga.
 *
 * Espeja `assertSquadCoversLooseGuests` (db/validate.ts): el sorteo le da a
 * cada invitado suelto un jugador del torneo DISTINTO mientras alcancen, y
 * pasado eso el pigeonhole obliga a una pareja invitado-invitado que la fecha
 * rebota. Sin este test, volver a poner el tope en uno —el defecto que esta
 * tanda revierte— deja todo en verde y le saca al admin una opción que el
 * dueño del producto pidió.
 */
describe('drawRoom', () => {
  it('cuenta a los dos invitados sin compañero y al plantel que los puede acompañar', () => {
    const room = drawRoom(squad, [{ partnerId: null }, { partnerId: null }], null)

    expect(room).toEqual({ toTheDraw: 2, freeSquad: 2 })
  })

  it('no cuenta al invitado que ya tiene compañero elegido', () => {
    const room = drawRoom(squad, [{ partnerId: 'a' }, { partnerId: null }], null)

    expect(room.toTheDraw).toBe(1)
  })

  it('no cuenta como libre al jugador ya elegido como compañero', () => {
    const room = drawRoom(squad, [{ partnerId: 'a' }], null)

    expect(room.freeSquad).toBe(1)
  })

  it('no cuenta como libre al que avisó que no va', () => {
    const room = drawRoom(squad, [], null)

    expect(room.freeSquad).toBe(2)
  })

  it('deja ver cuándo los invitados pasan al plantel libre', () => {
    const room = drawRoom(
      squad,
      [{ partnerId: null }, { partnerId: null }, { partnerId: null }],
      null,
    )

    expect(room.toTheDraw > room.freeSquad).toBe(true)
  })

  // El mismo agujero que tenía `assertSquadCoversLooseGuests`: `buildPairs`
  // arma `settled` con los defensores antes de que exista el pool, así que no
  // son acompañantes disponibles. Sin este descuento la pantalla ofrecía
  // "Generar parejas" para una fecha que el borde rebota.
  it('no cuenta como libres a los defensores, que salen del pool antes del sorteo', () => {
    const room = drawRoom(squad, [{ partnerId: null }], pair('a', 'b'))

    expect(room.freeSquad).toBe(0)
  })

  it('cuenta a los defensores como libres si uno de los dos no viene', () => {
    // Mismo criterio que `resolveDefenders`: sin los dos presentes la pareja se
    // disuelve y el que sí vino vuelve al pool.
    const room = drawRoom(squad, [{ partnerId: null }], pair('a', 'c'))

    expect(room.freeSquad).toBe(2)
  })

  it('cuenta a los defensores como libres cuando no hay ninguno', () => {
    const room = drawRoom(squad, [{ partnerId: null }], null)

    expect(room.freeSquad).toBe(2)
  })
})

/**
 * El asiento que la paridad EXIGE, y por eso el único sin cruz: sacarlo es un
 * no-op porque `removeLooseGuestSeat` cierra con `syncGuestSeat`, que lo repone
 * en el acto.
 *
 * Vivía inline en `armado.tsx`, que es `'use client'` y no se puede importar
 * desde la suite pura: decide qué asiento se puede sacar y cuál no, y nadie lo
 * probaba.
 */
describe('parityGuestSeat', () => {
  const impar: SeatVM[] = [
    { entryId: 'a', name: 'Ana', playing: true },
    { entryId: 'b', name: 'Beto', playing: true },
    { entryId: 'c', name: 'Cami', playing: true },
  ]

  it('exige el asiento con el plantel impar y un solo suelto', () => {
    expect(parityGuestSeat(impar, 1)).toBe(true)
  })

  it('no lo exige con el plantel par', () => {
    expect(parityGuestSeat(squad, 1)).toBe(false)
  })

  it('no lo exige con un segundo suelto en pantalla', () => {
    expect(parityGuestSeat(impar, 2)).toBe(false)
  })

  it('no lo exige cuando todavía no hay ningún suelto', () => {
    expect(parityGuestSeat(impar, 0)).toBe(false)
  })

  it('mide la paridad sobre los que vienen, no sobre el plantel entero', () => {
    // `squad` son tres asientos con uno ausente: dos confirmados, par.
    expect(squad).toHaveLength(3)
    expect(parityGuestSeat(squad, 1)).toBe(false)
  })
})

/**
 * El compañero que el admin trabó y que después avisó que no va.
 *
 * `toggleAttendance` no toca `pair_locks`, así que el invitado queda trabado
 * con un ausente: la fecha rebota en el borde y la tarjeta afirmaba que "los
 * puntos de la pareja los cobra" alguien que no viene.
 */
describe('guestPartnerAbsent', () => {
  it('es falso para el invitado que va al sorteo', () => {
    expect(guestPartnerAbsent(squad, { partnerId: null })).toBe(false)
  })

  it('es falso cuando el compañero elegido viene', () => {
    expect(guestPartnerAbsent(squad, { partnerId: 'a' })).toBe(false)
  })

  it('es verdadero cuando el compañero elegido avisó que no va', () => {
    expect(guestPartnerAbsent(squad, { partnerId: 'c' })).toBe(true)
  })

  it('es verdadero cuando el compañero no está en el plantel dibujado', () => {
    expect(guestPartnerAbsent(squad, { partnerId: 'fantasma' })).toBe(true)
  })
})
