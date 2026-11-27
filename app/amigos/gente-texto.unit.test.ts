import { describe, expect, it } from 'vitest'
import type { GenteDeTorneo } from '@/db/friends'
import {
  cuantasPersonas,
  deUnTorneo,
  filtrosDeGente,
  GENTE_EN_AMIGOS,
  GENTE_EN_INICIO,
  GENTE_POR_TANDA,
  metaDeGente,
  mostrarMas,
} from './gente-texto'

// "Gente de tus torneos" (odd/tasks/amigos-faciles.md, S3, S10, S11).

const persona = (playerId: string, torneos: Array<[string, string]>): GenteDeTorneo => ({
  playerId,
  displayName: playerId,
  seasonIds: torneos.map(([id]) => id),
  torneos: torneos.map(([, nombre]) => nombre),
  fechasJuntos: 0,
})

const MARTES: [string, string] = ['s-martes', 'Los Pibes del Martes']
const JUEVES: [string, string] = ['s-jueves', 'Copa del Jueves']
const VIERNES: [string, string] = ['s-viernes', 'FIFA de los Viernes']

describe('cuántas se ven', () => {
  it('5 en Amigos, 2 en Inicio, de a 20 en "Ver todas"', () => {
    expect(GENTE_EN_AMIGOS).toBe(5)
    expect(GENTE_EN_INICIO).toBe(2)
    expect(GENTE_POR_TANDA).toBe(20)
  })
})

describe('metaDeGente: de dónde la conocés, sin fechas (S11)', () => {
  it('uno, dos, tres o más torneos; nunca las fechas juntos', () => {
    expect(metaDeGente({ torneos: ['Los Pibes del Martes'] })).toBe('Los Pibes del Martes')
    expect(metaDeGente({ torneos: ['Los Pibes del Martes', 'Copa del Jueves'] })).toBe('Los Pibes del Martes y Copa del Jueves')
    expect(metaDeGente({ torneos: ['Los Pibes del Martes', 'Copa del Jueves', 'FIFA de los Viernes'] })).toBe(
      'Los Pibes del Martes y 2 más',
    )
  })
})

describe('cuantasPersonas', () => {
  it('"1 persona", "N personas"', () => {
    expect(cuantasPersonas(0)).toBe('0 personas')
    expect(cuantasPersonas(1)).toBe('1 persona')
    expect(cuantasPersonas(23)).toBe('23 personas')
  })
})

describe('filtrosDeGente: un chip por torneo con gente para sugerir', () => {
  it('primero el que tiene más gente; con la misma, por nombre', () => {
    const gente = [persona('a', [MARTES, JUEVES]), persona('b', [VIERNES]), persona('c', [MARTES]), persona('d', [JUEVES])]
    expect(filtrosDeGente(gente)).toEqual([
      { seasonId: 's-jueves', nombre: 'Copa del Jueves', cuantas: 2 },
      { seasonId: 's-martes', nombre: 'Los Pibes del Martes', cuantas: 2 },
      { seasonId: 's-viernes', nombre: 'FIFA de los Viernes', cuantas: 1 },
    ])
  })

  it('sin gente, ningún chip', () => {
    expect(filtrosDeGente([])).toEqual([])
  })
})

describe('deUnTorneo', () => {
  const gente = [persona('a', [MARTES, JUEVES]), persona('b', [VIERNES]), persona('c', [MARTES])]

  it('sin filtro, todos y en el mismo orden', () => {
    expect(deUnTorneo(gente, null)).toEqual(gente)
  })

  it('con un torneo, sólo su gente y en el mismo orden', () => {
    expect(deUnTorneo(gente, 's-martes').map((p) => p.playerId)).toEqual(['a', 'c'])
  })

  it('un torneo sin nadie (o que no existe): vacío', () => {
    expect(deUnTorneo(gente, 's-otro')).toEqual([])
  })
})

describe('mostrarMas: cuántas suma el próximo toque', () => {
  it('las 20 siguientes, o las que quedan', () => {
    expect(mostrarMas(45, 20)).toBe(20)
    expect(mostrarMas(45, 40)).toBe(5)
    expect(mostrarMas(23, 20)).toBe(3)
    expect(mostrarMas(20, 20)).toBe(0)
    expect(mostrarMas(8, 20)).toBe(0)
  })
})
