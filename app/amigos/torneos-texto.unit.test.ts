import { describe, expect, it } from 'vitest'
import { torneosCompartidos } from './torneos-texto'

// Los torneos compartidos, igual en todos lados y sin fechas (odd/tasks/amigos-faciles.md, S11).
describe('torneosCompartidos', () => {
  it('uno: su nombre', () => {
    expect(torneosCompartidos(['Los Pibes del Martes'])).toBe('Los Pibes del Martes')
  })

  it('dos: los dos nombres, sin "y 1 más"', () => {
    expect(torneosCompartidos(['Los Pibes del Martes', 'Copa del Jueves'])).toBe('Los Pibes del Martes y Copa del Jueves')
  })

  it('tres o más: el primero y cuántos más', () => {
    expect(torneosCompartidos(['Los Pibes del Martes', 'Copa del Jueves', 'FIFA de los Viernes'])).toBe(
      'Los Pibes del Martes y 2 más',
    )
    expect(torneosCompartidos(['A', 'B', 'C', 'D', 'E'])).toBe('A y 4 más')
  })

  it('respeta el orden que le llega (el de la base): no reordena', () => {
    expect(torneosCompartidos(['Copa del Jueves', 'Los Pibes del Martes'])).toBe('Copa del Jueves y Los Pibes del Martes')
  })

  it('ninguno: nada', () => {
    expect(torneosCompartidos([])).toBeNull()
  })
})
