import { describe, expect, it } from 'vitest'
import {
  AYUDA_BUSQUEDA,
  BUSQUEDA_CORTA,
  SIN_RESULTADOS,
  campoDeBusqueda,
  partesDelUsuario,
  resumenDeBusqueda,
} from './buscar-texto'

/**
 * Lo que dice el buscador de Amigos (odd/tasks/amigos-faciles.md, S8,
 * `design/amigos-faciles/05-buscar-por-usuario.html`) según lo que escribiste.
 */

describe('campoDeBusqueda', () => {
  it('vacío, o sólo la @ y espacios: no busca y no avisa nada', () => {
    for (const vacio of ['', '   ', '@', ' @ ']) expect(campoDeBusqueda(vacio), vacio).toEqual({ kind: 'vacio' })
  })

  it('con menos de 3 letras: pide más, sin buscar', () => {
    for (const corta of ['n', 'ni', '@ni', ' NI ']) expect(campoDeBusqueda(corta), corta).toEqual({ kind: 'corta' })
  })

  it('desde 3 letras busca lo limpio: sin la @, sin espacios, en minúsculas', () => {
    expect(campoDeBusqueda('nic')).toEqual({ kind: 'buscar', query: 'nic' })
    expect(campoDeBusqueda(' @Nico.A ')).toEqual({ kind: 'buscar', query: 'nico.a' })
  })
})

describe('partesDelUsuario', () => {
  it('separa lo que escribiste (va en negrita) del resto', () => {
    expect(partesDelUsuario('nicanorortiz', 'nic')).toEqual({ prefijo: 'nic', resto: 'anorortiz' })
    expect(partesDelUsuario('nic', 'nic')).toEqual({ prefijo: 'nic', resto: '' })
  })

  it('si no empieza así (una respuesta vieja), nada en negrita', () => {
    expect(partesDelUsuario('tomi', 'nic')).toEqual({ prefijo: '', resto: 'tomi' })
  })
})

describe('resumenDeBusqueda', () => {
  it('cuántos empiezan así', () => {
    expect(resumenDeBusqueda(1, 'nic')).toBe('1 usuario empieza con @nic')
    expect(resumenDeBusqueda(4, 'nic')).toBe('4 usuarios empiezan con @nic')
  })

  it('con 10, que son los primeros y que con una letra más se achica', () => {
    expect(resumenDeBusqueda(10, 'nic')).toBe('Los primeros 10 que empiezan con @nic. Si no está, escribí una letra más.')
  })
})

describe('los textos fijos', () => {
  it('son los de la maqueta', () => {
    expect(AYUDA_BUSQUEDA).toBe('Para sumar a quien no está en tus torneos')
    expect(BUSQUEDA_CORTA).toBe('Escribí al menos 3 letras de su @usuario')
    expect(SIN_RESULTADOS).toBe('No hay nadie con ese @usuario. Si todavía no lo eligió, mandale tu link.')
  })
})
