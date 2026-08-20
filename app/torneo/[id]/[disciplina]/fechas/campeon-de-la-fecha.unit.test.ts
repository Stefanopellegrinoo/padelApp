import { describe, expect, it } from 'vitest'
import { defaultConfig, pair, type MatchFormat, type MatchResult, type Side } from '@/core'
import { championRecord } from './campeon-de-la-fecha'

/**
 * La marca del campeón en la lista de fechas.
 *
 * Vivía adentro de `page.tsx` —un server component `async`— y por eso no tenía
 * un solo test. Se cae en los dos lados apenas la disciplina permite empates:
 * cuenta `ganados` y `perdidos` y **el empate se evapora** (un lado con 2
 * ganados, 1 empatado y 0 perdidos sale `2–0`, como si hubiera jugado dos
 * partidos), y llama `games` a lo que en FIFA son goles.
 */

const PADEL = defaultConfig(8).matchFormat
const FIFA: MatchFormat = { ...PADEL, openScore: true }

const A = pair('a1', 'a2')
const B = pair('b1', 'b2')
const C = pair('c1', 'c2')

function partido(izq: Side, der: Side, golesA: number, golesB: number): MatchResult {
  return { round: 1, sideA: izq, sideB: der, sets: [{ gamesA: golesA, gamesB: golesB }] }
}

describe('championRecord en pádel — no se mueve', () => {
  it('dice ganados–perdidos y cuenta games', () => {
    const matches = [partido(A, B, 4, 1), partido(A, C, 2, 4)]
    expect(championRecord(matches, A, PADEL, false)).toBe('1–1 · +1 games')
  })

  it('el signo + sólo va cuando la diferencia es positiva', () => {
    expect(championRecord([partido(A, B, 0, 4)], A, PADEL, false)).toBe('0–1 · -4 games')
  })

  it('ignora los partidos que el campeón no jugó', () => {
    const matches = [partido(A, B, 4, 0), partido(B, C, 4, 0)]
    expect(championRecord(matches, A, PADEL, false)).toBe('1–0 · +4 games')
  })
})

describe('championRecord donde el empate es legal', () => {
  it('dice ganados–empatados–perdidos, y el empate no se evapora', () => {
    // 2 ganados, 1 empatado, 0 perdidos. Hoy esto sale `2–0`: la fecha parece
    // de dos partidos cuando fueron tres.
    const matches = [partido(A, B, 3, 1), partido(A, C, 1, 0), partido(C, A, 2, 2)]
    expect(championRecord(matches, A, FIFA, true)).toBe('2–1–0 · +3 goles')
  })

  it('cuenta GOLES y no games', () => {
    expect(championRecord([partido(A, B, 3, 1)], A, FIFA, true)).toContain('goles')
    expect(championRecord([partido(A, B, 3, 1)], A, FIFA, true)).not.toContain('games')
  })

  it('sin ningún empate jugado sigue mostrando la columna del medio en cero', () => {
    // La forma la manda la DISCIPLINA, no lo que pasó esa tarde: si cambiara
    // fecha a fecha, dos fechas de la misma liga se leerían distinto.
    const matches = [partido(A, B, 3, 1), partido(A, C, 0, 1)]
    expect(championRecord(matches, A, FIFA, true)).toBe('1–0–1 · +1 goles')
  })
})
