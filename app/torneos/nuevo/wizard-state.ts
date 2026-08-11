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
 * El asiento del que arma el torneo, mientras el wizard lo mueve de lugar.
 *
 * El plantel es un `string[]` sin identidad: el asiento propio se sigue por
 * índice, y cualquier cosa que corra la lista lo tiene que correr también. Por
 * eso las tres operaciones que la tocan viven acá y devuelven las dos cosas
 * juntas — separarlas es exactamente cómo se pierde de vista cuál era el tuyo.
 *
 * `mySeat` es un índice, NO un nombre: si te renombrás el asiento seguís siendo
 * vos. En el grupo te dicen "Colo", no "Rodrigo", y ése es el nombre que tiene
 * que ver el resto.
 */
export interface Squad {
  names: string[]
  mySeat: number | null
}

/** Saca la fila `index`. Si era la propia, el organizador queda afuera del plantel. */
export function removeSeatAt({ names, mySeat }: Squad, index: number): Squad {
  return {
    names: names.filter((_, at) => at !== index),
    mySeat: mySeat === null || mySeat === index ? null : mySeat > index ? mySeat - 1 : mySeat,
  }
}

/**
 * Vuelve a meter al organizador en el plantel, al final, exactamente como
 * "+ Agregar jugador".
 *
 * Agrega una fila y no reusa un casillero vacío. La versión que los reusaba
 * perdía una fila en la ida y vuelta —sacarse ya achica la lista, así que
 * volver reusando un vacío deja el plantel un lugar más corto que al empezar—
 * y quedaba en un plantel de siete que el aviso reclamaba sin explicar por qué.
 *
 * Que caiga último y no primero es correcto: el orden es el desempate inicial,
 * y el paso 3 existe para acomodarlo.
 */
export function addMySeat({ names }: Squad, myName: string): Squad {
  return { names: [...names, myName], mySeat: names.length }
}

/** Sube o baja una fila del orden inicial, arrastrando el asiento propio si es una de las dos. */
export function moveSeat({ names, mySeat }: Squad, from: number, to: number): Squad {
  if (to < 0 || to >= names.length) return { names, mySeat }
  const next = [...names]
  next[from] = names[to]!
  next[to] = names[from]!
  return { names: next, mySeat: mySeat === from ? to : mySeat === to ? from : mySeat }
}

/**
 * Lo que se manda a crear: los nombres cargados, y en qué posición de ESA lista
 * quedó el asiento propio.
 *
 * El índice se recalcula contra la lista filtrada y no se manda el del wizard:
 * los casilleros vacíos de arriba lo corren, y mandar el crudo ataría al
 * organizador al asiento de otro. Un asiento sin nombre no es un asiento, así
 * que si la fila propia quedó en blanco el organizador no juega.
 */
export function submitSeats({ names, mySeat }: Squad): {
  squadNames: string[]
  mySeatIndex: number | null
} {
  const filled = names
    .map((name, at) => ({ name: name.trim(), at }))
    .filter((seat) => seat.name.length > 0)
  const index = mySeat === null ? -1 : filled.findIndex((seat) => seat.at === mySeat)
  return {
    squadNames: filled.map((seat) => seat.name),
    mySeatIndex: index < 0 ? null : index,
  }
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
