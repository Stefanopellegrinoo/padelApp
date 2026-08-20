import { describe, it, expect } from 'vitest'
import { currentPhase, phaseIsComplete, faseForCount } from './knockout'
import { pair } from './side'
import type { MatchResult, Phase } from './types'

const A = pair('a1', 'a2')
const B = pair('b1', 'b2')

function match(fase: Phase, played: boolean, grupo = 1): MatchResult {
  return { round: 1, fase, grupo, sideA: A, sideB: B, sets: played ? [{ gamesA: 4, gamesB: 1 }] : [] }
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
