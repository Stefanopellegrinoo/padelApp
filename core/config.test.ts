import { describe, it, expect } from 'vitest'
import { validateConfig, defaultConfig } from './config'
import type { SeasonConfig } from './types'

const valid: SeasonConfig = {
  squadSize: 12,
  matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true },
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

  // REQ-D2-2/REQ-D5-2 (W24): la paridad es una regla DE LA PAREJA, no del
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
})
