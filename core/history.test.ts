import { describe, it, expect } from 'vitest'
import { previousContext, type MatchdayHistory } from './history'
import { members, pair, single } from './side'
import type { Award, Side } from './types'

function history(sides: Side[], champion: Side | null): MatchdayHistory {
  const awards: Award[] = []
  sides.forEach((side, index) => {
    const position = champion !== null && side === champion ? 1 : index + 2
    for (const entryId of members(side)) {
      if (entryId.startsWith('g')) continue // guests don't collect points
      awards.push({ entryId, position, points: 10 - position, lines: [] })
    }
  })
  return { sides, awards }
}

const A = pair('p1', 'p2')
const B = pair('p3', 'p4')
const C = pair('p5', 'p6')

describe('previousContext', () => {
  it('has nothing to inherit on the first matchday', () => {
    expect(previousContext(null, null)).toEqual({
      defenders: null,
      defendersAlreadyRepeated: false,
      previousPairs: [],
    })
  })

  it('the defenders are the pair that collected position 1', () => {
    const context = previousContext(history([A, B, C], B), null)
    expect(context.defenders).toEqual(B)
    expect(context.defendersAlreadyRepeated).toBe(false)
  })

  it('returns every pair from the previous matchday', () => {
    expect(previousContext(history([A, B, C], A), null).previousPairs).toEqual([A, B, C])
  })

  it('marks them as already repeated if they were also together two matchdays ago', () => {
    const context = previousContext(history([A, B, C], A), history([A, B, C], A))
    expect(context.defendersAlreadyRepeated).toBe(true)
  })

  it('does not care about the order of the two players', () => {
    const flipped = pair('p2', 'p1')
    const context = previousContext(history([A, B], A), history([flipped, C], flipped))
    expect(context.defendersAlreadyRepeated).toBe(true)
  })

  it('is not already repeated when the pair before last is a different one', () => {
    const context = previousContext(history([A, B, C], A), history([B, C], null))
    expect(context.defendersAlreadyRepeated).toBe(false)
  })

  it('never returns a guest-only pair, even when it topped the table', () => {
    const guests = pair('g1', 'g2')
    const context = previousContext(history([guests, A, B], A), null)
    expect(context.defenders).toEqual(A)
  })

  it('finds a mixed champion pair by its tournament teammate', () => {
    const mixed = pair('p1', 'g1')
    const context = previousContext(history([mixed, B], mixed), null)
    expect(context.defenders).toEqual(mixed)
  })

  it('has no defenders if the previous matchday never closed', () => {
    const context = previousContext({ sides: [A, B], awards: [] }, null)
    expect(context.defenders).toBeNull()
    expect(context.previousPairs).toEqual([A, B])
  })

  it('fails if two pairs claim position 1', () => {
    const broken: MatchdayHistory = {
      sides: [A, B],
      awards: [
        { entryId: 'p1', position: 1, points: 10, lines: [] },
        { entryId: 'p3', position: 1, points: 10, lines: [] },
      ],
    }
    expect(() => previousContext(broken, null)).toThrow(/2 parejas en la posición 1/)
  })

  it('fails if the winner is not in any pair', () => {
    const broken: MatchdayHistory = {
      sides: [A],
      awards: [{ entryId: 'p9', position: 1, points: 10, lines: [] }],
    }
    expect(() => previousContext(broken, null)).toThrow(/0 parejas en la posición 1/)
  })

  /*
   * PR18b: una historia de lados de UNO no tiene defensores ni parejas
   * previas, y eso no es un agujero — la regla del campeón que defiende es una
   * restricción del sorteo de PAREJAS, y de a uno no hay con quién repetir.
   * `previousContext` devuelve el mismo triple neutro que para "no hubo fecha
   * anterior", que es lo que `buildSides` con `sideSize === 1` ya ignoraba
   * entero (core/pairing.ts) y lo que el guard de C19 hardcodeaba en
   * `pairingContextFor`.
   */
  it('una fecha de a uno no deja defensores ni parejas previas', () => {
    const solos = [single('s1'), single('s2'), single('s3')]
    const context = previousContext(history(solos, solos[0] ?? null), null)
    expect(context).toEqual({
      defenders: null,
      defendersAlreadyRepeated: false,
      previousPairs: [],
    })
  })

  it('un lado de uno campeón no vuelve como pareja defensora', () => {
    // El campeón EXISTE (cobró la posición 1) pero no es una pareja: si esto
    // devolviera algo, `buildPairs` recibiría una restricción sobre un sorteo
    // que no ocurre.
    const solos = [single('s1'), single('s2')]
    expect(previousContext(history(solos, solos[0] ?? null), null).defenders).toBeNull()
  })

  it('fails when the awards exist but none is in position 1', () => {
    const broken: MatchdayHistory = {
      sides: [A, B],
      awards: [{ entryId: 'p1', position: 2, points: 8, lines: [] }],
    }
    expect(() => previousContext(broken, null)).toThrow(/awards pero ninguno en la posición 1/)
  })
})
