import { describe, it, expect } from 'vitest'
import { validateConfig, defaultConfig } from './config'
import type { SeasonConfig } from './types'

const valid: SeasonConfig = {
  squadSize: 12,
  matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true },
  points: [10, 7, 5, 3, 2, 1],
  regularMatchdays: 10,
  countBestOf: 8,
  tiebreakSnapshotEvery: 3,
}

describe('validateConfig', () => {
  it('accepts a valid config', () => {
    expect(validateConfig(valid)).toEqual([])
  })

  it('rejects an odd squad size', () => {
    const errors = validateConfig({ ...valid, squadSize: 11, points: [10, 7, 5, 3, 2] })
    expect(errors).toContain('El plantel tiene que ser un número par.')
  })

  it('rejects a squad below the minimum', () => {
    const errors = validateConfig({ ...valid, squadSize: 6, points: [10, 7, 5] })
    expect(errors).toContain('El plantel tiene que ser de 8 jugadores o más.')
  })

  it('rejects a squad above the maximum', () => {
    const errors = validateConfig({ ...valid, squadSize: 14, points: [10, 7, 5, 3, 2, 1, 1] })
    expect(errors).toContain('El plantel no puede pasar de 12 jugadores.')
  })

  it('rejects a points list that does not match the pair count', () => {
    const errors = validateConfig({ ...valid, points: [10, 7, 5, 3] })
    expect(errors).toContain('Con un plantel de 12 hacen falta 6 valores de puntos, no 4.')
  })

  it('rejects points that are not strictly descending', () => {
    const errors = validateConfig({ ...valid, points: [10, 7, 7, 3, 2, 1] })
    expect(errors).toContain('Los puntos tienen que ir de mayor a menor, sin repetir.')
  })

  it('rejects a zero in the points list', () => {
    const errors = validateConfig({ ...valid, points: [10, 7, 5, 3, 1, 0] })
    expect(errors).toContain('Todos los puntos tienen que ser mayores que 0: si salir último diera 0, sería lo mismo que faltar.')
  })

  it('rejects countBestOf above regularMatchdays', () => {
    const errors = validateConfig({ ...valid, countBestOf: 12 })
    expect(errors).toContain('No pueden contar 12 fechas si el torneo tiene 10.')
  })

  it('rejects a tournament with fewer than one matchday', () => {
    const errors = validateConfig({ ...valid, regularMatchdays: 0 })
    expect(errors).toContain('El torneo tiene que tener al menos 1 fecha.')
  })

  it('rejects a countBestOf below one', () => {
    const errors = validateConfig({ ...valid, countBestOf: 0 })
    expect(errors).toContain('Tiene que contar al menos 1 fecha por jugador.')
  })

  it('rejects a match format with zero sets to win', () => {
    const errors = validateConfig({
      ...valid,
      matchFormat: { ...valid.matchFormat, setsToWin: 0 },
    })
    expect(errors).toContain(
      'Los sets para ganar un partido tienen que ser al menos 1: con 0, ningún partido podría terminar.',
    )
  })

  it('rejects a match format with zero games per set', () => {
    const errors = validateConfig({
      ...valid,
      matchFormat: { ...valid.matchFormat, gamesPerSet: 0 },
    })
    expect(errors).toContain(
      'Los games por set tienen que ser al menos 1: con 0, la página de reglas describiría un set que no existe.',
    )
  })

  it('rejects a tiebreak interval below one', () => {
    const errors = validateConfig({ ...valid, tiebreakSnapshotEvery: 0 })
    expect(errors).toContain('El orden de desempate se tiene que refrescar cada 1 fecha o más.')
  })

  it('reports every problem at once, not just the first', () => {
    const errors = validateConfig({ ...valid, squadSize: 7, countBestOf: 99 })
    expect(errors).toContain('El plantel tiene que ser un número par.')
    expect(errors).toContain('No pueden contar 99 fechas si el torneo tiene 10.')
  })
})

describe('defaultConfig', () => {
  it('builds a valid config for any allowed squad size', () => {
    for (const size of [8, 10, 12]) {
      expect(validateConfig(defaultConfig(size))).toEqual([])
    }
  })

  it('gives the winner ten points regardless of squad size', () => {
    expect(defaultConfig(8).points[0]).toBe(10)
    expect(defaultConfig(12).points[0]).toBe(10)
  })
})
