import type { Client } from './client'
import { EdgeError } from './errors'
import { playerNames } from './read'

/**
 * El @usuario (odd/tasks/amigos-faciles.md, S7): único sin importar
 * mayúsculas, de 3 a 20 caracteres, elegido una sola vez. La regla de verdad
 * vive en la base (0118-0122); acá está lo que la pantalla dice antes de
 * preguntarle, las sugerencias y los envoltorios de las tres funciones.
 */

/** El mismo patrón que el `check` de `players.username` (0118). */
const USERNAME = /^[a-z0-9][a-z0-9._]{2,19}$/
const MAX = 20

export const USERNAME_RULE = '3 a 20 caracteres: letras, números, punto y guion bajo. No se puede cambiar después.'
/** El mismo texto que levanta `choose_my_username` (0121). */
export const USERNAME_FORMAT_ERROR =
  'Usá de 3 a 20 letras, números, punto o guion bajo, empezando con una letra o un número.'
export const USERNAME_EMPTY = 'Elegí tu @usuario.'

/** Lo que escribió la persona, como lo guarda la base: sin espacios, sin la @ de adelante, en minúsculas. */
export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@/, '').trim().toLowerCase()
}

/**
 * Desde cuántas letras busca el buscador de Amigos (S8): las mismas que pide
 * `search_players_by_username` (0124). Vive acá y no en `db/buscar.ts` porque
 * la pantalla también lo usa, y este archivo se puede importar desde el cliente.
 */
export const SEARCH_MIN_LENGTH = 3

/** El problema de formato de un @usuario, o `null` si se puede usar. */
export function usernameError(raw: string): string | null {
  const username = normalizeUsername(raw)
  if (username.length === 0) return USERNAME_EMPTY
  return USERNAME.test(username) ? null : USERNAME_FORMAT_ERROR
}

/** Corta en 20 y no deja un punto o guion bajo colgando, ni adelante ni atrás. */
function clamp(value: string): string {
  return value.slice(0, MAX).replace(/^[._]+/, '').replace(/[._]+$/, '')
}

/** `base` + `suffix` en 20 caracteres: si no entra, se acorta `base`. */
function withSuffix(base: string, suffix: string): string {
  const head = base.slice(0, MAX - suffix.length)
  return /^[._]/.test(suffix) ? head.replace(/[._]+$/, '') + suffix : head + suffix
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].filter((value) => USERNAME.test(value))
}

/**
 * Los @usuario que salen del nombre: sin tildes, en minúsculas, los espacios
 * como punto, sin lo que no vale y cortado en 20. "Martín Pérez" da
 * `martin.perez` y `martinperez`. Siempre devuelve al menos uno válido.
 */
export function usernameSuggestions(displayName: string): string[] {
  const words = displayName
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9._]/g, ''))
    .filter((word) => word.length > 0)
  const dotted = clamp(words.join('.').replace(/\.{2,}/g, '.'))
  const compact = clamp(words.join('').replace(/[._]/g, ''))
  const found = unique([dotted, compact])
  if (found.length > 0) return found
  const base = dotted.length > 0 ? dotted : compact
  return base.length > 0 ? unique([withSuffix(base, '.padel')]) : ['jugador']
}

/**
 * Para uno que ya está en uso, otros parecidos: con un número y con "padel".
 * "nico.arias" da `nico.arias2`, `nicoarias.padel`, `nico.arias3`... Ninguno
 * es el tomado; la base dice cuáles están libres.
 */
export function usernameAlternatives(taken: string): string[] {
  const compact = taken.replace(/[._]/g, '')
  return unique([
    withSuffix(taken, '2'),
    withSuffix(compact, '.padel'),
    withSuffix(taken, '3'),
    withSuffix(compact, '_padel'),
    withSuffix(taken, '4'),
    withSuffix(taken, '10'),
  ]).filter((value) => value !== taken)
}

/** Si un @usuario está libre (`username_available`, 0120). Anda sin sesión, para el registro. */
export async function usernameAvailable(supabase: Client, username: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('username_available', { p_username: normalizeUsername(username) })
  if (error !== null) throw new EdgeError('No se pudo revisar el @usuario. Probá de nuevo.')
  return data === true
}

/** Los primeros `count` libres de `candidates`, en su orden. */
async function freeAmong(supabase: Client, candidates: readonly string[], count: number): Promise<string[]> {
  const libres = await Promise.all(candidates.map((candidate) => usernameAvailable(supabase, candidate)))
  return candidates.filter((_, index) => libres[index]).slice(0, count)
}

export type UsernameStatus =
  | { kind: 'vacio' }
  | { kind: 'formato'; message: string }
  | { kind: 'libre'; username: string; message: string }
  | { kind: 'en-uso'; username: string; message: string; suggestions: string[] }

/**
 * Lo que dice el campo mientras escribís: "@martinperez está libre", o
 * "@nico.arias ya está en uso" con dos libres para tocar. Un formato inválido
 * se contesta acá, sin preguntarle a la base.
 */
export async function usernameStatus(supabase: Client, raw: string): Promise<UsernameStatus> {
  const username = normalizeUsername(raw)
  if (username.length === 0) return { kind: 'vacio' }
  const problem = usernameError(username)
  if (problem !== null) return { kind: 'formato', message: problem }
  if (await usernameAvailable(supabase, username)) {
    return { kind: 'libre', username, message: `@${username} está libre` }
  }
  return {
    kind: 'en-uso',
    username,
    message: `@${username} ya está en uso`,
    suggestions: await freeAmong(supabase, usernameAlternatives(username), 2),
  }
}

/**
 * La sugerencia ya escrita de la pantalla única: la primera libre que sale
 * del nombre, y si no, la primera alternativa libre. Si están todas tomadas,
 * deja la primera, que el campo va a marcar en uso y la persona cambia.
 */
export async function firstFreeUsername(supabase: Client, displayName: string): Promise<string> {
  const suggestions = usernameSuggestions(displayName)
  const [libre] = await freeAmong(supabase, suggestions, 1)
  if (libre !== undefined) return libre
  const [alternativa] = await freeAmong(supabase, suggestions.flatMap(usernameAlternatives), 1)
  return alternativa ?? suggestions[0]!
}

/**
 * Elige tu @usuario, una sola vez (`choose_my_username`, 0121). Devuelve el
 * guardado. Los motivos de la base ("Ese @usuario ya está en uso.", "Ya
 * elegiste tu @usuario.") salen tal cual.
 */
export async function chooseMyUsername(supabase: Client, raw: string): Promise<string> {
  const username = normalizeUsername(raw)
  const problem = usernameError(username)
  if (problem !== null) throw new EdgeError(problem)
  const { data, error } = await supabase.rpc('choose_my_username', { p_username: username })
  if (error !== null) throw new EdgeError(error.message)
  return data
}

/** Tu @usuario, o `null` si todavía no lo elegiste (`my_username`, 0122). */
export async function myUsername(supabase: Client): Promise<string | null> {
  const { data, error } = await supabase.rpc('my_username')
  if (error !== null) throw new EdgeError('No se pudo leer tu @usuario.')
  return data ?? null
}

/** Tu nombre visible, para la sugerencia y el "Hola" de la pantalla única. */
export async function myDisplayName(supabase: Client): Promise<string> {
  const { data: me, error } = await supabase.rpc('my_player_id')
  if (error !== null || me === null) throw new EdgeError('No se pudo leer tu jugador.')
  return (await playerNames(supabase, [me])).get(me) ?? ''
}
