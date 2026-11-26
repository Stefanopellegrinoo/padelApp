import { describe, expect, it } from 'vitest'
import {
  agruparPorRonda,
  formatoRapido,
  marcadorDeDosToques,
  marcadorDeVentaja,
  marcadorDePartida,
  nombreLado,
  partidaDelMarcador,
  puntosDelPerdedor,
  resumenGuardado,
  siguienteSinCargar,
  subDeporte,
  toqueDelMarcador,
  unidadDe,
  ventajasDelPerdedor,
} from './jugar-logic'
import { setError } from '@/db/validate'
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
  it('pádel nace con el set real (S6): 0 a 2, y 5-3 y 5-4 van de ventaja', () => {
    expect(puntosDelPerdedor('PADEL')).toEqual([0, 1, 2])
    expect(ventajasDelPerdedor('PADEL')).toEqual([3, 4])
  })

  it('tenis: 0 a 4 y los de ventaja 7-5 y 7-6', () => {
    expect(puntosDelPerdedor('TENIS')).toEqual([0, 1, 2, 3, 4])
    expect(ventajasDelPerdedor('TENIS').map((p) => marcadorDeVentaja('a', p, 'TENIS'))).toEqual([
      { a: 7, b: 5 },
      { a: 7, b: 6 },
    ])
  })

  it('fútbol tenis y ping pong se ganan por 2: 16-14 y 12-10 son de ventaja', () => {
    expect(puntosDelPerdedor('FUTBOL_TENIS').at(-1)).toBe(13)
    expect(marcadorDeVentaja('b', 14, 'FUTBOL_TENIS')).toEqual({ a: 14, b: 16 })
    expect(ventajasDelPerdedor('FUTBOL_TENIS')).toContain(14)
    expect(marcadorDeVentaja('a', 10, 'PING_PONG')).toEqual({ a: 12, b: 10 })
  })

  it('pool y beer pong llegan justo: sin ventaja', () => {
    expect(puntosDelPerdedor('POOL')).toEqual([0, 1, 2])
    expect(ventajasDelPerdedor('POOL')).toEqual([])
    expect(puntosDelPerdedor('BEER_PONG')).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(ventajasDelPerdedor('BEER_PONG')).toEqual([])
  })

  it('ping pong se gana por 2, como en una fecha: 0 a 9, y el 10 va de ventaja (12-10)', () => {
    expect(puntosDelPerdedor('PING_PONG')).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(ventajasDelPerdedor('PING_PONG')[0]).toBe(10)
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
      for (const ganador of ['a', 'b'] as const) {
        const marcadores = [
          ...puntosDelPerdedor(deporte).map((puntos) => marcadorDeDosToques(ganador, puntos, deporte)),
          ...ventajasDelPerdedor(deporte).map((puntos) => marcadorDeVentaja(ganador, puntos, deporte)),
        ]
        for (const marcador of marcadores) {
          expect(() => cargarMarcador(torneo, 0, marcador.a, marcador.b)).not.toThrow()
          expect(marcador.a).not.toBe(marcador.b)
          // Y es un set legal del deporte: la misma regla que una fecha.
          expect(setError({ gamesA: marcador.a, gamesB: marcador.b }, formatoRapido(deporte), false)).toBeNull()
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
    expect(toqueDelMarcador(null, 'PADEL')).toEqual({ ganador: null, perdedor: null, ventaja: false })
  })

  it('un marcador de dos toques vuelve con su ganador y los puntos del que perdió', () => {
    expect(toqueDelMarcador({ a: 4, b: 2 }, 'PADEL')).toEqual({ ganador: 'a', perdedor: 2, ventaja: false })
    expect(toqueDelMarcador({ a: 9, b: 11 }, 'PING_PONG')).toEqual({ ganador: 'b', perdedor: 9, ventaja: false })
  })

  it('un marcador de ventaja prende su botón: 7-6, 16-14', () => {
    expect(toqueDelMarcador({ a: 7, b: 6 }, 'TENIS')).toEqual({ ganador: 'a', perdedor: 6, ventaja: true })
    expect(toqueDelMarcador({ a: 14, b: 16 }, 'FUTBOL_TENIS')).toEqual({ ganador: 'b', perdedor: 14, ventaja: true })
  })

  it('un marcador que no salió de los dos toques (versión vieja) marca el ganador pero ningún número', () => {
    expect(toqueDelMarcador({ a: 6, b: 3 }, 'PADEL')).toEqual({ ganador: 'a', perdedor: null, ventaja: false })
    // El 4-3 de pádel de antes del set real: se lee igual, sin número marcado.
    expect(toqueDelMarcador({ a: 4, b: 3 }, 'PADEL')).toEqual({ ganador: 'a', perdedor: null, ventaja: false })
    expect(toqueDelMarcador({ a: 2, b: 2 }, 'PADEL')).toEqual({ ganador: null, perdedor: null, ventaja: false })
  })
})

