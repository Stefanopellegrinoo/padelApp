import { minSquadFor } from './constants'
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
 * Indexada por CANTIDAD DE LADOS, no de jugadores: `sideCount = 6` son 6
 * jugadores de a uno o 12 en pareja, `sideCount = 12` son 12 de a uno o 24 en
 * pareja — la clave es el número de LADOS, así que dos plantillas bien
 * distintas de jugadores pueden compartir la misma curva.
 *
 * Sin techo de plantel, `sideCount` ya pasa de 12 (antes, imposible). Las
 * claves 2-6 y 8-12 tienen una curva puesta a mano; `sideCount = 7` y
 * cualquiera arriba de 12 caen fuera de esta tabla, y `defaultConfig` los
 * resuelve con `onlyTopSix(sideCount)` — la MISMA fórmula mecánica que ya
 * usan 8-12, no un plantel sin curva. `defaultConfig` nunca devuelve
 * `points: []`: fuera de la tabla, calcula.
 */
const DEFAULT_POINTS: Record<number, number[]> = {
  // Cabeza de la curva de 4 puesta a dedo, no una regla: `minSquadFor`
  // (docs/tipos-de-torneo.md §3.3) hace alcanzables 2 y 3 lados por primera
  // vez, y sin semilla acá `defaultConfig` devolvía `points: []` y
  // `pointsCountError` lo rechazaba. El creador la edita puesto por puesto en
  // el wizard (app/torneos/nuevo/wizard.tsx:311-325) y después en ajustes
  // (app/torneo/[id]/ajustes/formato.tsx:103-113) — lo único que tiene que
  // respetar la semilla es `pointsErrors`, más abajo.
  2: [10, 6],
  3: [10, 6, 3],
  4: [10, 6, 3, 1],
  5: [10, 7, 5, 3, 1],
  6: PAYING_SIDES,
  // Lados de a uno: un plantel impar es válido cuando cada presente es su
  // propio lado (REQ-D5-2). 7 no tiene entrada acá — quedó afuera cuando el
  // plantel de FIFA iba de 8 a 12 (los dos números que
  // docs/plan-piso-y-techo-del-plantel.md Task 3 borró) y nunca se completó.
  // Ya no importa: `defaultConfig` calcula `onlyTopSix(7)` al vuelo con el
  // mismo resultado que si estuviera acá a mano (fix round 1, Task 3).
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
 * (S80, verify-report-pr21 #4004): este bloque decía *"Lo que SIGUE sin
 * existir es el camino de PANTALLA: ningún caller de hoy pasa `sideSize =
 * 1`"*. Falso desde las Rebanadas E/F: `configFor` (`app/torneos/nuevo/
 * wizard-state.ts`, caller de `wizard.tsx`) y `newDisciplineSpec` (misma
 * `wizard-state.ts`, caller de `app/torneo/[id]/ajustes/actions.ts`) le pasan
 * `sideSize = 1` a esta función cuando el admin elige "Individual" — los dos
 * caminos de creación de disciplina. Corregido acá, mismo criterio que N48 y
 * la corrección de arriba: la frase falsa vive en el código y ahí se arregla.
 */
export function defaultConfig(squadSize: number, sideSize: SideSize = 2): SeasonConfig {
  const sideCount = squadSize / sideSize
  return {
    squadSize,
    matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true, openScore: false },
    points: DEFAULT_POINTS[sideCount] ?? onlyTopSix(sideCount),
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
 * "¿Esta lista de puntos tiene la cantidad que corresponde?", o `null`.
 *
 * Un lado por cada `sideSize` jugadores, así que un plantel de 10 son 5 lados
 * de a dos y 10 de a uno. Dividía siempre por 2 hasta W30, y eso le pedía a un
 * 1v1 la MITAD de los valores que necesita.
 *
 * Extraída de `validateConfig` (W88/W90): el paso 4 del wizard necesita hacer
 * la MISMA pregunta —su curva es compartida y su `sideSize` efectivo cambia
 * cuando se marcan o desmarcan disciplinas— y escribirla dos veces es
 * exactamente cómo empezó la familia W69 → W76 → W83: la pantalla y la base
 * diciendo cosas distintas sobre la misma curva. Con una sola implementación,
 * el aviso del wizard no puede divergir del que rechaza el submit.
 */
export function pointsCountError(squadSize: number, sideSize: SideSize, count: number): string | null {
  const expected = Math.floor(squadSize / sideSize)
  return count === expected
    ? null
    : `Con un plantel de ${squadSize} hacen falta ${expected} valores de puntos, no ${count}.`
}

export function validateConfig(config: SeasonConfig, sideSize: SideSize): string[] {
  const errors: string[] = []
  const { squadSize, matchFormat, points, regularMatchdays, countBestOf, tiebreakSnapshotEvery } =
    config

  if (sideSize === 2 && squadSize % 2 !== 0) {
    errors.push('El plantel tiene que ser un número par.')
  }
  // El piso ya no es un plano de 8: es `minSquadFor(sideSize)`, la gente que
  // hace falta para que exista UN partido de esta disciplina — 2 con lados de
  // a uno, 4 en pareja (docs/tipos-de-torneo.md §3.3).
  const minSquad = minSquadFor(sideSize)
  if (squadSize < minSquad) {
    errors.push(`El plantel tiene que ser de ${minSquad} jugadores o más.`)
  }
  // Sin techo acá a propósito (docs/plan-piso-y-techo-del-plantel.md Task 3):
  // el plano de 12 no cuidaba nada que otra cosa no cuide mejor — la duración
  // de la fecha es partidos, no cabezas, y la resuelve `maxMatchesOf` abajo.

  // El techo de partidos entra por un formulario, así que se valida acá como
  // cualquier otro número del config. La clave es OPCIONAL —sin ella rige
  // `defaultMaxMatches(sideSize)`— pero si viene, tiene que servir para algo:
  // un techo de 0 o negativo deja la disciplina sin ningún formato que lo
  // cumpla, y `offerableFormats` cae siempre a su salida del más barato.
  //
  // No se le pide que alcance para el plantel de HOY a propósito: la
  // asistencia cambia fecha a fecha y un techo que hoy no entra puede entrar
  // la que viene con dos ausentes. Rechazarlo acá sería atar una regla de
  // TORNEO a un dato de UNA fecha.
  if (config.maxMatches !== undefined) {
    if (!Number.isInteger(config.maxMatches)) {
      errors.push('El máximo de partidos por fecha tiene que ser un número entero.')
    } else if (config.maxMatches < 1) {
      errors.push('El máximo de partidos por fecha tiene que ser 1 o más.')
    }
  }

  const countError = pointsCountError(squadSize, sideSize, points.length)
  if (countError !== null) errors.push(countError)
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
  // ponytail: el techo es que una disciplina abierta puede guardar
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
