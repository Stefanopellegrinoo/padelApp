import { describe, expect, it } from 'vitest'
import { redirectTarget } from './casual-form-data'

describe('redirectTarget', () => {
  it('vuelve al amigo del formulario si sigue en el partido', () => {
    expect(redirectTarget('b', ['a', 'b', 'c'], 'a')).toBe('/amigos/b')
  })
  it('si el amigo del formulario no juega, usa lo que devolvió la base', () => {
    expect(redirectTarget('x', ['a', 'b'], 'a')).toBe('/amigos/a')
  })
  it('sin amigo del formulario ni de la base va a /amigos', () => {
    expect(redirectTarget('', ['a'], null)).toBe('/amigos')
    expect(redirectTarget('x', ['a'], null)).toBe('/amigos')
  })
})
