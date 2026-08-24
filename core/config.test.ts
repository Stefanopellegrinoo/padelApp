import { describe, it, expect } from 'vitest'
import { disciplineProfile, validateConfig, defaultConfig } from './config'
import type { SeasonConfig } from './types'

const valid: SeasonConfig = {
  squadSize: 12,
  matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true, openScore: false },
  points: [10, 7, 5, 3, 2, 1],
  regularMatchdays: 10,
  countBestOf: 8,
  tiebreakSnapshotEvery: 3,
}

describe('validateConfig', () => {
  it('accepts a valid config', () => {
    expect(validateConfig(valid, 2)).toEqual([])
  })

  it('rejects an odd squad size when the side is a pair', () => {
    const errors = validateConfig({ ...valid, squadSize: 11, points: [10, 7, 5, 3, 2] }, 2)
    expect(errors).toContain('El plantel tiene que ser un número par.')
  })

  // REQ-D2-2/REQ-D5-2: la paridad es una regla DE LA PAREJA, no del
  // plantel. Con sideSize=1 cada presente es su propio lado — no hay nada
  // que emparejar, así que un plantel impar es perfectamente jugable.
  //
  // El GIVEN del spec usa "7 presentes" como ejemplo, pero MIN_PLAYERS=8 es
  // todavía un piso COMPARTIDO entre disciplinas (PUNTO 3 del design, sin
  // hacer en esta tanda: separar minPlayers/maxPlayers por disciplina). Un
  // 7 acá tropezaría con ese piso —gap real, ya señalado, deliberadamente
  // afuera de W24— y taparía la señal de esta prueba. Se usa 9: impar,
  // dentro del piso/techo de hoy, aislando sólo la paridad.
  it('accepts an odd squad size when the side is a single (REQ-D2-2)', () => {
    const errors = validateConfig({ ...valid, squadSize: 9, points: [10, 7, 5, 3] }, 1)
    expect(errors).not.toContain('El plantel tiene que ser un número par.')
  })

  it('rejects a squad below the minimum', () => {
    const errors = validateConfig({ ...valid, squadSize: 6, points: [10, 7, 5] }, 2)
    expect(errors).toContain('El plantel tiene que ser de 8 jugadores o más.')
  })

  it('rejects a squad above the maximum', () => {
    const errors = validateConfig({ ...valid, squadSize: 14, points: [10, 7, 5, 3, 2, 1, 1] }, 2)
    expect(errors).toContain('El plantel no puede pasar de 12 jugadores.')
  })

  it('rejects a points list that does not match the pair count', () => {
    const errors = validateConfig({ ...valid, points: [10, 7, 5, 3] }, 2)
    expect(errors).toContain('Con un plantel de 12 hacen falta 6 valores de puntos, no 4.')
  })

  // ExpectedPoints dividía siempre por 2, así
  // que un 1v1 de 10 pedía la MITAD de los valores que necesita — y
  // rechazaba los 10 que un plantel de 10 lados-de-uno sí necesita.
  it('expects one value per side, not always per pair', () => {
    const cfg = { ...valid, squadSize: 10 }
    const tenValues = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
    expect(validateConfig({ ...cfg, points: tenValues }, 1)).toEqual([])
    const errors = validateConfig({ ...cfg, points: [10, 7, 5, 3, 2] }, 1)
    expect(errors).toContain('Con un plantel de 10 hacen falta 10 valores de puntos, no 5.')
  })

  const ORDER = 'Los puntos tienen que ir de mayor a menor. El único que se puede repetir es el 0.'

  it('rejects a repeated value that pays', () => {
    const errors = validateConfig({ ...valid, points: [10, 7, 7, 3, 2, 1] }, 2)
    expect(errors).toContain(ORDER)
  })

  // El último puede no sumar nada: es una decisión del torneo, no una regla del
  // formato. Lo que no puede es ser negativo.
  it('accepts a zero as the last value', () => {
    expect(validateConfig({ ...valid, points: [10, 7, 5, 3, 1, 0] }, 2)).toEqual([])
  })

  it('rejects a negative in the points list', () => {
    const errors = validateConfig({ ...valid, points: [10, 7, 5, 3, 1, -1] }, 2)
    expect(errors).toContain('Los puntos no pueden ser negativos.')
  })

  // Este test decía lo contrario: prohibía dos ceros por "repetidos". Con un
  // plantel de 12 son 6 valores, así que "sólo puntúan los primeros cuatro" NO
  // se podía escribir — bajar el quinto a 0 obligaba al sexto a ser negativo.
  // Repetir un valor que PAGA sigue prohibido; el 0 no paga.
  it('accepts as many trailing zeros as the tournament wants', () => {
    expect(validateConfig({ ...valid, points: [10, 6, 3, 1, 0, 0] }, 2)).toEqual([])
    expect(validateConfig({ ...valid, points: [10, 0, 0, 0, 0, 0] }, 2)).toEqual([])
  })

  it('rejects a zero with something after it', () => {
    const errors = validateConfig({ ...valid, points: [10, 7, 5, 0, 2, 1] }, 2)
    expect(errors).toContain(ORDER)
  })

  // Sin esto, [0,0,0,0,0,0] pasaría: es de mayor a menor y no tiene negativos.
  // Una temporada donde ganar no suma no produce tabla.
  it('rejects a list where winning pays nothing', () => {
    const errors = validateConfig({ ...valid, points: [0, 0, 0, 0, 0, 0] }, 2)
    expect(errors).toContain('Ganar tiene que sumar: el primer puesto no puede quedar en 0.')
  })

  it('rejects countBestOf above regularMatchdays', () => {
    const errors = validateConfig({ ...valid, countBestOf: 12 }, 2)
    expect(errors).toContain('No pueden contar 12 fechas si el torneo tiene 10.')
  })

  it('rejects a tournament with fewer than one matchday', () => {
    const errors = validateConfig({ ...valid, regularMatchdays: 0 }, 2)
    expect(errors).toContain('El torneo tiene que tener al menos 1 fecha.')
  })

  it('rejects a countBestOf below one', () => {
    const errors = validateConfig({ ...valid, countBestOf: 0 }, 2)
    expect(errors).toContain('Tiene que contar al menos 1 fecha por jugador.')
  })

  it('rejects a match format with zero sets to win', () => {
    const errors = validateConfig(
      {
        ...valid,
        matchFormat: { ...valid.matchFormat, setsToWin: 0 },
      },
      2,
    )
    expect(errors).toContain(
      'Los sets para ganar un partido tienen que ser al menos 1: con 0, ningún partido podría terminar.',
    )
  })

  it('rejects a match format with zero games per set', () => {
    const errors = validateConfig(
      {
        ...valid,
        matchFormat: { ...valid.matchFormat, gamesPerSet: 0 },
      },
      2,
    )
    expect(errors).toContain(
      'Los games por set tienen que ser al menos 1: con 0, la página de reglas describiría un set que no existe.',
    )
  })

  it('rejects a tiebreak interval below one', () => {
    const errors = validateConfig({ ...valid, tiebreakSnapshotEvery: 0 }, 2)
    expect(errors).toContain('El orden de desempate se tiene que refrescar cada 1 fecha o más.')
  })

  it('reports every problem at once, not just the first', () => {
    const errors = validateConfig({ ...valid, squadSize: 7, countBestOf: 99 }, 2)
    expect(errors).toContain('El plantel tiene que ser un número par.')
    expect(errors).toContain('No pueden contar 99 fechas si el torneo tiene 10.')
  })
})

