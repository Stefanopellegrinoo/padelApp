import { describe, it, expect } from 'vitest'
import { bracketOrderNote, formatLabel, formatsLabel, narrateRules, thirdPlaceNote } from './narrate'
import { MASTERS_MATCHES, MASTERS_SIZE } from './constants'
import { pair } from './side'
import type { MatchResult, Phase, Side, SeasonConfig } from './types'

const CONFIG: SeasonConfig = {
  squadSize: 12,
  matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true, openScore: false },
  points: [10, 7, 5, 3, 2, 1],
  regularMatchdays: 10,
  countBestOf: 8,
  tiebreakSnapshotEvery: 3,
}

function bodyOf(config: SeasonConfig, title: string): string {
  const block = narrateRules(config).find((section) => section.title === title)
  if (block === undefined) throw new Error(`No hay bloque "${title}"`)
  return block.body
}

describe('narrateRules', () => {
  it('returns a block per topic', () => {
    const titles = narrateRules(CONFIG).map((section) => section.title)
    expect(titles).toEqual([
      'El torneo',
      'La fecha',
      'Los puntos',
      'Cómo se arman las parejas',
      'Los desempates',
      'El Masters',
    ])
  })

  it('states how many matchdays there are and how many count', () => {
    const body = bodyOf(CONFIG, 'El torneo')
    expect(body).toContain('10 fechas')
    expect(body).toContain('8 mejores')
  })

  it('describes the match format from the config', () => {
    expect(bodyOf(CONFIG, 'La fecha')).toContain('4 games')
  })

  it('lists every points value', () => {
    const body = bodyOf(CONFIG, 'Los puntos')
    for (const value of CONFIG.points) {
      expect(body).toContain(String(value))
    }
  })

  it('follows the config when the points change, instead of a stale copy', () => {
    const richer = { ...CONFIG, points: [12, 9, 6, 4, 2, 1] }
    const body = bodyOf(richer, 'Los puntos')
    expect(body).toContain('el 1º, 12')
    expect(body).not.toContain('el 1º, 10')
  })

  // La página de reglas es la que leen los jugadores para saber cómo funciona
  // el campeonato. Afirmaba SIEMPRE "Nadie suma 0 por presentarse", que dejó de
  // ser cierto cuando el 0 se volvió legal: un torneo donde sólo puntúan los
  // primeros cuatro leía una regla que él mismo no cumple.
  it('does not promise that everybody scores when some places pay nothing', () => {
    const soloCuatro = { ...CONFIG, points: [10, 7, 5, 3, 0, 0] }
    const body = bodyOf(soloCuatro, 'Los puntos')
    expect(body).not.toContain('Nadie suma 0 por presentarse')
    expect(body).toContain('sólo puntúan los primeros 4 puestos')
  })

  it('keeps the old promise when every place pays', () => {
    expect(bodyOf(CONFIG, 'Los puntos')).toContain('Nadie suma 0 por presentarse')
  })

  it('says it in singular when only the winner scores', () => {
    const soloElPrimero = { ...CONFIG, points: [10, 0, 0, 0, 0, 0] }
    expect(bodyOf(soloElPrimero, 'Los puntos')).toContain('sólo puntúa el que gana la fecha')
  })

  it('states the snapshot refresh interval', () => {
    expect(bodyOf(CONFIG, 'Los desempates')).toContain('3 fechas')
  })

  it('states the masters size', () => {
    expect(bodyOf(CONFIG, 'El Masters')).toContain('4 mejores')
  })

  it('describes a multi-set format when configured that way', () => {
    const bestOfThree = {
      ...CONFIG,
      matchFormat: { setsToWin: 2, gamesPerSet: 6, tieBreak: true, openScore: false },
    }
    expect(bodyOf(bestOfThree, 'La fecha')).toContain('6 games')
  })

  it('never leaves a placeholder in the output', () => {
    for (const section of narrateRules(CONFIG)) {
      expect(section.body).not.toMatch(/undefined|NaN|\{\{/)
      expect(section.body.length).toBeGreaterThan(0)
    }
  })

  it('orders tiebreakers as sets-difference then games-difference when multi-set', () => {
    const bestOfThree = {
      ...CONFIG,
      matchFormat: { setsToWin: 2, gamesPerSet: 6, tieBreak: true, openScore: false },
    }
    const body = bodyOf(bestOfThree, 'Los desempates')
    const setsPhrase = 'corta la diferencia de sets'
    const gamesPhrase = 'corta la diferencia de games'
    const setsAt = body.indexOf(setsPhrase)
    const gamesAt = body.indexOf(gamesPhrase)
    expect(setsAt).toBeGreaterThan(-1)
    expect(gamesAt).toBeGreaterThan(-1)
    expect(setsAt).toBeLessThan(gamesAt)
  })

  it('omits sets-difference tiebreaker when the format is single-set', () => {
    const singleSet = {
      ...CONFIG,
      matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true, openScore: false },
    }
    const body = bodyOf(singleSet, 'Los desempates')
    expect(body).not.toContain('corta la diferencia de sets')
    expect(body).toContain('corta la diferencia de games')
  })

  it('names the masters size and match count from the constants, not a config value', () => {
    const body = bodyOf(CONFIG, 'El Masters')
    expect(body).toContain(`${MASTERS_SIZE} mejores`)
    expect(body).toContain(`${MASTERS_MATCHES} partidos`)
  })
})

// ── PR20 rebanada D2 — la página de Reglas dejó de describir un set de pádel ──
//
// Esta página es la que leen los jugadores para saber cómo funciona el torneo.
// Con marcador abierto no hay set, ni games, ni tie-break: hay un marcador de
// goles. Narrar "Cada partido se define a un set de 4 games con tie-break"
// sobre una liga de FIFA es la misma clase de mentira que W47, W51 y W56 —
// copy que describe algo que la app no hace.
describe('narrateRules con marcador abierto', () => {
  const FIFA: SeasonConfig = {
    ...CONFIG,
    matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true, openScore: true },
  }

  it('no promete sets, games ni tie-break', () => {
    const body = bodyOf(FIFA, 'La fecha')
    expect(body).not.toContain('games')
    expect(body).not.toContain('tie-break')
    expect(body).toContain('goles')
  })

  it('el desempate corta por diferencia de gol, y nunca por diferencia de sets', () => {
    // `setsToWin: 2` a propósito: es el valor que HOY enciende el escalón de
    // sets, y con marcador abierto no significa nada.
    const body = bodyOf(
      { ...FIFA, matchFormat: { ...FIFA.matchFormat, setsToWin: 2 } },
      'Los desempates',
    )
    expect(body).not.toContain('corta la diferencia de sets')
    expect(body).not.toContain('diferencia de games')
    expect(body).toContain('diferencia de gol')
  })
})

