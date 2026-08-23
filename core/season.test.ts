import { describe, it, expect } from 'vitest'
import { seasonStatusOf } from './season'

//REQ-D3-3: el estado de la temporada se DERIVA del de sus disciplinas, no
// vive suelto. `seasons.status` sigue existiendo (dual-write hasta el
// contract, PR 27) pero esta función es la que manda para cualquier pantalla
// que necesite el estado real de un torneo con más de una disciplina.

describe('seasonStatusOf', () => {
  it('sin disciplinas, SETUP', () => {
    expect(seasonStatusOf([])).toBe('SETUP')
  })

  it('una sola disciplina en SETUP, SETUP', () => {
    expect(seasonStatusOf([{ status: 'SETUP' }])).toBe('SETUP')
  })

  it('una sola disciplina ACTIVE, ACTIVE', () => {
    expect(seasonStatusOf([{ status: 'ACTIVE' }])).toBe('ACTIVE')
  })

  it('una sola disciplina FINISHED, FINISHED', () => {
    expect(seasonStatusOf([{ status: 'FINISHED' }])).toBe('FINISHED')
  })

  it('todas FINISHED, FINISHED', () => {
    expect(seasonStatusOf([{ status: 'FINISHED' }, { status: 'FINISHED' }])).toBe('FINISHED')
  })

  it('todas SETUP, SETUP', () => {
    expect(seasonStatusOf([{ status: 'SETUP' }, { status: 'SETUP' }])).toBe('SETUP')
  })

  // El caso del spec: pádel ACTIVE y FIFA SETUP → la temporada está ACTIVE.
  it('pádel ACTIVE y FIFA SETUP, ACTIVE', () => {
    expect(seasonStatusOf([{ status: 'ACTIVE' }, { status: 'SETUP' }])).toBe('ACTIVE')
  })

  it('una FINISHED y otra ACTIVE, ACTIVE', () => {
    expect(seasonStatusOf([{ status: 'FINISHED' }, { status: 'ACTIVE' }])).toBe('ACTIVE')
  })

  it('una FINISHED y otra SETUP, ACTIVE (ni todas terminaron ni todas sin empezar)', () => {
    expect(seasonStatusOf([{ status: 'FINISHED' }, { status: 'SETUP' }])).toBe('ACTIVE')
  })
})
