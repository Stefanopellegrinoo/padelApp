'use server'

import { revalidatePath } from 'next/cache'
import type { DisciplineId } from '@/core'
import { EdgeError } from '@/db/errors'
import { createMatchday } from '@/db/matchday'
import { serverClient } from '@/db/server'

export type WriteResult = { ok: true } | { ok: false; error: string }

/**
 * Crea la siguiente fecha de UNA disciplina, en `DRAFT`.
 *
 * El número no se manda: lo decide `createMatchday` con `max(number) + 1` DE
 * ESA disciplina, que es la única cuenta que puede ser cierta en el momento
 * del insert. La pantalla dibuja ese mismo número, pero como etiqueta, no
 * como dato.
 *
 * `disciplineId` explícito (PR13c slice B, C12): antes de este cambio el
 * único caller de producción pasaba 3 argumentos y `createMatchday` resolvía
 * siempre `defaultDisciplineId`, así que la segunda disciplina de una
 * temporada no tenía forma de abrir una fecha propia.
 *
 * Devuelve el error en vez de tirarlo porque el CTA es un componente cliente y
 * lo tiene que dibujar en línea.
 */
export async function openNextMatchday(
  seasonId: string,
  disciplineId: DisciplineId,
  playedOn: string,
): Promise<WriteResult> {
  try {
    const supabase = await serverClient()
    await createMatchday(supabase, seasonId, playedOn, disciplineId)
    // 'layout': la fecha vive bajo `[disciplina]/fechas`, y este action no
    // conoce el slug — mismo criterio que ya usa
    // `[disciplina]/fechas/[n]/actions.ts` para `inDraft`/`onMatchday`.
    revalidatePath(`/torneo/${seasonId}`, 'layout')
    return { ok: true }
  } catch (error) {
    if (error instanceof EdgeError) return { ok: false, error: error.message }
    throw error
  }
}