describe('unidadDe y resumenGuardado', () => {
  it('cada deporte se cuenta en su unidad', () => {
    expect(unidadDe('PADEL')).toBe('games')
    expect(unidadDe('PING_PONG')).toBe('puntos')
    expect(unidadDe('TENIS')).toBe('games')
    expect(unidadDe('POOL')).toBe('bolas')
    expect(unidadDe('BEER_PONG')).toBe('vasos')
  })

  it('el ganador primero y su marcador primero, como se canta', () => {
    expect(resumenGuardado('Ana y Beto', 'Cami y Dani', { a: 4, b: 2 })).toBe('Ana y Beto 4-2')
    expect(resumenGuardado('Ana', 'Beto', { a: 7, b: 11 })).toBe('Beto 11-7')
    expect(resumenGuardado('Ana', 'Beto', { a: 3, b: 3 })).toBe('Ana 3-3 Beto')
  })
})

// Ajedrez (odd/tasks/mas-deportes.md, S3): un toque, guardado como 1-0, 0-1 o 0-0.
describe('la partida de ajedrez', () => {
  it('cada toque es un marcador que la regla de una fecha acepta, tablas incluidas', () => {
    expect(marcadorDePartida('a')).toEqual({ a: 1, b: 0 })
    expect(marcadorDePartida('b')).toEqual({ a: 0, b: 1 })
    expect(marcadorDePartida('tablas')).toEqual({ a: 0, b: 0 })
    for (const toque of ['a', 'b', 'tablas'] as const) {
      const { a, b } = marcadorDePartida(toque)
      expect(setError({ gamesA: a, gamesB: b }, formatoRapido('AJEDREZ'), true)).toBeNull()
    }
  })

  it('lo cargado vuelve a su toque', () => {
    expect(partidaDelMarcador({ a: 1, b: 0 })).toBe('a')
    expect(partidaDelMarcador({ a: 0, b: 1 })).toBe('b')
    expect(partidaDelMarcador({ a: 0, b: 0 })).toBe('tablas')
    expect(partidaDelMarcador(null)).toBeNull()
    expect(partidaDelMarcador({ a: 4, b: 2 })).toBeNull()
  })

  it('no tiene números del perdedor ni de ventaja', () => {
    expect(puntosDelPerdedor('AJEDREZ')).toEqual([])
    expect(ventajasDelPerdedor('AJEDREZ')).toEqual([])
  })

  it('el botón del deporte dice cómo se juega', () => {
    expect(subDeporte('AJEDREZ')).toBe('Gana o tablas')
    expect(subDeporte('PADEL')).toBe('A 4 games')
    expect(subDeporte('BEER_PONG')).toBe('A 10 vasos')
  })

  it('el aviso dice quién ganó, o tablas', () => {
    expect(resumenGuardado('Ana', 'Beto', { a: 1, b: 0 }, 'AJEDREZ')).toBe('ganó Ana')
    expect(resumenGuardado('Ana', 'Beto', { a: 0, b: 1 }, 'AJEDREZ')).toBe('ganó Beto')
    expect(resumenGuardado('Ana', 'Beto', { a: 0, b: 0 }, 'AJEDREZ')).toBe('Ana y Beto, tablas')
    expect(resumenGuardado('Ana', 'Beto', { a: 4, b: 2 }, 'PADEL')).toBe('Ana 4-2')
  })
})