describe('defaultConfig', () => {
  it('builds a valid config for any allowed squad size', () => {
    for (const size of [8, 10, 12]) {
      expect(validateConfig(defaultConfig(size), 2)).toEqual([])
    }
  })

  it('gives the winner ten points regardless of squad size', () => {
    expect(defaultConfig(8).points[0]).toBe(10)
    expect(defaultConfig(12).points[0]).toBe(10)
  })

  // PairCount dividía siempre por 2 — 4 lados
  // de a uno necesitan la misma tabla que 4 parejas (8 jugadores), no la
  // tabla vacía que le tocaba por casualidad.
  it('divides by the real side size, not always by 2', () => {
    expect(defaultConfig(4, 1).points).toEqual(defaultConfig(8, 2).points)
  })
})

// ── PR20 rebanada D1 — `validateConfig` entiende el marcador abierto ─────────
//
// Con `openScore: true` no hay set ni número objetivo, así que `setsToWin` y
// `gamesPerSet` no los lee NADIE (ver `db/validate.ts`). Exigir que sean
// válidos sería rechazar una config de FIFA por dos valores muertos.
//
// OJO: este `describe` NO es lo que habilita el `0-0`. Lo que lo hacía
// imposible era `setError` exigiendo `winner === gamesPerSet`; eso se corta en
// `db/validate.ts`. Acá sólo se deja de pedir coherencia a un número que nadie
// mira.
describe('validateConfig con openScore', () => {
  const dead = { setsToWin: 0, gamesPerSet: 0, tieBreak: false }

  it('ignora setsToWin y gamesPerSet cuando el marcador es abierto', () => {
    expect(
      validateConfig({ ...valid, matchFormat: { ...dead, openScore: true } }, 2),
    ).toEqual([])
  })

  it('y los sigue exigiendo, palabra por palabra, cuando no lo es (REQ-NR-1)', () => {
    const errors = validateConfig({ ...valid, matchFormat: { ...dead, openScore: false } }, 2)
    expect(errors).toContain(
      'Los sets para ganar un partido tienen que ser al menos 1: con 0, ningún partido podría terminar.',
    )
    expect(errors).toContain(
      'Los games por set tienen que ser al menos 1: con 0, la página de reglas describiría un set que no existe.',
    )
  })

  // El default es el pádel de siempre. Si esto se da vuelta, una temporada
  // nueva nace con marcador abierto sin que nadie lo haya pedido.
  it('defaultConfig nace con el marcador cerrado', () => {
    expect(defaultConfig(8).matchFormat.openScore).toBe(false)
  })

  // El resto de la config NO se afloja: `openScore` habla del marcador, no de
  // los puntos ni del plantel.
  it('no afloja nada más de la config', () => {
    const errors = validateConfig(
      { ...valid, points: [], matchFormat: { ...dead, openScore: true } },
      2,
    )
    expect(errors.length).toBeGreaterThan(0)
  })
})

