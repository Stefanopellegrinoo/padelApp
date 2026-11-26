import { describe, it, expect } from 'vitest'
import { defaultConfig, disciplineProfile, fichaSeed } from './config'
import {
  MODALITY_ORDER,
  SPORTS,
  SPORT_TONOS,
  SPORT_IDS,
  TOURNAMENT_SPORTS,
  isSportId,
  isTournamentSport,
  modalityLabel,
  modalityOf,
  modalityShape,
  sideWords,
  sportFamily,
  sportFormatError,
  sportLabel,
  unitOf,
  type Modality,
  type Sport,
} from './sports'
import type { MatchFormat, SideSize } from './types'

describe('registro de deportes', () => {
  // Pádel juega el set real (S6) y fuera de eso no se mueve; `defaultConfig`, la de los torneos de
  // antes, sigue sin la regla.
  it('el formato por defecto de pádel no se mueve, salvo el set real', () => {
    expect(SPORTS.PADEL.format).toEqual({
      ...disciplineProfile('PADEL', defaultConfig(4)).config.matchFormat,
      ventaja: true,
    })
    expect(defaultConfig(4).matchFormat.ventaja).toBeUndefined()
  })

  it('los deportes nuevos, con los valores aprobados (S1, S2)', () => {
    expect(SPORTS.TENIS).toMatchObject({
      label: 'Tenis', unit: 'games', family: 'sets', tournaments: true,
      format: { setsToWin: 1, gamesPerSet: 6, tieBreak: true, openScore: false, ventaja: true },
    })
    expect(SPORTS.FUTBOL_TENIS).toMatchObject({
      label: 'Fútbol tenis', unit: 'puntos', family: 'sets', tournaments: true,
      format: { setsToWin: 1, gamesPerSet: 15, tieBreak: false, openScore: false },
    })
    expect(SPORTS.POOL).toMatchObject({
      label: 'Pool', unit: 'bolas', family: 'sets', tournaments: true,
      format: { setsToWin: 1, gamesPerSet: 3, tieBreak: true, openScore: false },
    })
    expect(SPORTS.BEER_PONG).toMatchObject({
      label: 'Beer pong', unit: 'vasos', family: 'sets', tournaments: true,
      format: { setsToWin: 1, gamesPerSet: 10, tieBreak: true, openScore: false },
    })
  })

  it('la lista de deportes y la de torneos, en el orden de los chips', () => {
    expect(SPORT_IDS).toEqual([
      'PADEL', 'PING_PONG', 'FIFA', 'TENIS', 'FUTBOL_TENIS', 'POOL', 'BEER_PONG', 'AJEDREZ', 'FUTBOL', 'BASQUET',
    ])
    expect([...TOURNAMENT_SPORTS]).toEqual([
      'PADEL', 'PING_PONG', 'FIFA', 'TENIS', 'FUTBOL_TENIS', 'POOL', 'BEER_PONG', 'AJEDREZ',
    ])
  })

  it('el set real se ofrece sólo donde se juega a games con tie-break: pádel y tenis', () => {
    const conSetReal = SPORT_IDS.filter((id) => {
      const sport = SPORTS[id]
      return sport.family === 'sets' && sport.setReal
    })
    expect(conSetReal).toEqual(['PADEL', 'TENIS'])
    for (const id of SPORT_IDS) {
      const sport: Sport = SPORTS[id]
      if (sport.family === 'sets' && !sport.setReal) expect(sport.format.ventaja).toBeUndefined()
    }
    // Pádel con amigos y en el torneo rápido también juega el real, como tenis (S6).
    expect((SPORTS.PADEL.format as MatchFormat).ventaja).toBe(true)
    expect(SPORTS.TENIS.format.ventaja).toBe(true)
  })

  it('cada deporte tiene su color y su ícono, y no hay dos con el mismo color (S5)', () => {
    const tonos = SPORT_IDS.map((id) => SPORTS[id].tono)
    expect(new Set(tonos).size).toBe(tonos.length)
    for (const tono of tonos) expect(SPORT_TONOS).toContain(tono)
    expect(SPORTS.PADEL.tono).toBe('padel')
    expect(SPORTS.FIFA.tono).toBe('fifa')
    const iconos = SPORT_IDS.map((id) => SPORTS[id].icono)
    expect(new Set(iconos).size).toBe(iconos.length)
    // Bowling (T3) ya tiene paleta: su entrada del registro llega con él.
    expect(SPORTS.AJEDREZ.tono).toBe('ajedrez')
    expect(SPORT_TONOS).toEqual(expect.arrayContaining(['bowling']))
  })

  it('los torneos nuevos de pádel y tenis nacen con el set real; los demás con su regla', () => {
    expect(fichaSeed('PADEL', 8, 'ROTAN').config.matchFormat).toEqual({ ...SPORTS.PADEL.format, ventaja: true })
    expect(fichaSeed('PADEL', 8, 'FIJAS').config.matchFormat.ventaja).toBe(true)
    expect(fichaSeed('TENIS', 8, 'INDIVIDUAL').config.matchFormat).toEqual(SPORTS.TENIS.format)
    expect(fichaSeed('PING_PONG', 8, 'INDIVIDUAL').config.matchFormat.ventaja).toBeUndefined()
  })

  it('los rangos de pádel son los de STEPPERS de hoy', () => {
    // app/.../wizard-state.ts:30 (core no importa app, por eso va literal).
    expect(SPORTS.PADEL.setsToWin).toEqual({ min: 1, max: 3 })
    expect(SPORTS.PADEL.gamesPerSet).toEqual({ min: 3, max: 9 })
  })

  it('TOURNAMENT_SPORTS es el flag `tournaments`, en orden', () => {
    expect([...TOURNAMENT_SPORTS]).toEqual(SPORT_IDS.filter((id) => SPORTS[id].tournaments))
  })

  it('todo id cumple el regex de casual_sport_id', () => {
    for (const id of SPORT_IDS) expect(id).toMatch(/^[A-Z][A-Z_]{0,31}$/)
  })

  it('toda familia sets: sin marcador abierto, sin empate y defaults dentro de rango', () => {
    for (const id of SPORT_IDS) {
      const s = SPORTS[id]
      if (s.family !== 'sets') continue
      expect(s.format.openScore).toBe(false)
      expect(s.allowsDraw).toBe(false)
      expect(s.format.setsToWin).toBeGreaterThanOrEqual(s.setsToWin.min)
      expect(s.format.setsToWin).toBeLessThanOrEqual(s.setsToWin.max)
      expect(s.format.gamesPerSet).toBeGreaterThanOrEqual(s.gamesPerSet.min)
      expect(s.format.gamesPerSet).toBeLessThanOrEqual(s.gamesPerSet.max)
    }
  })

  it('lee ids fuera del registro sin tirar', () => {
    expect(sportLabel('PADEL')).toBe('Pádel')
    expect(sportLabel('TEJO')).toBe('TEJO')
    expect(sportFamily('BASQUET')).toBe('goals')
    expect(sportFamily('TEJO')).toBeNull()
    expect(isSportId('Fifa')).toBe(false)
    expect(isSportId('toString')).toBe(false)
    expect(isSportId('FIFA')).toBe(true)
  })

  it('disciplineProfile deriva empate y marcador abierto del registro', () => {
    for (const kind of TOURNAMENT_SPORTS) {
      const { config, allowsDraw } = disciplineProfile(kind, defaultConfig(4))
      expect(allowsDraw).toBe(SPORTS[kind].allowsDraw)
      expect(config.matchFormat.openScore).toBe(SPORTS[kind].family === 'goals')
    }
  })
})

