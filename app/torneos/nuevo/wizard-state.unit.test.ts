import { describe, expect, it } from 'vitest'
import { defaultConfig, validateConfig } from '@/core'
import {
  configFor,
  filledCount,
  formatErrors,
  resizeConfig,
  squadWarning,
  summaryOf,
} from './wizard-state'

describe('squadWarning', () => {
  it('asks for the missing name when the squad is short', () => {
    const names = [...Array(7).fill('Jugador'), '']
    expect(squadWarning(names)).toBe('Falta 1 nombre. El plantel arranca en 8.')
  })

  it('counts how many are missing when it is more than one', () => {
    const names = [...Array(6).fill('Jugador'), '', '']
    expect(squadWarning(names)).toBe('Faltan 2 nombres. El plantel arranca en 8.')
  })

  it('refuses an odd squad, because pairs need an even number', () => {
    expect(squadWarning(Array(9).fill('Jugador'))).toBe(
      'Son 9. El plantel tiene que ser par para poder armar parejas.',
    )
  })

  it('says nothing for a squad that can go on', () => {
    expect(squadWarning(Array(8).fill('Jugador'))).toBeNull()
    expect(squadWarning(Array(10).fill('Jugador'))).toBeNull()
    expect(squadWarning(Array(12).fill('Jugador'))).toBeNull()
  })

  it('ignores whitespace when counting', () => {
    expect(filledCount(['Marce', '   ', 'Nico'])).toBe(2)
  })
})

describe('the config the wizard builds', () => {
  // Con 12 hacen falta 6 valores de puntos: si al cambiar el plantel la lista
  // no se rehace, la temporada nace inválida y createSeason la rebota.
  it('rebuilds the points list when the squad changes size', () => {
    const eight = configFor(8)
    expect(eight.points).toHaveLength(4)

    const twelve = resizeConfig(eight, 12)
    expect(twelve.points).toHaveLength(6)
    expect(twelve.squadSize).toBe(12)
  })

  it('leaves the config alone when the size did not change', () => {
    const config = { ...configFor(8), points: [20, 10, 5, 1] }
    expect(resizeConfig(config, 8)).toBe(config)
  })

  it('gives back exactly defaultConfig for every squad size', () => {
    for (const size of [8, 10, 12]) {
      expect(configFor(size)).toEqual(defaultConfig(size))
    }
  })

  // Lo que arma el wizard tiene que pasar la validación de core/, o
  // `createSeason` lo rebota en el submit y el usuario se entera al final.
  it('produces a config core accepts, for every squad size', () => {
    for (const size of [8, 10, 12]) {
      expect(validateConfig(configFor(size))).toEqual([])
      expect(formatErrors(configFor(size))).toEqual([])
    }
  })
})

describe('formatErrors', () => {
  it('catches points that do not go down', () => {
    const config = { ...configFor(8), points: [10, 10, 5, 3] }
    expect(formatErrors(config)).toEqual([
      'Los puntos tienen que ir de mayor a menor y ninguno puede quedar en cero.',
    ])
  })

  it('catches a zero, which would make coming last the same as not showing up', () => {
    const config = { ...configFor(8), points: [10, 6, 3, 0] }
    expect(formatErrors(config)).toContain(
      'Los puntos tienen que ir de mayor a menor y ninguno puede quedar en cero.',
    )
  })

  it('catches counting more matchdays than the season has', () => {
    const config = { ...configFor(8), regularMatchdays: 10, countBestOf: 12 }
    expect(formatErrors(config)).toEqual(['No pueden contar más fechas de las que se juegan.'])
  })

  it('reports both problems at once', () => {
    const config = { ...configFor(8), points: [1, 2, 3, 4], regularMatchdays: 4, countBestOf: 9 }
    expect(formatErrors(config)).toHaveLength(2)
  })
})

describe('summaryOf', () => {
  it('lists the six rows of the handoff, in order', () => {
    const rows = summaryOf('Los Jueves 2026', Array(8).fill('Jugador'), configFor(8))
    expect(rows.map((row) => row.key)).toEqual([
      'Nombre',
      'Jugadores',
      'Formato',
      'Puntos',
      'Fechas',
      'Desempate',
    ])
    expect(rows[1]?.value).toBe('8')
    expect(rows[2]?.value).toBe('1 set a 4 games')
  })
})
