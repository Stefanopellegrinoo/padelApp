import type { Client } from './client'
import { EdgeError } from './errors'
import { friendsOf } from './friends'
import { SEARCH_MIN_LENGTH, normalizeUsername } from './usuario'

/**
 * El buscador de Amigos por @usuario (odd/tasks/amigos-faciles.md, S8) y
 * "Que me encuentren por mi usuario". La regla de verdad vive en la base
 * (0123-0126): el mínimo de 3 letras, el tope de 10, quién aparece y qué
 * columnas salen. Acá está lo que evita preguntarle de más y el estado de
 * amistad de cada resultado.
 */

/** En qué está la amistad con cada resultado: nada, mi pedido, su pedido o ya amigos. */
export type EstadoBusqueda = 'none' | 'sent' | 'received' | 'friends'

export interface UsernameMatch {
  playerId: string
  displayName: string
  username: string
  estado: EstadoBusqueda
}

/**
 * Hasta 10 jugadores cuyo @usuario empieza con lo que escribiste, en orden
 * alfabético, cada uno con su estado conmigo. Con menos de 3 letras no le
 * pregunta a la base. El estado sale de `friendsOf`: una lectura de mis
 * amistades para todos los resultados, no una por persona.
 */
export async function searchByUsername(supabase: Client, raw: string): Promise<UsernameMatch[]> {
  // Lo mismo que hace la base: sin la @ de adelante, sin espacios, en minúsculas.
  const query = normalizeUsername(raw)
  if (query.length < SEARCH_MIN_LENGTH) return []

  const { data, error } = await supabase.rpc('search_players_by_username', { p_query: query })
  if (error !== null) throw new EdgeError('No se pudo buscar. Probá de nuevo.')
  const filas = data ?? []
  if (filas.length === 0) return []

  const estadoPor = new Map<string, EstadoBusqueda>(
    (await friendsOf(supabase)).map((amistad) => [
      amistad.playerId,
      amistad.accepted ? 'friends' : amistad.theyAsked ? 'received' : 'sent',
    ]),
  )
  return filas.map((fila) => ({
    playerId: fila.id,
    displayName: fila.display_name,
    username: fila.username,
    estado: estadoPor.get(fila.id) ?? 'none',
  }))
}

/**
 * Si te encuentran por tu @usuario (`my_discoverable`, 0126). Sin jugador
 * cuenta como prendido, que es como viene.
 */
export async function myDiscoverable(supabase: Client): Promise<boolean> {
  const { data, error } = await supabase.rpc('my_discoverable')
  if (error !== null) throw new EdgeError('No se pudo leer si te encuentran por tu @usuario.')
  return data ?? true
}

/**
 * Prende o apaga "Que me encuentren por mi usuario" (`set_my_discoverable`,
 * 0125), siempre el tuyo. Devuelve cómo quedó. Los motivos de la base
 * ("Tenés que iniciar sesión.") salen tal cual.
 */
export async function setMyDiscoverable(supabase: Client, discoverable: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_my_discoverable', { p_discoverable: discoverable })
  if (error !== null) {
    throw new EdgeError(error.code === 'P0001' ? error.message : 'No se pudo guardar. Probá de nuevo.')
  }
  return data
}
