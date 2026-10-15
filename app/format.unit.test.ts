import { describe, expect, it } from 'vitest'
import { matchdayFormatLabel } from './format'

describe('matchdayFormatLabel', () => {
  it('Automático (docs/torneos-deportes.md §7) se nombra como tal', () => {
    expect(matchdayFormatLabel({ kind: 'AUTO' })).toBe('Automático')
  })
})
