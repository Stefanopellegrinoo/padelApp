/**
 * El registro de deportes: un deporte es DATO, la familia de marcador es la
 * estrategia. Agregar un deporte de una familia existente es agregar una
 * entrada acá; nada más en `core/` cambia.
 *
 * Puro y sin dependencias: sólo tipos de `./types` (nada de `./config`, que
 * importa de acá).
 */
import type { FirstFecha, MatchFormat, MatchdayFormatSetting, SideSize } from './types'

export type ScoringFamily = 'sets' | 'goals'
export interface Range {
  min: number
  max: number
}

export type Modality = 'INDIVIDUAL' | 'FIJAS' | 'ROTAN'
/** Orden en que se DIBUJAN los botones (mockups). El orden de la ficha decide sólo cuál viene marcada. */
export const MODALITY_ORDER: readonly Modality[] = ['INDIVIDUAL', 'FIJAS', 'ROTAN']

/** Con qué nace un torneo de este deporte: sólo datos, la lee `fichaSeed` (core/config.ts). */
export interface TournamentFicha {
  /** En el orden de la ficha: la primera es la marcada. */
  modalities: readonly { id: Modality; label: string }[]
  season: { regularMatchdays: number; countBestOf: number; tiebreakSnapshotEvery: number }
  /** Masters por defecto con parejas. De a uno nunca (`disciplines_has_masters_needs_pair`, 0053). */
  masters: boolean
  fechaFormat: MatchdayFormatSetting
  firstFecha: Record<Modality, FirstFecha>
}

