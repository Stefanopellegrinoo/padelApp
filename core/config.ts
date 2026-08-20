import { MAX_PLAYERS, MIN_PLAYERS } from './constants'
import type { SeasonConfig, SideSize } from './types'

/**
 * Los seis puestos que pagan. Es la tabla de un torneo de seis parejas, y
 * desde la decisión #3963 es TAMBIÉN la de cualquier disciplina de a uno:
 * ganar paga 10, salir 5° paga 2, y del 7° para abajo no suma nadie.
 */
const PAYING_SIDES = [10, 7, 5, 3, 2, 1]

/**
 * La misma curva estirada a `sides` puestos: los seis primeros pagan y el
 * resto va en 0.
 *
 * La cola de ceros no es un relleno: `isDescendingWithZeroTail` la admite a
 * propósito y ya la describía como *"de acá para abajo no se suma, que es como
 * un grupo dice 'sólo puntúan los primeros cuatro'"*.
 *
 * Es también lo único que la aritmética permite arriba de diez lados: entre 10
 * y 1 hay diez enteros, así que con 11 o 12 no existe tabla con el ganador en
 * 10, el último en 1 y todos distintos. Subir el techo del ganador cuando hay
 * más gente distorsionaría el campeonato —la asistencia cambia fecha a fecha y
 * el diseño mantiene "ganar paga 10" justamente por eso.
 */
function onlyTopSix(sides: number): number[] {
  return Array.from({ length: sides }, (_, index) => PAYING_SIDES[index] ?? 0)
}

/**
 * Points for a full squad, longest first. A matchday with fewer pairs uses
 * the leading values, so winning always pays ten.
 *
 * Indexada por CANTIDAD DE LADOS, no de jugadores: con parejas y
 * `MAX_PLAYERS = 12` nunca pasa de 6, y las claves 8-12 son alcanzables sólo
 * con `sideSize = 1`. Por eso agregarlas no puede mover al pádel.
 */
const DEFAULT_POINTS: Record<number, number[]> = {
  4: [10, 6, 3, 1],
  5: [10, 7, 5, 3, 1],
  6: PAYING_SIDES,
  // Lados de a uno: `MIN_PLAYERS` = 8 y `MAX_PLAYERS` = 12, y un plantel impar
  // es válido cuando cada presente es su propio lado (REQ-D5-2). 7 no aparece:
  // con parejas serían 14 jugadores, arriba del techo.
  8: onlyTopSix(8),
  9: onlyTopSix(9),
  10: onlyTopSix(10),
  11: onlyTopSix(11),
  12: onlyTopSix(12),
}

/**
 * `sideSize` default 2 (el pádel de siempre): la tabla de puntos por default
 * está indexada por CANTIDAD DE LADOS, no siempre `squadSize / 2`.
 *
 * (Este docblock decía que `DEFAULT_POINTS` "no tiene entradas para lados de a
 * uno todavía" y que con `sideSize=1` esto devuelve `points: []`. Dejó de ser
 * cierto con la decisión #3963: las claves 8-12 existen y son la curva de seis
 * puestos con ceros abajo. Corregido acá, mismo criterio que N48 — la frase
 * falsa vive en el código y ahí se arregla.)
 *
 * Lo que SIGUE sin existir es el camino de PANTALLA: ningún caller de hoy pasa
 * `sideSize = 1`. Son los otros dos bloqueos del 1v1, y van con PR21 a
 * propósito — abrir el camino antes de que existan los grupos dejaría crear
 * una fecha de 12 de a uno, que son 66 partidos contra 15 en parejas (W32,
 * decisión #3863).
 */
export function defaultConfig(squadSize: number, sideSize: SideSize = 2): SeasonConfig {
  const sideCount = squadSize / sideSize
  return {
    squadSize,
    matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true, openScore: false },
    points: DEFAULT_POINTS[sideCount] ?? [],
    regularMatchdays: 10,
    countBestOf: 8,
    tiebreakSnapshotEvery: 3,
  }
}

