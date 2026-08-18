import { describe, expect, it } from 'vitest'
import { defaultConfig, pair, single, type SeasonConfig, type SideStanding } from '@/core'
import { dayPoints } from './dia-state'

function standing(side: SideStanding['side'], position: number): SideStanding {
  return { side, played: 0, won: 0, setsDiff: 0, gamesDiff: 0, position }
}

const PAIR_CONFIG = defaultConfig(8) // points.length === 4
const SOLO_CONFIG: SeasonConfig = { ...defaultConfig(8), points: [8, 7, 6, 5, 4, 3, 2, 1] }

describe('dayPoints — de a dos', () => {
  it('reparte los puntos congelados por posición', () => {
    const standings = [
      standing(pair('a1', 'a2'), 1),
      standing(pair('b1', 'b2'), 2),
      standing(pair('c1', 'c2'), 3),
      standing(pair('d1', 'd2'), 4),
    ]
    const frozen = new Map([
      ['a1', 10], ['a2', 10],
      ['b1', 6], ['b2', 6],
      ['c1', 3], ['c2', 3],
      ['d1', 1], ['d2', 1],
    ])
    const points = dayPoints({ standings, config: PAIR_CONFIG, guestIds: [], frozenPoints: frozen })
    expect(points.get('a1')).toBe(10)
    expect(points.get('b2')).toBe(6)
    expect(points.get('d1')).toBe(1)
  })

  it('el invitado no cobra y su compañero sí', () => {
    const standings = [
      standing(pair('a1', 'g1'), 1),
      standing(pair('b1', 'b2'), 2),
      standing(pair('c1', 'c2'), 3),
      standing(pair('d1', 'd2'), 4),
    ]
    // `computeAwards` no le escribe award al invitado, y `awards` tampoco lo tiene.
    const frozen = new Map([
      ['a1', 10],
      ['b1', 6], ['b2', 6],
      ['c1', 3], ['c2', 3],
      ['d1', 1], ['d2', 1],
    ])
    const points = dayPoints({ standings, config: PAIR_CONFIG, guestIds: ['g1'], frozenPoints: frozen })
    expect(points.get('a1')).toBe(10)
    expect(points.get('g1')).toBeUndefined()
  })
})

/*
 * C21 (verify-report ronda 14). La pantalla de una fecha CERRADA RECALCULABA
 * sus puntos con `computeAwards` sobre los `guestIds` de HOY, en vez de leer
 * los `awards` congelados al cerrar. Mientras el conjunto de lados que cobran
 * no cambie después del cierre, las dos fuentes dan lo mismo — y PR18c es lo
 * primero en toda la cadena que hace que cambie.
 *
 * Al promover al invitado que jugó solo (PR18c), deja de estar en `guestIds`,
 * su propio lado pasa a cobrar, y los lados pagos suben de 8 a 9 contra 8
 * valores de puntos. `computeAwards` tira un `Error` PELADO —no `EdgeError`—,
 * que el server action re-tira, así que el admin ve un error boundary de Next
 * sin una sola palabra. Medido de punta a punta por la auditoría: la acción
 * devuelve ok y el render siguiente muere.
 *
 * Los `awards` congelados son la fuente correcta por definición: son lo que la
 * fecha repartió, y una fecha cerrada no vuelve a repartir. Recalcular fue
 * siempre una coincidencia, no una decisión.
 */
describe('dayPoints — de a uno, después de promover un invitado (C21)', () => {
  // 8 del plantel + 1 invitado que jugó solo = 9 lados, 8 pagos.
  const standings = [
    standing(single('s1'), 1),
    standing(single('s2'), 2),
    standing(single('s3'), 3),
    standing(single('s4'), 4),
    standing(single('s5'), 5),
    standing(single('s6'), 6),
    standing(single('s7'), 7),
    standing(single('s8'), 8),
    standing(single('invi'), 9),
  ]
  const frozen = new Map([
    ['s1', 8], ['s2', 7], ['s3', 6], ['s4', 5],
    ['s5', 4], ['s6', 3], ['s7', 2], ['s8', 1],
  ])

  it('antes de promover, cada jugador muestra lo que cobró', () => {
    const points = dayPoints({ standings, config: SOLO_CONFIG, guestIds: ['invi'], frozenPoints: frozen })
    expect(points.get('s1')).toBe(8)
    expect(points.get('s8')).toBe(1)
    expect(points.get('invi')).toBeUndefined()
  })

  it('después de promover NO se rompe: el invitado ya no está en guestIds', () => {
    // ESTE es C21. Con el recálculo, 9 lados pagos contra 8 valores de puntos
    // hacen tirar a `computeAwards` y la pantalla entera se cae.
    expect(() =>
      dayPoints({ standings, config: SOLO_CONFIG, guestIds: [], frozenPoints: frozen }),
    ).not.toThrow()
  })

  it('después de promover, los 8 que cobraron siguen mostrando lo MISMO', () => {
    // La otra mitad de C21: aunque no tirara, recalcular con 9 lados pagos
    // repartiría distinto y la tabla del día contradiría a la de la temporada,
    // que lee `awards`. Los puntos de una fecha cerrada no se mueven porque
    // alguien se sumó al plantel después.
    const points = dayPoints({ standings, config: SOLO_CONFIG, guestIds: [], frozenPoints: frozen })
    expect(points.get('s1')).toBe(8)
    expect(points.get('s2')).toBe(7)
    expect(points.get('s8')).toBe(1)
  })

  it('el promovido no cobra nada de esa fecha: jugó de invitado', () => {
    const points = dayPoints({ standings, config: SOLO_CONFIG, guestIds: [], frozenPoints: frozen })
    expect(points.get('invi')).toBeUndefined()
  })
})
