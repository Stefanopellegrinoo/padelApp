import { describe, it, expect } from 'vitest'
import {
  currentPhase,
  phaseIsComplete,
  faseForCount,
  groupSides,
  knockoutMatchups,
  nextRoundMatchups,
  losingMatchup,
  knockoutPositions,
  suggestFormat,
  isUnplayedThirdPlace,
  thirdPlaceByGroupTable,
  drawIsLegal,
} from './knockout'
import { pair, single } from './side'
import type { MatchResult, Phase, Side, SideStanding } from './types'

const A = pair('a1', 'a2')
const B = pair('b1', 'b2')

function match(fase: Phase, played: boolean, grupo = 1): MatchResult {
  return { round: 1, fase, grupo, sideA: A, sideB: B, sets: played ? [{ gamesA: 4, gamesB: 1 }] : [] }
}

/** Un `SideStanding` mínimo: sólo `side`/`position` importan a estos tests. */
function standing(side: Side, position: number): SideStanding {
  return { side, played: 0, won: 0, drawn: 0, dayPoints: 0, setsDiff: 0, gamesDiff: 0, position }
}

/** Un partido de llave ya jugado, con ganador elegido a mano. */
function playedMatch(fase: Phase, grupo: number, sideA: Side, sideB: Side, winner: 'A' | 'B'): MatchResult {
  const sets = winner === 'A' ? [{ gamesA: 4, gamesB: 1 }] : [{ gamesA: 1, gamesB: 4 }]
  return { round: 1, fase, grupo, sideA, sideB, sets }
}

describe('currentPhase', () => {
  it('sin partidos, no hay fase', () => {
    expect(currentPhase([])).toBeNull()
  })

  it('con GRUPO y CUARTOS creados, la fase actual es la más avanzada', () => {
    const matches = [match('GRUPO', true), match('CUARTOS', false)]
    expect(currentPhase(matches)).toBe('CUARTOS')
  })

  it('con una sola fase, esa es la actual', () => {
    expect(currentPhase([match('GRUPO', false)])).toBe('GRUPO')
  })

  it('TERCER_PUESTO no tapa a FINAL: se generan juntas y el máximo da FINAL', () => {
    // Mismo orden que PHASE_ORDER (y que el array de matchday_phase en SQL,
    // 0039_match_phase.sql): TERCER_PUESTO va ANTES de FINAL a propósito.
    const matches = [match('SEMI', true), match('TERCER_PUESTO', false), match('FINAL', false)]
    expect(currentPhase(matches)).toBe('FINAL')
  })
})

describe('phaseIsComplete', () => {
  it('con un partido de la fase sin jugar, no está completa', () => {
    const matches = [match('GRUPO', true), match('GRUPO', false, 2)]
    expect(phaseIsComplete(matches, 'GRUPO')).toBe(false)
  })

  it('con todos los partidos de la fase jugados, está completa', () => {
    const matches = [match('GRUPO', true), match('GRUPO', true, 2)]
    expect(phaseIsComplete(matches, 'GRUPO')).toBe(true)
  })

  it('sin partidos de esa fase, no está completa', () => {
    expect(phaseIsComplete([match('GRUPO', true)], 'CUARTOS')).toBe(false)
  })
})

describe('faseForCount', () => {
  it('mapea la cantidad de partidos de la llave a su fase', () => {
    expect(faseForCount(8)).toBe('OCTAVOS')
    expect(faseForCount(4)).toBe('CUARTOS')
    expect(faseForCount(2)).toBe('SEMI')
    expect(faseForCount(1)).toBe('FINAL')
  })

  it('tira con una cantidad que no es una fase conocida', () => {
    expect(() => faseForCount(3)).toThrow(/3/)
  })
})

