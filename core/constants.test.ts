import { describe, it, expect } from 'vitest'
import { MIN_PLAYERS, MAX_PLAYERS, MAX_PAIRING_POOL, MASTERS_SIZE } from './constants'
import { allMatchings } from './matchings'

describe('constants', () => {
  it('defines the matchday size limits from the format', () => {
    expect(MIN_PLAYERS).toBe(8)
    expect(MAX_PLAYERS).toBe(12)
  })

  it('defines the masters size as four', () => {
    expect(MASTERS_SIZE).toBe(4)
  })
})

describe('MAX_PAIRING_POOL — el techo de CPU, separado del de producto', () => {
  it('hoy vale lo mismo que MAX_PLAYERS, y ésa es la coincidencia que documenta', () => {
    expect(MAX_PAIRING_POOL).toBe(MAX_PLAYERS)
  })

  it('allMatchings rechaza por el techo de CPU, no por el del plantel', () => {
    // 14 es par y está por encima de los dos, así que rechaza igual — lo que
    // este test fija es CUÁL de los dos números lo rechaza: el mensaje tiene
    // que nombrar el pool, no el plantel. Si mañana `MAX_PLAYERS` sube a 14
    // porque el producto lo decide, esto sigue rojo y ahí está el punto:
    // (14-1)!! = 135135 emparejamientos, 13 veces los de 12.
    expect(() => allMatchings(Array.from({ length: 14 }, (_, i) => `e${i}`))).toThrow(
      new RegExp(String(MAX_PAIRING_POOL)),
    )
  })
})
