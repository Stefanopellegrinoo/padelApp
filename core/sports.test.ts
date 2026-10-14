import { describe, it, expect } from 'vitest'
import { defaultConfig, disciplineProfile } from './config'
import { SPORTS, SPORT_IDS, TOURNAMENT_SPORTS, isSportId, sportFamily, sportLabel } from './sports'

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
