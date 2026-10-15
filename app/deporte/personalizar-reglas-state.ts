import {
  KNOCKOUT_GROUP_COUNTS,
  MASTERS_SIZE,
  desempateLine,
  isSportId,
  matchCountForFormat,
  maxMatchesOf,
  resolveFormato,
  sideWords,
  sportOf,
  type DisciplineSeed,
  type MatchFormat,
  type MatchdayFormatSetting,
  type SeasonConfig,
  type SetsSport,
  type SideSize,
} from '@/core'
import { matchdayFormatLabel } from '@/app/format'
import { formatErrors } from '@/app/torneos/nuevo/wizard-state'

/** Lo que la hoja "Personalizar reglas" edita de un deporte: lo que Ajustes ya guarda por disciplina. */
export interface DisciplineRules {
  config: SeasonConfig
  hasMasters: boolean
  formatoDefault: MatchdayFormatSetting
}

export function rulesFromSeed(seed: DisciplineSeed): DisciplineRules {
  return { config: seed.config, hasMasters: seed.hasMasters, formatoDefault: seed.formatoDefault }
}

/** Los tres botones de "Cómo se arma". Los grupos (2 o 4) se eligen en un segundo renglón. */
export type FormatoChoice = 'AUTO' | 'ROUND_ROBIN' | 'GROUPS_KNOCKOUT'

export function formatoChoice(setting: MatchdayFormatSetting): FormatoChoice {
  return setting.kind
}

/** Cuántos grupos se pueden elegir: los que sabe armar la llave, menos 1 (un grupo + llave nunca ahorra nada, decisión #4014). */
export const GROUP_COUNTS = KNOCKOUT_GROUP_COUNTS.filter((groups) => groups !== 1)

export function withGroups(rules: DisciplineRules, groups: number): DisciplineRules {
  return { ...rules, formatoDefault: { kind: 'GROUPS_KNOCKOUT', groups, qualifiersPerGroup: 2 } }
}

/** Tocar la elección vigente no cambia nada: con 4 grupos puestos, "Grupos + llave" no los vuelve a 2. */
export function withFormatoChoice(rules: DisciplineRules, choice: FormatoChoice): DisciplineRules {
  if (formatoChoice(rules.formatoDefault) === choice) return rules
  return choice === 'GROUPS_KNOCKOUT' ? withGroups(rules, 2) : { ...rules, formatoDefault: { kind: choice } }
}

/** El deporte si se juega a sets (con rangos para tocar); `null` para goles o un deporte fuera del registro. */
export function setsSportOf(kind: string): SetsSport | null {
  if (!isSportId(kind)) return null
  const sport = sportOf(kind)
  return sport.family === 'sets' ? sport : null
}

export interface RulesHints {
  setsToWin: string
  gamesPerSet: string
  formato: string
  points: string
  maxMatches: string
  regularMatchdays: string
  countBestOf: string
  masters: string
  tiebreak: string
}

/** Las dos ayudas del partido: las usa también el armado (`BloquePartido`), que no tiene una `DisciplineRules`. */
export function partidoHints(kind: string, format: MatchFormat): Pick<RulesHints, 'setsToWin' | 'gamesPerSet'> {
  const frase = (sets: number) => (sets === 1 ? 'un solo set' : `al mejor de ${2 * sets - 1}`)
  const { setsToWin, gamesPerSet } = format
  const max = setsSportOf(kind)?.setsToWin.max ?? setsToWin
  const next = setsToWin + 1 <= max ? ` ${setsToWin + 1} = ${frase(setsToWin + 1)}.` : ''
  return {
    setsToWin: `${setsToWin} = ${frase(setsToWin)}.${next}`,
    gamesPerSet: format.tieBreak
      ? `Con tie-break: el set termina en ${gamesPerSet} justo.`
      : `Se gana por 2: ${gamesPerSet}-${gamesPerSet - 2}, ${gamesPerSet + 1}-${gamesPerSet - 1}…`,
  }
}

/** La consecuencia de cada número, escrita al lado de su stepper. */
export function rulesHints(kind: string, rules: DisciplineRules, pairSize: SideSize): RulesHints {
  const { config, hasMasters, formatoDefault } = rules
  const worstDropped = config.regularMatchdays - config.countBestOf
  const countBestOf =
    worstDropped <= 0
      ? 'Cuentan todas: faltar resta.'
      : worstDropped === 1
        ? 'La peor se descarta: podés faltar 1 vez.'
        : `Las ${worstDropped} peores se descartan: podés faltar ${worstDropped} veces.`
  const regularMatchdays = hasMasters
    ? 'Sin contar el Masters.'
    : pairSize === 1
      ? 'Sin Masters: en individual no hay.'
      : 'Sin Masters.'
  return {
    ...partidoHints(kind, config.matchFormat),
    formato: formatoHint(config, formatoDefault, pairSize),
    points: `Cuántos suma cada puesto de la fecha. Hay un puesto por ${sideWords(pairSize).one}.`,
    maxMatches:
      pairSize === 1
        ? 'De a uno cada presente es su propio lado, así que los partidos crecen rápido: con 12 son 66 todos contra todos.'
        : 'El máximo que entra en una tarde. Con 12 jugadores, todos contra todos son 15.',
    regularMatchdays,
    countBestOf,
    masters: `Los ${MASTERS_SIZE} mejores juegan una fecha extra que define el campeón.`,
    tiebreak: desempateLine(config.tiebreakSnapshotEvery),
  }
}

/** Con AUTO dice lo que haría hoy con el plantel completo: el mismo cálculo que resuelve la fecha al confirmar. */
function formatoHint(config: SeasonConfig, setting: MatchdayFormatSetting, pairSize: SideSize): string {
  const formato = resolveFormato(setting, config.squadSize, pairSize, maxMatchesOf(config, pairSize))
  const matches = matchCountForFormat(formato, Math.floor(config.squadSize / pairSize))
  const count = matches === 1 ? '1 partido' : `${matches} partidos`
  return `Con ${config.squadSize} jugadores: ${matchdayFormatLabel(formato).toLowerCase()} (${count}). Se puede cambiar al armar cada fecha.`
}

/** Los errores del wizard (puntos y "cuentan más de las que se juegan"): una sola lista para los dos lugares. */
export function rulesErrors(rules: DisciplineRules, pairSize: SideSize): string[] {
  return formatErrors(rules.config, pairSize)
}
