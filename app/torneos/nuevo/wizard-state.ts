/**
 * La lógica del wizard, sin React.
 *
 * Vive aparte de `wizard.tsx` para poder testearla en la suite unitaria, sin
 * DOM y sin base. Es la única parte del paso a paso donde se puede equivocar
 * algo: el resto es dibujar.
 */
import { MAX_PLAYERS, MIN_PLAYERS, defaultConfig, type SeasonConfig } from '@/core'

/** Los rangos son medidas del handoff (§6 paso 4), no decisiones de este código. */
export interface Stepper {
  key: 'setsToWin' | 'gamesPerSet' | 'regularMatchdays' | 'countBestOf' | 'tiebreakSnapshotEvery'
  label: string
  hint: string
  min: number
  max: number
}

export const STEPPERS: Stepper[] = [
  {
    key: 'setsToWin',
    label: 'Sets por partido',
    hint: 'Con 1 set la fecha entra en una tarde.',
    min: 1,
    max: 3,
  },
  {
    key: 'gamesPerSet',
    label: 'Games por set',
    hint: 'A 4 games el resultado se carga en dos toques.',
    min: 3,
    max: 9,
  },
  {
    key: 'regularMatchdays',
    label: 'Fechas del año',
    hint: 'Sin contar el Masters, que va al final.',
    min: 4,
    max: 24,
  },
  {
    key: 'countBestOf',
    label: 'Cuentan las mejores',
    hint: 'Las peores se descartan, así se puede faltar sin quedar afuera.',
    min: 1,
    max: 24,
  },
  {
    key: 'tiebreakSnapshotEvery',
    label: 'Refresco del orden',
    hint: 'Cada cuántas fechas se actualiza el orden que corta los empates.',
    min: 1,
    max: 6,
  },
]

/** Cuántos nombres del plantel están cargados de verdad. */
export function filledCount(names: readonly string[]): number {
  return names.filter((name) => name.trim().length > 0).length
}

/**
 * El aviso del paso 2, o `null` si se puede continuar.
 *
 * El plantel se carga **par**: la app agrega un invitado cuando una FECHA da
 * impar, que es otra cosa.
 */
export function squadWarning(names: readonly string[]): string | null {
  const filled = filledCount(names)
  if (filled < MIN_PLAYERS) {
    const missing = MIN_PLAYERS - filled
    return missing === 1
      ? `Falta 1 nombre. El plantel arranca en ${MIN_PLAYERS}.`
      : `Faltan ${missing} nombres. El plantel arranca en ${MIN_PLAYERS}.`
  }
  if (filled > MAX_PLAYERS) {
    return `Son ${filled} y el plantel llega hasta ${MAX_PLAYERS}.`
  }
  if (filled % 2 !== 0) {
    return `Son ${filled}. El plantel tiene que ser par para poder armar parejas.`
  }
  return null
}

/**
 * La config por defecto para un plantel de este tamaño.
 *
 * Sale de `defaultConfig` y no de la lista del handoff (§6 paso 4, "Defaults
 * 10 · 7 · 5 · 3 · 2 · 1"). Los dos documentos no coinciden —el handoff también
 * dice 12 fechas y 9 que cuentan, y el spec §2.1 dice 10 y 8— y manda el que
 * está implementado, testeado, validado por `validateConfig` y usado por el
 * seed y por todos los tests contra la base. Un wizard que produjera otros
 * defaults haría que ninguna captura de pantalla coincida con ningún fixture.
 */
export function configFor(squadSize: number): SeasonConfig {
  return defaultConfig(squadSize)
}

/**
 * Rehace `points` cuando cambia el tamaño del plantel, **pisando** lo que el
 * admin hubiera tocado. No es una pérdida: con otro plantel hace falta otra
 * cantidad de valores, y una lista de 4 en un plantel de 12 es inválida.
 */
export function resizeConfig(config: SeasonConfig, squadSize: number): SeasonConfig {
  if (config.squadSize === squadSize) return config
  return { ...config, squadSize, points: configFor(squadSize).points }
}

/** Los errores del paso 4, con las frases del handoff. */
export function formatErrors(config: SeasonConfig): string[] {
  const errors: string[] = []

  const descending = config.points.every(
    (value, index) => index === 0 || value < (config.points[index - 1] ?? Infinity),
  )
  if (!descending || config.points.some((value) => value <= 0)) {
    errors.push('Los puntos tienen que ir de mayor a menor y ninguno puede quedar en cero.')
  }
  if (config.countBestOf > config.regularMatchdays) {
    errors.push('No pueden contar más fechas de las que se juegan.')
  }
  return errors
}

/** El resumen del paso 5, en el orden del handoff. */
export function summaryOf(
  name: string,
  names: readonly string[],
  config: SeasonConfig,
): Array<{ key: string; value: string }> {
  const setWord = config.matchFormat.setsToWin === 1 ? '1 set' : `${config.matchFormat.setsToWin} sets`
  return [
    { key: 'Nombre', value: name },
    { key: 'Jugadores', value: String(filledCount(names)) },
    { key: 'Formato', value: `${setWord} a ${config.matchFormat.gamesPerSet} games` },
    { key: 'Puntos', value: config.points.join(' · ') },
    { key: 'Fechas', value: String(config.regularMatchdays) },
    { key: 'Desempate', value: `cada ${config.tiebreakSnapshotEvery} fechas` },
  ]
}
