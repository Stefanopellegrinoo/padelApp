import { MAX_PLAYERS, MIN_PLAYERS } from './constants'
import type { SeasonConfig, SideSize } from './types'

/**
 * Points for a full squad, longest first. A matchday with fewer pairs uses
 * the leading values, so winning always pays ten.
 */
const DEFAULT_POINTS: Record<number, number[]> = {
  4: [10, 6, 3, 1],
  5: [10, 7, 5, 3, 1],
  6: [10, 7, 5, 3, 2, 1],
}

/**
 * `sideSize` default 2 (el pádel de siempre — ningún caller de hoy pasa 1):
 * la tabla de puntos por default está indexada por CANTIDAD DE LADOS, no
 * siempre `squadSize / 2` (C16, verify-report ronda 9). `DEFAULT_POINTS` no
 * tiene entradas para lados de a uno todavía (PUNTO 3 del design, deuda
 * separada) — con `sideSize=1` esto devuelve `points: []` honestamente, no
 * la tabla de parejas por casualidad.
 */
export function defaultConfig(squadSize: number, sideSize: SideSize = 2): SeasonConfig {
  const sideCount = squadSize / sideSize
  return {
    squadSize,
    matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true },
    points: DEFAULT_POINTS[sideCount] ?? [],
    regularMatchdays: 10,
    countBestOf: 8,
    tiebreakSnapshotEvery: 3,
  }
}

/**
 * `sideSize` condiciona la paridad (W24, REQ-D2-2/REQ-D5-2): un plantel impar
 * sólo es un problema cuando un lado necesita DOS. Con `sideSize=1` cada
 * presente es su propio lado — la regla no se relaja, es INAPLICABLE.
 *
 * El piso/techo (`MIN_PLAYERS`/`MAX_PLAYERS`) sigue sin condicionar por
 * `sideSize` — es cantidad, no paridad, y REQ-D2-2 no lo toca directamente.
 * Pero el TECHO mide partidos, no jugadores (W32, verify-report ronda 9): su
 * unidad cambia con `sideSize` (12 jugadores son 15 partidos en parejas y 66
 * de a uno), así que dejarlo sin condicionar es DEUDA, no una corrección —
 * PUNTO 3 del design (`DisciplineConfig.maxPlayers`) todavía no tiene
 * decisión de producto ni migración. El PISO sí sobrevive sin ajuste: 8
 * personas son 8 competidores válidos también en sideSize=1.
 */
export function validateConfig(config: SeasonConfig, sideSize: SideSize): string[] {
  const errors: string[] = []
  const { squadSize, matchFormat, points, regularMatchdays, countBestOf, tiebreakSnapshotEvery } =
    config

  if (sideSize === 2 && squadSize % 2 !== 0) {
    errors.push('El plantel tiene que ser un número par.')
  }
  if (squadSize < MIN_PLAYERS) {
    errors.push(`El plantel tiene que ser de ${MIN_PLAYERS} jugadores o más.`)
  }
  if (squadSize > MAX_PLAYERS) {
    errors.push(`El plantel no puede pasar de ${MAX_PLAYERS} jugadores.`)
  }

  // C16 (verify-report ronda 9): dividía siempre por 2, así que un 1v1
  // pedía la MITAD de los valores de puntos que en verdad necesita — un
  // plantel de 10 en sideSize=1 son 10 lados, no 5.
  const expectedPoints = Math.floor(squadSize / sideSize)
  if (points.length !== expectedPoints) {
    errors.push(
      `Con un plantel de ${squadSize} hacen falta ${expectedPoints} valores de puntos, no ${points.length}.`,
    )
  }
  errors.push(...pointsErrors(points))

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

/**
 * Las reglas de la lista de puntos, en UN solo lugar.
 *
 * Está exportada porque el paso 4 del wizard tenía su propia copia y se
 * separaron: cuando el 0 pasó a ser legal, la pantalla siguió rechazándolo y te
 * dejaba elegir un valor que después te trababa el "Continuar". Dos copias de
 * una regla son una regla y media.
 *
 * Las tres reglas:
 * - **Nada negativo.** Un puesto que resta no significa nada.
 * - **Ganar suma.** Con el primero en 0 la lista entera es 0 —es de mayor a
 *   menor y no hay negativos— y la temporada no podría producir una tabla.
 * - **De mayor a menor, y el 0 puede repetirse.** Repetir un valor que paga
 *   sería un empate declarado de antemano y lo decide el desempate, no la
 *   config. El 0 es otra cosa: es "de acá para abajo no se suma", que es como
 *   un grupo dice "sólo puntúan los primeros cuatro". Al no haber negativos,
 *   un 0 obliga a que todo lo que sigue también sea 0.
 */
export function pointsErrors(points: number[]): string[] {
  const errors: string[] = []

  if (points.some((value) => value < 0)) {
    errors.push('Los puntos no pueden ser negativos.')
  }
  if (points.length > 0 && points[0] === 0) {
    errors.push('Ganar tiene que sumar: el primer puesto no puede quedar en 0.')
  }
  if (!isDescendingWithZeroTail(points)) {
    errors.push('Los puntos tienen que ir de mayor a menor. El único que se puede repetir es el 0.')
  }
  return errors
}

function isDescendingWithZeroTail(values: number[]): boolean {
  for (let i = 1; i < values.length; i++) {
    const previous = values[i - 1]
    const current = values[i]
    if (previous === undefined || current === undefined) return false
    // Después de un 0 sólo puede venir otro 0; antes, cada valor baja de verdad.
    if (previous === 0 ? current !== 0 : current >= previous) return false
  }
  return true
}