interface SportBase {
  label: string
  /** Plural, minúscula: 'games' | 'puntos' | 'goles'. El copy lo arma la pantalla. */
  unit: string
  /** Se puede elegir al crear un torneo: exige `ficha`. */
  tournaments: boolean
  /** Con qué nace un torneo de este deporte; `null` si no se juega en torneos (FUTBOL, BASQUET). */
  ficha: TournamentFicha | null
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

// Lo que comparten las tres fichas de hoy: los valores que la app ya usaba.
const SEASON_DE_HOY = { regularMatchdays: 10, countBestOf: 8, tiebreakSnapshotEvery: 3 }
const AUTO_FECHA = { kind: 'AUTO' } as const
const FIRST_FECHA_DE_HOY: Record<Modality, FirstFecha> = { INDIVIDUAL: 'SORTEO', FIJAS: 'SORTEO', ROTAN: 'NIVEL' }

export const SPORTS = {
  PADEL: {
    label: 'Pádel', unit: 'games', family: 'sets', allowsDraw: false, tournaments: true,
    format: { setsToWin: 1, gamesPerSet: 4, tieBreak: true, openScore: false },
    setsToWin: { min: 1, max: 3 }, gamesPerSet: { min: 3, max: 9 },
    ficha: {
      modalities: [{ id: 'ROTAN', label: 'Parejas que rotan' }, { id: 'FIJAS', label: 'Parejas fijas' }],
      season: SEASON_DE_HOY, masters: true, fechaFormat: AUTO_FECHA, firstFecha: FIRST_FECHA_DE_HOY,
    },
  },
  PING_PONG: {
    label: 'Ping pong', unit: 'puntos', family: 'sets', allowsDraw: false, tournaments: true,
    format: { setsToWin: 2, gamesPerSet: 11, tieBreak: false, openScore: false },
    setsToWin: { min: 1, max: 4 }, gamesPerSet: { min: 11, max: 11 },
    ficha: {
      modalities: [
        { id: 'INDIVIDUAL', label: 'Individual' },
        { id: 'FIJAS', label: 'Dobles fijos' },
        { id: 'ROTAN', label: 'Dobles que rotan' },
      ],
      season: SEASON_DE_HOY, masters: false, fechaFormat: AUTO_FECHA, firstFecha: FIRST_FECHA_DE_HOY,
    },
  },
  FIFA: {
    label: 'FIFA', unit: 'goles', family: 'goals', allowsDraw: true, teams: true, tournaments: true,
    ficha: {
      modalities: [
        { id: 'INDIVIDUAL', label: 'Individual' },
        { id: 'FIJAS', label: 'Parejas fijas' },
        { id: 'ROTAN', label: 'Parejas que rotan' },
      ],
      season: SEASON_DE_HOY, masters: false, fechaFormat: AUTO_FECHA, firstFecha: FIRST_FECHA_DE_HOY,
    },
  },
  FUTBOL:  { label: 'Fútbol',  unit: 'goles',  family: 'goals', allowsDraw: true,  teams: false, tournaments: false, ficha: null },
  BASQUET: { label: 'Básquet', unit: 'puntos', family: 'goals', allowsDraw: false, teams: false, tournaments: false, ficha: null },
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

/** `modalityShape` deshace esto. De a uno no hay "fijas": `fixedTeams` no cuenta. */
export function modalityOf(pairSize: SideSize, fixedTeams: boolean): Modality {
  if (pairSize === 1) return 'INDIVIDUAL'
  return fixedTeams ? 'FIJAS' : 'ROTAN'
}
export function modalityShape(modality: Modality): { pairSize: SideSize; fixedTeams: boolean } {
  if (modality === 'INDIVIDUAL') return { pairSize: 1, fixedTeams: false }
  return { pairSize: 2, fixedTeams: modality === 'FIJAS' }
}

const GENERIC_MODALITY_LABELS: Record<Modality, string> = {
  INDIVIDUAL: 'Individual',
  FIJAS: 'Parejas fijas',
  ROTAN: 'Parejas que rotan',
}
/** La de la ficha; para un id fuera del registro, la genérica ("Individual"/"Parejas fijas"/"Parejas que rotan"). */
export function modalityLabel(kind: string, modality: Modality): string {
  const option = isSportId(kind) ? SPORTS[kind].ficha?.modalities.find((o) => o.id === modality) : undefined
  return option?.label ?? GENERIC_MODALITY_LABELS[modality]
}

/** La palabra sigue a la modalidad, no al deporte: un lado de uno es "jugador", de dos "pareja". */
export function sideWords(pairSize: SideSize): { one: string; many: string; best: string } {
  return pairSize === 1
    ? { one: 'jugador', many: 'jugadores', best: 'el mejor jugador' }
    : { one: 'pareja', many: 'parejas', best: 'la mejor pareja' }
}

/** `SPORTS[kind].unit`; fuera del registro: 'goles' con `openScore`, 'games' si no. Nunca tira. */
export function unitOf(kind: string, format: MatchFormat): string {
  if (isSportId(kind)) return SPORTS[kind].unit
  return format.openScore ? 'goles' : 'games'
}

/** Tupla literal a propósito (`TournamentSport` necesita las claves exactas); el orden del registro es el de los chips. */
export const TOURNAMENT_SPORTS = ['PADEL', 'PING_PONG', 'FIFA'] as const satisfies readonly SportId[]
export type TournamentSport = (typeof TOURNAMENT_SPORTS)[number]

export function isTournamentSport(raw: string): raw is TournamentSport {
  return isSportId(raw) && (TOURNAMENT_SPORTS as readonly string[]).includes(raw)
}

/**
 * `null` si el formato de partido entra en la ficha. Sólo mira los deportes de sets con `openScore: false`:
 * los de goles y los marcadores abiertos no tienen perillas (y hay tests que crean FIFA con la config de pádel).
 */
export function sportFormatError(
  kind: string,
  format: Pick<MatchFormat, 'setsToWin' | 'gamesPerSet' | 'openScore'>,
): string | null {
  if (!isSportId(kind)) return 'Elegí un deporte de la lista.'
  const sport = SPORTS[kind]
  if (sport.family !== 'sets' || format.openScore) return null
  const { setsToWin, gamesPerSet } = sport
  if (format.setsToWin < setsToWin.min || format.setsToWin > setsToWin.max) {
    return `Los sets para ganar tienen que estar entre ${setsToWin.min} y ${setsToWin.max}.`
  }
  if (format.gamesPerSet < gamesPerSet.min || format.gamesPerSet > gamesPerSet.max) {
    return gamesPerSet.min === gamesPerSet.max
      ? `Los ${sport.unit} por set son ${gamesPerSet.min}.`
      : `Los ${sport.unit} por set tienen que estar entre ${gamesPerSet.min} y ${gamesPerSet.max}.`
  }
  return null
}
