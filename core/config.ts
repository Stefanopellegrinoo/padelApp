import { MAX_PLAYERS, MIN_PLAYERS } from './constants'
import type { SeasonConfig } from './types'

/**
 * Points for a full squad, longest first. A matchday with fewer pairs uses
 * the leading values, so winning always pays ten.
 */
const DEFAULT_POINTS: Record<number, number[]> = {
  4: [10, 6, 3, 1],
  5: [10, 7, 5, 3, 1],
  6: [10, 7, 5, 3, 2, 1],
}

export function defaultConfig(squadSize: number): SeasonConfig {
  const pairCount = squadSize / 2
  return {
    squadSize,
    matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true },
    points: DEFAULT_POINTS[pairCount] ?? [],
    regularMatchdays: 10,
    countBestOf: 8,
    tiebreakSnapshotEvery: 3,
  }
}

export function validateConfig(config: SeasonConfig): string[] {
  const errors: string[] = []
  const { squadSize, matchFormat, points, regularMatchdays, countBestOf, tiebreakSnapshotEvery } =
    config

  if (squadSize % 2 !== 0) {
    errors.push('El plantel tiene que ser un número par.')
  }
  if (squadSize < MIN_PLAYERS) {
    errors.push(`El plantel tiene que ser de ${MIN_PLAYERS} jugadores o más.`)
  }
  if (squadSize > MAX_PLAYERS) {
    errors.push(`El plantel no puede pasar de ${MAX_PLAYERS} jugadores.`)
  }

  const expectedPoints = Math.floor(squadSize / 2)
  if (points.length !== expectedPoints) {
    errors.push(
      `Con un plantel de ${squadSize} hacen falta ${expectedPoints} valores de puntos, no ${points.length}.`,
    )
  }
  // El 0 vale. La versión anterior lo prohibía con este argumento: "si salir
  // último diera 0, sería lo mismo que faltar". Es cierto —con `countBestOf`,
  // una fecha jugada que pagó 0 puntúa igual que una a la que no fuiste— pero es
  // una decisión del torneo, no una regla del formato, y hay grupos que quieren
  // exactamente eso: que el último no sume. Lo que sigue prohibido es el
  // negativo, que no significa nada, y repetir un valor, que lo frena
  // `isStrictlyDescending` de abajo.
  if (points.some((value) => value < 0)) {
    errors.push('Los puntos no pueden ser negativos.')
  }
  if (!isStrictlyDescending(points)) {
    errors.push('Los puntos tienen que ir de mayor a menor, sin repetir.')
  }

  if (matchFormat.setsToWin < 1) {
    errors.push(
      'Los sets para ganar un partido tienen que ser al menos 1: con 0, ningún partido podría terminar.',
    )
  }
  if (matchFormat.gamesPerSet < 1) {
    errors.push(
      'Los games por set tienen que ser al menos 1: con 0, la página de reglas describiría un set que no existe.',
    )
  }

  if (regularMatchdays < 1) {
    errors.push('El torneo tiene que tener al menos 1 fecha.')
  }
  if (countBestOf > regularMatchdays) {
    errors.push(`No pueden contar ${countBestOf} fechas si el torneo tiene ${regularMatchdays}.`)
  }
  if (countBestOf < 1) {
    errors.push('Tiene que contar al menos 1 fecha por jugador.')
  }
  if (tiebreakSnapshotEvery < 1) {
    errors.push('El orden de desempate se tiene que refrescar cada 1 fecha o más.')
  }

  return errors
}

function isStrictlyDescending(values: number[]): boolean {
  for (let i = 1; i < values.length; i++) {
    const previous = values[i - 1]
    const current = values[i]
    if (previous === undefined || current === undefined) return false
    if (current >= previous) return false
  }
  return true
}
