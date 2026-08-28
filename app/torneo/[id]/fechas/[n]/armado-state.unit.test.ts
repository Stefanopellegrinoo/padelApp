import { describe, expect, it } from 'vitest'
import {
  applySeatTick,
  drawRoom,
  guestPartnerAbsent,
  parityGuestSeat,
  type SeatVM,
} from './armado-state'

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
    const room = drawRoom(squad, [{ partnerId: null }], { a: 'a', b: 'b' })

    expect(room.freeSquad).toBe(0)
  })

  it('cuenta a los defensores como libres si uno de los dos no viene', () => {
    // Mismo criterio que `resolveDefenders`: sin los dos presentes la pareja se
    // disuelve y el que sí vino vuelve al pool.
    const room = drawRoom(squad, [{ partnerId: null }], { a: 'a', b: 'c' })

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
