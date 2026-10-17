import { describe, it, expect } from 'vitest'
import { bracketOrderNote, formatLabel, formatsLabel, narrateRules, scoreDiffLabel, thirdPlaceNote } from './narrate'
import { SPORTS } from './sports'
import { MASTERS_MATCHES, MASTERS_SIZE } from './constants'
import { defaultConfig } from './config'
import { pair } from './side'
import type { DisciplineShape, MatchResult, Phase, Side, SeasonConfig } from './types'

/**
 * Tarea 3a.1 (reglas-por-disciplina): pin de byte-identidad sobre la salida
 * DE HOY de `narrateRules(defaultConfig(8))` — la llamada de UN solo
 * argumento, tal cual existe antes de que `narrateRules` reciba
 * `DisciplineShape`. Copiado literal de `narrate.ts:67-114` con
 * `defaultConfig(8)` (squadSize=8, sideSize=2 default ⇒ `DEFAULT_POINTS[4]`
 * = `[10, 6, 3, 1]`), que es hoy el único shape que existe en producción
 * (hasMasters=true, pairSize=2, allowsDraw=true).
 *
 * Corrido y visto en VERDE contra el `narrate.ts` SIN TOCAR, antes de escribir
 * una sola línea de `DisciplineShape` — es la garantía de que este pin mide
 * lo que hoy renderiza la app y no lo que el código YA cambiado renderiza.
 *
 * (3a.4, después de implementar): con `narrateRules` pidiendo ya el segundo
 * argumento obligatorio, este mismo test pasó de la llamada de un argumento a
 * `narrateRules(PIN_CONFIG, { hasMasters: true, pairSize: 2, allowsDraw: true
 * })` — el shape de HOY — sin tocar un solo carácter de los seis textos
 * pinneados abajo. Es exactamente la prueba de que nada de lo que ya rendía
 * cambió: el pin se estableció contra el archivo sin tocar (arriba) y sigue
 * verde contra el archivo ya implementado.
 *
 * (torneos-deportes, Tarea 7, a propósito): `La fecha` perdió "y juegan todos
 * contra todos" — cómo se arma la fecha lo dice la línea `fecha` del reglamento
 * y con `AUTO` o con grupos esa frase era falsa. El resto del texto, igual.
 */
describe('narrateRules — pin de byte-identidad (3a.1)', () => {
  const PIN_CONFIG = defaultConfig(8)

  it('reproduce las seis secciones de hoy, carácter a carácter', () => {
    const sections = narrateRules(PIN_CONFIG, TODAY_SHAPE, 'games')

    expect(sections.map((section) => section.title)).toEqual([
      'El torneo',
      'La fecha',
      'Los puntos',
      'Cómo se arman las parejas',
      'Los desempates',
      'El Masters',
    ])

    expect(sections.find((s) => s.title === 'El torneo')?.body).toBe(
      'El campeonato son 10 fechas. Para cada jugador cuentan sus 8 mejores resultados, así que se ' +
        'puede faltar alguna vez sin quedar afuera de la pelea. El año cierra con un Masters entre ' +
        'los 4 mejores.',
    )

    expect(sections.find((s) => s.title === 'La fecha')?.body).toBe(
      'Cada fecha la juegan los que confirman, como mínimo 4 y hasta 12. Se arman parejas con todos. ' +
        'Cada partido se define a un set de 4 games con tie-break. Si el número ' +
        'de confirmados da impar, se suma un invitado para poder armar las parejas: el invitado no ' +
        'suma puntos, pero su compañero sí.',
    )

    expect(sections.find((s) => s.title === 'Los puntos')?.body).toBe(
      'Los dos integrantes de una pareja suman siempre lo mismo, según dónde terminó la pareja: el ' +
        '1º, 10; el 2º, 6; el 3º, 3; el 4º, 1. Cuando juegan menos parejas se usan los primeros ' +
        'valores, así ganar la fecha siempre suma 10. Nadie suma 0 por presentarse: si salir último ' +
        'diera lo mismo que faltar, convendría faltar.',
    )

    expect(sections.find((s) => s.title === 'Cómo se arman las parejas')?.body).toBe(
      'Las parejas se arman con la tabla del campeonato: se ordena a los presentes por puntos y se ' +
        'junta al primero con el último, al segundo con el anteúltimo, y así. Ninguna pareja se ' +
        'repite dos fechas seguidas, con una sola excepción: la pareja que gana una fecha se ' +
        'mantiene junta en la siguiente. Después se separa, gane o pierda, así que toda pareja ' +
        'campeona juega exactamente 2 fechas junta.',
    )

    expect(sections.find((s) => s.title === 'Los desempates')?.body).toBe(
      'En la tabla de la fecha, si dos parejas ganan la misma cantidad de partidos, corta la ' +
        'diferencia de games. Si empatan dos, el partido entre ellas lo decide; si empatan tres o ' +
        'más, el partido entre ellas no alcanza porque se ganan en círculo, y corta el orden de ' +
        'desempate. En la tabla del campeonato, si dos jugadores tienen los mismos puntos corta el ' +
        'orden de desempate: una lista del mejor al peor que arranca en el orden que consensuó el ' +
        'grupo y se actualiza cada 3 fechas con la tabla de ese momento.',
    )

    expect(sections.find((s) => s.title === 'El Masters')?.body).toBe(
      'Los 4 mejores del año juegan una jornada final de 3 partidos con compañeros rotativos: cada ' +
        'uno juega una vez con cada uno. Se cuentan los partidos ganados de forma individual. Si hay ' +
        'empate, gana el que llegó mejor posicionado en el ranking anual.',
    )
  })
})

