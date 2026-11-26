/**
 * El registro de deportes: un deporte es DATO, la familia de marcador es la
 * estrategia. Agregar un deporte de una familia existente es agregar una
 * entrada acá; nada más en `core/` cambia.
 *
 * Puro y sin dependencias: sólo tipos de `./types` (nada de `./config`, que
 * importa de acá).
 */
import type { FirstFecha, MatchFormat, MatchdayFormatSetting, SideSize } from './types'

export type ScoringFamily = 'sets' | 'goals' | 'result'
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

/**
 * La paleta del deporte (S5 de mas-deportes): `app/globals.css` define
 * `--color-<tono>`, `-tint`, `on-<tono>`, `-block` y `-block-soft` en claro y
 * en oscuro, y un bloque `[data-deporte='<ID>']` por id que las usa. Bowling
 * ya tiene la suya: su entrada del registro llega con su familia.
 */
export const SPORT_TONOS = [
  'padel', 'pingpong', 'fifa', 'futbol', 'basquet', 'tenis', 'futboltenis', 'pool', 'beerpong', 'ajedrez', 'bowling',
] as const
export type SportTono = (typeof SPORT_TONOS)[number]

/** El ícono del deporte: un trazo de `app/torneos/inicio/iconos.tsx`. */
export type SportIcono =
  | 'padel' | 'pingpong' | 'pad' | 'futbol' | 'basquet' | 'tenis' | 'futbolTenis' | 'pool' | 'vaso' | 'peon' | 'bolo'

interface SportBase {
  label: string
  tono: SportTono
  icono: SportIcono
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
  /**
   * Se juega a games con tie-break, así que un torneo nuevo nace con el set
   * real (`MatchFormat.ventaja`, `fichaSeed`) y "Personalizar reglas" ofrece
   * apagarlo: pádel y tenis. Los de puntos que se ganan por 2 (ping pong,
   * fútbol tenis) y los de llegar justo (pool, beer pong) no.
   */
  setReal: boolean
  setsToWin: Range
  /** min === max → fijo, sin stepper. */
  gamesPerSet: Range
}
export interface GoalsSport extends SportBase {
  family: 'goals'
  allowsDraw: boolean
  teams: boolean
}
/**
 * Gana, pierde o tablas (ajedrez, S3 de mas-deportes): un toque y ningún
 * número. Se guarda como UN set 1-0, 0-1 o 0-0 (`RESULT_FORMAT`), así la base,
 * la validación y la tabla de la fecha son las de siempre: las tablas son un
 * empate y pagan lo que paga un empate (`dayScoring`, core/standings.ts).
 */
export interface ResultSport extends SportBase {
  family: 'result'
  /** Las tablas: legales donde lo es un empate (`drawIsLegal`), nunca en la llave. */
  allowsDraw: true
  /** Siempre `RESULT_FORMAT`: no hay perillas. */
  format: MatchFormat
}
export type Sport = SetsSport | GoalsSport | ResultSport

/** Una partida: un set de 1, que gana uno (1-0, 0-1) o queda en tablas (0-0). */
export const RESULT_FORMAT: MatchFormat = {
  setsToWin: 1, gamesPerSet: 1, tieBreak: false, openScore: false, resultado: true,
}

// Lo que comparten las tres fichas de hoy: los valores que la app ya usaba.
const SEASON_DE_HOY = { regularMatchdays: 10, countBestOf: 8, tiebreakSnapshotEvery: 3 }
const AUTO_FECHA = { kind: 'AUTO' } as const
const FIRST_FECHA_DE_HOY: Record<Modality, FirstFecha> = { INDIVIDUAL: 'SORTEO', FIJAS: 'SORTEO', ROTAN: 'NIVEL' }

