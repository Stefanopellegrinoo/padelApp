import { describe, expect, it } from 'vitest'
import { agruparPorRonda, marcadorDeDosToques, nombreLado, puntosDelPerdedor } from './jugar-logic'
import {
  ARMADO_INICIAL,
  DEPORTES,
  DEPORTE_OBJETIVO,
  cargarMarcador,
  type Partido,
  type TorneoRapido,
} from './rapido-state'

describe('agruparPorRonda', () => {
  it('agrupa los partidos por ronda conservando el índice original', () => {
    const partidos: Partido[] = [
      { ronda: 1, a: [0], b: [1], marcador: null },
      { ronda: 2, a: [2], b: [3], marcador: null },
      { ronda: 1, a: [4], b: [5], marcador: null },
    ]
    expect(agruparPorRonda(partidos)).toEqual([
      {
        ronda: 1,
        items: [
          { indice: 0, partido: partidos[0] },
          { indice: 2, partido: partidos[2] },
        ],
      },
      { ronda: 2, items: [{ indice: 1, partido: partidos[1] }] },
    ])
  })

  it('devuelve vacío si no hay partidos', () => {
    expect(agruparPorRonda([])).toEqual([])
  })
})

describe('nombreLado', () => {
  it('junta a los dos jugadores de una pareja con "y"', () => {
    expect(nombreLado(['Ana', 'Beto', 'Cami'], [0, 2])).toBe('Ana y Cami')
  })

  it('devuelve un solo nombre si el lado es individual', () => {
    expect(nombreLado(['Ana', 'Beto'], [1])).toBe('Beto')
  })
})

describe('puntosDelPerdedor', () => {
  it('ofrece de 0 al objetivo menos uno en pádel', () => {
    expect(puntosDelPerdedor('PADEL')).toEqual([0, 1, 2, 3])
  })

  it('ofrece de 0 al objetivo menos uno en ping pong', () => {
    expect(puntosDelPerdedor('PING_PONG')).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('nunca ofrece el objetivo: eso sería un empate, y en la pantalla no existe', () => {
    expect(puntosDelPerdedor('PADEL')).not.toContain(DEPORTE_OBJETIVO.PADEL)
    expect(puntosDelPerdedor('PING_PONG')).not.toContain(DEPORTE_OBJETIVO.PING_PONG)
  })
})

describe('marcadorDeDosToques', () => {
  it('le da el objetivo entero al lado que ganó', () => {
    expect(marcadorDeDosToques('a', 2, 'PADEL')).toEqual({ a: 4, b: 2 })
  })

  it('le da el objetivo entero al lado B cuando ganó B', () => {
    expect(marcadorDeDosToques('b', 7, 'PING_PONG')).toEqual({ a: 7, b: 11 })
  })

  it('todo lo que sale de los dos toques lo acepta cargarMarcador', () => {
    const partido: Partido = { ronda: 1, a: [0], b: [1], marcador: null }
    const torneo: TorneoRapido = {
      armado: { ...ARMADO_INICIAL, jugadores: ['Ana', 'Beto'] },
      jugadores: ['Ana', 'Beto'],
      partidos: [partido],
    }
    for (const deporte of DEPORTES) {
      for (const puntos of puntosDelPerdedor(deporte)) {
        for (const ganador of ['a', 'b'] as const) {
          const marcador = marcadorDeDosToques(ganador, puntos, deporte)
          expect(() => cargarMarcador(torneo, 0, marcador.a, marcador.b)).not.toThrow()
          expect(marcador.a).not.toBe(marcador.b)
        }
      }
    }
  })
})
