import { describe, expect, it } from 'vitest'
import {
  agruparPorRonda,
  marcadorDeDosToques,
  nombreLado,
  puntosDelPerdedor,
  resumenGuardado,
  siguienteSinCargar,
  toqueDelMarcador,
  unidadDe,
} from './jugar-logic'
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

describe('siguienteSinCargar', () => {
  const p = (cargado: boolean): Partido => ({ ronda: 1, a: [0], b: [1], marcador: cargado ? { a: 4, b: 1 } : null })

  it('el próximo sin marcador después del que se guardó', () => {
    expect(siguienteSinCargar([p(true), p(true), p(false), p(false)], 1)).toBe(2)
  })

  it('da la vuelta: si los de después están cargados, busca desde el principio', () => {
    expect(siguienteSinCargar([p(false), p(true), p(true)], 2)).toBe(0)
  })

  it('nunca devuelve el que se acaba de guardar, y null si no falta ninguno', () => {
    expect(siguienteSinCargar([p(true), p(false)], 1)).toBeNull()
    expect(siguienteSinCargar([p(true), p(true)], 0)).toBeNull()
  })
})

describe('toqueDelMarcador', () => {
  it('sin marcador no hay nada elegido', () => {
    expect(toqueDelMarcador(null, 'PADEL')).toEqual({ ganador: null, perdedor: null })
  })

  it('un marcador de dos toques vuelve con su ganador y los puntos del que perdió', () => {
    expect(toqueDelMarcador({ a: 4, b: 2 }, 'PADEL')).toEqual({ ganador: 'a', perdedor: 2 })
    expect(toqueDelMarcador({ a: 9, b: 11 }, 'PING_PONG')).toEqual({ ganador: 'b', perdedor: 9 })
  })

  it('un marcador que no salió de los dos toques (versión vieja) marca el ganador pero ningún número', () => {
    expect(toqueDelMarcador({ a: 6, b: 3 }, 'PADEL')).toEqual({ ganador: 'a', perdedor: null })
    expect(toqueDelMarcador({ a: 2, b: 2 }, 'PADEL')).toEqual({ ganador: null, perdedor: null })
  })
})

describe('unidadDe y resumenGuardado', () => {
  it('pádel se cuenta en games y ping pong en puntos', () => {
    expect(unidadDe('PADEL')).toBe('games')
    expect(unidadDe('PING_PONG')).toBe('puntos')
  })

  it('el ganador primero y su marcador primero, como se canta', () => {
    expect(resumenGuardado('Ana y Beto', 'Cami y Dani', { a: 4, b: 2 })).toBe('Ana y Beto 4-2')
    expect(resumenGuardado('Ana', 'Beto', { a: 7, b: 11 })).toBe('Beto 11-7')
    expect(resumenGuardado('Ana', 'Beto', { a: 3, b: 3 })).toBe('Ana 3-3 Beto')
  })
})
