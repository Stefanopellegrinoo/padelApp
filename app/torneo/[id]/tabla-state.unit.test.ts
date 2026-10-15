import { describe, expect, it } from 'vitest'
import type { DisciplineId } from '@/core'
import {
  defendersOf,
  mastersCutoffFor,
  pairRows,
  singleDisciplineRedirect,
  volverDestination,
  type ClosedMatchdayAwards,
} from './tabla-state'
import type { StandingsRow } from './desempate'

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
   * W42. Esta derivación no miraba `pairSize`, así
   * que la Tabla de una disciplina de a uno anunciaba "Ganaron la fecha 2 ·
   * les queda 1 defensa / Repiten" sobre un jugador solo — verificado en HTML
   * real por la auditoría.
   *
   * La regla del campeón que defiende es una restricción DEL SORTEO DE
   * PAREJAS: `pairingContextFor` hardcodea `defenders: null` con `pairSize=1`
   * (C19) y `buildSides` con `sideSize===1` ignora `defenders` entero. La
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

describe('volverDestination', () => {
  it('con 2+ disciplinas sube a la tabla global de la temporada', () => {
    expect(volverDestination('s1', 2)).toEqual({ href: '/torneo/s1', label: 'Tabla general' })
  })

  it('con exactamente 1 disciplina no vuelve a la raíz (esa raíz redirige acá y rebota) — manda a Mis torneos', () => {
    expect(volverDestination('s1', 1)).toEqual({ href: '/torneos', label: 'Mis torneos' })
  })
})

describe('singleDisciplineRedirect', () => {
  it('con exactamente 1 disciplina redirige a su Tabla', () => {
    const target = singleDisciplineRedirect('s1', [{ id: 'd1' as DisciplineId, kind: 'PADEL' }])
    expect(target).toBe('/torneo/s1/padel')
  })

  it('con 2+ disciplinas no redirige: la raíz se queda mostrando la global', () => {
    const target = singleDisciplineRedirect('s1', [
      { id: 'd1' as DisciplineId, kind: 'PADEL' },
      { id: 'd2' as DisciplineId, kind: 'FIFA' },
    ])
    expect(target).toBeNull()
  })
})

describe('mastersCutoffFor', () => {
  it('con Masters el corte cae después de los MASTERS_SIZE primeros', () => {
    expect(mastersCutoffFor(true, 8)).toBe(4)
  })

  it('sin Masters el corte queda fuera de rango: no se dibuja', () => {
    expect(mastersCutoffFor(false, 8)).toBe(9)
  })
})

/** Una fila de la tabla por persona, en el orden que le da el ranking. */
function row(
  entryId: string,
  displayName: string,
  position: number,
  points: number,
  extra: Partial<StandingsRow> = {},
): StandingsRow {
  return {
    entryId,
    displayName,
    initials: displayName.slice(0, 1),
    position,
    points,
    movement: 0,
    tiedWithEntryId: null,
    ...extra,
  }
}

/** Seis jugadores, uno por puesto: e1 Ana ... e6 Fede. */
function sixPlayers(): StandingsRow[] {
  return [
    row('e1', 'Ana', 1, 34, { movement: 2 }),
    row('e2', 'Beto', 2, 30, { movement: -1 }),
    row('e3', 'Cami', 3, 28),
    row('e4', 'Dani', 4, 20),
    row('e5', 'Eli', 5, 10),
    row('e6', 'Fede', 6, 0),
  ]
}

