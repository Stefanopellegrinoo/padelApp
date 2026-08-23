import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
  return { round: 1, fase: 'GRUPO', grupo: 1, sideA: izq, sideB: der, sets: [{ gamesA: golesA, gamesB: golesB }] }
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

// ── El punto de unión ────────────────────────────────────────────────────────
//
// Extraer mueve el riesgo acá: el módulo queda con seis tests y el cableado con
// ninguno. `page.tsx` (`fechas/`) es un server component `async` de ~290 líneas
// con seis lectores; montarlo pediría mockearlos todos para pinchar dos
// argumentos, así que va por FUENTE — mismo criterio y mismo techo declarado
// que `fuente-de-puntos.unit.test.ts` en `fechas/[n]/`.
//
// Los dos argumentos fallan CALLADOS, que es lo que los hace merecer un pin:
// un `false` fijo en `allowsDraw` devuelve el bug exacto que este archivo
// arregla —el empate del campeón se evapora— y un `matchFormat` equivocado le
// dice `games` a los goles. Ninguno rompe nada visible salvo que alguien juegue
// al FIFA y cuente.
//
// Se pinchan los ARGUMENTOS y no el nombre: un mis-wire conserva
// `championRecord(` intacto (medido en la ronda 18, otra vez en la 22 y otra
// en PR20-B). Techo, declarado: falso POSITIVO si alguien renombra `detail`,
// `matchFormat` o `championSide` — el lado correcto del que equivocarse.
describe('el cableado de la marca del campeón', () => {
  const source = readFileSync(
    join(process.cwd(), 'app/torneo/[id]/[disciplina]/fechas/page.tsx'),
    'utf8',
  )
  /** El fuente sin comentarios: lo que de verdad se ejecuta. */
  const ejecutable = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')

  it('le pasa el formato de la disciplina y el allows_draw CONGELADO de la fecha', () => {
    expect(ejecutable).toMatch(
      /championRecord\(\s*detail\.matches\s*,\s*championSide\s*,\s*matchFormat\s*,\s*matchday\.allowsDraw\s*,?\s*\)/,
    )
  })

  it('y pinchar sólo el nombre no serviría: el mis-wire lo conserva', () => {
    const misWire = 'championRecord(detail.matches, championSide, matchFormat, false)'
    expect(misWire).toMatch(/championRecord\(/)
    expect(misWire).not.toMatch(/,\s*matchday\.allowsDraw\s*,?\s*\)/)
  })
})
