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
    mastersSize: 4,
    tiebreakSnapshotEvery: 3,
  }
}

export function validateConfig(config: SeasonConfig): string[] {
  const errors: string[] = []
  const { squadSize, points, regularMatchdays, countBestOf, tiebreakSnapshotEvery } = config

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
  if (points.some((value) => value <= 0)) {
    errors.push(
      'Todos los puntos tienen que ser mayores que 0: si salir último diera 0, sería lo mismo que faltar.',
    )
  }
  if (!isStrictlyDescending(points)) {
    errors.push('Los puntos tienen que ir de mayor a menor, sin repetir.')
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
