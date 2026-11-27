import { describe, expect, it } from 'vitest'
import { metaDeGente } from './gente-texto'

// De dónde la conocés, en la fila de "Gente de tus torneos" (odd/tasks/amigos-faciles.md, S3).
describe('metaDeGente', () => {
  it('un torneo: su nombre y las fechas ("Los Pibes del Martes · 7 fechas")', () => {
    expect(metaDeGente({ torneos: ['Los Pibes del Martes'], fechasJuntos: 7 })).toBe('Los Pibes del Martes · 7 fechas')
    expect(metaDeGente({ torneos: ['Los Pibes del Martes'], fechasJuntos: 1 })).toBe('Los Pibes del Martes · 1 fecha')
  })

  it('un torneo sin ninguna fecha juntos: sólo el torneo', () => {
    expect(metaDeGente({ torneos: ['Los Pibes del Martes'], fechasJuntos: 0 })).toBe('Los Pibes del Martes')
  })

  it('varios torneos: cuántos y las fechas juntos ("2 torneos · 9 fechas juntos")', () => {
    expect(metaDeGente({ torneos: ['A', 'B'], fechasJuntos: 9 })).toBe('2 torneos · 9 fechas juntos')
    expect(metaDeGente({ torneos: ['A', 'B', 'C'], fechasJuntos: 1 })).toBe('3 torneos · 1 fecha juntos')
    expect(metaDeGente({ torneos: ['A', 'B'], fechasJuntos: 0 })).toBe('2 torneos')
  })
})
