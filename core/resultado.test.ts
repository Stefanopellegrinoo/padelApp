// La familia "resultado" (odd/tasks/mas-deportes.md, S3): el ajedrez se carga con un toque —ganó
// uno, ganó el otro o tablas— y se guarda como UN set 1-0, 0-1 o 0-0.
import { describe, expect, it } from 'vitest'
import { defaultConfig, disciplineProfile, fichaSeed } from './config'
import { drawIsLegal } from './knockout'
import { formatLabel, narrateRules } from './narrate'
import { fichaLine, reglamento, type ReglamentoInput } from './reglamento'
import { single } from './side'
import { RESULT_FORMAT, SPORTS, sportFamily, sportFormatError } from './sports'
import { computeStandings, dayScoring } from './standings'
import type { MatchResult, SeasonConfig } from './types'

const seeded = (): ReglamentoInput => {
  const { config, pairSize, fixedTeams, allowsDraw, hasMasters, formatoDefault } = fichaSeed('AJEDREZ', 6, 'INDIVIDUAL')
  return { kind: 'AJEDREZ', pairSize, fixedTeams, allowsDraw, hasMasters, formatoDefault, config }
}

describe('el ajedrez en el registro', () => {
  it('es de la familia resultado, con tablas, en partidas, con su color y su peón', () => {
    expect(SPORTS.AJEDREZ).toMatchObject({
      label: 'Ajedrez', unit: 'partidas', family: 'result', allowsDraw: true, tournaments: true,
      tono: 'ajedrez', icono: 'peon', format: RESULT_FORMAT,
    })
    expect(sportFamily('AJEDREZ')).toBe('result')
  })

  it('el formato es una partida: un set de 1, sin marcador abierto', () => {
    expect(RESULT_FORMAT).toEqual({ setsToWin: 1, gamesPerSet: 1, tieBreak: false, openScore: false, resultado: true })
  })

  it('se juega de a uno: la ficha sólo ofrece Individual y no tiene Masters', () => {
    expect(SPORTS.AJEDREZ.ficha.modalities.map((option) => option.id)).toEqual(['INDIVIDUAL'])
    expect(SPORTS.AJEDREZ.ficha.masters).toBe(false)
    expect(() => fichaSeed('AJEDREZ', 8, 'FIJAS')).toThrow()
  })

  it('un torneo nuevo nace con la partida y con tablas', () => {
    const seed = fichaSeed('AJEDREZ', 6, 'INDIVIDUAL')
    expect(seed.config.matchFormat).toEqual(RESULT_FORMAT)
    expect(seed.config.matchFormat).not.toBe(RESULT_FORMAT)
    expect(seed).toMatchObject({ pairSize: 1, fixedTeams: false, allowsDraw: true, hasMasters: false })
  })

  it('disciplineProfile también lo deja en la partida, con tablas', () => {
    const { config, allowsDraw } = disciplineProfile('AJEDREZ', defaultConfig(6, 1))
    expect(config.matchFormat).toEqual(RESULT_FORMAT)
    expect(allowsDraw).toBe(true)
  })

  it('disciplineProfile no se movió para los de sets y goles', () => {
    const base = defaultConfig(8)
    expect(disciplineProfile('PADEL', base).config.matchFormat).toEqual({ ...base.matchFormat, openScore: false })
    expect(disciplineProfile('FIFA', base).config.matchFormat).toEqual({ ...base.matchFormat, openScore: true })
    expect(disciplineProfile('PADEL', base).config.matchFormat.resultado).toBeUndefined()
  })
})

describe('sportFormatError con la familia resultado', () => {
  it('deja pasar la partida', () => {
    expect(sportFormatError('AJEDREZ', RESULT_FORMAT)).toBeNull()
  })

  it('rechaza cualquier otro formato: no hay sets que cambiar', () => {
    const error = 'El ajedrez se carga con gana, pierde o tablas: no tiene sets que cambiar.'
    expect(sportFormatError('AJEDREZ', { setsToWin: 1, gamesPerSet: 4, openScore: false })).toBe(error)
    expect(sportFormatError('AJEDREZ', { ...RESULT_FORMAT, setsToWin: 2 })).toBe(error)
    expect(sportFormatError('AJEDREZ', { ...RESULT_FORMAT, openScore: true })).toBe(error)
  })

  it('y un deporte de sets con la marca de resultado tampoco entra', () => {
    expect(sportFormatError('PADEL', { setsToWin: 1, gamesPerSet: 4, openScore: false, resultado: true })).toBe(
      'Este deporte no se carga con gana, pierde o tablas.',
    )
  })
})

