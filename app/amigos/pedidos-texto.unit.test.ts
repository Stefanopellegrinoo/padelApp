import { describe, expect, it } from 'vitest'
import { metaEnviado, metaRecibidoEnAmigos, metaRecibidoEnInicio } from './pedidos-texto'

// Las palabras de los pedidos (odd/tasks/amigos-faciles.md, S4), con los torneos en el formato de S11.
describe('el pedido recibido', () => {
  it('en Inicio: "Te pidió ser amigos · <torneos>", o sólo "Te pidió ser amigos"', () => {
    expect(metaRecibidoEnInicio(['Los Pibes del Martes'])).toBe('Te pidió ser amigos · Los Pibes del Martes')
    expect(metaRecibidoEnInicio(['Los Pibes del Martes', 'Copa del Jueves'])).toBe(
      'Te pidió ser amigos · Los Pibes del Martes y Copa del Jueves',
    )
    expect(metaRecibidoEnInicio(['A', 'B', 'C'])).toBe('Te pidió ser amigos · A y 2 más')
    expect(metaRecibidoEnInicio([])).toBe('Te pidió ser amigos')
  })

  it('en Amigos: "De <torneos>", o nada', () => {
    expect(metaRecibidoEnAmigos(['Los Pibes del Martes'])).toBe('De Los Pibes del Martes')
    expect(metaRecibidoEnAmigos(['Los Pibes del Martes', 'Copa del Jueves'])).toBe('De Los Pibes del Martes y Copa del Jueves')
    expect(metaRecibidoEnAmigos(['A', 'B', 'C'])).toBe('De A y 2 más')
    expect(metaRecibidoEnAmigos([])).toBeNull()
  })
})

describe('metaEnviado: "Sin respuesta · hace 3 días"', () => {
  const ahora = new Date('2026-11-27T12:00:00Z')

  it('hoy, hace 1 día, hace N días, en minúscula', () => {
    expect(metaEnviado('2026-11-27T09:00:00Z', ahora)).toBe('Sin respuesta · hoy')
    expect(metaEnviado('2026-11-26T11:00:00Z', ahora)).toBe('Sin respuesta · hace 1 día')
    expect(metaEnviado('2026-11-24T12:00:00Z', ahora)).toBe('Sin respuesta · hace 3 días')
  })
})
