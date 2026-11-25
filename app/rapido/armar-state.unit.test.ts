import { describe, expect, it } from 'vitest'
import { agruparChips, enterEnJugador, nombresValidos, seCaenLasParejas, tocarJugador } from './armar-state'

describe('nombresValidos', () => {
  it('descarta los nombres vacíos o con sólo espacios', () => {
    expect(nombresValidos(['Ana', '  ', '', 'Beto '])).toEqual(['Ana', 'Beto'])
  })
})

describe('tocarJugador', () => {
  it('deja pendiente al primer jugador tocado', () => {
    expect(tocarJugador([], null, 0)).toEqual({ pares: [], pendiente: 0 })
  })

  it('cierra la pareja al tocar un segundo jugador distinto', () => {
    expect(tocarJugador([], 0, 2)).toEqual({ pares: [[0, 2]], pendiente: null })
  })

  it('ordena la pareja de menor a mayor sin importar el orden de los toques', () => {
    expect(tocarJugador([], 3, 1)).toEqual({ pares: [[1, 3]], pendiente: null })
  })

  it('cancela el pendiente si se lo vuelve a tocar', () => {
    expect(tocarJugador([], 1, 1)).toEqual({ pares: [], pendiente: null })
  })

  it('desempareja a alguien que ya tenía pareja', () => {
    const pares: Array<[number, number]> = [
      [0, 1],
      [2, 3],
    ]
    expect(tocarJugador(pares, null, 1)).toEqual({ pares: [[2, 3]], pendiente: null })
  })

  it('desemparejar a otro no toca el pendiente propio', () => {
    const pares: Array<[number, number]> = [[0, 1]]
    expect(tocarJugador(pares, 4, 0)).toEqual({ pares: [], pendiente: 4 })
  })
})

describe('seCaenLasParejas', () => {
  it('no se caen al agregar un casillero vacío: la lista filtrada no cambió', () => {
    expect(seCaenLasParejas(['Ana', 'Beto'], ['Ana', 'Beto', ''])).toBe(false)
  })

  it('no se caen al sacar un casillero vacío', () => {
    expect(seCaenLasParejas(['Ana', '', 'Beto'], ['Ana', 'Beto'])).toBe(false)
  })

  it('no se caen al corregir un nombre que ya tenía contenido', () => {
    expect(seCaenLasParejas(['Ana', 'Beto'], ['Ana', 'Betito'])).toBe(false)
  })

  it('se caen al llenar un casillero vacío: corre los índices de la lista filtrada', () => {
    expect(seCaenLasParejas(['', 'Beto'], ['Ana', 'Beto'])).toBe(true)
  })

  it('se caen al vaciar un nombre que tenía contenido', () => {
    expect(seCaenLasParejas(['Ana', 'Beto'], ['', 'Beto'])).toBe(true)
  })

  it('se caen al sacar una fila con nombre', () => {
    expect(seCaenLasParejas(['Ana', 'Beto'], ['Beto'])).toBe(true)
  })
})

describe('agruparChips', () => {
  it('agrupa a cada pareja con su número, y deja sueltos a los que no tienen', () => {
    expect(agruparChips(['Ana', 'Beto', 'Cami', 'Dani'], [[0, 3]])).toEqual({
      parejas: [
        {
          numero: 1,
          jugadores: [
            { indice: 0, nombre: 'Ana' },
            { indice: 3, nombre: 'Dani' },
          ],
        },
      ],
      sueltos: [
        { indice: 1, nombre: 'Beto' },
        { indice: 2, nombre: 'Cami' },
      ],
    })
  })

  it('numera las parejas en el orden en que se armaron', () => {
    const grupos = agruparChips(['Ana', 'Beto', 'Cami', 'Dani'], [
      [2, 3],
      [0, 1],
    ])
    expect(grupos.parejas.map((pareja) => pareja.numero)).toEqual([1, 2])
    expect(grupos.parejas[0]?.jugadores.map((jugador) => jugador.nombre)).toEqual(['Cami', 'Dani'])
    expect(grupos.sueltos).toEqual([])
  })

  it('sin parejas armadas quedan todos sueltos', () => {
    expect(agruparChips(['Ana', 'Beto'], [])).toEqual({
      parejas: [],
      sueltos: [
        { indice: 0, nombre: 'Ana' },
        { indice: 1, nombre: 'Beto' },
      ],
    })
  })
})

describe('enterEnJugador', () => {
  it('Enter en una fila del medio pasa a la siguiente, sin tocar la lista', () => {
    expect(enterEnJugador(['Ana', '', ''], 0)).toEqual({ jugadores: ['Ana', '', ''], foco: 1 })
  })

  it('Enter en la última con nombre agrega un casillero vacío y va ahí', () => {
    expect(enterEnJugador(['Ana', 'Beto'], 1)).toEqual({ jugadores: ['Ana', 'Beto', ''], foco: 2 })
  })

  it('Enter en la última vacía no agrega otra: ahí se terminó la lista', () => {
    expect(enterEnJugador(['Ana', '  '], 1)).toEqual({ jugadores: ['Ana', '  '], foco: null })
  })

  it('no agrega por arriba del techo de jugadores', () => {
    const doce = Array.from({ length: 12 }, (_, i) => `J${i}`)
    expect(enterEnJugador(doce, 11)).toEqual({ jugadores: doce, foco: null })
  })
})