describe('la ficha', () => {
  it('todo deporte de torneos tiene ficha; fútbol y básquet no', () => {
    for (const id of SPORT_IDS) {
      if (SPORTS[id].tournaments) expect(SPORTS[id].ficha).not.toBeNull()
    }
    expect(SPORTS.PING_PONG.ficha).not.toBeNull()
    expect(SPORTS.FUTBOL.ficha).toBeNull()
    expect(SPORTS.BASQUET.ficha).toBeNull()
  })

  it('cada ficha ofrece modalidades distintas con etiqueta, y la primera es la marcada', () => {
    for (const id of SPORT_IDS) {
      const ficha = SPORTS[id].ficha
      if (ficha === null) continue
      const ids = ficha.modalities.map((option) => option.id)
      expect(ids.length).toBeGreaterThan(0)
      expect(new Set(ids).size).toBe(ids.length)
      for (const option of ficha.modalities) expect(option.label.trim()).not.toBe('')
    }
    expect(SPORTS.PADEL.ficha?.modalities[0]?.id).toBe('ROTAN')
    expect(SPORTS.PING_PONG.ficha?.modalities[0]?.id).toBe('INDIVIDUAL')
    expect(SPORTS.FIFA.ficha?.modalities[0]?.id).toBe('INDIVIDUAL')
    expect(SPORTS.TENIS.ficha?.modalities.map((o) => o.label)).toEqual(['Individual', 'Dobles fijos', 'Dobles que rotan'])
    expect(SPORTS.FUTBOL_TENIS.ficha?.modalities[0]?.id).toBe('INDIVIDUAL')
    expect(SPORTS.POOL.ficha?.modalities[0]?.id).toBe('INDIVIDUAL')
    expect(SPORTS.BEER_PONG.ficha?.modalities.map((o) => o.id)).toEqual(['FIJAS', 'ROTAN', 'INDIVIDUAL'])
  })

  it('cada deporte nuevo siembra un torneo con cada modalidad de su ficha', () => {
    for (const id of ['TENIS', 'FUTBOL_TENIS', 'POOL', 'BEER_PONG'] as const) {
      for (const { id: modality } of SPORTS[id].ficha.modalities) {
        const seed = fichaSeed(id, 8, modality)
        expect(seed.config.matchFormat).toEqual(SPORTS[id].format)
        expect(seed.hasMasters).toBe(false)
      }
    }
  })

  it('MODALITY_ORDER dibuja individual, fijas, rotan', () => {
    expect([...MODALITY_ORDER]).toEqual(['INDIVIDUAL', 'FIJAS', 'ROTAN'])
  })

  it('modalityShape deshace modalityOf', () => {
    const shapes: [SideSize, boolean][] = [[1, false], [2, true], [2, false]]
    for (const [pairSize, fixedTeams] of shapes) {
      expect(modalityShape(modalityOf(pairSize, fixedTeams))).toEqual({ pairSize, fixedTeams })
    }
    const modalities: Modality[] = ['INDIVIDUAL', 'FIJAS', 'ROTAN']
    for (const modality of modalities) {
      const { pairSize, fixedTeams } = modalityShape(modality)
      expect(modalityOf(pairSize, fixedTeams)).toBe(modality)
    }
  })

  it('modalityLabel usa la ficha del deporte y cae a la genérica fuera del registro', () => {
    expect(modalityLabel('PING_PONG', 'FIJAS')).toBe('Dobles fijos')
    expect(modalityLabel('PING_PONG', 'ROTAN')).toBe('Dobles que rotan')
    expect(modalityLabel('PADEL', 'ROTAN')).toBe('Parejas que rotan')
    expect(modalityLabel('TEJO', 'INDIVIDUAL')).toBe('Individual')
    expect(modalityLabel('TEJO', 'FIJAS')).toBe('Parejas fijas')
    expect(modalityLabel('TEJO', 'ROTAN')).toBe('Parejas que rotan')
  })

  it('modalityLabel no tira con un deporte sin ficha ni con una modalidad que la ficha no ofrece', () => {
    expect(modalityLabel('FUTBOL', 'ROTAN')).toBe('Parejas que rotan')
    expect(modalityLabel('PADEL', 'INDIVIDUAL')).toBe('Individual')
  })

  it('sideWords sigue a la modalidad: jugador de a uno, pareja de a dos', () => {
    expect(sideWords(1)).toEqual({ one: 'jugador', many: 'jugadores', best: 'el mejor jugador' })
    expect(sideWords(2)).toEqual({ one: 'pareja', many: 'parejas', best: 'la mejor pareja' })
  })

  it('unitOf lee el registro y fuera de él deduce de openScore, sin tirar', () => {
    const format: MatchFormat = SPORTS.PADEL.format
    expect(unitOf('PING_PONG', SPORTS.PADEL.format)).toBe('puntos')
    expect(unitOf('PADEL', format)).toBe('games')
    expect(unitOf('TEJO', { ...format, openScore: true })).toBe('goles')
    expect(unitOf('TEJO', { ...format, openScore: false })).toBe('games')
  })

  it('isTournamentSport acepta sólo ids del registro que se juegan en torneos', () => {
    expect(isTournamentSport('PADEL')).toBe(true)
    expect(isTournamentSport('PING_PONG')).toBe(true)
    expect(isTournamentSport('FUTBOL')).toBe(false)
    expect(isTournamentSport('toString')).toBe(false)
    expect(isTournamentSport('padel')).toBe(false)
  })
})