// ── PR20 rebanada D2 — el perfil de una disciplina al NACER ──────────────────
//
// Hasta acá `openScore` existía en el modelo y NADA podía escribirlo: los dos
// caminos que crean una disciplina (el wizard de `/torneos/nuevo` y el
// "+ Agregar disciplina" de Ajustes) armaban su config con `defaultConfig`, que
// nace en pádel. Una liga de FIFA nacía siendo pádel con otro nombre.
//
// Vive en `core/` y no en cada pantalla por lo mismo que `pointsErrors`: dos
// copias de una regla son una regla y media. `allows_draw` además se fija AL
// CREAR y no se puede editar después (`0015_disciplines.sql:70` no lo incluye
// en el grant de UPDATE), así que una disciplina que nace mal nace mal para
// siempre.
describe('disciplineProfile', () => {
  it('una disciplina de FIFA nace con marcador de goles y con empates', () => {
    const profile = disciplineProfile('FIFA', valid)
    expect(profile.config.matchFormat.openScore).toBe(true)
    expect(profile.allowsDraw).toBe(true)
  })

  it('y una de pádel nace exactamente como hoy, sin tocar nada', () => {
    const profile = disciplineProfile('PADEL', valid)
    expect(profile.config).toEqual(valid)
    expect(profile.allowsDraw).toBe(false)
  })

  it('no pisa el resto de la config: sólo cambia la forma del marcador', () => {
    const profile = disciplineProfile('FIFA', valid)
    expect(profile.config.points).toEqual(valid.points)
    expect(profile.config.squadSize).toBe(valid.squadSize)
    expect(profile.config.matchFormat.setsToWin).toBe(valid.matchFormat.setsToWin)
  })

  it('la config que devuelve es válida: una liga de FIFA se puede crear de verdad', () => {
    expect(validateConfig(disciplineProfile('FIFA', valid).config, 2)).toEqual([])
  })
})

