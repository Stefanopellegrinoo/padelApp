/**
 * El reglamento de UNA disciplina, en criollo (docs/torneos-deportes.md §6).
 *
 * Una sola función para las tres pantallas que lo cuentan —el paso 4 del
 * wizard, el "Así queda" de "Personalizar reglas" y la página Reglas—: así
 * nunca dicen cosas distintas. Todo sale de la config y de las palabras de la
 * ficha; nada se pregunta por el nombre del deporte.
 *
 * Puro y sin `app/`: los nombres del formato de la fecha se escriben acá en vez
 * de reusar `matchdayFormatLabel` (`app/format.ts`).
 */
import { MASTERS_SIZE } from './constants'
import { modalityLabel, modalityOf, unitOf } from './sports'
import type { MatchdayFormatSetting, SeasonConfig, SideSize } from './types'

export interface ReglamentoInput {
  kind: string
  pairSize: SideSize
  fixedTeams: boolean
  hasMasters: boolean
  allowsDraw: boolean
  formatoDefault: MatchdayFormatSetting
  config: SeasonConfig
}
export type ReglamentoKey = 'modalidad' | 'partido' | 'fecha' | 'puntos' | 'temporada' | 'desempate' | 'masters'
export interface ReglamentoLine {
  key: ReglamentoKey
  text: string
}

/** El reglamento de UNA disciplina. Las líneas van siempre en este orden; `masters` sólo con `hasMasters`. */
export function reglamento(input: ReglamentoInput): ReglamentoLine[] {
  const { config } = input
  const lines: ReglamentoLine[] = [
    { key: 'modalidad', text: modalidadText(input) },
    { key: 'partido', text: partidoText(input) },
    { key: 'fecha', text: fechaText(input.formatoDefault) },
    { key: 'puntos', text: puntosText(config.points) },
    { key: 'temporada', text: temporadaText(config) },
    { key: 'desempate', text: desempateLine(config.tiebreakSnapshotEvery) },
  ]
  if (input.hasMasters) lines.push({ key: 'masters', text: `Masters al final con los ${MASTERS_SIZE} mejores.` })
  return lines
}

/** La frase de desempate, compartida con la ayuda del stepper "Desempate" de la hoja. */
export function desempateLine(every: number): string {
  const when = every === 1 ? 'la fecha anterior' : `hace ${every} fechas`
  return `Si empatan en puntos, gana el que iba mejor ${when}.`
}

/** La ficha en una línea, para la tarjeta del paso 3: "1 set a 4 games · 10 fechas · cuentan las 8 mejores · Masters al final". */
export function fichaLine(input: ReglamentoInput): string {
  const { config, kind } = input
  const format = config.matchFormat
  const sets = format.setsToWin === 1 ? '1 set' : `Mejor de ${2 * format.setsToWin - 1} sets`
  const parts = [
    format.openScore ? 'A goles' : `${sets} a ${format.gamesPerSet} ${unitOf(kind, format)}`,
    fechasText(config.regularMatchdays),
    config.regularMatchdays === 1 ? null : cuentanText(config),
    input.hasMasters ? 'Masters al final' : null,
  ]
  return parts.filter((part) => part !== null).join(' · ')
}

function modalidadText({ kind, pairSize, fixedTeams, config }: ReglamentoInput): string {
  const label = `${modalityLabel(kind, modalityOf(pairSize, fixedTeams))}.`
  // Sin `firstFecha` (torneo anterior a la ficha) no se inventa cómo se armó la primera fecha.
  if (config.firstFecha === undefined) return label
  const how = config.firstFecha === 'NIVEL' ? 'por nivel' : 'al azar'
  return `${label} La primera fecha se arma ${how}; después, por la tabla.`
}

function partidoText({ kind, allowsDraw, config }: ReglamentoInput): string {
  const format = config.matchFormat
  if (format.openScore) {
    return allowsDraw ? 'Partidos a goles; se puede empatar.' : 'Partidos a goles, siempre con un ganador.'
  }
  const sets = format.setsToWin === 1 ? 'a 1 set' : `al mejor de ${2 * format.setsToWin - 1} sets`
  const byTwo = format.tieBreak ? '' : ', se gana por 2'
  return `Partidos ${sets} de ${format.gamesPerSet} ${unitOf(kind, format)}${byTwo}.`
}

function fechaText(formato: MatchdayFormatSetting): string {
  if (formato.kind === 'AUTO') return 'Cada fecha se arma sola, según cuántos vengan.'
  if (formato.kind === 'ROUND_ROBIN') return 'Cada fecha, todos contra todos.'
  return `Cada fecha, ${formato.groups} grupos + llave.`
}

const ORDINALS = ['primero', 'segundo', 'tercero', 'cuarto', 'quinto', 'sexto', 'séptimo', 'octavo', 'noveno', 'décimo']
/** Del índice 0 del primer puesto; pasado el décimo, "11°". */
const ordinalOf = (index: number): string => ORDINALS[index] ?? `${index + 1}°`

function puntosText(points: number[]): string {
  const firstZero = points.findIndex((value) => value <= 0)
  const paying = firstZero === -1 ? points.length : firstZero
  const winners = points.slice(1, paying).map((value, i) => `, ${ordinalOf(i + 1)} ${value}`)
  const tail = firstZero === -1 ? '' : `; del ${ordinalOf(firstZero)} para abajo no suman`
  return `Gana ${points[0] ?? 0}${winners.join('')}${tail}.`
}

const fechasText = (count: number): string => (count === 1 ? '1 fecha' : `${count} fechas`)
const cuentanText = ({ regularMatchdays, countBestOf }: SeasonConfig): string =>
  countBestOf === regularMatchdays ? 'cuentan todas' : `cuentan las ${countBestOf} mejores`

function temporadaText(config: SeasonConfig): string {
  if (config.regularMatchdays === 1) return '1 fecha.'
  return `${fechasText(config.regularMatchdays)}, ${cuentanText(config)}.`
}
