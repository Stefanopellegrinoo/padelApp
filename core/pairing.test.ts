import { describe, it, expect } from 'vitest'
import { buildPairs, buildSides, type PairingInput, type SideBuildInput } from './pairing'
import { members, pair, sameSide, single } from './side'
import type { Side } from './types'

const SNAPSHOT = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p11', 'p12']

function input(overrides: Partial<PairingInput> = {}): PairingInput {
  return {
    present: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'],
    points: new Map(SNAPSHOT.map((id, i) => [id, 100 - i])),
    snapshot: SNAPSHOT,
    defenders: null,
    defendersAlreadyRepeated: false,
    previousPairs: [],
    guestIds: [],
    fixedPairs: [],
    ...overrides,
  }
}

function key(side: Side): string {
  return [...members(side)].sort().join('-')
}

function keys(sides: Side[]): string[] {
  return sides.map(key).sort()
}

describe('sameSide sobre lados de dos', () => {
  it('ignores the order of the two players', () => {
    expect(sameSide(pair('x', 'y'), pair('y', 'x'))).toBe(true)
  })

  it('is false for different players', () => {
    expect(sameSide(pair('x', 'y'), pair('x', 'z'))).toBe(false)
  })
})

describe('buildPairs — the balanced default', () => {
  it('pairs first with last when nothing constrains it', () => {
    const pairs = buildPairs(input())
    expect(keys(pairs)).toEqual(['p1-p8', 'p2-p7', 'p3-p6', 'p4-p5'])
  })

  it('returns half as many pairs as players', () => {
    expect(buildPairs(input())).toHaveLength(4)
    expect(buildPairs(input({ present: SNAPSHOT.slice(0, 12) }))).toHaveLength(6)
    expect(buildPairs(input({ present: SNAPSHOT.slice(0, 10) }))).toHaveLength(5)
  })

  it('uses every present player exactly once', () => {
    const present = SNAPSHOT.slice(0, 12)
    const used = buildPairs(input({ present })).flatMap((side) => members(side))
    expect(used.sort()).toEqual([...present].sort())
  })

  it('gives the same result for the same input', () => {
    // Compares order-erased sorted keys, so this only catches nondeterminism
    // (e.g. a stray Math.random or Date creeping into the algorithm) — it
    // does not guarantee the pairs array itself comes back in the same order.
    expect(keys(buildPairs(input()))).toEqual(keys(buildPairs(input())))
  })

  it('does not depend on the order the present players arrive in', () => {
    const straight = buildPairs(input())
    const shuffled = buildPairs(input({ present: ['p5', 'p1', 'p8', 'p3', 'p7', 'p2', 'p6', 'p4'] }))
    expect(keys(shuffled)).toEqual(keys(straight))
  })

  it('pins the known boundary: with two players outside the snapshot, their pairing depends on arrival order in `present`', () => {
    // out1/out2 are absent from SNAPSHOT and untracked in `points`, so both the
    // points tie-break and the snapshot-rank tie-break land equal for them —
    // the sort falls back to arrival order, which orderByPoints takes from the
    // pool array, and pool preserves whatever order `present` arrived in.
    const orderingA = buildPairs(input({ present: ['out1', 'out2', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'] }))
    const orderingB = buildPairs(input({ present: ['out2', 'out1', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'] }))
    expect(keys(orderingA)).toEqual(['out1-p2', 'out2-p1', 'p3-p6', 'p4-p5'])
    expect(keys(orderingB)).toEqual(['out1-p1', 'out2-p2', 'p3-p6', 'p4-p5'])
  })
})

describe('buildPairs — the defending champions', () => {
  const defenders: Side = pair('p3', 'p4')

  it('keeps the defenders together and out of the pool', () => {
    const pairs = buildPairs(input({ defenders }))
    expect(keys(pairs)).toContain('p3-p4')
    expect(pairs).toHaveLength(4)
  })

  it('dissolves them when one of the two is missing', () => {
    const pairs = buildPairs(
      input({ defenders, present: ['p1', 'p2', 'p3', 'p5', 'p6', 'p7', 'p8', 'p9'] }),
    )
    expect(keys(pairs)).not.toContain('p3-p4')
  })

  it('dissolves them when they already repeated once', () => {
    const pairs = buildPairs(input({ defenders, defendersAlreadyRepeated: true }))
    expect(keys(pairs)).not.toContain('p3-p4')
  })

  it('builds every pair from scratch when there are no defenders', () => {
    const pairs = buildPairs(input({ defenders: null }))
    expect(pairs).toHaveLength(4)
  })

  it('keeps the defenders even when their own pair is in previousPairs — the one sanctioned repeat', () => {
    const pairs = buildPairs(input({ defenders, previousPairs: [defenders] }))
    expect(keys(pairs)).toContain('p3-p4')
  })
})

describe('buildPairs — no repeating last matchday', () => {
  it('never repeats a pair from the previous matchday', () => {
    const previousPairs: Side[] = [
      pair('p1', 'p8'),
      pair('p2', 'p7'),
      pair('p3', 'p6'),
      pair('p4', 'p5'),
    ]
    const pairs = buildPairs(input({ previousPairs }))
    for (const built of pairs) {
      expect(previousPairs.some((old) => sameSide(old, built))).toBe(false)
    }
  })

  it('falls back to the next most balanced when the ideal one repeats', () => {
    const previousPairs: Side[] = [pair('p1', 'p8')]
    const pairs = buildPairs(input({ previousPairs }))
    expect(keys(pairs)).not.toContain('p1-p8')
    expect(pairs).toHaveLength(4)
    // Several legal matchings tie on imbalance once the ideal one (p1-p8,
    // p2-p7, p3-p6, p4-p5) is excluded. Pinned to whichever one allMatchings
    // enumerates first among the tied candidates, so a refactor of that
    // recursion — or loosening the `<` in buildPairs to `<=` — cannot
    // silently change who plays with whom while every other assertion here
    // still passes.
    expect(keys(pairs)).toEqual(['p1-p7', 'p2-p8', 'p3-p6', 'p4-p5'])
  })

  it('still finds a legal set when the table is identical to last matchday', () => {
    const previousPairs: Side[] = [
      pair('p1', 'p8'),
      pair('p2', 'p7'),
      pair('p3', 'p6'),
      pair('p4', 'p5'),
    ]
    const pairs = buildPairs(input({ previousPairs, points: new Map() }))
    expect(pairs).toHaveLength(4)
  })

  it('ignores a previous pair whose players are not both present', () => {
    const previousPairs: Side[] = [pair('p1', 'p99')]
    expect(() => buildPairs(input({ previousPairs }))).not.toThrow()
  })

  it('never runs out of legal options for any allowed size', () => {
    for (const size of [8, 10, 12]) {
      const present = SNAPSHOT.slice(0, size)
      const previousPairs = buildPairs(input({ present }))
      const next = buildPairs(input({ present, previousPairs }))
      expect(next).toHaveLength(size / 2)
      for (const built of next) {
        expect(previousPairs.some((old) => sameSide(old, built))).toBe(false)
      }
    }
  })
})

describe('buildPairs — the guest', () => {
  it('places the guest last in the order, so they get the table leader', () => {
    const present = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'guest']
    const points = new Map(present.map((id, i) => [id, 100 - i]))
    points.set('guest', 999) // points must not lift the guest out of last place
    const pairs = buildPairs(input({ present, points, guestIds: ['guest'] }))
    expect(keys(pairs)).toContain('guest-p1')
  })

  it('pairs the guest normally when they are not flagged as one', () => {
    const present = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']
    expect(buildPairs(input({ present, guestIds: [] }))).toHaveLength(4)
  })
})

describe('buildPairs — several guests', () => {
  it('two loose guests come out in two mixed pairs, not paired with each other', () => {
    // Ordered pool [p1..p6, g1, g2] → positions 1..8, idealSum 9. The only
    // matching with zero imbalance is 1-8, 2-7, 3-6, 4-5: p1 with g2 and p2 with g1.
    const pairs = buildPairs(
      input({ present: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'g1', 'g2'], guestIds: ['g1', 'g2'] }),
    )
    expect(keys(pairs)).toEqual(['g1-p2', 'g2-p1', 'p3-p6', 'p4-p5'])
  })

  it('reversing the guest order reverses who each one is paired with', () => {
    const pairs = buildPairs(
      input({ present: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'g1', 'g2'], guestIds: ['g2', 'g1'] }),
    )
    expect(keys(pairs)).toEqual(['g1-p1', 'g2-p2', 'p3-p6', 'p4-p5'])
  })
})

describe('buildPairs — fixed pairs', () => {
  it('keeps the fixed pair together and takes it out of the pool', () => {
    const pairs = buildPairs(
      input({
        present: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'g1', 'g2'],
        guestIds: ['g1', 'g2'],
        fixedPairs: [pair('g1', 'g2')],
      }),
    )
    expect(keys(pairs)).toEqual(['g1-g2', 'p1-p6', 'p2-p5', 'p3-p4'])
  })

  it('coexists with the defenders', () => {
    const pairs = buildPairs(
      input({
        present: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'g1', 'g2'],
        defenders: pair('p1', 'p2'),
        guestIds: ['g1', 'g2'],
        fixedPairs: [pair('g1', 'g2')],
      }),
    )
    expect(keys(pairs)).toContain('p1-p2')
    expect(keys(pairs)).toContain('g1-g2')
    expect(pairs).toHaveLength(4)
  })

  it('returns exactly the fixed pairs when no pool is left', () => {
    const pairs = buildPairs(
      input({
        present: ['g1', 'g2', 'g3', 'g4'],
        guestIds: ['g1', 'g2', 'g3', 'g4'],
        fixedPairs: [
          pair('g1', 'g2'),
          pair('g3', 'g4'),
        ],
      }),
    )
    expect(keys(pairs)).toEqual(['g1-g2', 'g3-g4'])
  })

  it('a fixed pair is not subject to the no-repeat rule', () => {
    // Repeating is a championship rule. A pair the admin fixed by hand does
    // not violate it: he chose it.
    const pairs = buildPairs(
      input({
        present: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'g1', 'g2'],
        guestIds: ['g1', 'g2'],
        fixedPairs: [pair('g1', 'g2')],
        previousPairs: [pair('g1', 'g2')],
      }),
    )
    expect(keys(pairs)).toContain('g1-g2')
  })

  it('fails if a fixed pair includes someone who is not playing', () => {
    expect(() => buildPairs(input({ fixedPairs: [pair('p1', 'p99')] }))).toThrow(
      /p99, que no juega esta fecha/,
    )
  })

  it('fails if someone is in two fixed pairs', () => {
    expect(() =>
      buildPairs(
        input({
          fixedPairs: [
            pair('p1', 'p2'),
            pair('p2', 'p3'),
          ],
        }),
      ),
    ).toThrow(/p2 está en más de una pareja fija/)
  })

  it('fails if a fixed pair overlaps with the defenders', () => {
    expect(() =>
      buildPairs(input({ defenders: pair('p1', 'p2'), fixedPairs: [pair('p2', 'p3')] })),
    ).toThrow(/p2 ya está en la pareja defensora/)
  })
})

describe('buildPairs — refusing the impossible', () => {
  it('throws on an odd number of present players', () => {
    expect(() => buildPairs(input({ present: ['p1', 'p2', 'p3'] }))).toThrow(/par/)
  })

  it('throws loudly rather than returning nothing', () => {
    expect(() => buildPairs(input({ present: [] }))).toThrow()
  })
})

function sideInput(overrides: Partial<SideBuildInput> = {}): SideBuildInput {
  return { ...input(), sideSize: 2, ...overrides }
}

describe('buildSides — sideSize 2 delegates to buildPairs (design PUNTO 5)', () => {
  it('returns exactly buildPairs, mapped through sideOf', () => {
    const built = sideInput()
    const pairs = buildPairs(built)
    const sides = buildSides(built)

    expect(sides).toHaveLength(pairs.length)
    for (const [index, side] of sides.entries()) {
      const expected = pairs[index]
      if (expected === undefined) throw new Error('expected a side of two here')
      expect(side.size).toBe(2)
      // Desde PR19 `buildPairs` ya devuelve `Side[]`, así que esto compara dos
      // lados directamente en vez de subir uno con `sideOf`. El test se queda
      // porque lo que fija sigue valiendo: `buildSides` con `sideSize: 2` es
      // `buildPairs` elemento a elemento, mismo orden incluido.
      expect(sameSide(side, expected)).toBe(true)
    }
  })
})

describe('buildSides — sideSize 1 (design PUNTO 5, decisión #5/#6)', () => {
  it('gives every present player their own side', () => {
    const sides = buildSides(sideInput({ sideSize: 1, present: ['p3', 'p1', 'p2'] }))

    expect(sides).toHaveLength(3)
    expect(sides.every((side) => side.size === 1)).toBe(true)
    expect(sides.map((side) => side.a).sort()).toEqual(['p1', 'p2', 'p3'])
  })

  // REQ-D5-2: headcount parity is a rule of the PAIR, not the squad. With
  // sideSize=1 there is nothing to pair, so an odd count is not an error.
  it('accepts an odd headcount', () => {
    const present = ['p1', 'p2', 'p3', 'p4', 'p5']
    expect(() => buildSides(sideInput({ sideSize: 1, present }))).not.toThrow()
    expect(buildSides(sideInput({ sideSize: 1, present }))).toHaveLength(5)
  })

  it('refuses an empty matchday, same message as the pair path', () => {
    expect(() => buildSides(sideInput({ sideSize: 1, present: [] }))).toThrow(
      'No se puede armar una fecha sin jugadores.',
    )
  })

  it('orders leader first, same criterion buildPairs uses to rank the pool', () => {
    // Default `input()` points rank p1 highest, p3 lowest — present is shuffled
    // on purpose to prove the order comes from points, not from `present`.
    const sides = buildSides(sideInput({ sideSize: 1, present: ['p3', 'p1', 'p2'] }))
    expect(sides.map((side) => side.a)).toEqual(['p1', 'p2', 'p3'])
  })

  it('sends a guest to the tail, same as the pair path', () => {
    const present = ['guest', 'p1', 'p2']
    const sides = buildSides(sideInput({ sideSize: 1, present, guestIds: ['guest'] }))
    expect(sides.map((side) => side.a)).toEqual(['p1', 'p2', 'guest'])
  })

  // Decisión #6 (design): un dúo fijo es una restricción de ARMADO, no un
  // competidor. Sin armado (sideSize=1 no empareja a nadie) la restricción no
  // significa nada — y esto lo prueba de la forma más dura posible: ni
  // siquiera se valida contra `present`, cosa que buildPairs SÍ hace y que
  // tiraría "no juega esta fecha" si esta rama las leyera.
  it('ignores defenders and fixed pairs entirely — nothing to constrain without a pairing', () => {
    const sides = buildSides(
      sideInput({
        sideSize: 1,
        present: ['p1', 'p2', 'p3'],
        defenders: pair('ghost1', 'ghost2'),
        fixedPairs: [pair('ghost3', 'ghost4')],
      }),
    )
    expect(sides).toHaveLength(3)
  })
})

/*
 * PR19. Al borrar `Side`, `fixedPairs`/`defenders`/`previousPairs` pasan a ser
 * `Side[]`, y con eso un lado de UNO se vuelve REPRESENTABLE donde antes el
 * tipo lo impedía. `Side` era `{a, b}` y no había forma de escribir uno solo;
 * `Side` es una unión y sí la hay.
 *
 * No es teórico: `buildSides` recibe el mismo objeto para las dos aridades
 * (`SideBuildInput extends PairingInput`), así que una `SideBuildInput` armada
 * para `sideSize: 1` —donde un lado de uno en `fixedPairs` es lo natural— y
 * reusada con `sideSize: 2` cae justo acá.
 *
 * Antes de este guard el sorteo tiraba igual, pero con basura: `take` recorría
 * `[pair.a, pair.b]`, el `.b` inexistente daba `undefined`, y el mensaje decía
 * "Una pareja fija incluye a undefined, que no juega esta fecha" — que manda a
 * buscar un asiento fantasma en vez de decir que el lado está mal formado.
 */
describe('buildSides — un lado de uno donde se juega de a dos (PR19)', () => {
  it('rechaza un lado de uno en fixedPairs con un mensaje que nombra la causa', () => {
    expect(() =>
      buildSides(sideInput({ sideSize: 2, fixedPairs: [single('p1')] })),
    ).toThrow(/Una pareja fija es de dos: llegó un lado de uno \(p1\)\./)
  })

  it('rechaza un lado de uno como pareja defensora', () => {
    expect(() =>
      buildSides(sideInput({ sideSize: 2, defenders: single('p1') })),
    ).toThrow(/La pareja defensora es de dos: llegó un lado de uno \(p1\)\./)
  })

  it('un lado de uno en previousPairs no puede hacer que el sorteo se quede sin salida', () => {
    // `previousPairs` sólo alimenta la regla de no-repetir, que compara con
    // `sameSide`: un lado de uno nunca va a ser igual a uno de dos, así que se
    // ignora solo. Lo que NO puede pasar es que reviente.
    expect(() =>
      buildSides(sideInput({ sideSize: 2, previousPairs: [single('p1')] })),
    ).not.toThrow()
  })
})
