import { describe, expect, it } from 'vitest'
import { deportesDeTorneo, historialHref, ultimoPartido } from './perfil-texto'

describe('deportesDeTorneo (S11: el deporte, nunca fechas)', () => {
  it('uno, dos, y un id que no está en el registro tal cual', () => {
    expect(deportesDeTorneo(['PADEL'])).toBe('Pádel')
    expect(deportesDeTorneo(['FIFA', 'TENIS'])).toBe('FIFA y Tenis')
    expect(deportesDeTorneo(['PADEL', 'PADEL'])).toBe('Pádel')
    expect(deportesDeTorneo(['TEJO'])).toBe('TEJO')
    expect(deportesDeTorneo([])).toBe('')
  })
})

describe('historialHref', () => {
  it('lleva al historial con Volver al perfil', () => {
    expect(historialHref('p-nico')).toBe('/amigos/p-nico?desde=perfil')
  })
})

describe('ultimoPartido', () => {
  const ahora = new Date('2026-09-01T15:00:00Z')
  it('"El último, hace N días", "hoy", y nada sin día', () => {
    expect(ultimoPartido('2026-08-30', ahora)).toBe('El último, hace 2 días')
    expect(ultimoPartido('2026-09-01', ahora)).toBe('El último, hoy')
    expect(ultimoPartido(null, ahora)).toBeNull()
  })
})
