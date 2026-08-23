import { describe, it, expect } from 'vitest'
import { disciplineSlugs, resolveDisciplineBySlug, type SluggableDiscipline } from './discipline-slug'
import type { DisciplineId } from './types'

function discipline(id: string, kind: 'PADEL' | 'FIFA'): SluggableDiscipline {
  return { id: id as DisciplineId, kind }
}

describe('disciplineSlugs', () => {
  it('gives the bare kind to the only discipline of a season', () => {
    const slugs = disciplineSlugs([discipline('a', 'PADEL')])
    expect(slugs.get('a' as DisciplineId)).toBe('padel')
  })

  it('gives each kind its own bare slug when they differ', () => {
    const slugs = disciplineSlugs([discipline('a', 'PADEL'), discipline('b', 'FIFA')])
    expect(slugs.get('a' as DisciplineId)).toBe('padel')
    expect(slugs.get('b' as DisciplineId)).toBe('fifa')
  })

  it('disambiguates two disciplines of the same kind by list order, never colliding', () => {
    const slugs = disciplineSlugs([discipline('a', 'PADEL'), discipline('b', 'PADEL')])
    expect(slugs.get('a' as DisciplineId)).toBe('padel')
    expect(slugs.get('b' as DisciplineId)).toBe('padel-2')
  })

  it('keeps disambiguating past two of the same kind', () => {
    const slugs = disciplineSlugs([
      discipline('a', 'PADEL'),
      discipline('b', 'PADEL'),
      discipline('c', 'PADEL'),
    ])
    expect(slugs.get('c' as DisciplineId)).toBe('padel-3')
  })
})

describe('resolveDisciplineBySlug', () => {
  const disciplines = [discipline('a', 'PADEL'), discipline('b', 'PADEL')]

  it('finds the discipline whose derived slug matches', () => {
    expect(resolveDisciplineBySlug(disciplines, 'padel-2')?.id).toBe('b')
  })

  it('returns undefined for a slug that matches no discipline (unknown slug)', () => {
    expect(resolveDisciplineBySlug(disciplines, 'basquet')).toBeUndefined()
  })

  it('returns undefined for a slug belonging to a different season (wrong-season slug)', () => {
    const otherSeason = [discipline('c', 'FIFA')]
    expect(resolveDisciplineBySlug(otherSeason, 'padel')).toBeUndefined()
  })
})
