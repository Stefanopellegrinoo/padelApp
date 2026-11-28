import { SEARCH_MIN_LENGTH, normalizeUsername } from '@/db/usuario'

/**
 * Lo que dice el buscador de Amigos por @usuario (odd/tasks/amigos-faciles.md,
 * S8, `design/amigos-faciles/05-buscar-por-usuario.html`), aparte de la
 * pantalla para probarlo solo.
 */

/** Cuánto esperar a que dejes de escribir antes de buscar: lo mismo que el campo @usuario del registro. */
export const ESPERA_MS = 300

export const AYUDA_BUSQUEDA = 'Para sumar a quien no está en tus torneos'
export const BUSQUEDA_CORTA = `Escribí al menos ${SEARCH_MIN_LENGTH} letras de su @usuario`
export const SIN_RESULTADOS = 'No hay nadie con ese @usuario. Si todavía no lo eligió, mandale tu link.'

export type CampoDeBusqueda = { kind: 'vacio' } | { kind: 'corta' } | { kind: 'buscar'; query: string }

/**
 * Qué hacer con lo que escribiste: nada, pedir más letras o buscarlo limpio
 * (sin la @, sin espacios, en minúsculas), como lo compara la base.
 */
export function campoDeBusqueda(raw: string): CampoDeBusqueda {
  const query = normalizeUsername(raw)
  if (query.length === 0) return { kind: 'vacio' }
  if (query.length < SEARCH_MIN_LENGTH) return { kind: 'corta' }
  return { kind: 'buscar', query }
}

/** El @usuario partido en lo que escribiste (va en negrita) y el resto. */
export function partesDelUsuario(username: string, query: string): { prefijo: string; resto: string } {
  return username.startsWith(query)
    ? { prefijo: query, resto: username.slice(query.length) }
    : { prefijo: '', resto: username }
}

/** "4 usuarios empiezan con @nic". Con 10, el tope de la base, que pueden ser más. */
export function resumenDeBusqueda(cantidad: number, query: string): string {
  if (cantidad === 1) return `1 usuario empieza con @${query}`
  if (cantidad >= 10) return `Los primeros ${cantidad} que empiezan con @${query}. Si no está, escribí una letra más.`
  return `${cantidad} usuarios empiezan con @${query}`
}
