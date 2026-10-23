import type { Client } from './client'
import { EdgeError } from './errors'

/** Le pasa la administración del torneo al jugador del asiento `entryId` (tiene que tener cuenta). */
export async function transferSeasonAdmin(supabase: Client, seasonId: string, entryId: string): Promise<void> {
  const { error } = await supabase.rpc('transfer_season_admin', { p_season: seasonId, p_entry: entryId })
  if (error !== null) throw new EdgeError(error.message)
}

/**
 * Borra la cuenta de quien llama: el login y sus amistades. Su jugador queda en
 * los torneos con su nombre, sin cuenta. Falla —sin borrar nada— si es admin
 * de algún torneo, y el mensaje dice cuáles.
 */
export async function deleteMyAccount(supabase: Client): Promise<void> {
  const { error } = await supabase.rpc('delete_my_account')
  if (error !== null) throw new EdgeError(error.message)
}