describe('knockoutMatchups', () => {
  // decisión (a) — el design NO dice cómo se cruza la llave. Regla elegida
  // (ver `core/knockout.ts`): cruzar grupos para que los primeros no se
  // encuentren antes de semifinales, y ningún grupo se enfrente a su propio
  // 2º puesto en el primer cruce.
  const A1 = pair('a1', 'a2')
  const A2 = pair('a3', 'a4')
  const B1 = pair('b1', 'b2')
  const B2 = pair('b3', 'b4')
  const C1 = pair('c1', 'c2')
  const C2 = pair('c3', 'c4')
  const D1 = pair('d1', 'd2')
  const D2 = pair('d3', 'd4')

  const groupA = [standing(A1, 1), standing(A2, 2)]
  const groupB = [standing(B1, 1), standing(B2, 2)]
  const groupC = [standing(C1, 1), standing(C2, 2)]
  const groupD = [standing(D1, 1), standing(D2, 2)]

  it('con 1 grupo, el 1º y el 2º arman el único cruce', () => {
    expect(knockoutMatchups([groupA], 2)).toEqual([[A1, A2]])
  })

  it('con 2 grupos, cruza para que los primeros no se enfrenten antes de la final (A1-B2, B1-A2)', () => {
    expect(knockoutMatchups([groupA, groupB], 2)).toEqual([
      [A1, B2],
      [B1, A2],
    ])
  })

  it('con 4 grupos, separa los 4 primeros en mitades distintas del cuadro', () => {
    // nextRoundMatchups empareja de a dos EN ORDEN: [0]+[1] arman una semi,
    // [2]+[3] la otra. Con este orden, A1 y C1 quedan de un lado (sólo se
    // pueden cruzar en semifinal), B1 y D1 del otro — y ningún grupo se
    // enfrenta a su propio 2º puesto en cuartos.
    expect(knockoutMatchups([groupA, groupB, groupC, groupD], 2)).toEqual([
      [A1, B2],
      [C1, D2],
      [B1, A2],
      [D1, C2],
    ])
  })

  it('tira con una cantidad de grupos que no sabe cruzar', () => {
    expect(() => knockoutMatchups([groupA, groupB, groupC], 2)).toThrow(/3/)
  })

  it('tira si los clasificados por grupo no son 2', () => {
    expect(() => knockoutMatchups([groupA, groupB], 1)).toThrow(/1/)
  })
})

describe('nextRoundMatchups', () => {
  it('con una ronda de 4 partidos jugada, arma la siguiente de 2', () => {
    const A1 = pair('a1', 'a2')
    const A2 = pair('a3', 'a4')
    const B1 = pair('b1', 'b2')
    const B2 = pair('b3', 'b4')
    const C1 = pair('c1', 'c2')
    const C2 = pair('c3', 'c4')
    const D1 = pair('d1', 'd2')
    const D2 = pair('d3', 'd4')

    const played = [
      playedMatch('CUARTOS', 1, A1, B2, 'A'), // gana A1
      playedMatch('CUARTOS', 1, C1, D2, 'B'), // gana D2
      playedMatch('CUARTOS', 1, B1, A2, 'A'), // gana B1
      playedMatch('CUARTOS', 1, D1, C2, 'B'), // gana C2
    ]

    expect(nextRoundMatchups(played)).toEqual([
      [A1, D2],
      [B1, C2],
    ])
  })

  it('tira con una cantidad de partidos que no arma parejas completas', () => {
    const A1 = pair('a1', 'a2')
    const B1 = pair('b1', 'b2')
    const C1 = pair('c1', 'c2')
    const played = [
      playedMatch('SEMI', 1, A1, B1, 'A'),
      playedMatch('SEMI', 1, B1, C1, 'A'),
      playedMatch('SEMI', 1, C1, A1, 'A'),
    ]
    expect(() => nextRoundMatchups(played)).toThrow(/3/)
  })
})

