import { describe, expect, it } from 'vitest'
import { deDonde, metaEnviado, metaRecibidoEnAmigos, metaRecibidoEnInicio } from './pedidos-texto'

// Las palabras de los pedidos (odd/tasks/amigos-faciles.md, S4).
describe('deDonde: de dónde lo conocés, por los torneos compartidos', () => {
  it('uno: su nombre; varios: el primero y cuántos más; ninguno: nada', () => {
    expect(deDonde(['Los Pibes del Martes'])).toBe('Los Pibes del Martes')
    expect(deDonde(['Los Pibes del Martes', 'FIFA de los Viernes'])).toBe('Los Pibes del Martes y 1 más')
    expect(deDonde(['A', 'B', 'C'])).toBe('A y 2 más')
    expect(deDonde([])).toBeNull()
  })
})

describe('el pedido recibido', () => {
  it('en Inicio: "Te pidió ser amigos · <torneo>", o sólo "Te pidió ser amigos"', () => {
    expect(metaRecibidoEnInicio(['Los Pibes del Martes'])).toBe('Te pidió ser amigos · Los Pibes del Martes')
    expect(metaRecibidoEnInicio(['A', 'B'])).toBe('Te pidió ser amigos · A y 1 más')
    expect(metaRecibidoEnInicio([])).toBe('Te pidió ser amigos')
  })

  it('en Amigos: "De <torneo>", o nada', () => {
    expect(metaRecibidoEnAmigos(['Los Pibes del Martes'])).toBe('De Los Pibes del Martes')
    expect(metaRecibidoEnAmigos(['A', 'B'])).toBe('De A y 1 más')
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
