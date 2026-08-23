import { describe, it, expect } from 'vitest'
import { computeAwards } from './awards'
import { defaultConfig } from './config'
import { pair, single } from './side'
import type { Side, SideStanding, SeasonConfig } from './types'

const CONFIG: SeasonConfig = {
  squadSize: 12,
  matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true, openScore: false },
  points: [10, 7, 5, 3, 2, 1],
  regularMatchdays: 10,
  countBestOf: 8,
  tiebreakSnapshotEvery: 3,
}

function standing(a: string, b: string, position: number): SideStanding {
  return { side: pair(a, b), played: 3, won: 0, drawn: 0, dayPoints: 0, setsDiff: 0, gamesDiff: 0, position }
}

describe('computeAwards', () => {
  it('gives both members of a pair exactly the same points', () => {
    const awards = computeAwards([standing('a1', 'a2', 1)], CONFIG, [])
    expect(awards).toHaveLength(2)
    expect(awards[0]?.points).toBe(10)
    expect(awards[1]?.points).toBe(10)
  })

  it('uses the leading values of the list for a four pair matchday', () => {
    const standings = [
      standing('a1', 'a2', 1),
      standing('b1', 'b2', 2),
      standing('c1', 'c2', 3),
      standing('d1', 'd2', 4),
    ]
    const byEntry = new Map(computeAwards(standings, CONFIG, []).map((a) => [a.entryId, a.points]))
    expect(byEntry.get('a1')).toBe(10)
    expect(byEntry.get('b1')).toBe(7)
    expect(byEntry.get('c1')).toBe(5)
    expect(byEntry.get('d1')).toBe(3)
  })

  it('uses the whole list for a six pair matchday', () => {
    const standings = [
      standing('a1', 'a2', 1),
      standing('b1', 'b2', 2),
      standing('c1', 'c2', 3),
      standing('d1', 'd2', 4),
      standing('e1', 'e2', 5),
      standing('f1', 'f2', 6),
    ]
    const byEntry = new Map(computeAwards(standings, CONFIG, []).map((a) => [a.entryId, a.points]))
    expect(byEntry.get('a1')).toBe(10)
    expect(byEntry.get('f1')).toBe(1)
  })

  it('pays ten for the win whether the standings list has one row or two', () => {
    const four = computeAwards([standing('a1', 'a2', 1)], CONFIG, [])
    const six = computeAwards(
      [standing('a1', 'a2', 1), standing('b1', 'b2', 2)],
      CONFIG,
      [],
    )
    expect(four[0]?.points).toBe(10)
    expect(six[0]?.points).toBe(10)
  })

  it('never awards zero, so turning up always beats staying home', () => {
    const standings = Array.from({ length: 6 }, (_, i) => standing(`p${i}a`, `p${i}b`, i + 1))
    for (const award of computeAwards(standings, CONFIG, [])) {
      expect(award.points).toBeGreaterThan(0)
    }
  })

  it('skips the guest, who is not in the championship', () => {
    const awards = computeAwards([standing('a1', 'guest', 1)], CONFIG, ['guest'])
    expect(awards).toHaveLength(1)
    expect(awards[0]?.entryId).toBe('a1')
  })

  it('still pays the guest partner in full', () => {
    const awards = computeAwards([standing('a1', 'guest', 1)], CONFIG, ['guest'])
    expect(awards[0]?.points).toBe(10)
  })

  it('records the championship position, compacted from the table', () => {
    const awards = computeAwards(
      [standing('a1', 'a2', 1), standing('b1', 'b2', 2), standing('c1', 'c2', 3)],
      CONFIG,
      [],
    )
    expect(awards.find((award) => award.entryId === 'c1')?.position).toBe(3)
  })

  it('throws when the standings are longer than the points list', () => {
    const tooMany = Array.from({ length: 7 }, (_, i) => standing(`p${i}a`, `p${i}b`, i + 1))
    expect(() => computeAwards(tooMany, CONFIG, [])).toThrow(/puntos/)
  })

  /*
   * S44: el mensaje decía "parejas" siempre, y en una
   * disciplina de a uno eso manda a buscar un bug de parejas donde no las hay.
   * Es el único rastro que queda en un log cuando el reparto no cierra — la
   * ronda 14 lo encontró en el server.log como la firma de C21.
   */
  it('dice "competidores" y no "parejas" cuando el lado es de uno', () => {
    const solos = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'].map((id, index) => ({
      side: single(id),
      played: 0,
      won: 0,
      drawn: 0,
      dayPoints: 0,
      setsDiff: 0,
      gamesDiff: 0,
      position: index + 1,
    }))
    expect(() => computeAwards(solos, CONFIG, [])).toThrow(
      /La fecha tiene 7 competidores del torneo pero la lista de puntos sólo tiene 6 valores\./,
    )
  })

  it('sigue diciendo "parejas" cuando el lado es de dos (S44, no-regresión)', () => {
    const tooMany = table([
      pair('a1', 'a2'), pair('b1', 'b2'), pair('c1', 'c2'), pair('d1', 'd2'),
      pair('e1', 'e2'), pair('f1', 'f2'), pair('g1', 'g2'),
    ])
    expect(() => computeAwards(tooMany, CONFIG, [])).toThrow(
      /La fecha tiene 7 parejas del torneo pero la lista de puntos sólo tiene 6 valores\./,
    )
  })
})

