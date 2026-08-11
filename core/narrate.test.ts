import { describe, it, expect } from 'vitest'
import { narrateRules } from './narrate'
import { MASTERS_MATCHES, MASTERS_SIZE } from './constants'
import type { SeasonConfig } from './types'

const CONFIG: SeasonConfig = {
  squadSize: 12,
  matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true },
  points: [10, 7, 5, 3, 2, 1],
  regularMatchdays: 10,
  countBestOf: 8,
  tiebreakSnapshotEvery: 3,
}

function bodyOf(config: SeasonConfig, title: string): string {
  const block = narrateRules(config).find((section) => section.title === title)
  if (block === undefined) throw new Error(`No hay bloque "${title}"`)
  return block.body
}

describe('narrateRules', () => {
  it('returns a block per topic', () => {
    const titles = narrateRules(CONFIG).map((section) => section.title)
    expect(titles).toEqual([
      'El torneo',
      'La fecha',
      'Los puntos',
      'Cómo se arman las parejas',
      'Los desempates',
      'El Masters',
    ])
  })

  it('states how many matchdays there are and how many count', () => {
    const body = bodyOf(CONFIG, 'El torneo')
    expect(body).toContain('10 fechas')
    expect(body).toContain('8 mejores')
  })

  it('describes the match format from the config', () => {
    expect(bodyOf(CONFIG, 'La fecha')).toContain('4 games')
  })

  it('lists every points value', () => {
    const body = bodyOf(CONFIG, 'Los puntos')
    for (const value of CONFIG.points) {
      expect(body).toContain(String(value))
    }
  })

  it('follows the config when the points change, instead of a stale copy', () => {
    const richer = { ...CONFIG, points: [12, 9, 6, 4, 2, 1] }
    const body = bodyOf(richer, 'Los puntos')
    expect(body).toContain('el 1º, 12')
    expect(body).not.toContain('el 1º, 10')
  })

  // La página de reglas es la que leen los jugadores para saber cómo funciona
  // el campeonato. Afirmaba SIEMPRE "Nadie suma 0 por presentarse", que dejó de
  // ser cierto cuando el 0 se volvió legal: un torneo donde sólo puntúan los
  // primeros cuatro leía una regla que él mismo no cumple.
  it('does not promise that everybody scores when some places pay nothing', () => {
    const soloCuatro = { ...CONFIG, points: [10, 7, 5, 3, 0, 0] }
    const body = bodyOf(soloCuatro, 'Los puntos')
    expect(body).not.toContain('Nadie suma 0 por presentarse')
    expect(body).toContain('sólo puntúan los primeros 4 puestos')
  })

  it('keeps the old promise when every place pays', () => {
    expect(bodyOf(CONFIG, 'Los puntos')).toContain('Nadie suma 0 por presentarse')
  })

  it('says it in singular when only the winner scores', () => {
    const soloElPrimero = { ...CONFIG, points: [10, 0, 0, 0, 0, 0] }
    expect(bodyOf(soloElPrimero, 'Los puntos')).toContain('sólo puntúa el que gana la fecha')
  })

  it('states the snapshot refresh interval', () => {
    expect(bodyOf(CONFIG, 'Los desempates')).toContain('3 fechas')
  })

  it('states the masters size', () => {
    expect(bodyOf(CONFIG, 'El Masters')).toContain('4 mejores')
  })

  it('describes a multi-set format when configured that way', () => {
    const bestOfThree = {
      ...CONFIG,
      matchFormat: { setsToWin: 2, gamesPerSet: 6, tieBreak: true },
    }
    expect(bodyOf(bestOfThree, 'La fecha')).toContain('6 games')
  })

  it('never leaves a placeholder in the output', () => {
    for (const section of narrateRules(CONFIG)) {
      expect(section.body).not.toMatch(/undefined|NaN|\{\{/)
      expect(section.body.length).toBeGreaterThan(0)
    }
  })

  it('orders tiebreakers as sets-difference then games-difference when multi-set', () => {
    const bestOfThree = {
      ...CONFIG,
      matchFormat: { setsToWin: 2, gamesPerSet: 6, tieBreak: true },
    }
    const body = bodyOf(bestOfThree, 'Los desempates')
    const setsPhrase = 'corta la diferencia de sets'
    const gamesPhrase = 'corta la diferencia de games'
    const setsAt = body.indexOf(setsPhrase)
    const gamesAt = body.indexOf(gamesPhrase)
    expect(setsAt).toBeGreaterThan(-1)
    expect(gamesAt).toBeGreaterThan(-1)
    expect(setsAt).toBeLessThan(gamesAt)
  })

  it('omits sets-difference tiebreaker when the format is single-set', () => {
    const singleSet = {
      ...CONFIG,
      matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true },
    }
    const body = bodyOf(singleSet, 'Los desempates')
    expect(body).not.toContain('corta la diferencia de sets')
    expect(body).toContain('corta la diferencia de games')
  })

  it('names the masters size and match count from the constants, not a config value', () => {
    const body = bodyOf(CONFIG, 'El Masters')
    expect(body).toContain(`${MASTERS_SIZE} mejores`)
    expect(body).toContain(`${MASTERS_MATCHES} partidos`)
  })
})
