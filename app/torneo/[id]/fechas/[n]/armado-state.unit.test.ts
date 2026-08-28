import { describe, expect, it } from 'vitest'
import { applySeatTick, drawRoom, type SeatVM } from './armado-state'

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
    const room = drawRoom(squad, [{ partnerId: null }, { partnerId: null }])

    expect(room).toEqual({ toTheDraw: 2, freeSquad: 2 })
  })

  it('no cuenta al invitado que ya tiene compañero elegido', () => {
    const room = drawRoom(squad, [{ partnerId: 'a' }, { partnerId: null }])

    expect(room.toTheDraw).toBe(1)
  })

  it('no cuenta como libre al jugador ya elegido como compañero', () => {
    const room = drawRoom(squad, [{ partnerId: 'a' }])

    expect(room.freeSquad).toBe(1)
  })

  it('no cuenta como libre al que avisó que no va', () => {
    const room = drawRoom(squad, [])

    expect(room.freeSquad).toBe(2)
  })

  it('deja ver cuándo los invitados pasan al plantel libre', () => {
    const room = drawRoom(squad, [{ partnerId: null }, { partnerId: null }, { partnerId: null }])

    expect(room.toTheDraw > room.freeSquad).toBe(true)
  })
})
