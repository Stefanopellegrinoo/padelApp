import { describe, it, expect } from 'vitest'
import { single, pair, members, includes, partnerOf, sameSide, sideOfRow } from './side'

describe('single', () => {
  it('builds a side of one', () => {
    expect(single('a')).toEqual({ size: 1, a: 'a' })
  })
})

describe('pair', () => {
  it('builds a side of two', () => {
    expect(pair('a', 'b')).toEqual({ size: 2, a: 'a', b: 'b' })
  })
})

describe('members', () => {
  it('returns the one entry of a side of one', () => {
    expect(members(single('a'))).toEqual(['a'])
  })

  it('returns both entries of a side of two', () => {
    expect(members(pair('a', 'b'))).toEqual(['a', 'b'])
  })
})

describe('includes', () => {
  it('is true for the entry of a side of one', () => {
    expect(includes(single('a'), 'a')).toBe(true)
  })

  it('is false for someone else against a side of one', () => {
    expect(includes(single('a'), 'z')).toBe(false)
  })

  it('is true for either entry of a side of two', () => {
    expect(includes(pair('a', 'b'), 'a')).toBe(true)
    expect(includes(pair('a', 'b'), 'b')).toBe(true)
  })

  it('is false for someone not on a side of two', () => {
    expect(includes(pair('a', 'b'), 'z')).toBe(false)
  })
})

describe('partnerOf', () => {
  it('is null on a side of one: there is no partner to have', () => {
    expect(partnerOf(single('a'), 'a')).toBeNull()
  })

  it('returns the other entry of a side of two', () => {
    expect(partnerOf(pair('a', 'b'), 'a')).toBe('b')
    expect(partnerOf(pair('a', 'b'), 'b')).toBe('a')
  })

  it('is null when the entry does not play on that side of two', () => {
    expect(partnerOf(pair('a', 'b'), 'z')).toBeNull()
  })
})

describe('sameSide', () => {
  it('two sides of one are the same when the entry matches', () => {
    expect(sameSide(single('a'), single('a'))).toBe(true)
    expect(sameSide(single('a'), single('b'))).toBe(false)
  })

  it('a side of one is never the same as a side of two', () => {
    expect(sameSide(single('a'), pair('a', 'b'))).toBe(false)
    expect(sameSide(pair('a', 'b'), single('a'))).toBe(false)
  })

  it('two sides of two are the same regardless of a/b order', () => {
    expect(sameSide(pair('a', 'b'), pair('a', 'b'))).toBe(true)
    expect(sameSide(pair('a', 'b'), pair('b', 'a'))).toBe(true)
  })

  it('two sides of two with a different member are not the same', () => {
    expect(sameSide(pair('a', 'b'), pair('a', 'z'))).toBe(false)
  })
})

// Con un discriminante VARIABLE (no un literal)
// `{ size: row.pair_size as SideSize, a: row.entry_a, b: row.entry_b }`
// compila limpio y, si `pair_size` es 1, pierde el `b` de la fila en
// silencio — exactamente la forma del mapper que va a leer `pairs`.
// `sideOfRow` es el único borde por el que un `Side` puede nacer de una fila.
describe('sideOfRow', () => {
  it('builds a side of one, ignoring a stray b', () => {
    expect(sideOfRow(1, 'a', null)).toEqual({ size: 1, a: 'a' })
  })

  it('builds a side of two when b is present', () => {
    expect(sideOfRow(2, 'a', 'b')).toEqual({ size: 2, a: 'a', b: 'b' })
  })

  it('throws when a side of two has no b: the row is broken', () => {
    expect(() => sideOfRow(2, 'a', null)).toThrow(/segundo miembro/)
  })

  // La rama size===1 tapaba sólo la mitad del
  // agujero que este describe documenta arriba — tiraba con size=2/b=null,
  // pero descartaba un `b` en silencio con size=1/b!==null. Simétrico con el
  // test de arriba.
  it('throws when a side of one carries a stray b: the row is broken', () => {
    expect(() => sideOfRow(1, 'a', 'b')).toThrow(/segundo miembro/)
  })
})
