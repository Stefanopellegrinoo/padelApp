import { describe, it, expect } from 'vitest'
import { sideOf, pairOf, pairFromRow } from './pair-compat'
import { single } from './side'

describe('sideOf', () => {
  it('lifts a Pair into a Side of two', () => {
    expect(sideOf({ a: 'a', b: 'b' })).toEqual({ size: 2, a: 'a', b: 'b' })
  })
})

describe('pairOf', () => {
  it('reads a Side of two back as a Pair', () => {
    expect(pairOf({ size: 2, a: 'a', b: 'b' })).toEqual({ a: 'a', b: 'b' })
  })

  // La aserción del adaptador (design #3801): mientras exista, ningún camino
  // PRODUCE un lado de uno, así que llegar acá es un consumidor sin migrar.
  it('throws on a side of one instead of returning a partner-less pair', () => {
    expect(() => pairOf(single('a'))).toThrow(/Falta migrar este consumidor a Side/)
  })
})

// S38 (verify-report ronda 12): `pairFromRow` ES `pairOf ∘ sideOfRow`, con el
// mismo mensaje — el hogar único que reemplaza las tres copias byte-idénticas
// que db/read.ts, db/matchday.ts y db/season.ts escribían a mano.
describe('pairFromRow', () => {
  it('reads a row of two (pair_size=2) as a Pair', () => {
    expect(pairFromRow(2, 'a', 'b')).toEqual({ a: 'a', b: 'b' })
  })

  it('throws on a row of one instead of returning a partner-less pair', () => {
    expect(() => pairFromRow(1, 'a', null)).toThrow(/Falta migrar este consumidor a Side/)
  })

  it('throws when a row of two is missing its second member: the row is broken', () => {
    expect(() => pairFromRow(2, 'a', null)).toThrow(/segundo miembro/)
  })
})