const CONFIG: SeasonConfig = {
  squadSize: 12,
  matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true, openScore: false },
  points: [10, 7, 5, 3, 2, 1],
  regularMatchdays: 10,
  countBestOf: 8,
  tiebreakSnapshotEvery: 3,
}

/** La única forma que existía antes de `DisciplineShape`: pádel, con Masters. */
const TODAY_SHAPE: DisciplineShape = { hasMasters: true, pairSize: 2, fixedTeams: false, allowsDraw: true }

function bodyOf(
  config: SeasonConfig,
  title: string,
  shape: DisciplineShape = TODAY_SHAPE,
  unit = 'games',
): string {
  const block = narrateRules(config, shape, unit).find((section) => section.title === title)
  if (block === undefined) throw new Error(`No hay bloque "${title}"`)
  return block.body
}

describe('narrateRules', () => {
  it('returns a block per topic', () => {
    const titles = narrateRules(CONFIG, TODAY_SHAPE, 'games').map((section) => section.title)
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
    for (const section of narrateRules(CONFIG, TODAY_SHAPE, 'games')) {
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

// ── reglas-por-disciplina, slice 3a — `DisciplineShape` (tareas 3a.2-3a.7) ───
//
// Hasta acá `narrateRules` sólo conocía la config: no podía saber si ESTA
// disciplina juega Masters, si sus lados son de uno o de dos, ni si un
// empate es un resultado legal. Esas tres cosas viven en `disciplines`, no en
// el jsonb, y por eso llegan como segundo argumento, obligatorio y sin
// default (misma razón que `MatchFormat.openScore`: un default permisivo
// esconde al llamador que no lo piensa).
describe('narrateRules — DisciplineShape', () => {
  it('sin Masters no hay sección "El Masters" y "El torneo" no la nombra [R1]', () => {
    const sections = narrateRules(CONFIG, { ...TODAY_SHAPE, hasMasters: false }, 'games')
    expect(sections.map((s) => s.title)).not.toContain('El Masters')
    const elTorneo = sections.find((s) => s.title === 'El torneo')?.body ?? ''
    expect(elTorneo).not.toContain('Masters')
  })

  it('con lados de uno, "La fecha" y "Los puntos" no hablan de parejas y no hay sección de armado [R2, R3]', () => {
    const sections = narrateRules(CONFIG, { ...TODAY_SHAPE, pairSize: 1 }, 'games')
    const laFecha = sections.find((s) => s.title === 'La fecha')?.body ?? ''
    expect(laFecha).not.toContain('pareja')
    expect(laFecha).not.toContain('se suma un invitado')
    const losPuntos = sections.find((s) => s.title === 'Los puntos')?.body ?? ''
    expect(losPuntos).not.toContain('Los dos integrantes de una pareja')
    expect(sections.map((s) => s.title)).not.toContain('Cómo se arman las parejas')
  })

  it('con hasMasters:true y pairSize:2 reproduce el pin de 3a.1 tal cual (regresión R1/R2/R3) [3a.4]', () => {
    const sections = narrateRules(defaultConfig(8), TODAY_SHAPE, 'games')
    expect(sections.find((s) => s.title === 'La fecha')?.body).toBe(
      'Cada fecha la juegan los que confirman, como mínimo 4 y hasta 12. Se arman parejas con todos. ' +
        'Cada partido se define a un set de 4 games con tie-break. Si el número ' +
        'de confirmados da impar, se suma un invitado para poder armar las parejas: el invitado no ' +
        'suma puntos, pero su compañero sí.',
    )
  })

  it('FIFA 1v1 default: el tope de "La fecha" refleja maxMatchesOf, no el default de partidos de pádel [R4]', () => {
    const laFecha = bodyOf(CONFIG, 'La fecha', { hasMasters: false, pairSize: 1, fixedTeams: false, allowsDraw: true })
    // maxMatchesOf(CONFIG, 1) === defaultMaxMatches(1) === 36, porque CONFIG no trae `maxMatches`.
    expect(laFecha).toContain('36 partidos por fecha')
  })

  it('un maxMatches explícito cambia el tope narrado, para cualquier pairSize [R4]', () => {
    const conTope = { ...CONFIG, maxMatches: 20 }
    const laFecha = bodyOf(conTope, 'La fecha', TODAY_SHAPE)
    expect(laFecha).toContain('20 partidos por fecha')
    expect(laFecha).not.toContain('15 partidos por fecha')
  })

  it('marcador abierto + empate permitido reproduce "Puede terminar empatado." tal cual [R5]', () => {
    const FIFA = { ...CONFIG, matchFormat: { ...CONFIG.matchFormat, openScore: true } }
    const body = bodyOf(FIFA, 'La fecha', { hasMasters: false, pairSize: 1, fixedTeams: false, allowsDraw: true }, 'goles')
    expect(body).toContain('Puede terminar empatado.')
  })

  it('marcador abierto + empate NO permitido dice lo contrario, sin la palabra "empatado" [R5]', () => {
    const FIFA = { ...CONFIG, matchFormat: { ...CONFIG.matchFormat, openScore: true } }
    const body = bodyOf(FIFA, 'La fecha', { hasMasters: false, pairSize: 1, fixedTeams: false, allowsDraw: false }, 'goles')
    expect(body).not.toContain('empatado')
    expect(body).toContain('ganador')
  })

  it('sin marcador abierto, la frase del formato no depende de allowsDraw [R5]', () => {
    const conEmpate = bodyOf(CONFIG, 'La fecha', { ...TODAY_SHAPE, allowsDraw: true })
    const sinEmpate = bodyOf(CONFIG, 'La fecha', { ...TODAY_SHAPE, allowsDraw: false })
    expect(conEmpate).toBe(sinEmpate)
  })

  // W1 (verify-report reglas-por-disciplina): R2 sólo tenía scenarios para
  // "La fecha" y "Los puntos" — "Los desempates" seguía diciendo "si dos
  // parejas ganan..." sin importar `pairSize`, y como es la ÚNICA pantalla
  // pública sin sesión, mentía a cualquiera con el link. `pairSize=1` no
  // tiene pareja que ganar (core/pairing.ts:135-147): la tabla de la fecha
  // ordena jugadores.
  it('con lados de uno, "Los desempates" no afirma que ganan parejas [R2]', () => {
    const body = bodyOf(CONFIG, 'Los desempates', { hasMasters: true, pairSize: 1, fixedTeams: false, allowsDraw: true })
    expect(body).not.toContain('pareja')
    expect(body).toContain('si dos jugadores ganan la misma cantidad de partidos')
    expect(body).toContain('el partido entre ellos lo decide')
    expect(body).toContain('el partido entre ellos no alcanza')
  })

  it('con lados de dos, "Los desempates" sigue diciendo parejas tal cual (regresión) [R2]', () => {
    const body = bodyOf(CONFIG, 'Los desempates', { hasMasters: true, pairSize: 2, fixedTeams: false, allowsDraw: true })
    expect(body).toContain('si dos parejas ganan la misma cantidad de partidos')
    expect(body).toContain('el partido entre ellas lo decide')
  })

  // Decisión #3963: la curva de puntos ya no para en 6 lados. `ordinal` sólo
  // tiene nombre a mano para el 1º-6º; del 7º para arriba cae en el fallback
  // `el ${position}º`. Todos los demás fixtures del archivo usan configs de
  // ≤6 valores, así que nunca ejercitan ese fallback. 14 jugadores en pareja
  // son 7 lados: la primera curva real con un 7º puesto.
  it('nombra bien el 7º puesto cuando la curva de puntos tiene más de seis valores', () => {
    const body = bodyOf(defaultConfig(14, 2), 'Los puntos', { hasMasters: false, pairSize: 2, fixedTeams: false, allowsDraw: true })
    expect(body).toContain('el 7º, 0')
    expect(body).not.toContain('el 8º')
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
    const body = bodyOf(FIFA, 'La fecha', TODAY_SHAPE, 'goles')
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
      TODAY_SHAPE,
      'goles',
    )
    expect(body).not.toContain('corta la diferencia de sets')
    expect(body).not.toContain('diferencia de games')
    expect(body).toContain('diferencia de gol')
  })
})

// torneos-deportes, Tarea 7: el detalle de hoy nunca dice otra cosa que el
// reglamento en criollo que va arriba (docs/torneos-deportes.md §6).
describe('narrateRules — el detalle no contradice al reglamento', () => {
  const FIJAS: DisciplineShape = { ...TODAY_SHAPE, fixedTeams: true }
  const INDIVIDUAL: DisciplineShape = { hasMasters: false, pairSize: 1, fixedTeams: false, allowsDraw: true }
  const FORMAS: Array<[string, DisciplineShape, string]> = [
    ['parejas que rotan', TODAY_SHAPE, 'games'],
    ['parejas fijas', FIJAS, 'games'],
    ['individual', INDIVIDUAL, 'goles'],
    ['individual sin empate', { ...INDIVIDUAL, allowsDraw: false }, 'puntos'],
  ]

  it('parejas fijas: no hay sección de armado y "La fecha" dice que juegan juntas todo el torneo', () => {
    const sections = narrateRules(CONFIG, FIJAS, 'games')
    expect(sections.map((s) => s.title)).not.toContain('Cómo se arman las parejas')
    expect(bodyOf(CONFIG, 'La fecha', FIJAS)).toContain('Cada pareja juega junta todo el torneo.')
  })

  it('parejas que rotan: la sección de armado sigue, y "La fecha" dice que se arman con todos', () => {
    expect(narrateRules(CONFIG, TODAY_SHAPE, 'games').map((s) => s.title)).toContain('Cómo se arman las parejas')
    expect(bodyOf(CONFIG, 'La fecha', TODAY_SHAPE)).toContain('Se arman parejas con todos. ')
  })

  it('individual: "La fecha" dice que cada uno juega por su cuenta', () => {
    expect(bodyOf(CONFIG, 'La fecha', INDIVIDUAL, 'goles')).toContain('Cada uno juega por su cuenta. ')
  })

  it('ping pong: "La fecha" cuenta de 11 puntos y "Los desempates" corta por diferencia de puntos', () => {
    const pingPong: SeasonConfig = { ...CONFIG, matchFormat: SPORTS.PING_PONG.format }
    expect(bodyOf(pingPong, 'La fecha', TODAY_SHAPE, 'puntos')).toContain('de 11 puntos')
    expect(bodyOf(pingPong, 'La fecha', TODAY_SHAPE, 'puntos')).not.toContain('games')
    const desempates = bodyOf(pingPong, 'Los desempates', TODAY_SHAPE, 'puntos')
    expect(desempates).toContain('diferencia de puntos')
    expect(desempates).not.toContain('diferencia de games')
  })

  it.each(FORMAS)('%s: ninguna forma dice "todos contra todos" en "La fecha"', (_nombre, shape, unit) => {
    expect(bodyOf(CONFIG, 'La fecha', shape, unit)).not.toContain('todos contra todos')
  })

  it('la cláusula de invitados no cambia: sigue en pareja y no está de a uno', () => {
    expect(bodyOf(CONFIG, 'La fecha', FIJAS)).toContain('se suma un invitado')
    expect(bodyOf(CONFIG, 'La fecha', INDIVIDUAL, 'goles')).not.toContain('invitado')
  })
})

// La etiqueta corta del formato: la misma frase en Reglas, en Ajustes y en el
// resumen del wizard. Estaba escrita tres veces —dos idénticas y una que
// además decía "3 set" en singular con `setsToWin: 3`— y las tres mentían con
// marcador abierto.
describe('formatLabel', () => {
  it('nombra el set y los games del pádel', () => {
    expect(formatLabel(CONFIG.matchFormat, 'games')).toBe('1 set a 4 games')
  })

  it('pluraliza cuando el partido se define a más de un set', () => {
    expect(formatLabel({ ...CONFIG.matchFormat, setsToWin: 3 }, 'games')).toBe('mejor de 5 sets a 4 games')
  })

  it('no nombra ningún set cuando el marcador es abierto', () => {
    expect(formatLabel({ ...CONFIG.matchFormat, openScore: true }, 'goles')).toBe('Marcador de goles')
  })

  it('habla con la unidad que le pasan: el ping pong se juega a puntos', () => {
    expect(formatLabel(SPORTS.PING_PONG.format, 'puntos')).toBe('mejor de 3 sets a 11 puntos')
  })

  it('pádel a dos sets de 6: mejor de 3 sets a 6 games', () => {
    expect(formatLabel({ ...SPORTS.PADEL.format, setsToWin: 2, gamesPerSet: 6 }, 'games')).toBe(
      'mejor de 3 sets a 6 games',
    )
  })
})

describe('scoreDiffLabel', () => {
  it('con la unidad "goles" es "diferencia de gol", en singular', () => {
    expect(scoreDiffLabel('goles')).toBe('diferencia de gol')
  })

  it('con cualquier otra unidad la nombra tal cual', () => {
    expect(scoreDiffLabel('puntos')).toBe('diferencia de puntos')
    expect(scoreDiffLabel('games')).toBe('diferencia de games')
  })
})

// Antes de PR20 rebanada D2 todas las
// disciplinas de una temporada compartían `matchFormat`, así que UNA línea de
// formato era verdad. D2 hizo posibles dos formatos en el mismo torneo y por
// eso convirtió esa frase en falsa: Reglas y Ajustes narraban
// `primaryDiscipline(header)` y le decían al grupo "1 set a 4 games" sobre un
// torneo que tiene una mitad que se juega a goles.
describe('formatsLabel', () => {
  const PADEL = CONFIG.matchFormat
  const FIFA = { ...CONFIG.matchFormat, openScore: true }

  it('con un solo formato dice lo de siempre, sin prefijo', () => {
    expect(formatsLabel([{ label: 'Pádel', matchFormat: PADEL, unit: 'games' }])).toBe('1 set a 4 games')
  })

  it('con dos formatos nombra los dos y de quién es cada uno', () => {
    expect(
      formatsLabel([
        { label: 'Pádel', matchFormat: PADEL, unit: 'games' },
        { label: 'FIFA', matchFormat: FIFA, unit: 'goles' },
      ]),
    ).toBe('Pádel: 1 set a 4 games · FIFA: Marcador de goles')
  })

  it('dos disciplinas del mismo formato no son dos cosas que nombrar', () => {
    expect(
      formatsLabel([
        { label: 'Pádel', matchFormat: PADEL, unit: 'games' },
        { label: 'Pádel', matchFormat: PADEL, unit: 'games' },
      ]),
    ).toBe('1 set a 4 games')
  })

  it('cada fila cuenta en la unidad de su deporte', () => {
    expect(
      formatsLabel([
        { label: 'Pádel', matchFormat: PADEL, unit: 'games' },
        { label: 'Ping pong', matchFormat: SPORTS.PING_PONG.format, unit: 'puntos' },
      ]),
    ).toBe('Pádel: 1 set a 4 games · Ping pong: mejor de 3 sets a 11 puntos')
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
  it('pádel: cuenta la diferencia de games', () => {
    expect(bracketOrderNote('games')).toBe(
      'El orden sale del resultado de la llave, no sólo de la fase de grupos: por eso puede haber lados con el mismo PG y la misma diferencia de games en un orden distinto.',
    )
  })

  it('FIFA (marcador abierto): cuenta la diferencia de GOL, no de games', () => {
    expect(bracketOrderNote('goles')).toBe(
      'El orden sale del resultado de la llave, no sólo de la fase de grupos: por eso puede haber lados con el mismo PG y la misma diferencia de gol en un orden distinto.',
    )
  })

  it('ping pong: cuenta la diferencia de puntos', () => {
    expect(bracketOrderNote('puntos')).toContain('diferencia de puntos')
  })
})
