import { describe, it, expect } from 'vitest'
import { currentPhase, phaseIsComplete, faseForCount, knockoutMatchups, nextRoundMatchups } from './knockout'
import { pair, single } from './side'
import type { MatchResult, Phase, Side, SideStanding } from './types'

const A = pair('a1', 'a2')
const B = pair('b1', 'b2')

function match(fase: Phase, played: boolean, grupo = 1): MatchResult {
  return { round: 1, fase, grupo, sideA: A, sideB: B, sets: played ? [{ gamesA: 4, gamesB: 1 }] : [] }
}

/** Un `SideStanding` mínimo: sólo `side`/`position` importan a estos tests. */
function standing(side: Side, position: number): SideStanding {
  return { side, played: 0, won: 0, drawn: 0, dayPoints: 0, setsDiff: 0, gamesDiff: 0, position }
}

/** Un partido de llave ya jugado, con ganador elegido a mano. */
function playedMatch(fase: Phase, grupo: number, sideA: Side, sideB: Side, winner: 'A' | 'B'): MatchResult {
  const sets = winner === 'A' ? [{ gamesA: 4, gamesB: 1 }] : [{ gamesA: 1, gamesB: 4 }]
  return { round: 1, fase, grupo, sideA, sideB, sets }
}

describe('currentPhase', () => {
  it('sin partidos, no hay fase', () => {
    expect(currentPhase([])).toBeNull()
  })

  it('con GRUPO y CUARTOS creados, la fase actual es la más avanzada', () => {
    const matches = [match('GRUPO', true), match('CUARTOS', false)]
    expect(currentPhase(matches)).toBe('CUARTOS')
  })

  it('con una sola fase, esa es la actual', () => {
    expect(currentPhase([match('GRUPO', false)])).toBe('GRUPO')
  })

  it('TERCER_PUESTO no tapa a FINAL: se generan juntas y el máximo da FINAL', () => {
    // Mismo orden que PHASE_ORDER (y que el array de matchday_phase en SQL,
    // 0039_match_phase.sql): TERCER_PUESTO va ANTES de FINAL a propósito.
    const matches = [match('SEMI', true), match('TERCER_PUESTO', false), match('FINAL', false)]
    expect(currentPhase(matches)).toBe('FINAL')
  })
})

describe('phaseIsComplete', () => {
  it('con un partido de la fase sin jugar, no está completa', () => {
    const matches = [match('GRUPO', true), match('GRUPO', false, 2)]
    expect(phaseIsComplete(matches, 'GRUPO')).toBe(false)
  })

  it('con todos los partidos de la fase jugados, está completa', () => {
    const matches = [match('GRUPO', true), match('GRUPO', true, 2)]
    expect(phaseIsComplete(matches, 'GRUPO')).toBe(true)
  })

  it('sin partidos de esa fase, no está completa', () => {
    expect(phaseIsComplete([match('GRUPO', true)], 'CUARTOS')).toBe(false)
  })
})

describe('faseForCount', () => {
  it('mapea la cantidad de partidos de la llave a su fase', () => {
    expect(faseForCount(8)).toBe('OCTAVOS')
    expect(faseForCount(4)).toBe('CUARTOS')
    expect(faseForCount(2)).toBe('SEMI')
    expect(faseForCount(1)).toBe('FINAL')
  })

  it('tira con una cantidad que no es una fase conocida', () => {
    expect(() => faseForCount(3)).toThrow(/3/)
  })
})

describe('knockoutMatchups', () => {
  // decisión (a) — el design NO dice cómo se cruza la llave. Regla elegida
  // (ver `core/knockout.ts`): cruzar grupos para que los primeros no se
  // encuentren antes de semifinales, y ningún grupo se enfrente a su propio
  // 2º puesto en el primer cruce.
  const A1 = pair('a1', 'a2')
  const A2 = pair('a3', 'a4')
  const B1 = pair('b1', 'b2')
  const B2 = pair('b3', 'b4')
  const C1 = pair('c1', 'c2')
  const C2 = pair('c3', 'c4')
  const D1 = pair('d1', 'd2')
  const D2 = pair('d3', 'd4')

  const groupA = [standing(A1, 1), standing(A2, 2)]
  const groupB = [standing(B1, 1), standing(B2, 2)]
  const groupC = [standing(C1, 1), standing(C2, 2)]
  const groupD = [standing(D1, 1), standing(D2, 2)]

  it('con 1 grupo, el 1º y el 2º arman el único cruce', () => {
    expect(knockoutMatchups([groupA], 2)).toEqual([[A1, A2]])
  })

  it('con 2 grupos, cruza para que los primeros no se enfrenten antes de la final (A1-B2, B1-A2)', () => {
    expect(knockoutMatchups([groupA, groupB], 2)).toEqual([
      [A1, B2],
      [B1, A2],
    ])
  })

  it('con 4 grupos, separa los 4 primeros en mitades distintas del cuadro', () => {
    // nextRoundMatchups empareja de a dos EN ORDEN: [0]+[1] arman una semi,
    // [2]+[3] la otra. Con este orden, A1 y C1 quedan de un lado (sólo se
    // pueden cruzar en semifinal), B1 y D1 del otro — y ningún grupo se
    // enfrenta a su propio 2º puesto en cuartos.
    expect(knockoutMatchups([groupA, groupB, groupC, groupD], 2)).toEqual([
      [A1, B2],
      [C1, D2],
      [B1, A2],
      [D1, C2],
    ])
  })

  it('tira con una cantidad de grupos que no sabe cruzar', () => {
    expect(() => knockoutMatchups([groupA, groupB, groupC], 2)).toThrow(/3/)
  })

  it('tira si los clasificados por grupo no son 2', () => {
    expect(() => knockoutMatchups([groupA, groupB], 1)).toThrow(/1/)
  })
})

describe('nextRoundMatchups', () => {
  it('con una ronda de 4 partidos jugada, arma la siguiente de 2', () => {
    const A1 = pair('a1', 'a2')
    const A2 = pair('a3', 'a4')
    const B1 = pair('b1', 'b2')
    const B2 = pair('b3', 'b4')
    const C1 = pair('c1', 'c2')
    const C2 = pair('c3', 'c4')
    const D1 = pair('d1', 'd2')
    const D2 = pair('d3', 'd4')

    const played = [
      playedMatch('CUARTOS', 1, A1, B2, 'A'), // gana A1
      playedMatch('CUARTOS', 1, C1, D2, 'B'), // gana D2
      playedMatch('CUARTOS', 1, B1, A2, 'A'), // gana B1
      playedMatch('CUARTOS', 1, D1, C2, 'B'), // gana C2
    ]

    expect(nextRoundMatchups(played)).toEqual([
      [A1, D2],
      [B1, C2],
    ])
  })

  it('tira con una cantidad de partidos que no arma parejas completas', () => {
    const A1 = pair('a1', 'a2')
    const B1 = pair('b1', 'b2')
    const C1 = pair('c1', 'c2')
    const played = [
      playedMatch('SEMI', 1, A1, B1, 'A'),
      playedMatch('SEMI', 1, B1, C1, 'A'),
      playedMatch('SEMI', 1, C1, A1, 'A'),
    ]
    expect(() => nextRoundMatchups(played)).toThrow(/3/)
  })
})
