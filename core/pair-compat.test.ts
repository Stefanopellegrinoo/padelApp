import { describe, it, expect } from 'vitest'
import { sideOf, pairOf } from './pair-compat'
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