/**
 * Con qué FORMA de marcador y con qué regla de empate nace una disciplina de
 * este tipo. Devuelve la config a escribir y el `allows_draw` de la columna,
 * que son las dos mitades de "un partido de FIFA termina 3-1 o 0-0".
 *
 * Vive acá y no en cada pantalla por lo mismo que `pointsErrors`: los DOS
 * caminos que crean una disciplina —el wizard de `/torneos/nuevo` y el
 * "+ Agregar disciplina" de Ajustes— tienen que escribir lo mismo, y hasta
 * esta función los dos armaban su config con `defaultConfig`, que nace en
 * pádel. Una liga de FIFA nacía siendo pádel con otro nombre: sin marcador
 * abierto y sin empates, o sea sin poder cargar ni un `3-1` ni un `0-0`.
 *
 * Se DERIVA del `kind`, y ésa es la diferencia con `pair_size`: un lado de
 * FIFA puede ser de uno o de dos (decisión de producto #5, ver `SideSize`),
 * pero un partido de FIFA se cuenta en goles siempre. No hay FIFA por sets.
 *
 * El empate viaja aparte del marcador —son dos ejes ortogonales, D1— porque
 * la base los guarda en dos lugares distintos: `openScore` en el jsonb de la
 * config y `allows_draw` en su propia columna, que `match_sets_no_draw`
 * (0034) sigue exigiendo por su cuenta. Y `allows_draw` NO está en el grant
 * de UPDATE de `disciplines` (`0015_disciplines.sql:70`): se fija al crear y
 * ninguna pantalla lo puede corregir después, así que nacer mal es para
 * siempre.
 */
export function disciplineProfile(
  kind: 'PADEL' | 'FIFA',
  config: SeasonConfig,
): { config: SeasonConfig; allowsDraw: boolean } {
  const goals = kind === 'FIFA'
  return {
    // Los dos sentidos, no sólo el de encender: así el resultado depende del
    // `kind` y no de lo que traía la config que entró.
    config: { ...config, matchFormat: { ...config.matchFormat, openScore: goals } },
    allowsDraw: goals,
  }
}

/**
 *`sideSize` condiciona la paridad (W24, REQ-D2-2/REQ-D5-2): un plantel impar
 * sólo es un problema cuando un lado necesita DOS. Con `sideSize=1` cada
 * presente es su propio lado — la regla no se relaja, es INAPLICABLE.
 *
 * El piso/techo (`MIN_PLAYERS`/`MAX_PLAYERS`) sigue sin condicionar por
 *`sideSize` — es cantidad, no paridad, y REQ-D2-2 no lo toca directamente.
 *Pero el TECHO mide partidos, no jugadores: su
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

  //Dividía siempre por 2, así que un 1v1
  // pedía la MITAD de los valores de puntos que en verdad necesita — un
  // plantel de 10 en sideSize=1 son 10 lados, no 5.
  const expectedPoints = Math.floor(squadSize / sideSize)
  if (points.length !== expectedPoints) {
    errors.push(
      `Con un plantel de ${squadSize} hacen falta ${expectedPoints} valores de puntos, no ${points.length}.`,
    )
  }
  errors.push(...pointsErrors(points))

  // Con marcador abierto no hay set ni número objetivo, así que estos dos
  // números NO SE LEEN: `setError` ignora `gamesPerSet`/`tieBreak` y
  // `matchError` no exige `setsToWin` (ver `db/validate.ts`). Exigir que sean
  // válidos sería rechazar una config de FIFA por dos valores que nadie va a
  // mirar.
  //
  // Se IGNORAN, no se exigen ausentes: `MatchFormat` los declara obligatorios
  // (design #3801, `tipos`) y volverlos irrepresentables pediría una unión
  // discriminada, que obligaría a narrowing en los ~8 lectores de
  // `setsToWin`/`gamesPerSet` — la mayoría pantallas, fuera del alcance del
  // modelo.
  //
  // OJO con la lectura fácil: este `if` NO es lo que habilita el `0-0`. Lo que
  // hacía imposible un `0-0` era `setError` exigiendo `winner === gamesPerSet`,
  // y ESO se corta en `db/validate.ts`, no acá. Acá sólo se deja de pedir
  // coherencia a un número muerto.
  //
  //Nota: el techo es que una disciplina abierta puede guardar
  // `gamesPerSet: 0` y, si alguien apaga `openScore` después, queda con un
  // formato que no acepta ningún resultado. Hoy ninguna pantalla escribe
  // `openScore`, así que no hay camino para llegar ahí; el día que una lo
  // ofrezca, o valida el formato completo igual, o el cambio de `openScore`
  // pasa por su propia validación.
  if (!matchFormat.openScore) {
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
