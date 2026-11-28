import { haceCuanto } from '@/app/torneo/[id]/[disciplina]/jugador/amistad-texto'
import { sportLabel } from '@/core'

/**
 * Las palabras del perfil (odd/tasks/amigos-faciles.md, S9, S11). Puras: la
 * página las arma del lado del servidor.
 */

/** El deporte de un torneo compartido, como en Inicio: "Pádel", "FIFA y Tenis". Nunca fechas (S11). */
export function deportesDeTorneo(sports: readonly string[]): string {
  return [...new Set(sports.map(sportLabel))].join(' y ')
}

/** "Ver historial" lleva al historial entre los dos, y su Volver vuelve al perfil. */
export function historialHref(playerId: string): string {
  return `/amigos/${playerId}?desde=perfil`
}

/** "El último, hace 2 días" debajo de "Ver historial". Sin día cargado, nada. */
export function ultimoPartido(playedOn: string | null, ahora: Date): string | null {
  if (playedOn === null) return null
  const hace = haceCuanto(playedOn, ahora)
  return `El último, ${hace.charAt(0).toLocaleLowerCase('es')}${hace.slice(1)}`
}