// La etiqueta corta del formato: la misma frase en Reglas, en Ajustes y en el
// resumen del wizard. Estaba escrita tres veces —dos idénticas y una que
// además decía "3 set" en singular con `setsToWin: 3`— y las tres mentían con
// marcador abierto.
describe('formatLabel', () => {
  it('nombra el set y los games del pádel', () => {
    expect(formatLabel(CONFIG.matchFormat)).toBe('1 set a 4 games')
  })

  it('pluraliza cuando el partido se define a más de un set', () => {
    expect(formatLabel({ ...CONFIG.matchFormat, setsToWin: 3 })).toBe('3 sets a 4 games')
  })

  it('no nombra ningún set cuando el marcador es abierto', () => {
    expect(formatLabel({ ...CONFIG.matchFormat, openScore: true })).toBe('Marcador de goles')
  })
})

//. Antes de PR20 rebanada D2 todas las
// disciplinas de una temporada compartían `matchFormat`, así que UNA línea de
// formato era verdad. D2 hizo posibles dos formatos en el mismo torneo y por
// eso convirtió esa frase en falsa: Reglas y Ajustes narraban
// `primaryDiscipline(header)` y le decían al grupo "1 set a 4 games" sobre un
// torneo que tiene una mitad que se juega a goles.
describe('formatsLabel', () => {
  const PADEL = CONFIG.matchFormat
  const FIFA = { ...CONFIG.matchFormat, openScore: true }

  it('con un solo formato dice lo de siempre, sin prefijo', () => {
    expect(formatsLabel([{ label: 'Pádel', matchFormat: PADEL }])).toBe('1 set a 4 games')
  })

  it('con dos formatos nombra los dos y de quién es cada uno', () => {
    expect(
      formatsLabel([
        { label: 'Pádel', matchFormat: PADEL },
        { label: 'FIFA', matchFormat: FIFA },
      ]),
    ).toBe('Pádel: 1 set a 4 games · FIFA: Marcador de goles')
  })

  it('dos disciplinas del mismo formato no son dos cosas que nombrar', () => {
    expect(
      formatsLabel([
        { label: 'Pádel', matchFormat: PADEL },
        { label: 'Pádel', matchFormat: PADEL },
      ]),
    ).toBe('1 set a 4 games')
  })

  it('sin disciplinas no inventa una frase', () => {
    expect(formatsLabel([])).toBe('')
  })
})