describe('losingMatchup', () => {
  // Rebanada C2, agujero (1) del design que no estaba en PUNTO 7: SEMI genera
  // FINAL (ganadores, `nextRoundMatchups`) Y TERCER_PUESTO (perdedores) a la
  // vez — decisión #3979 asume que ese partido EXISTE aunque después nadie lo
  // juegue. `nextRoundMatchups` sólo sabe de ganadores; esto es su espejo.
  it('arma el cruce del tercer puesto con los perdedores de las dos semis', () => {
    const A1 = pair('a1', 'a2')
    const A2 = pair('a3', 'a4')
    const B1 = pair('b1', 'b2')
    const B2 = pair('b3', 'b4')
    const played = [
      playedMatch('SEMI', 1, A1, B2, 'A'), // pierde B2
      playedMatch('SEMI', 1, B1, A2, 'A'), // pierde A2
    ]
    expect(losingMatchup(played)).toEqual([B2, A2])
  })

  it('tira si no son exactamente 2 semifinales', () => {
    const A1 = pair('a1', 'a2')
    const B1 = pair('b1', 'b2')
    const played = [playedMatch('SEMI', 1, A1, B1, 'A')]
    expect(() => losingMatchup(played)).toThrow(/2/)
  })
})

describe('knockoutPositions', () => {
  // decisión (b) — agujero del design: REQ-D7-4 dice a secas "3º/4º
  // semifinalistas perdedores", pero PHASE_ORDER tiene una fase
  // TERCER_PUESTO que el design genera junto con FINAL. Regla elegida (ver
  // JSDoc de `thirdAndFourth` en `core/knockout.ts`): si el partido de
  // tercer puesto se jugó, SU resultado decide 3º/4º; si no, caen al texto
  // literal — "semifinalistas perdedores" desempatados por su posición en
  // la fase de grupos.
  //
  // El ganador de la final acá es B2 —el 2º de su grupo, no el 1º— así el
  // test no puede pasar copiando el orden de `groupTable`: prueba que la
  // función realmente lee el resultado de la llave.
  const A1 = pair('a1', 'a2')
  const A2 = pair('a3', 'a4')
  const A3 = pair('a5', 'a6')
  const B1 = pair('b1', 'b2')
  const B2 = pair('b3', 'b4')
  const B3 = pair('b5', 'b6')

  const groupTable = [
    standing(A1, 1),
    standing(A2, 2),
    standing(A3, 3),
    standing(B1, 1),
    standing(B2, 2),
    standing(B3, 3),
  ]

  const semis = [
    playedMatch('SEMI', 1, A1, B2, 'B'), // gana B2 (el 2º de su grupo, upset)
    playedMatch('SEMI', 1, B1, A2, 'A'), // gana B1
  ]
  const final = playedMatch('FINAL', 1, B2, B1, 'A') // gana B2: campeón es un 2º de grupo

  it('con el partido de tercer puesto jugado, SU resultado decide 3º y 4º', () => {
    const playoff = playedMatch('TERCER_PUESTO', 1, A1, A2, 'B') // gana A2
    const bracket = [...semis, playoff, final]

    const result = knockoutPositions(bracket, groupTable)

    expect(result.map((row) => row.side)).toEqual([B2, B1, A2, A1, A3, B3])
    expect(result.map((row) => row.position)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('sin partido de tercer puesto jugado, 3º/4º se desempatan por la tabla de grupos', () => {
    const bracket = [...semis, final] // ningún TERCER_PUESTO en la llave

    const result = knockoutPositions(bracket, groupTable)

    // A1 tenía mejor posición de grupo (1) que A2 (2) — a falta del partido
    // de tercer puesto, A1 va 3º y A2 4º: ORDEN DISTINTO al caso de arriba,
    // prueba que el fallback es real y no una copia del otro caso.
    expect(result.map((row) => row.side)).toEqual([B2, B1, A1, A2, A3, B3])
  })

  it('tira si la llave no tiene exactamente un partido de FINAL', () => {
    expect(() => knockoutPositions(semis, groupTable)).toThrow(/FINAL/)
  })
})

describe('thirdPlaceByGroupTable', () => {
  const A1 = pair('a1', 'a2')
  const A2 = pair('a3', 'a4')
  const B1 = pair('b1', 'b2')
  const B2 = pair('b3', 'b4')

  const semis = [
    playedMatch('SEMI', 1, A1, B2, 'B'),
    playedMatch('SEMI', 1, B1, A2, 'A'),
  ]
  const final = playedMatch('FINAL', 1, B2, B1, 'A')

  it('true cuando hay semis y el tercer puesto no existe en la llave', () => {
    expect(thirdPlaceByGroupTable([...semis, final])).toBe(true)
  })

  it('true cuando el tercer puesto existe pero nadie cargó el resultado', () => {
    const playoff: MatchResult = { round: 1, fase: 'TERCER_PUESTO', grupo: 1, sideA: A1, sideB: A2, sets: [] }
    expect(thirdPlaceByGroupTable([...semis, playoff, final])).toBe(true)
  })

  it('false cuando el tercer puesto se jugó de verdad', () => {
    const playoff = playedMatch('TERCER_PUESTO', 1, A1, A2, 'B')
    expect(thirdPlaceByGroupTable([...semis, playoff, final])).toBe(false)
  })

  it('false sin semifinales: la llave no tiene 3º/4º que resolver de ninguna forma', () => {
    expect(thirdPlaceByGroupTable([final])).toBe(false)
  })
})

describe('isUnplayedThirdPlace', () => {
  const A1 = pair('a1', 'a2')
  const A2 = pair('a3', 'a4')

  it('true para un TERCER_PUESTO sin sets', () => {
    const match: MatchResult = { round: 1, fase: 'TERCER_PUESTO', grupo: 1, sideA: A1, sideB: A2, sets: [] }
    expect(isUnplayedThirdPlace(match)).toBe(true)
  })

  it('false para un TERCER_PUESTO ya jugado', () => {
    expect(isUnplayedThirdPlace(playedMatch('TERCER_PUESTO', 1, A1, A2, 'A'))).toBe(false)
  })

  it('false para cualquier otra fase sin jugar — la excepción es sólo del tercer puesto', () => {
    const match: MatchResult = { round: 1, fase: 'SEMI', grupo: 1, sideA: A1, sideB: A2, sets: [] }
    expect(isUnplayedThirdPlace(match)).toBe(false)
  })
})

/**
 * C30 (verify-report-pr21, #4004) / decisión #4005 expresada en código: el
 * empate es legal SÓLO en GRUPO, sin importar `allowsDraw`. Tabla de verdad
 * completa — las cuatro celdas — porque esta línea es la única función pura
 * de `core/` que contesta la pregunta, y hasta ahora ningún test la nombraba
 * (cobertura sólo indirecta vía `saveResult`/`closeMatchday` en `*.db.test.ts`).
 * La celda que importa es `('SEMI', true)`: si alguien la cambia a un `||` o
 * le agrega `TERCER_PUESTO` "porque casi es un partido de grupo", ésta es la
 * que tiene que caer.
 */
describe('drawIsLegal', () => {
  it('GRUPO + allowsDraw=true → legal', () => {
    expect(drawIsLegal('GRUPO', true)).toBe(true)
  })

  it('GRUPO + allowsDraw=false → ilegal (la disciplina no admite empates)', () => {
    expect(drawIsLegal('GRUPO', false)).toBe(false)
  })

  it('SEMI + allowsDraw=true → ilegal (la celda de la decisión #4005: la fase manda, no la disciplina)', () => {
    expect(drawIsLegal('SEMI', true)).toBe(false)
  })

  it('SEMI + allowsDraw=false → ilegal', () => {
    expect(drawIsLegal('SEMI', false)).toBe(false)
  })
})

describe('groupSides', () => {
  // Hallazgo de diseño (C1.3, el design PUNTO 7 no nombraba este helper):
  // `generatePairs` (`db/matchday.ts`) necesita repartir los lados en grupos
  // ANTES de llamar `buildFixture` una vez por grupo. La regla es snake/
  // serpentina, no un corte secuencial (1,2,3,4 | 5,6,7,8) — con eso el
  // grupo 0 se quedaría con los 4 mejores seeds y el reparto no sería justo.
  it('reparte 8 lados en 2 grupos por seed, en zigzag (snake), no en cortes secuenciales', () => {
    const seeds = Array.from({ length: 8 }, (_unused, index) => single(`s${index + 1}`))

    const groups = groupSides(seeds, 2)

    // seed1→G0, seed2→G1, seed3→G1 (vuelta), seed4→G0, seed5→G0, seed6→G1,
    // seed7→G1 (vuelta), seed8→G0. Un corte secuencial daría [1,2,3,4]/[5,6,7,8]
    // — distinto a esto, así que el test no pasa con esa implementación más simple.
    expect(groups).toEqual([
      [seeds[0], seeds[3], seeds[4], seeds[7]],
      [seeds[1], seeds[2], seeds[5], seeds[6]],
    ])
  })

  it('es genérico: reparte cualquier tipo de item, no sólo Side', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f']
    expect(groupSides(items, 3)).toEqual([
      ['a', 'f'],
      ['b', 'e'],
      ['c', 'd'],
    ])
  })

  it('tira con menos de 1 grupo', () => {
    expect(() => groupSides([single('a')], 0)).toThrow(/0/)
  })
})

describe('suggestFormat', () => {
  it('8 presentes de a dos (4 lados) sugiere round robin', () => {
    expect(suggestFormat(8, 2)).toEqual({ kind: 'ROUND_ROBIN' })
  })

  it('8 presentes de a uno (8 lados) sugiere 2 grupos de 4 + semis + final (REQ-D8-1, GIVEN literal)', () => {
    const format = suggestFormat(8, 1)
    expect(format).toEqual({ kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 })
    if (format.kind !== 'GROUPS_KNOCKOUT') throw new Error('unreachable')
    expect(8 / format.groups).toBe(4) // "2 grupos DE 4"
  })

  it('12 lados de a uno: grupos + llave completa dan 19 partidos, no 66 (razón de W32, decisión #3863)', () => {
    const format = suggestFormat(12, 1)
    expect(format).toEqual({ kind: 'GROUPS_KNOCKOUT', groups: 4, qualifiersPerGroup: 2 })
    if (format.kind !== 'GROUPS_KNOCKOUT') throw new Error('unreachable')

    // 4 grupos de 3 lados, round robin dentro de cada uno: C(3,2)=3 partidos
    // por grupo. `groupSides` (el helper que reparte lados en grupos) es de
    // la Rebanada C1, todavía no existe — acá el reparto es manual, sólo
    // para probar la aritmética.
    const sidesPerGroup = 12 / format.groups
    const groupStageMatches = format.groups * ((sidesPerGroup * (sidesPerGroup - 1)) / 2)
    expect(groupStageMatches).toBe(12)

    const groups = Array.from({ length: format.groups }, (_group, groupIndex) =>
      Array.from({ length: sidesPerGroup }, (_seed, seedIndex) =>
        standing(single(`g${groupIndex}-${seedIndex}`), seedIndex + 1),
      ),
    )

    const cuartos = knockoutMatchups(groups, format.qualifiersPerGroup)
    expect(cuartos).toHaveLength(4) // faseForCount(4) === 'CUARTOS'
    const cuartosPlayed = cuartos.map(([sideA, sideB]) => playedMatch('CUARTOS', 1, sideA, sideB, 'A'))

    const semisNext = nextRoundMatchups(cuartosPlayed)
    expect(semisNext).toHaveLength(2) // faseForCount(2) === 'SEMI'
    const semisPlayed = semisNext.map(([sideA, sideB]) => playedMatch('SEMI', 1, sideA, sideB, 'A'))

    const finalNext = nextRoundMatchups(semisPlayed)
    expect(finalNext).toHaveLength(1) // faseForCount(1) === 'FINAL'

    const knockoutMatches = cuartos.length + semisNext.length + finalNext.length // 4 + 2 + 1 = 7
    const total = groupStageMatches + knockoutMatches

    // 12 (grupos) + 7 (llave, sin contar un eventual partido de tercer
    // puesto opcional) = 19. Con el partido de tercer puesto serían 20 — de
    // cualquier forma, el "~19" de la decisión #3863 se confirma con
    // funciones REALES, lejísimos de los 66 del round robin puro que
    // motivó W32.
    expect(total).toBe(19)
  })
})
