import { describe, it, expect } from 'vitest'
import { defaultConfig, disciplineProfile } from './config'
import {
  MODALITY_ORDER,
  SPORTS,
  SPORT_IDS,
  TOURNAMENT_SPORTS,
  isSportId,
  isTournamentSport,
  modalityLabel,
  modalityOf,
  modalityShape,
  sideWords,
  sportFamily,
  sportLabel,
  unitOf,
  type Modality,
} from './sports'
import type { MatchFormat, SideSize } from './types'

describe('registro de deportes', () => {
  it('el formato por defecto de pádel no se mueve', () => {
    expect(SPORTS.PADEL.format).toEqual(disciplineProfile('PADEL', defaultConfig(4)).config.matchFormat)
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
    expect(isTournamentSport('FUTBOL')).toBe(false)
    expect(isTournamentSport('toString')).toBe(false)
    expect(isTournamentSport('padel')).toBe(false)
  })
})
