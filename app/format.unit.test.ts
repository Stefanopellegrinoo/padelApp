import { describe, expect, it } from 'vitest'
import { matchdayFormatLabel } from './format'

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
