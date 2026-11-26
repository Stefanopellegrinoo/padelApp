import { describe, expect, it } from 'vitest'
import { diaLargo, matchdayFormatLabel } from './format'

describe('matchdayFormatLabel', () => {
  it('Automático (docs/torneos-deportes.md §7) se nombra como tal', () => {
    expect(matchdayFormatLabel({ kind: 'AUTO' })).toBe('Automático')
  })

  it('la fecha por ranking de bowling (S4) se nombra "Ranking por pinos"', () => {
    expect(matchdayFormatLabel({ kind: 'RANKING' })).toBe('Ranking por pinos')
  })

  it('los formatos de siempre no cambian', () => {
    expect(matchdayFormatLabel({ kind: 'ROUND_ROBIN' })).toBe('Todos contra todos')
    expect(matchdayFormatLabel({ kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 })).toBe('2 grupos + llave')
  })
})

describe('diaLargo', () => {
  const hoy = new Date(2026, 10, 26, 12)

  it('escribe el día con el nombre en mayúscula: "Jueves 26 nov"', () => {
    expect(diaLargo('2026-11-26', hoy)).toBe('Jueves 26 nov')
    expect(diaLargo('2026-12-01', hoy)).toBe('Martes 1 dic')
  })

  it('de otro año, lo agrega', () => {
    expect(diaLargo('2025-11-26', hoy)).toBe('Miércoles 26 nov 2025')
  })

  it('sin día, nada', () => {
    expect(diaLargo('', hoy)).toBe('')
  })
})
