/**
 * Derivaciones puras de la pantalla "Jugar": agrupar los partidos por ronda,
 * armar el nombre de un lado, y las dos reglas de la carga en dos toques.
 * Nada de esto toca React ni el DOM — por eso vive acá y no en jugar.tsx,
 * donde ningún test lo alcanzaría.
 */
import { DEPORTE_OBJETIVO, type Deporte, type Partido } from './rapido-state'

export interface GrupoRonda {
  ronda: number
  items: Array<{ indice: number; partido: Partido }>
}

/** Agrupa conservando el índice original de cada partido: `cargarMarcador` lo necesita para saber cuál tocar. */
export function agruparPorRonda(partidos: readonly Partido[]): GrupoRonda[] {
  const grupos = new Map<number, GrupoRonda['items']>()
  partidos.forEach((partido, indice) => {
    const items = grupos.get(partido.ronda) ?? []
    items.push({ indice, partido })
    grupos.set(partido.ronda, items)
  })
  return [...grupos.entries()].sort(([a], [b]) => a - b).map(([ronda, items]) => ({ ronda, items }))
}

/** El nombre de un lado: un jugador solo, o los dos unidos por "y". */
export function nombreLado(jugadores: readonly string[], indices: readonly number[]): string {
  return indices.map((indice) => jugadores[indice] ?? `#${indice}`).join(' y ')
}

/** Cuál de los dos lados de un partido. */
export type Lado = 'a' | 'b'

/**
 * Los botones del segundo toque, y son todos los marcadores posibles: el que
 * gana se lleva el objetivo entero del deporte, así que al perdedor sólo le
 * puede quedar de 0 a objetivo − 1. Nada de lo que salga de acá lo puede
 * rechazar `cargarMarcador`, igual que en la carga de una fecha.
 *
 * El objetivo NO está en la lista, y es la decisión que hace que la pantalla
 * no ofrezca el empate: ni el pádel ni el ping pong empatan. El motor lo
 * acepta por generalidad; acá no hay dos toques que lo produzcan.
 */
export function puntosDelPerdedor(deporte: Deporte): number[] {
  return Array.from({ length: DEPORTE_OBJETIVO[deporte] }, (_, puntos) => puntos)
}

/** El marcador que sale de los dos toques: el que ganó se lleva el objetivo entero. */
export function marcadorDeDosToques(
  ganador: Lado,
  puntosPerdedor: number,
  deporte: Deporte,
): { a: number; b: number } {
  const objetivo = DEPORTE_OBJETIVO[deporte]
  return ganador === 'a'
    ? { a: objetivo, b: puntosPerdedor }
    : { a: puntosPerdedor, b: objetivo }
}

/**
 * El partido que "Siguiente" abre después de guardar el `desde`: el próximo
 * sin marcador en el orden de la pantalla, dando la vuelta al final (el que
 * quedó atrás sin cargar también cuenta). `null` si no falta ninguno.
 */
export function siguienteSinCargar(partidos: readonly Partido[], desde: number): number | null {
  const n = partidos.length
  for (let paso = 1; paso < n; paso++) {
    const indice = (desde + paso) % n
    if (partidos[indice]?.marcador === null) return indice
  }
  return null
}

/**
 * Lo que la hoja muestra elegido al abrir un partido ya cargado: el ganador y
 * los puntos del que perdió, así corregir es un toque. Un marcador que no
 * salió de los dos toques —los torneos de la versión con dos campos libres
 * siguen en algún teléfono— marca el ganador y ningún número: ofrecer uno que
 * no es el cargado sería mentir sobre lo que hay.
 */
export function toqueDelMarcador(
  marcador: Partido['marcador'],
  deporte: Deporte,
): { ganador: Lado | null; perdedor: number | null } {
  if (marcador === null || marcador.a === marcador.b) return { ganador: null, perdedor: null }
  const ganador: Lado = marcador.a > marcador.b ? 'a' : 'b'
  const delGanador = ganador === 'a' ? marcador.a : marcador.b
  const delPerdedor = ganador === 'a' ? marcador.b : marcador.a
  const deDosToques = delGanador === DEPORTE_OBJETIVO[deporte] && puntosDelPerdedor(deporte).includes(delPerdedor)
  return { ganador, perdedor: deDosToques ? delPerdedor : null }
}

/** Cómo se cuentan los puntos del deporte, para la pregunta del segundo toque. */
export function unidadDe(deporte: Deporte): 'games' | 'puntos' {
  return deporte === 'PADEL' ? 'games' : 'puntos'
}

/**
 * "Ana y Beto 4-2": el ganador y su marcador primero, como se canta un
 * resultado (el mismo criterio que la carga de una fecha). Un empate —sólo
 * puede venir de una versión vieja— nombra a los dos.
 */
export function resumenGuardado(nombreA: string, nombreB: string, marcador: { a: number; b: number }): string {
  if (marcador.a === marcador.b) return `${nombreA} ${marcador.a}-${marcador.b} ${nombreB}`
  return marcador.a > marcador.b
    ? `${nombreA} ${marcador.a}-${marcador.b}`
    : `${nombreB} ${marcador.b}-${marcador.a}`
}
