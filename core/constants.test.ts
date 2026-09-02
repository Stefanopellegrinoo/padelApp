import { describe, it, expect } from 'vitest'
import { MAX_PAIRING_POOL, MASTERS_SIZE, minSquadFor } from './constants'
import { allMatchings } from './matchings'

describe('constants', () => {
  it('defines the masters size as four', () => {
    expect(MASTERS_SIZE).toBe(4)
  })
})

describe('minSquadFor — el piso es "la gente que hace falta para que exista un partido"', () => {
  it('con lados de a uno, dos alcanzan: uno de cada lado', () => {
    expect(minSquadFor(1)).toBe(2)
  })

  it('con parejas, hacen falta cuatro: dos por lado', () => {
    expect(minSquadFor(2)).toBe(4)
  })

  // El piso de parejas es el único de los dos que puede pisar al Masters:
  // `ranking.length === squad.length` (`core/ranking.ts:27-38`, una fila por
  // MIEMBRO del plantel) y `mastersQualifiers` corta con `ranking.length <
  // MASTERS_SIZE` (`core/masters.ts:9-11`) — MASTERS_SIZE cuenta JUGADORES, no
  // lados. Con lados de a uno el Masters ya es inalcanzable por su cuenta:
  // `0053_disciplines_has_masters_needs_pair.sql:29-30` prohíbe
  // `has_masters and pair_size = 1`. Esta aserción es la que rompería en voz
  // alta el día que alguien cambie la fórmula del piso sin mirar el Masters.
  it('el piso de parejas no puede quedar por debajo del Masters', () => {
    expect(minSquadFor(2)).toBeGreaterThanOrEqual(MASTERS_SIZE)
  })
})

describe('MAX_PAIRING_POOL — el techo de CPU, con su propio literal', () => {
  // docs/plan-piso-y-techo-del-plantel.md Task 3: ya no hay techo de plantel
  // con el que coincidir "de casualidad" — se borró entero. Esto fija el
  // literal de CPU por lo que es, un límite propio, no un espejo de otro
  // número que ya no existe.
  it('vale 12 por su propia cuenta', () => {
    expect(MAX_PAIRING_POOL).toBe(12)
  })

  it('allMatchings rechaza por el techo de CPU, no por ningún techo de plantel', () => {
    // 14 está por encima del pool, así que rechaza — y el mensaje tiene que
    // nombrarlo a ÉL, no a un número de plantel que ya no existe:
    // (14-1)!! = 135135 emparejamientos, 13 veces los de 12.
    expect(() => allMatchings(Array.from({ length: 14 }, (_, i) => `e${i}`))).toThrow(
      new RegExp(String(MAX_PAIRING_POOL)),
    )
  })
})