const table = (sides: Side[]): SideStanding[] =>
  sides.map((p, index) => ({
    side: p,
    played: 0,
    won: 0,
    drawn: 0,
    dayPoints: 0,
    setsDiff: 0,
    gamesDiff: 0,
    position: index + 1,
  }))

describe('computeAwards — guests', () => {
  it("pays the guest's partner in full", () => {
    const standings = table([pair('p1', 'g1'), pair('p2', 'p3')])
    const awards = computeAwards(standings, CONFIG, ['g1'])
    expect(awards.find((award) => award.entryId === 'p1')?.points).toBe(CONFIG.points[0])
    expect(awards.find((award) => award.entryId === 'g1')).toBeUndefined()
  })

  it('skips every guest, not just the first', () => {
    const standings = table([pair('p1', 'g1'), pair('p2', 'g2')])
    const awards = computeAwards(standings, CONFIG, ['g1', 'g2'])
    expect(awards.map((award) => award.entryId).sort()).toEqual(['p1', 'p2'])
  })

  it('gives no paying position to a guest-only pair', () => {
    // The guest pair wins the matchday; the 10 points still belong to the championship.
    const standings = table([pair('g1', 'g2'), pair('p1', 'p2'), pair('p3', 'p4')])
    const awards = computeAwards(standings, CONFIG, ['g1', 'g2'])
    expect(awards).toHaveLength(4)
    expect(awards.find((award) => award.entryId === 'p1')?.points).toBe(CONFIG.points[0])
    expect(awards.find((award) => award.entryId === 'p1')?.position).toBe(1)
    expect(awards.find((award) => award.entryId === 'p3')?.points).toBe(CONFIG.points[1])
  })

  it('changes nothing when the guest pair finishes last', () => {
    const standings = table([pair('p1', 'p2'), pair('p3', 'p4'), pair('g1', 'g2')])
    const awards = computeAwards(standings, CONFIG, ['g1', 'g2'])
    expect(awards.find((award) => award.entryId === 'p1')?.position).toBe(1)
    expect(awards.find((award) => award.entryId === 'p3')?.position).toBe(2)
    expect(awards.find((award) => award.entryId === 'g1')).toBeUndefined()
    expect(awards.find((award) => award.entryId === 'g2')).toBeUndefined()
    expect(awards).toHaveLength(4)
  })

  it('does not depend on the order the table arrives in', () => {
    const standings = table([pair('p1', 'p2'), pair('p3', 'p4')])
    const reversed = [...standings].reverse()
    expect(computeAwards(reversed, CONFIG, [])).toEqual(computeAwards(standings, CONFIG, []))
  })

  it('throws when championship pairs outnumber the points list', () => {
    const config = defaultConfig(8) // four point values
    const standings = table([
      pair('p1', 'p2'),
      pair('p3', 'p4'),
      pair('p5', 'p6'),
      pair('p7', 'p8'),
      pair('p9', 'g1'),
    ])
    expect(() => computeAwards(standings, config, ['g1'])).toThrow(
      /5 parejas del torneo .* sólo tiene 4 valores/,
    )
  })
})

