/**
 * Derivaciones puras de la pantalla "Jugar": agrupar los partidos por ronda,
 * armar el nombre de un lado, y las dos reglas de la carga en dos toques.
 * Nada de esto toca React ni el DOM — por eso vive acá y no en jugar.tsx,
 * donde ningún test lo alcanzaría.
 */
import { SPORTS, type MatchFormat } from '@/core'
import { loserGamesOptions } from '@/app/torneo/[id]/[disciplina]/fechas/[n]/carga-state'
import { deuceOptions, deuceWinnerGames } from '@/app/amigos/[playerId]/cargar-state'
import type { Deporte, Partido } from './rapido-state'

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
 * Un partido rápido es UN set del deporte, con la regla con la que nace un
 * torneo nuevo (`fichaSeed`): pádel y tenis juegan el set real (5-3, 7-5,
 * 7-6, S6) y ping pong y fútbol tenis se ganan por 2 (12-10, 16-14).
 */
export function formatoRapido(deporte: Deporte): MatchFormat {
  const sport = SPORTS[deporte]
  if (sport.family === 'result') return { ...sport.format }
  return { ...sport.format, setsToWin: 1, ...(sport.setReal ? { ventaja: true } : {}) }
}

/** Si el deporte se carga con un toque: gana, pierde o tablas (ajedrez). */
export function esPartida(deporte: Deporte): boolean {
  return SPORTS[deporte].family === 'result'
}

/** Lo que dice el botón del deporte al armar: "A 4 games", o "Gana o tablas" (entra en un renglón). */
export function subDeporte(deporte: Deporte): string {
  return esPartida(deporte) ? 'Gana o tablas' : `A ${SPORTS[deporte].format.gamesPerSet} ${unidadDe(deporte)}`
}

/** El toque de una partida: ganó un lado, o tablas. */
export type ToquePartida = Lado | 'tablas'

/** El marcador de una partida, como lo guarda una fecha: 1-0, 0-1 o 0-0. */
export function marcadorDePartida(toque: ToquePartida): { a: number; b: number } {
  if (toque === 'a') return { a: 1, b: 0 }
  if (toque === 'b') return { a: 0, b: 1 }
  return { a: 0, b: 0 }
}

/** El toque que dio una partida cargada, para marcarlo al corregir; `null` si no es una partida. */
export function partidaDelMarcador(marcador: Partido['marcador']): ToquePartida | null {
  if (marcador === null) return null
  if (marcador.a === 1 && marcador.b === 0) return 'a'
  if (marcador.a === 0 && marcador.b === 1) return 'b'
  if (marcador.a === 0 && marcador.b === 0) return 'tablas'
  return null
}

/**
 * Los botones del segundo toque: el que gana se lleva el objetivo entero y al
 * perdedor le queda lo que la regla deja (`loserGamesOptions`, los de una
 * fecha). Nada de lo que salga de acá lo puede rechazar `cargarMarcador`.
 *
 * El objetivo NO está en la lista, y es la decisión que hace que la pantalla
 * no ofrezca el empate: ninguno de estos deportes empata. El motor lo acepta
 * por generalidad; acá no hay dos toques que lo produzcan.
 */
export function puntosDelPerdedor(deporte: Deporte): number[] {
  return loserGamesOptions(formatoRapido(deporte))
}

/** Los botones de ventaja (`deuceOptions`, los de una fecha): los puntos del que perdió. */
export function ventajasDelPerdedor(deporte: Deporte): number[] {
  return deuceOptions(formatoRapido(deporte))
}

/** El marcador que sale de los dos toques: el que ganó se lleva el objetivo entero. */
export function marcadorDeDosToques(
  ganador: Lado,
  puntosPerdedor: number,
  deporte: Deporte,
): { a: number; b: number } {
  const objetivo = SPORTS[deporte].format.gamesPerSet
  return ganador === 'a'
    ? { a: objetivo, b: puntosPerdedor }
    : { a: puntosPerdedor, b: objetivo }
}

/** El marcador de un botón de ventaja: 7-5, 7-6, 12-10, 16-14. */
export function marcadorDeVentaja(ganador: Lado, puntosPerdedor: number, deporte: Deporte): { a: number; b: number } {
  const delGanador = deuceWinnerGames(formatoRapido(deporte), puntosPerdedor)
  return ganador === 'a' ? { a: delGanador, b: puntosPerdedor } : { a: puntosPerdedor, b: delGanador }
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
 * el botón del que perdió (un número, o uno de ventaja), así corregir es un
 * toque. Un marcador que no salió de los dos toques —los torneos de la versión
 * con dos campos libres, o un 4-3 de pádel de antes del set real— marca el
 * ganador y ningún número: ofrecer uno que no es el cargado sería mentir sobre
 * lo que hay.
 */
export function toqueDelMarcador(
  marcador: Partido['marcador'],
  deporte: Deporte,
): { ganador: Lado | null; perdedor: number | null; ventaja: boolean } {
  if (marcador === null || marcador.a === marcador.b) return { ganador: null, perdedor: null, ventaja: false }
  const ganador: Lado = marcador.a > marcador.b ? 'a' : 'b'
  const delPerdedor = ganador === 'a' ? marcador.b : marcador.a
  const igual = (otro: { a: number; b: number }) => otro.a === marcador.a && otro.b === marcador.b
  if (puntosDelPerdedor(deporte).includes(delPerdedor) && igual(marcadorDeDosToques(ganador, delPerdedor, deporte))) {
    return { ganador, perdedor: delPerdedor, ventaja: false }
  }
  if (ventajasDelPerdedor(deporte).includes(delPerdedor) && igual(marcadorDeVentaja(ganador, delPerdedor, deporte))) {
    return { ganador, perdedor: delPerdedor, ventaja: true }
  }
  return { ganador, perdedor: null, ventaja: false }
}

/** Cómo se cuentan los puntos del deporte, para la pregunta del segundo toque. */
export function unidadDe(deporte: Deporte): string {
  return SPORTS[deporte].unit
}

/**
 * "Ana y Beto 4-2": el ganador y su marcador primero, como se canta un
 * resultado (el mismo criterio que la carga de una fecha). Un empate —sólo
 * puede venir de una versión vieja— nombra a los dos.
 */
export function resumenGuardado(
  nombreA: string,
  nombreB: string,
  marcador: { a: number; b: number },
  deporte?: Deporte,
): string {
  // La partida: sin números que cantar.
  if (deporte !== undefined && esPartida(deporte)) {
    const toque = partidaDelMarcador(marcador)
    if (toque === 'a') return `ganó ${nombreA}`
    if (toque === 'b') return `ganó ${nombreB}`
    if (toque === 'tablas') return `${nombreA} y ${nombreB}, tablas`
  }
  if (marcador.a === marcador.b) return `${nombreA} ${marcador.a}-${marcador.b} ${nombreB}`
  return marcador.a > marcador.b
    ? `${nombreA} ${marcador.a}-${marcador.b}`
    : `${nombreB} ${marcador.b}-${marcador.a}`
}
