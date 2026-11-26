import { describe, expect, it } from 'vitest'
import { faltanPinos, leerPinos, tablaDePinos, type JugadorPinosVM } from './pinos-state'

const jugador = (entryId: string, score: number | null, vos = false): JugadorPinosVM => ({
  entryId,
  name: `Jugador ${entryId}`,
  vos,
  score,
})

describe('leerPinos: lo que se tipeó en la fila', () => {
  it('vacío no es nada todavía', () => {
    expect(leerPinos('')).toBeNull()
    expect(leerPinos('   ')).toBeNull()
  })

  it('un entero de 0 a 9999 es un total', () => {
    expect(leerPinos('0')).toEqual({ score: 0 })
    expect(leerPinos(' 180 ')).toEqual({ score: 180 })
    expect(leerPinos('9999')).toEqual({ score: 9999 })
  })

  it('lo que no es un total dice por qué', () => {
    expect(leerPinos('10000')).toEqual({ error: 'Los pinos van de 0 a 9999, sin decimales.' })
    expect(leerPinos('12a')).toEqual({ error: 'Sólo números.' })
    expect(leerPinos('-3')).toEqual({ error: 'Sólo números.' })
    expect(leerPinos('1.5')).toEqual({ error: 'Sólo números.' })
  })
})

describe('faltanPinos: lo que falta para cerrar', () => {
  it('dice cuántos jugadores no cargaron', () => {
    expect(faltanPinos(0)).toBe('Todos cargaron sus pinos')
    expect(faltanPinos(1)).toBe('Falta 1 jugador')
    expect(faltanPinos(3)).toBe('Faltan 3 jugadores')
  })
})

describe('tablaDePinos: el ranking en vivo', () => {
  it('comparte el puesto en el empate y el siguiente salta (S4)', () => {
    const filas = tablaDePinos([jugador('a', 150), jugador('b', 180), jugador('c', 200), jugador('d', 180)])
    expect(filas.map((fila) => [fila.key, fila.puesto, fila.pinos])).toEqual([
      ['c', '1', '200'],
      ['b', '2', '180'],
      ['d', '2', '180'],
      ['a', '4', '150'],
    ])
  })

  it('quien no cargó va al fondo, sin puesto, y no le corre el puesto a nadie', () => {
    const filas = tablaDePinos([jugador('a', null), jugador('b', 90, true), jugador('c', 120)])
    expect(filas).toEqual([
      { key: 'c', nombre: 'Jugador c', esVos: false, puesto: '1', pinos: '120' },
      { key: 'b', nombre: 'Jugador b', esVos: true, puesto: '2', pinos: '90' },
      { key: 'a', nombre: 'Jugador a', esVos: false, puesto: '—', pinos: '—' },
    ])
  })

  it('sin nadie cargado, todos sin puesto en el orden en que llegaron', () => {
    expect(tablaDePinos([jugador('x', null), jugador('y', null)]).map((fila) => fila.key)).toEqual(['x', 'y'])
  })
})
