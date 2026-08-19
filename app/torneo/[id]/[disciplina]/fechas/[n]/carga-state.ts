import type { MatchFormat, SetScore } from '@/core'
import { matchError } from '@/db/validate'

/**
 * Cuántos dígitos entran en un lado del marcador abierto.
 *
 * Es un techo de DÍGITOS, no una regla del juego: `match_sets.games_a` es un
 * `int` de Postgres, y sin cortar en algún lado un campo numérico deja tipear
 * un número que revienta el insert con un error de la base en vez de con algo
 * legible. 999 goles es absurdo por varios órdenes de magnitud y ningún
 * resultado real queda afuera.
 */
export const MAX_GOAL_DIGITS = 3
const GOALS = /^\d{1,3}$/

/**
 * El marcador abierto: los dos números como quedaron, sin ganador que elegir y
 * sin tope. Devuelve el resultado a guardar, o `null` mientras lo tipeado no
 * sea todavía un par de enteros >= 0.
 *
 * Es la otra máquina de esta pantalla, no una variante de la de dos toques.
 * Aquella por construcción no puede producir ni un `3-1` —el ganador siempre se
 * lleva `format.gamesPerSet`— ni un empate: `chooseWinner` pide `'A' | 'B'`.
 * Con `openScore` las dos cosas son resultados normales, así que lo que hace
 * falta son dos entradas numéricas y nada más.
 *
 * NO opina sobre si el par es legal para la disciplina. Un `0-0` donde no se
 * admiten empates lo rechaza `matchError` del lado del servidor, que es donde
 * vive esa regla y donde `saveResult` la vuelve a correr igual. Una segunda
 * opinión acá serían dos verdades para sincronizar — la misma razón por la que
 * el paso 4 del wizard dejó de tener su propia copia de `pointsErrors`.
 */
export function openScoreSet(goalsA: string, goalsB: string): SetScore | null {
  const gamesA = parseGoals(goalsA)
  const gamesB = parseGoals(goalsB)
  if (gamesA === null || gamesB === null) return null
  return { gamesA, gamesB }
}

/**
 * Sólo dígitos: el `-`, el `.` y el vacío son "todavía no", no un cero. El
 * largo del `GOALS` de arriba y `MAX_GOAL_DIGITS` son el mismo número escrito
 * dos veces —el `maxLength` del campo sale del segundo— y por eso están
 * pegados: `\d{1,3}` no se puede interpolar sin construir el regex en cada
 * llamada, y eso es más raro de leer que estas dos líneas juntas.
 */
function parseGoals(text: string): number | null {
  const trimmed = text.trim()
  if (!GOALS.test(trimmed)) return null
  return Number(trimmed)
}

/**
 * La máquina de la carga en dos toques: quién ganó, y con cuántos games se
 * quedó el que perdió. El ganador siempre se lleva el set completo, así que el
 * segundo toque es el único número que hace falta y nunca aparece un teclado.
 *
 * Vive en su propio módulo y no adentro de `carga.tsx` por la misma razón que
 * `wizard-state.ts`: es la única lógica nueva de la tarea, y adentro de un
 * componente `'use client'` no se puede testear cómodamente.
 *
 * Acumula los sets en memoria y no escribe nada: `saveResult` REEMPLAZA los
 * sets de un partido, así que guardar de a un set borraría el anterior. Se
 * llama una sola vez, con el partido entero.
 */
export interface LoadState {
  sets: SetScore[]
  /** Quién ganó el set en curso, o `null` mientras se está preguntando. */
  pendingWinner: 'A' | 'B' | null
}

export function startLoad(): LoadState {
  return { sets: [], pendingWinner: null }
}

export function chooseWinner(state: LoadState, winner: 'A' | 'B'): LoadState {
  return { ...state, pendingWinner: winner }
}

/**
 * Cierra el set en curso. Sin ganador elegido no hace nada: no existe un set
 * con games del perdedor y nadie que haya ganado.
 *
 * Y un partido ya cerrado no crece. Esa guarda no es teórica: si el guardado
 * falla, el panel se queda con el partido completo en la mano, y dos toques más
 * apilaban un tercer set que `matchError` acepta —2-1 es legal a dos sets— y
 * que `saveResult` escribía encima del bueno, porque reemplaza.
 */
export function chooseLoserGames(
  state: LoadState,
  loserGames: number,
  format: MatchFormat,
): LoadState {
  if (state.pendingWinner === null) return state
  if (isComplete(state, format)) return state
  const won = format.gamesPerSet
  const set: SetScore =
    state.pendingWinner === 'A'
      ? { gamesA: won, gamesB: loserGames }
      : { gamesA: loserGames, gamesB: won }
  return { sets: [...state.sets, set], pendingWinner: null }
}

/**
 * Los botones del segundo toque, y son todos los resultados posibles: nada de
 * lo que salga de acá puede ser rechazado por `setError`.
 *
 * Con tie-break el set corta en `gamesPerSet` exacto, así que el perdedor puede
 * tener de 0 a `gamesPerSet - 1`. Sin tie-break hay que ganar por dos, y ese
 * último valor —el 4-3 de un set a 4— no cierra nada.
 */
export function loserGamesOptions(format: MatchFormat): number[] {
  const top = format.tieBreak ? format.gamesPerSet - 1 : format.gamesPerSet - 2
  return Array.from({ length: Math.max(0, top + 1) }, (_, index) => index)
}

/**
 * Si el partido ya se puede guardar. Es `matchError` y no una segunda opinión.
 *
 * `allowsDraw: false` fijo, y NO es un stub (W61, verify-report ronda 19): la
 * máquina de dos toques no puede PRODUCIR un empate. `chooseWinner` pide
 * `'A' | 'B'` y `chooseLoserGames` le da al ganador `format.gamesPerSet` y al
 * perdedor un número de `loserGamesOptions`, que va de 0 a `gamesPerSet - 1`.
 * Ningún camino de este módulo genera `gamesA === gamesB`, así que pasarle
 * `true` no cambiaría un solo resultado — sólo escondería que esta máquina no
 * sabe cargar un empate.
 *
 * Y eso sigue siendo cierto: la disciplina con empates que llegó (PR20 rebanada
 * D2) NO usa esta función. Con `openScore` la pantalla dibuja `openScoreSet` —
 * dos números tipeados— y ni siquiera monta la máquina de dos toques, así que
 * `isComplete` sólo ve partidos de pádel. Cuando una disciplina de SETS admita
 * empates, la que cambia es la máquina (un tercer botón "empataron"), no este
 * `false`.
 */
export function isComplete(state: LoadState, format: MatchFormat): boolean {
  return matchError(state.sets, format, false) === null
}