export const SPORTS = {
  PADEL: {
    label: 'Pádel', unit: 'games', family: 'sets', allowsDraw: false, tournaments: true, tono: 'padel', icono: 'padel',
    // Con `ventaja`: el set real (odd/tasks/mas-deportes.md, S6) para los partidos con amigos y el
    // torneo rápido; un torneo nuevo nace igual por `setReal` (`fichaSeed`). Los torneos ya creados
    // guardan su formato y no cambian, y un partido con amigos viejo (un 6-5) se sigue pudiendo
    // volver a guardar (`parseSetsResult`, db/friends.ts).
    format: { setsToWin: 1, gamesPerSet: 4, tieBreak: true, openScore: false, ventaja: true }, setReal: true,
    setsToWin: { min: 1, max: 3 }, gamesPerSet: { min: 3, max: 9 },
    ficha: {
      modalities: [{ id: 'ROTAN', label: 'Parejas que rotan' }, { id: 'FIJAS', label: 'Parejas fijas' }],
      season: SEASON_DE_HOY, masters: true, fechaFormat: AUTO_FECHA, firstFecha: FIRST_FECHA_DE_HOY,
    },
  },
  PING_PONG: {
    label: 'Ping pong', unit: 'puntos', family: 'sets', allowsDraw: false, tournaments: true, tono: 'pingpong', icono: 'pingpong',
    format: { setsToWin: 2, gamesPerSet: 11, tieBreak: false, openScore: false }, setReal: false,
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
    label: 'FIFA', unit: 'goles', family: 'goals', allowsDraw: true, teams: true, tournaments: true, tono: 'fifa', icono: 'pad',
    ficha: {
      modalities: [
        { id: 'INDIVIDUAL', label: 'Individual' },
        { id: 'FIJAS', label: 'Parejas fijas' },
        { id: 'ROTAN', label: 'Parejas que rotan' },
      ],
      season: SEASON_DE_HOY, masters: false, fechaFormat: AUTO_FECHA, firstFecha: FIRST_FECHA_DE_HOY,
    },
  },
  TENIS: {
    label: 'Tenis', unit: 'games', family: 'sets', allowsDraw: false, tournaments: true, tono: 'tenis', icono: 'tenis',
    format: { setsToWin: 1, gamesPerSet: 6, tieBreak: true, openScore: false, ventaja: true }, setReal: true,
    setsToWin: { min: 1, max: 3 }, gamesPerSet: { min: 4, max: 8 },
    ficha: {
      modalities: [
        { id: 'INDIVIDUAL', label: 'Individual' },
        { id: 'FIJAS', label: 'Dobles fijos' },
        { id: 'ROTAN', label: 'Dobles que rotan' },
      ],
      season: SEASON_DE_HOY, masters: false, fechaFormat: AUTO_FECHA, firstFecha: FIRST_FECHA_DE_HOY,
    },
  },
  FUTBOL_TENIS: {
    label: 'Fútbol tenis', unit: 'puntos', family: 'sets', allowsDraw: false, tournaments: true, tono: 'futboltenis', icono: 'futbolTenis',
    // Sin tie-break: se gana por 2 (16-14), como el ping pong.
    format: { setsToWin: 1, gamesPerSet: 15, tieBreak: false, openScore: false }, setReal: false,
    setsToWin: { min: 1, max: 3 }, gamesPerSet: { min: 11, max: 21 },
    ficha: {
      modalities: [
        { id: 'INDIVIDUAL', label: 'Individual' },
        { id: 'FIJAS', label: 'Parejas fijas' },
        { id: 'ROTAN', label: 'Parejas que rotan' },
      ],
      season: SEASON_DE_HOY, masters: false, fechaFormat: AUTO_FECHA, firstFecha: FIRST_FECHA_DE_HOY,
    },
  },
  POOL: {
    label: 'Pool', unit: 'bolas', family: 'sets', allowsDraw: false, tournaments: true, tono: 'pool', icono: 'pool',
    format: { setsToWin: 1, gamesPerSet: 3, tieBreak: true, openScore: false }, setReal: false,
    setsToWin: { min: 1, max: 3 }, gamesPerSet: { min: 1, max: 9 },
    ficha: {
      modalities: [
        { id: 'INDIVIDUAL', label: 'Individual' },
        { id: 'FIJAS', label: 'Parejas fijas' },
        { id: 'ROTAN', label: 'Parejas que rotan' },
      ],
      season: SEASON_DE_HOY, masters: false, fechaFormat: AUTO_FECHA, firstFecha: FIRST_FECHA_DE_HOY,
    },
  },
  BEER_PONG: {
    label: 'Beer pong', unit: 'vasos', family: 'sets', allowsDraw: false, tournaments: true, tono: 'beerpong', icono: 'vaso',
    format: { setsToWin: 1, gamesPerSet: 10, tieBreak: true, openScore: false }, setReal: false,
    setsToWin: { min: 1, max: 3 }, gamesPerSet: { min: 6, max: 10 },
    ficha: {
      modalities: [
        { id: 'FIJAS', label: 'Parejas fijas' },
        { id: 'ROTAN', label: 'Parejas que rotan' },
        { id: 'INDIVIDUAL', label: 'Individual' },
      ],
      season: SEASON_DE_HOY, masters: false, fechaFormat: AUTO_FECHA, firstFecha: FIRST_FECHA_DE_HOY,
    },
  },
  AJEDREZ: {
    label: 'Ajedrez', unit: 'partidas', family: 'result', allowsDraw: true, tournaments: true, tono: 'ajedrez', icono: 'peon',
    format: RESULT_FORMAT,
    // Sólo de a uno: una partida es uno contra uno. El ajedrez por equipos son varios tableros
    // a la vez, que es otra cosa que una pareja; y sin parejas no hay Masters (0053).
    ficha: {
      modalities: [{ id: 'INDIVIDUAL', label: 'Individual' }],
      season: SEASON_DE_HOY, masters: false, fechaFormat: AUTO_FECHA, firstFecha: FIRST_FECHA_DE_HOY,
    },
  },
  FUTBOL:  { label: 'Fútbol',  unit: 'goles',  family: 'goals', allowsDraw: true,  teams: false, tournaments: false, ficha: null, tono: 'futbol', icono: 'futbol' },
  BASQUET: { label: 'Básquet', unit: 'puntos', family: 'goals', allowsDraw: false, teams: false, tournaments: false, ficha: null, tono: 'basquet', icono: 'basquet' },
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
export const TOURNAMENT_SPORTS = [
  'PADEL', 'PING_PONG', 'FIFA', 'TENIS', 'FUTBOL_TENIS', 'POOL', 'BEER_PONG', 'AJEDREZ',
] as const satisfies readonly SportId[]
export type TournamentSport = (typeof TOURNAMENT_SPORTS)[number]

export function isTournamentSport(raw: string): raw is TournamentSport {
  return isSportId(raw) && (TOURNAMENT_SPORTS as readonly string[]).includes(raw)
}

/**
 * `null` si el formato de partido entra en la ficha. Los de goles y los marcadores abiertos no tienen
 * perillas (y hay tests que crean FIFA con la config de pádel). Los de resultado tienen UN formato,
 * `RESULT_FORMAT`, y la marca `resultado` sólo vale ahí.
 */
export function sportFormatError(
  kind: string,
  format: Pick<MatchFormat, 'setsToWin' | 'gamesPerSet' | 'openScore' | 'resultado'>,
): string | null {
  if (!isSportId(kind)) return 'Elegí un deporte de la lista.'
  const sport: Sport = SPORTS[kind]
  if (sport.family === 'result') {
    const esPartida =
      format.resultado === true && !format.openScore && format.setsToWin === 1 && format.gamesPerSet === 1
    return esPartida ? null : `El ${sport.label.toLowerCase()} se carga con gana, pierde o tablas: no tiene sets que cambiar.`
  }
  if (format.resultado === true) return 'Este deporte no se carga con gana, pierde o tablas.'
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
