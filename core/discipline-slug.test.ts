import { describe, it, expect } from 'vitest'
import { disciplineSlugs, resolveDisciplineBySlug, type SluggableDiscipline } from './discipline-slug'
import type { DisciplineId } from './types'

function discipline(id: string, kind: string): SluggableDiscipline {
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

  it('pasa el guion bajo del id a guion en la URL (PING_PONG -> ping-pong)', () => {
    const slugs = disciplineSlugs([
      discipline('a', 'PADEL'),
      discipline('b', 'PING_PONG'),
      discipline('c', 'PING_PONG'),
      discipline('d', 'FIFA'),
    ])
    expect([...slugs.values()]).toEqual(['padel', 'ping-pong', 'ping-pong-2', 'fifa'])
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

describe('resolveDisciplineBySlug con ids con guion bajo', () => {
  const disciplines = [discipline('a', 'PADEL'), discipline('b', 'PING_PONG'), discipline('c', 'PING_PONG')]

  it('encuentra la primera por su slug con guion', () => {
    expect(resolveDisciplineBySlug(disciplines, 'ping-pong')?.id).toBe('b')
  })

  it('no entiende el id crudo con guion bajo', () => {
    expect(resolveDisciplineBySlug(disciplines, 'ping_pong')).toBeUndefined()
  })
})
