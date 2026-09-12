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
