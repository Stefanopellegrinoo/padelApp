import { describe, expect, it } from 'vitest'
import { members, pair, single, type Side, type SideStanding } from '@/core'
import { frozenTableRows, orderMoved } from './tabla-congelada'

/**
 * W57 (verify-report ronda 17). El arreglo de W55 congeló el orden de la tabla
 * de una fecha cerrada usando `awards.position`, con `?? Number.MAX_SAFE_INTEGER`
 * para los lados que no tienen fila en `awards`. Un lado hecho SÓLO de invitados
 * no cobra (`core/awards.ts`: "A pair made only of guests is outside the
 * championship altogether. **It keeps its place in the matchday table** but
 * consumes no paying position"), así que se iba al FONDO: la pareja de dos
 * invitados que ganó los 4 partidos con +16 pasó de PRIMERA a ÚLTIMA. Medido
 * por la auditoría con navegador real contra los dos builds, y **también con
 * `pair_size = 2`, que es el camino de producción** — el `sort` nunca estuvo
 * gateado por la aridad.
 *
 * W55 entró sin una sola aserción nueva y de ahí salieron W56 y W57. Esto es lo
 * que faltaba: **la columna de puntos es monótona decreciente Y el lado sin
 * award conserva su lugar deportivo**.
 */

const puntos = new Map<string, { position: number; points: number }>()

function standing(side: Side, position: number): SideStanding {
  return { side, played: 4, won: 0, setsDiff: 0, gamesDiff: 0, position }
}

/** Los puntos de las filas dibujadas, en el orden en que se dibujan, salteando a quien no cobró. */
function columnaDePuntos(
  filas: readonly SideStanding[],
  frozen: ReadonlyMap<string, { points: number }>,
): number[] {
  return filas
    .map((fila) =>
      members(fila.side)
        .map((entryId) => frozen.get(entryId)?.points)
        .find((valor) => valor !== undefined),
    )
    .filter((valor): valor is number => valor !== undefined)
}

describe('frozenTableRows', () => {
  it('de a dos, la pareja de invitados que ganó todo conserva su lugar deportivo', () => {
    // Escena medida por la auditoría (verify-report ronda 17, anexo 4f):
    // `pair_size = 2`, la pareja de dos invitados gana los 4 partidos con +16 y
    // `computeStandings` la pone PRIMERA. No tiene fila en `awards` porque
    // ninguno de los dos está en el campeonato.
    const invitados = pair('invi1', 'invi2')
    const filas = [
      standing(invitados, 1),
      standing(pair('j3', 'j6'), 2),
      standing(pair('j1', 'j8'), 3),
      standing(pair('j4', 'j5'), 4),
      standing(pair('j2', 'j7'), 5),
    ]
    const frozen = new Map([
      ['j3', { position: 1, points: 4 }],
      ['j6', { position: 1, points: 4 }],
      ['j1', { position: 2, points: 3 }],
      ['j8', { position: 2, points: 3 }],
      ['j4', { position: 3, points: 2 }],
      ['j5', { position: 3, points: 2 }],
      ['j2', { position: 4, points: 1 }],
      ['j7', { position: 4, points: 1 }],
    ])

    const dibujadas = frozenTableRows(filas, frozen)

    expect(dibujadas[0]?.side).toEqual(invitados)
    expect(dibujadas.at(-1)?.side).not.toEqual(invitados)
    // Monótona decreciente entre los que sí cobran, que es lo que W55 vino a
    // arreglar: la fila de arriba nunca muestra menos puntos que la de abajo.
    expect(columnaDePuntos(dibujadas, frozen)).toEqual([4, 3, 2, 1])
  })

  it('los lados que SÍ cobran quedan en orden de puesto congelado, no del vivo', () => {
    // No-regresión de W55: bajar `setsToWin` después de cerrar reordena
    // `computeStandings` mientras `awards` sigue congelado. Sin esto la tabla
    // mostraba al primero con 6 puntos y al segundo con 8.
    const filas = [
      standing(single('a'), 1),
      standing(single('b'), 2),
      standing(single('c'), 3),
      standing(single('d'), 4),
    ]
    const frozen = new Map([
      ['a', { position: 3, points: 6 }],
      ['b', { position: 1, points: 8 }],
      ['c', { position: 2, points: 7 }],
      ['d', { position: 4, points: 5 }],
    ])

    const dibujadas = frozenTableRows(filas, frozen)

    expect(dibujadas.map((fila) => members(fila.side)[0])).toEqual(['b', 'c', 'a', 'd'])
    expect(columnaDePuntos(dibujadas, frozen)).toEqual([8, 7, 6, 5])
  })

  it('el Masters, que no reparte puntos, deja la tabla como estaba', () => {
    // S60: `frozenPointsOf` ni se consulta con el Masters (spec 2.7, no reparte),
    // así que el Map llega vacío. Hasta ahora el orden se preservaba sólo porque
    // `Array.prototype.sort` es estable desde ES2019 — una garantía que ningún
    // test fijaba.
    const filas = [
      standing(pair('a', 'b'), 1),
      standing(pair('c', 'd'), 2),
      standing(pair('e', 'f'), 3),
      standing(pair('g', 'h'), 4),
    ]

    expect(frozenTableRows(filas, puntos)).toEqual(filas)
  })
})

/**
 * W56 (verify-report ronda 17). El mismo arreglo de W55 dejó el pie de la tabla
 * leyendo el orden VIVO mientras la tabla pasó al congelado: decía "Jugador de
 * test 4 quedó 2° por diferencia de games" sobre quien la tabla dibuja PRIMERO,
 * citando como mejor a alguien que aparece dos filas más abajo. La tabla no
 * imprime ordinales, así que el pie es el ÚNICO número de puesto que el usuario
 * ve — y es el que quedó desincronizado.
 *
 * El pie no se dibuja cuando el orden dibujado difiere del vivo, que es
 * exactamente cuando mentiría. Este predicado es esa condición.
 */
describe('orderMoved', () => {
  const filas = [
    standing(single('a'), 1),
    standing(single('b'), 2),
    standing(single('c'), 3),
  ]

  it('dice que no se movió cuando la tabla dibuja el orden vivo', () => {
    expect(orderMoved(filas, frozenTableRows(filas, puntos))).toBe(false)
  })

  it('dice que se movió cuando el puesto congelado reordena la tabla', () => {
    const frozen = new Map([
      ['a', { position: 2 }],
      ['b', { position: 1 }],
      ['c', { position: 3 }],
    ])

    expect(orderMoved(filas, frozenTableRows(filas, frozen))).toBe(true)
  })

  it('un lado sin premio que conserva su lugar no cuenta como movimiento', () => {
    // W57 dejó a los invitados donde estaban; si eso contara como movimiento, el
    // pie desaparecería de toda fecha con invitados aunque diga la verdad.
    const conInvitado = [
      standing(single('invi'), 1),
      standing(single('a'), 2),
      standing(single('b'), 3),
    ]
    const frozen = new Map([
      ['a', { position: 1 }],
      ['b', { position: 2 }],
    ])

    expect(orderMoved(conInvitado, frozenTableRows(conInvitado, frozen))).toBe(false)
  })
})
