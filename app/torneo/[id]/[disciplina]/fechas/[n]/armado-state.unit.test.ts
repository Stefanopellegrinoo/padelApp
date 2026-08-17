import { describe, expect, it } from 'vitest'
import { applySeatTick, type SeatVM } from './armado-state'

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