// ── El lado de UNO ya tiene tabla de puntos (decisión #3963) ─────────────────
//
// `DEFAULT_POINTS` sólo tenía 4, 5 y 6 lados —pensadas para parejas—, así que
// `defaultConfig(8, 1)` devolvía `points: []` y `validateConfig` lo rechazaba
// con "Con un plantel de 8 hacen falta 8 valores de puntos, no 0.". Era el
// primero de los tres bloqueos del 1v1, y el único que era decisión de
// producto.
//
// Stefano eligió la curva de pádel de 6 lados TAL CUAL, con ceros abajo: sólo
// puntúan los primeros seis puestos. Con 12 en cancha, la mitad de la fecha se
// va sin sumar — aceptado explícitamente.
describe('DEFAULT_POINTS con lados de uno', () => {
  it('un plantel de 8 de a uno son 8 lados y ahora tiene sus 8 valores', () => {
    expect(defaultConfig(8, 1).points).toEqual([10, 7, 5, 3, 2, 1, 0, 0])
  })

  it('los primeros seis son EXACTAMENTE la curva de pádel de 6 lados', () => {
    // No es "parecida": es la misma lista. Si alguien toca una, las dos tienen
    // que moverse juntas o el mismo puesto paga distinto según la disciplina.
    const padel = defaultConfig(12, 2).points
    for (const squadSize of [8, 9, 10, 11, 12]) {
      expect(defaultConfig(squadSize, 1).points.slice(0, 6)).toEqual(padel)
    }
  })

  it('cada plantel de a uno recibe exactamente un valor por lado', () => {
    for (const squadSize of [8, 9, 10, 11, 12]) {
      expect(defaultConfig(squadSize, 1).points).toHaveLength(squadSize)
    }
  })

  it('y `validateConfig` ya no las rechaza', () => {
    for (const squadSize of [8, 9, 10, 11, 12]) {
      expect(validateConfig(defaultConfig(squadSize, 1), 1)).toEqual([])
    }
  })

  it('del 7° puesto para abajo no suma nadie', () => {
    expect(defaultConfig(12, 1).points.slice(6)).toEqual([0, 0, 0, 0, 0, 0])
  })

  it('el pádel no se movió: sigue mirando 4, 5 y 6 lados', () => {
    expect(defaultConfig(8, 2).points).toEqual([10, 6, 3, 1])
    expect(defaultConfig(10, 2).points).toEqual([10, 7, 5, 3, 1])
    expect(defaultConfig(12, 2).points).toEqual([10, 7, 5, 3, 2, 1])
  })
})

describe('maxMatches — el techo de partidos de la disciplina', () => {
  it('sin la clave la config es válida: rige el default de su sideSize', () => {
    expect(validateConfig(defaultConfig(8), 2)).toEqual([])
  })

  it('acepta un techo propio', () => {
    expect(validateConfig({ ...defaultConfig(8), maxMatches: 20 }, 2)).toEqual([])
  })

  it('rechaza 0: dejaría a la disciplina sin ningún formato que lo cumpla', () => {
    expect(validateConfig({ ...defaultConfig(8), maxMatches: 0 }, 2)).toContain(
      'El máximo de partidos por fecha tiene que ser 1 o más.',
    )
  })

  it('rechaza un decimal', () => {
    expect(validateConfig({ ...defaultConfig(8), maxMatches: 6.5 }, 2)).toContain(
      'El máximo de partidos por fecha tiene que ser un número entero.',
    )
  })
})