describe('pairRows', () => {
  it('una fila por pareja: el nombre es "A & B" y puntos, movimiento y lugar son los del mejor ubicado', () => {
    const { rows } = pairRows(sixPlayers(), [
      { a: 'e1', b: 'e4' },
      { a: 'e2', b: 'e3' },
    ])

    expect(rows.map((r) => r.displayName)).toEqual(['Ana & Dani', 'Beto & Cami', 'Eli', 'Fede'])
    // Ana (34 pts, ▲2) va por Dani (20 pts): la pareja muestra lo de Ana.
    expect(rows[0]).toMatchObject({ entryId: 'e1', points: 34, movement: 2 })
    expect(rows[1]).toMatchObject({ entryId: 'e2', points: 30, movement: -1 })
  })

  it('los puestos se numeran de nuevo, 1..n, y los sueltos quedan como estaban', () => {
    const input = sixPlayers()
    const { rows } = pairRows(input, [
      { a: 'e1', b: 'e4' },
      { a: 'e2', b: 'e3' },
    ])

    expect(rows.map((r) => r.position)).toEqual([1, 2, 3, 4])
    expect(rows[2]).toEqual({ ...input[4]!, position: 3 })
    expect(rows[3]).toEqual({ ...input[5]!, position: 4 })
  })

  it('el orden sale de la tabla y no del orden de los equipos, ni de quién es "a" o "b"', () => {
    // Los equipos de una sola inserción vuelven de la base en orden de uuid
    // (nota de la tarea 11): el orden de `teams` no dice nada.
    const { rows } = pairRows(sixPlayers(), [
      { a: 'e3', b: 'e2' },
      { a: 'e4', b: 'e1' },
    ])

    expect(rows.map((r) => r.displayName)).toEqual(['Dani & Ana', 'Cami & Beto', 'Eli', 'Fede'])
    expect(rows.map((r) => r.entryId)).toEqual(['e1', 'e2', 'e5', 'e6'])
  })

  it('mastersAfter: con las dos parejas arriba, dos filas cubren a los 4 primeros jugadores', () => {
    const { mastersAfter } = pairRows(sixPlayers(), [
      { a: 'e1', b: 'e4' },
      { a: 'e2', b: 'e3' },
    ])
    expect(mastersAfter).toBe(2)
  })

  it('mastersAfter: un suelto arriba y una pareja después hacen falta tres filas para llegar a 4 jugadores', () => {
    // e1 suelto (1 jugador) + pareja e2/e3 (3 jugadores) + e4 (4): 3 filas.
    const { mastersAfter } = pairRows(sixPlayers(), [{ a: 'e2', b: 'e3' }])
    expect(mastersAfter).toBe(3)
  })

  it('sin equipos las filas quedan idénticas a las de entrada', () => {
    const input = sixPlayers()
    expect(pairRows(input, []).rows).toEqual(input)
  })

  it('un equipo con alguien que no está en la tabla se ignora: el otro queda como suelto', () => {
    const { rows } = pairRows(sixPlayers(), [{ a: 'e1', b: 'fantasma' }])
    expect(rows.map((r) => r.displayName)).toEqual(['Ana', 'Beto', 'Cami', 'Dani', 'Eli', 'Fede'])
  })

  describe('empates', () => {
    // Los dos de una pareja siempre empatan entre sí: el ⓘ tiene que marcar el
    // empate entre FILAS, no el de la pareja consigo misma.
    const tiedPairs = (): StandingsRow[] => [
      row('e1', 'Ana', 1, 20, { tiedWithEntryId: 'e2' }),
      row('e2', 'Beto', 2, 20, { tiedWithEntryId: 'e1' }),
      row('e3', 'Cami', 3, 20, { tiedWithEntryId: 'e4' }),
      row('e4', 'Dani', 4, 20, { tiedWithEntryId: 'e3' }),
    ]
    const teams = [
      { a: 'e1', b: 'e2' },
      { a: 'e3', b: 'e4' },
    ]

    it('dos parejas con los mismos puntos se marcan empatadas entre sí', () => {
      const { rows } = pairRows(tiedPairs(), teams)
      expect(rows.map((r) => r.tiedWithEntryId)).toEqual(['e3', 'e1'])
    })

    it('una pareja sin otra pareja con sus puntos no marca empate (aunque sus dos jugadores empaten entre sí)', () => {
      const input = tiedPairs().map((r) => (r.entryId === 'e3' || r.entryId === 'e4' ? { ...r, points: 10 } : r))
      const { rows } = pairRows(input, teams)
      expect(rows.map((r) => r.tiedWithEntryId)).toEqual([null, null])
    })

    it('sin fecha cerrada la tabla de entrada no marca empates y las parejas tampoco', () => {
      const input = tiedPairs().map((r) => ({ ...r, tiedWithEntryId: null }))
      const { rows } = pairRows(input, teams)
      expect(rows.map((r) => r.tiedWithEntryId)).toEqual([null, null])
    })
  })
})

describe('mastersCutoffFor con parejas fijas', () => {
  const teams = [
    { a: 'e1', b: 'e4' },
    { a: 'e2', b: 'e3' },
  ]

  it('con Masters el corte cae después de las filas que cubren a los 4 primeros jugadores', () => {
    const { rows, mastersAfter } = pairRows(sixPlayers(), teams)
    expect(mastersCutoffFor(true, rows.length, mastersAfter)).toBe(2)
  })

  it('sin Masters (FIFA "Parejas fijas") el corte queda fuera de rango: no hay línea', () => {
    const { rows, mastersAfter } = pairRows(sixPlayers(), teams)
    // 4 filas de pareja: fuera de rango es 5, no 7 (jugadores) ni 2.
    expect(mastersCutoffFor(false, rows.length, mastersAfter)).toBe(5)
  })
})