describe('sportFormatError', () => {
  it('rechaza los sets para ganar fuera del rango de la ficha', () => {
    expect(sportFormatError('PADEL', { setsToWin: 4, gamesPerSet: 4, openScore: false })).toBe(
      'Los sets para ganar tienen que estar entre 1 y 3.',
    )
  })

  it('rechaza los games por set fuera del rango de la ficha', () => {
    expect(sportFormatError('PADEL', { setsToWin: 1, gamesPerSet: 10, openScore: false })).toBe(
      'Los games por set tienen que estar entre 3 y 9.',
    )
  })

  it('dice "son N" cuando los puntos por set son fijos', () => {
    expect(sportFormatError('PING_PONG', { setsToWin: 2, gamesPerSet: 12, openScore: false })).toBe(
      'Los puntos por set son 11.',
    )
  })

  it('deja pasar un formato que entra en la ficha', () => {
    expect(sportFormatError('PADEL', { setsToWin: 1, gamesPerSet: 4, openScore: false })).toBeNull()
  })

  it('no mira los deportes de goles ni los marcadores abiertos: no tienen perillas', () => {
    expect(sportFormatError('FIFA', { setsToWin: 1, gamesPerSet: 4, openScore: false })).toBeNull()
    expect(sportFormatError('PADEL', { setsToWin: 9, gamesPerSet: 99, openScore: true })).toBeNull()
  })

  it('rechaza un id fuera del registro', () => {
    expect(sportFormatError('TEJO', { setsToWin: 1, gamesPerSet: 4, openScore: false })).toBe(
      'Elegí un deporte de la lista.',
    )
  })
})
