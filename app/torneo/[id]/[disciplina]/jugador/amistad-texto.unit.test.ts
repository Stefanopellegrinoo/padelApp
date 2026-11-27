import { describe, expect, it } from 'vitest'
import { amigosHref, haceCuanto, primerNombre } from './amistad-texto'

// Las palabras del control de amistad del perfil (odd/tasks/amigos-faciles.md, S2).
describe('primerNombre: a la persona se la nombra como en la maqueta ("Nico")', () => {
  it('el primer nombre, sin espacios de más; una sola palabra queda igual', () => {
    expect(primerNombre('Nico Arias')).toBe('Nico')
    expect(primerNombre('  Juan  Pablo Ledesma ')).toBe('Juan')
    expect(primerNombre('Juampi')).toBe('Juampi')
  })

  it('un nombre vacío no deja la frase sin nadie', () => {
    expect(primerNombre('   ')).toBe('este jugador')
  })
})

describe('haceCuanto: "Hace 2 días" desde que llegó el pedido', () => {
  const ahora = new Date('2026-11-27T12:00:00Z')

  it('en días enteros: hoy, 1 día, N días', () => {
    expect(haceCuanto('2026-11-27T09:00:00Z', ahora)).toBe('Hoy')
    expect(haceCuanto('2026-11-26T11:59:00Z', ahora)).toBe('Hace 1 día')
    expect(haceCuanto('2026-11-25T12:00:00Z', ahora)).toBe('Hace 2 días')
    expect(haceCuanto('2026-10-28T12:00:00Z', ahora)).toBe('Hace 30 días')
  })

  it('una fecha del futuro (reloj corrido) es hoy, no "hace -1 días"', () => {
    expect(haceCuanto('2026-11-27T12:05:00Z', ahora)).toBe('Hoy')
  })
})

describe('amigosHref: "Amigos ›" lleva al historial entre los dos', () => {
  it('al perfil del amigo, con Volver a la lista de Amigos', () => {
    expect(amigosHref('p2')).toBe('/amigos/p2?desde=amigos')
  })
})
