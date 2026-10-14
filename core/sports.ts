/**
 * El registro de deportes: un deporte es DATO, la familia de marcador es la
 * estrategia. Agregar un deporte de una familia existente es agregar una
 * entrada acá; nada más en `core/` cambia.
 *
 * Puro y sin dependencias: sólo tipos de `./types` (nada de `./config`, que
 * importa de acá).
 */
import type { MatchFormat } from './types'

export type ScoringFamily = 'sets' | 'goals'
export interface Range {
  min: number
  max: number
}

interface SportBase {
  label: string
  /** Plural, minúscula: 'games' | 'puntos' | 'goles'. El copy lo arma la pantalla. */
  unit: string
  /** Se puede elegir al crear un torneo. Fase 1: sólo PADEL y FIFA (CHECK de `disciplines.kind`). */
  tournaments: boolean
}
export interface SetsSport extends SportBase {
  family: 'sets'
  /** La máquina de dos toques no produce empates; `casual_sets_no_draw`. */
  allowsDraw: false
  /** Defaults, `openScore: false`. */
  format: MatchFormat
  setsToWin: Range
  /** min === max → fijo, sin stepper. */
  gamesPerSet: Range
}
export interface GoalsSport extends SportBase {
  family: 'goals'
  allowsDraw: boolean
  teams: boolean
}
export type Sport = SetsSport | GoalsSport

export const SPORTS = {
  PADEL: {
    label: 'Pádel', unit: 'games', family: 'sets', allowsDraw: false, tournaments: true,
    format: { setsToWin: 1, gamesPerSet: 4, tieBreak: true, openScore: false },
    setsToWin: { min: 1, max: 3 }, gamesPerSet: { min: 3, max: 9 },
  },
  PING_PONG: {
    label: 'Ping pong', unit: 'puntos', family: 'sets', allowsDraw: false, tournaments: false,
    format: { setsToWin: 2, gamesPerSet: 11, tieBreak: false, openScore: false },
    setsToWin: { min: 1, max: 4 }, gamesPerSet: { min: 11, max: 11 },
  },
  FIFA:    { label: 'FIFA',    unit: 'goles',  family: 'goals', allowsDraw: true,  teams: true,  tournaments: true },
  FUTBOL:  { label: 'Fútbol',  unit: 'goles',  family: 'goals', allowsDraw: true,  teams: false, tournaments: false },
  BASQUET: { label: 'Básquet', unit: 'puntos', family: 'goals', allowsDraw: false, teams: false, tournaments: false },
} satisfies Record<string, Sport>

export type SportId = keyof typeof SPORTS
/** En el orden del registro: es el orden de los chips. */
export const SPORT_IDS = Object.keys(SPORTS) as SportId[]

/** `Object.hasOwn`, no `in`: 'toString' no es un deporte. */
export function isSportId(raw: string): raw is SportId {
  return Object.hasOwn(SPORTS, raw)
}
export function sportOf(id: SportId): Sport {
  return SPORTS[id]
}
/** Para LEER: un id fuera del registro se muestra tal cual, nunca tira. */
export function sportLabel(id: string): string {
  return isSportId(id) ? SPORTS[id].label : id
}
/** La familia de un id del registro, o `null` si no está (el caller decide el fallback). */
export function sportFamily(id: string): ScoringFamily | null {
  return isSportId(id) ? SPORTS[id].family : null
}

/** Tupla literal a propósito: `Record<DisciplineKind, …>` del wizard necesita las claves exactas. */
export const TOURNAMENT_SPORTS = ['PADEL', 'FIFA'] as const satisfies readonly SportId[]
export type TournamentSport = (typeof TOURNAMENT_SPORTS)[number]
