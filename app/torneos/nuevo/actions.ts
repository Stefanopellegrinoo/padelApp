'use server'

import type { SeasonConfig } from '@/core'
import { EdgeError } from '@/db/errors'
import { createSeason, type NewSeasonDiscipline } from '@/db/season'
import { serverClient } from '@/db/server'

export type CreateResult =
  | { ok: true; seasonId: string; inviteToken: string }
  | { ok: false; error: string }

/**
 * El único momento en que el wizard escribe.
 *
 * Los cuatro primeros pasos no persisten nada: no hay temporada a medio hacer,
 * ni borrador en la base, ni autosave. Se usa una vez por año, y una fila
 * incompleta que nadie puede terminar es peor que volver a tipear ocho nombres.
 *
 * Devuelve el error en vez de tirarlo porque el wizard es un componente cliente
 * que tiene que dibujarlo en línea, junto al paso que falló.
 */
export async function createTournament(input: {
  name: string
  squadNames: string[]
  config: SeasonConfig
  /** El asiento del que crea, o `null` si organiza sin jugar. Índice sobre `squadNames`. */
  mySeatIndex: number | null
  /**
   * Una fila de `disciplines` por elemento, en el orden que el wizard armó
   * (paso 1, checkboxes). Sin esto, `createSeason` (PR11b) sigue creando la
   * única PADEL de siempre — el default queda para quien llame sin wizard.
   */
  disciplines?: NewSeasonDiscipline[]
}): Promise<CreateResult> {
  try {
    const supabase = await serverClient()
    const { seasonId, inviteToken } = await createSeason(supabase, input)
    return { ok: true, seasonId, inviteToken }
  } catch (error) {
    if (error instanceof EdgeError) return { ok: false, error: error.message }
    throw error
  }
}
