import { describe, expect, it } from 'vitest'
import { defendersOf, type ClosedMatchdayAwards } from './tabla-state'

const nameOf = new Map([
  ['a1', 'Ana'],
  ['a2', 'Beto'],
  ['b1', 'Cami'],
  ['b2', 'Dani'],
])

/** Una fecha cerrada con quiénes cobraron la posición 1. */
function closed(number: number, winners: string[]): ClosedMatchdayAwards {
  return {
    number,
    awards: [
      ...winners.map((entryId) => ({ entryId, position: 1 })),
      // Alguien en posición 2, para que el filtro por `position === 1` tenga
      // algo que descartar y no acierte por vacío.
      { entryId: 'relleno', position: 2 },
    ],
  }
}

describe('defendersOf', () => {
  it('la pareja que ganó la última fecha cerrada defiende', () => {
    const defenders = defendersOf([closed(2, ['a1', 'a2']), closed(1, ['b1', 'b2'])], nameOf, 2)
    expect(defenders).toEqual({ matchdayNumber: 2, names: ['Ana', 'Beto'] })
  })

  it('no defiende quien ya repitió: esa pareja gastó su defensa', () => {
    const defenders = defendersOf([closed(2, ['a1', 'a2']), closed(1, ['a1', 'a2'])], nameOf, 2)
    expect(defenders).toBeNull()
  })

  it('sin fechas cerradas no hay nada que defender', () => {
    expect(defendersOf([], nameOf, 2)).toBeNull()
  })

  it('una fecha cerrada sin ganador en posición 1 no inventa defensores', () => {
    expect(defendersOf([{ number: 2, awards: [{ entryId: 'a1', position: 2 }] }], nameOf, 2)).toBeNull()
  })

  it('toma la ÚLTIMA cerrada, no la primera de la lista', () => {
    // Desordenada a propósito: el orden lo tiene que poner la función.
    const defenders = defendersOf([closed(1, ['b1', 'b2']), closed(2, ['a1', 'a2'])], nameOf, 2)
    expect(defenders?.matchdayNumber).toBe(2)
  })

  /*
   *. Esta derivación no miraba `pairSize`, así
   * que la Tabla de una disciplina de a uno anunciaba "Ganaron la fecha 2 ·
   * les queda 1 defensa / Repiten" sobre un jugador solo — verificado en HTML
   *Real por la.
   *
   * La regla del campeón que defiende es una restricción DEL SORTEO DE
   * PAREJAS: `pairingContextFor` hardcodea `defenders: null` con `pairSize=1`
   *Y `buildSides` con `sideSize===1` ignora `defenders` entero. La
   * pantalla prometía una regla que el sorteo no aplica, y un admin que lea
   * "Repiten" va a reportar un bug del sorteo que no existe.
   */
  it('de a uno no hay defensores: nadie tiene con quién repetir', () => {
    expect(defendersOf([closed(2, ['a1']), closed(1, ['b1'])], nameOf, 1)).toBeNull()
  })

  it('de a uno tampoco los hay con una sola fecha cerrada', () => {
    expect(defendersOf([closed(1, ['a1'])], nameOf, 1)).toBeNull()
  })
})