// Decisión #3990: el único costo vivo que quedaba de #3979 ("se puede cerrar
// la fecha sin jugar el tercer puesto") era que nadie se enteraba de que el
// 3º/4º salió de la tabla de grupos y no de la cancha. Esta línea lo cuenta.
describe('thirdPlaceNote', () => {
  const A = pair('a1', 'a2')
  const B = pair('b1', 'b2')

  function playedMatch(fase: Phase, sideA: Side, sideB: Side): MatchResult {
    return { round: 1, fase, grupo: 1, sideA, sideB, sets: [{ gamesA: 4, gamesB: 1 }] }
  }

  it('cuenta que el tercer puesto se definió por la tabla cuando ese partido no se jugó', () => {
    const semis = [playedMatch('SEMI', A, B), playedMatch('SEMI', A, B)]
    const final = playedMatch('FINAL', A, B)
    expect(thirdPlaceNote([...semis, final])).toBe(
      'El tercer puesto se definió por la tabla de grupos: no se jugó el partido.',
    )
  })

  it('no dice nada cuando el tercer puesto se jugó de verdad', () => {
    const semis = [playedMatch('SEMI', A, B), playedMatch('SEMI', A, B)]
    const playoff = playedMatch('TERCER_PUESTO', A, B)
    const final = playedMatch('FINAL', A, B)
    expect(thirdPlaceNote([...semis, playoff, final])).toBeNull()
  })

  it('no dice nada sin semifinales: no hay 3º/4º que la llave tenga que explicar', () => {
    expect(thirdPlaceNote([playedMatch('FINAL', A, B)])).toBeNull()
  })
})

// W70 (verify-report-pr21 #4004): la tabla de una fecha cerrada con llave
// puede mostrar el mismo PG y la misma diferencia en dos filas en un orden
// que esas columnas no explican, porque el orden real lo arma la llave
// (`knockoutPositions`), no la fase de grupos sola.
describe('bracketOrderNote', () => {
  const PADEL = CONFIG.matchFormat
  const FIFA = { ...CONFIG.matchFormat, openScore: true }

  it('pádel: cuenta la diferencia de games', () => {
    expect(bracketOrderNote(PADEL)).toBe(
      'El orden sale del resultado de la llave, no sólo de la fase de grupos: por eso puede haber lados con el mismo PG y la misma diferencia de games en un orden distinto.',
    )
  })

  it('FIFA (marcador abierto): cuenta la diferencia de GOL, no de games', () => {
    expect(bracketOrderNote(FIFA)).toBe(
      'El orden sale del resultado de la llave, no sólo de la fase de grupos: por eso puede haber lados con el mismo PG y la misma diferencia de gol en un orden distinto.',
    )
  })
})