// El teorema del que depende TODO `promote_guest` (spec 3.1, design #3771
// decisión 12), enunciado con su hipótesis puesta: copiar el award congelado
// del compañero es lo mismo que lo que un reabrir-y-volver-a-cerrar hubiera
// calculado **cuando esa pareja YA cobraba** — o sea, cuando el compañero
// tiene un award congelado en esa fecha. Sin esa hipótesis es falso, y los
// dos últimos tests de este bloque lo muestran con números. La prueba anterior de
// esto era un probe suelto que se borró — vuelve acá, permanente, con
// aserciones contra VALORES TIPEADOS A MANO, nunca contra el resultado de
// otra corrida de la misma función: comparar una llamada contra otra no
// prueba nada si las dos están calculadas con la misma lógica rota — eso
// pasó en la PR anterior y un reviewer lo agarró recién con datos reales.
describe('computeAwards — el teorema de la promoción (spec 3.1)', () => {
  // Pareja 1: p1 (plantel) y g1 (invitado). Pareja 2: p2 y p3, plantel las dos.
  // CONFIG.points = [10, 7, 5, 3, 2, 1] — literal del archivo, no derivado.
  const standings: SideStanding[] = [standing('p1', 'g1', 1), standing('p2', 'p3', 2)]

  it('con g1 invitado —el comportamiento real de close_matchday—, p1 se lleva 10 puntos y g1 no tiene award', () => {
    const awards = computeAwards(standings, CONFIG, ['g1'])
    // CONFIG.points[0] = 10, CONFIG.points[1] = 7: tipeados a mano, no calculados.
    expect(awards).toEqual([
      { entryId: 'p1', position: 1, points: 10 },
      { entryId: 'p2', position: 2, points: 7 },
      { entryId: 'p3', position: 2, points: 7 },
    ])
  })

  // El teorema en sí: si g1 NO hubiera sido invitado —el hipotético "reabrir
  // y volver a cerrar"—, se habría llevado EXACTAMENTE position 1 y 10
  // puntos: los mismos valores literales que p1 ya tiene arriba, tipeados acá
  // de nuevo a mano y nunca comparados contra el resultado de la otra
  // llamada. Esa coincidencia entre dos literales —no una llamada contra
  // otra— es la que hace que copiar el award congelado sea lo mismo que
  // recalcular. `promote_guest` (0014_promote_guest.sql) hace la copia,
  // nunca la segunda llamada.
  it('si g1 no fuera invitado, se llevaría position 1 y 10 puntos: los mismos valores que ya tiene su pareja', () => {
    const awards = computeAwards(standings, CONFIG, [])
    const g1Award = awards.find((award) => award.entryId === 'g1')
    expect(g1Award).toEqual({ entryId: 'g1', position: 1, points: 10 })
  })

  it('y ningún otro award cambia entre las dos corridas: p2 y p3 siguen en position 2 con 7 puntos', () => {
    const awards = computeAwards(standings, CONFIG, [])
    expect(awards.find((award) => award.entryId === 'p2')).toEqual({ entryId: 'p2', position: 2, points: 7 })
    expect(awards.find((award) => award.entryId === 'p3')).toEqual({ entryId: 'p3', position: 2, points: 7 })
  })

  // ── el borde del teorema: dónde DEJA de valer ────────────────────────────
  // Los tres tests de arriba pinneaban el teorema sólo sobre la entrada donde
  // es cierto, y por eso no agarraban al mutante que importa: neutralizar el
  // filtro `paying` (core/awards.ts:26-28) los pasaba a los tres. Este par de
  // casos mete una pareja TODA INVITADA adentro de la tabla, que es lo único
  // que hace visible ese filtro — y de paso demuestra el contraejemplo por el
  // que `promote_guest` (0014_promote_guest.sql) REFUSA ese caso en vez de
  // saltearlo: ahí copiar el award congelado NO es lo que un recálculo daría.
  const conParejaInvitada: SideStanding[] = [
    standing('p1', 'p2', 1),
    standing('g1', 'g2', 2),
    standing('p3', 'p4', 3),
  ]

  it('congelado: la pareja toda invitada no consume posición paga, así que p3 y p4 cobran 7 en position 2', () => {
    const awards = computeAwards(conParejaInvitada, CONFIG, ['g1', 'g2'])
    // CONFIG.points = [10, 7, 5, 3, 2, 1]. Literales tipeados a mano.
    expect(awards).toEqual([
      { entryId: 'p1', position: 1, points: 10 },
      { entryId: 'p2', position: 1, points: 10 },
      { entryId: 'p3', position: 2, points: 7 },
      { entryId: 'p4', position: 2, points: 7 },
    ])
  })

  it('recalculado con g1 ya en el plantel: su pareja pasa a cobrar y p3 y p4 CAEN a position 3 con 5 — el teorema no vale acá', () => {
    const awards = computeAwards(conParejaInvitada, CONFIG, ['g2'])
    expect(awards).toEqual([
      { entryId: 'p1', position: 1, points: 10 },
      { entryId: 'p2', position: 1, points: 10 },
      { entryId: 'g1', position: 2, points: 7 },
      { entryId: 'p3', position: 3, points: 5 },
      { entryId: 'p4', position: 3, points: 5 },
    ])
  })
})