describe('la tabla de la fecha con tablas', () => {
  const A = single('a')
  const B = single('b')
  const C = single('c')
  const partida = (sideA: typeof A, sideB: typeof A, gamesA: number, gamesB: number): MatchResult => ({
    round: 1, fase: 'GRUPO', grupo: 1, sideA, sideB, sets: [{ gamesA, gamesB }],
  })
  const config: SeasonConfig = { ...defaultConfig(3, 1), matchFormat: RESULT_FORMAT }

  it('en una fecha de todos contra todos (fase GRUPO) las tablas son legales; en la llave no', () => {
    expect(drawIsLegal('GRUPO', SPORTS.AJEDREZ.allowsDraw)).toBe(true)
    for (const fase of ['OCTAVOS', 'CUARTOS', 'SEMI', 'TERCER_PUESTO', 'FINAL'] as const) {
      expect(drawIsLegal(fase, SPORTS.AJEDREZ.allowsDraw)).toBe(false)
    }
  })

  it('la victoria paga 3 y las tablas 1, la regla con empate de siempre', () => {
    expect(dayScoring(true)).toEqual({ win: 3, draw: 1 })
    expect(dayScoring(false)).toEqual({ win: 1, draw: 0 })
    const rows = computeStandings([A, B, C], [partida(A, B, 0, 0), partida(A, C, 1, 0), partida(B, C, 0, 1)], config, ['a', 'b', 'c'], true)
    expect(rows.map((row) => [row.side.a, row.won, row.drawn, row.dayPoints])).toEqual([
      ['a', 1, 1, 4],
      ['c', 1, 0, 3],
      ['b', 0, 1, 1],
    ])
  })
})

describe('el reglamento y el detalle del ajedrez', () => {
  it('el formato se dice gana, pierde o tablas', () => {
    expect(formatLabel(RESULT_FORMAT, 'partidas')).toBe('Gana, pierde o tablas')
    expect(fichaLine(seeded())).toBe('Gana, pierde o tablas · 10 fechas · cuentan las 8 mejores')
  })

  it('la línea del partido dice lo que paga la tabla de la fecha, con los números del motor', () => {
    const lines = Object.fromEntries(reglamento(seeded()).map((line) => [line.key, line.text]))
    expect(lines.modalidad).toBe('Individual. La primera fecha se arma al azar; después, por la tabla.')
    expect(lines.partido).toBe('Cada partida: gana, pierde o tablas. En la tabla de la fecha, victoria 3 puntos y tablas 1.')
    expect(lines).not.toHaveProperty('masters')
  })

  it('sin tablas (no pasa hoy) dice que siempre hay un ganador', () => {
    const lines = Object.fromEntries(reglamento({ ...seeded(), allowsDraw: false }).map((line) => [line.key, line.text]))
    expect(lines.partido).toBe('Cada partida, siempre con un ganador.')
  })

  it('el detalle cuenta las tablas, que en la llave no hay, y no promete sets ni games', () => {
    const { config } = seeded()
    const sections = narrateRules(config, { hasMasters: false, pairSize: 1, fixedTeams: false, allowsDraw: true }, 'partidas')
    const fecha = sections.find((section) => section.title === 'La fecha')?.body ?? ''
    expect(fecha).toContain(
      'Cada partida se gana, se pierde o termina en tablas. En la tabla de la fecha la victoria vale 3 y las tablas 1. En la llave no hay tablas: tiene que haber un ganador.',
    )
    expect(fecha).not.toContain('set')
    const desempate = sections.find((section) => section.title === 'Los desempates')?.body ?? ''
    expect(desempate).toContain('si dos jugadores suman los mismos puntos, corta la diferencia entre ganadas y perdidas')
  })
})
