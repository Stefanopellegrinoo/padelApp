'use server'

import { revalidatePath } from 'next/cache'
import { EdgeError } from '@/db/errors'
import { createMatchday } from '@/db/matchday'
import { serverClient } from '@/db/server'

export type WriteResult = { ok: true } | { ok: false; error: string }

/**
 * Crea la siguiente fecha, en `DRAFT`.
 *
 * El número no se manda: lo decide `createMatchday` con `max(number) + 1`, que
 * es la única cuenta que puede ser cierta en el momento del insert. La pantalla
 * dibuja ese mismo número, pero como etiqueta, no como dato.
 *
 * Devuelve el error en vez de tirarlo porque el CTA es un componente cliente y
 * lo tiene que dibujar en línea.
 */
export async function openNextMatchday(seasonId: string, playedOn: string): Promise<WriteResult> {
  try {
    const supabase = await serverClient()
    await createMatchday(supabase, seasonId, playedOn)
    revalidatePath(`/torneo/${seasonId}/fechas`)
    return { ok: true }
  } catch (error) {
    if (error instanceof EdgeError) return { ok: false, error: error.message }
    throw error
  }
}
