/**
 * El plantel, desde Ajustes: agregar, renombrar, sacar y desvincular asientos.
 *
 * Ninguna de estas funciones toca `config.squadSize` ni `config.points`. Eso se
 * edita en la sección Formato, y mientras las dos cosas no coincidan la pantalla
 * lo dice llamando a `validateConfig` con la cantidad real de asientos. Ajustar
 * la config desde acá dejaría una config inválida a mitad de camino, que es lo
 * que `assertValidConfig` existe para impedir.
 *
 * La guardia real es RLS: `entries_write` (0002_rls.sql) pide
 * `is_season_admin(season_id)` para insert, update y delete.
 */
import type { Client } from './client'
import { EdgeError } from './errors'

/**
 * Agrega un asiento al plantel. `beforeEntryId` es "antes de este asiento": el
 * default `null` agrega al final, que es el comportamiento de siempre —
 * byte a byte, nada cambia para quien ignora el selector nuevo.
 *
 * No es una posición numérica: `removeSeat` deja huecos en `seed_position` a
 * propósito, así que "posición 3" es ambigua y queda vieja apenas alguien más
 * entra o sale. "Antes de Juan" no.
 *
 * Elegir el lugar y correr la cola son dos pasos que tienen que viajar juntos
 * en UNA transacción, y el cliente de Supabase no tiene eso — por eso los dos
 * pasos viven en `add_squad_seat` (0013_squad_seat_position.sql) y acá queda
 * una sola llamada.
 */
export async function addSquadSeat(
  supabase: Client,
  seasonId: string,
  displayName: string,
  beforeEntryId: string | null = null,
): Promise<string> {
  const name = displayName.trim()
  if (name.length === 0) throw new EdgeError('El asiento necesita un nombre.')

  const { data, error } = await supabase.rpc('add_squad_seat', {
    p_season: seasonId,
    p_name: name,
    // `p_before` es opcional en el tipo generado (tiene default en SQL), no
    // nullable: `undefined` omite la clave y deja que el default de la
    // función decida, que es exactamente "al final".
    p_before: beforeEntryId ?? undefined,
  })
  if (error !== null || data === null) {
    throw new EdgeError(`No se pudo agregar el jugador: ${error?.message}`)
  }
  return data
}

/**
 * Reclama un asiento para quien llama, desde adentro del torneo.
 *
 * Es el mismo `claim_seat` que usa Unirse y no un update propio: ahí vive la
 * atomicidad (el `player_id is null` adentro del where), la regla de un asiento
 * por persona y los mensajes. Un update desde acá sería una segunda forma de
 * reclamar, y la que no se probó es la que se rompe.
 *
 * Existe porque el que crea el torneo no pasa por Unirse: no tiene por qué
 * pegarse su propio link de invitación para jugar el torneo que armó.
 */
export async function claimOwnSeat(
  supabase: Client,
  seasonId: string,
  entryId: string,
): Promise<void> {
  const { data: season, error: seasonError } = await supabase
    .from('seasons')
    .select('invite_token')
    .eq('id', seasonId)
    .maybeSingle()
  if (seasonError) throw new EdgeError(`No se pudo leer el torneo: ${seasonError.message}`)
  if (season === null) throw new EdgeError('El torneo no existe.')

  const { error } = await supabase.rpc('claim_seat', {
    p_token: season.invite_token,
    p_entry: entryId,
  })
  if (error !== null) throw new EdgeError(error.message)
}

/** Cambia el nombre del asiento. No toca `player_id`: renombrar no desvincula. */
export async function renameSeat(
  supabase: Client,
  entryId: string,
  displayName: string,
): Promise<void> {
  const name = displayName.trim()
  if (name.length === 0) throw new EdgeError('El asiento necesita un nombre.')

  const { error } = await supabase
    .from('entries')
    .update({ display_name: name })
    .eq('id', entryId)
  if (error !== null) throw new EdgeError(`No se pudo cambiar el nombre: ${error.message}`)
}

/** Suelta el asiento de quien lo reclamó, dejándolo libre para otro. El nombre se queda. */
export async function unlinkSeat(supabase: Client, entryId: string): Promise<void> {
  const { error } = await supabase.from('entries').update({ player_id: null }).eq('id', entryId)
  if (error !== null) throw new EdgeError(`No se pudo desvincular el asiento: ${error.message}`)
}

/**
 * Saca un asiento del plantel.
 *
 * Falla —y tiene que fallar— cuando el asiento ya jugó: `pairs` y `awards`
 * referencian `entries` con `on delete no action` (0001_schema.sql) justamente
 * para que dar de baja a alguien no borre las fechas que ya se jugaron. El
 * 23503 se traduce; no se borra en cascada y no se inventa un borrado lógico.
 *
 * El hueco que queda en `seed_position` no molesta: `squadSeedOrder` ordena por
 * esa columna y el índice pide único, no consecutivo. Renumerar sería reescribir
 * el orden de desempate inicial de todos los demás por sacar a uno.
 */
export async function removeSeat(supabase: Client, entryId: string): Promise<void> {
  const { error } = await supabase.from('entries').delete().eq('id', entryId)
  if (error === null) return

  if (error.code === '23503') {
    throw new EdgeError(
      'Este jugador ya jugó alguna fecha, así que no se puede sacar: sus resultados quedarían colgados. Podés desvincular el reclamo y cambiarle el nombre.',
    )
  }
  throw new EdgeError(`No se pudo sacar al jugador: ${error.message}`)
}
