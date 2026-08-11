'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { SeasonConfig } from '@/core'
import { addSquadSeat, claimOwnSeat, removeSeat, renameSeat, unlinkSeat } from '@/db/entries'
import { EdgeError } from '@/db/errors'
import { renameSeason, updateSeasonConfig, updateSeasonRules } from '@/db/season'
import { serverClient } from '@/db/server'

export type WriteResult = { ok: true } | { ok: false; error: string }

/**
 * Todo lo de Ajustes revalida la temporada entera, no sólo esta pantalla: el
 * nombre está en Mis torneos, el plantel en la Tabla, y el formato en Reglas.
 */
async function onSeason(
  seasonId: string,
  work: (supabase: Awaited<ReturnType<typeof serverClient>>) => Promise<void>,
): Promise<WriteResult> {
  try {
    const supabase = await serverClient()
    await work(supabase)
    revalidatePath(`/torneo/${seasonId}`, 'layout')
    revalidatePath('/torneos')
    return { ok: true }
  } catch (error) {
    if (error instanceof EdgeError) return { ok: false, error: error.message }
    throw error
  }
}

/**
 * El nombre se manda con un `<form>` y sin una línea de JavaScript: es un campo
 * de texto y un Enter. Por eso el error no vuelve en un `WriteResult` sino por
 * la query, que es el patrón que ya usa `unirse/[token]`.
 *
 * `redirect` tira por dentro para cortar el render, así que va FUERA del
 * `try`: adentro, el `catch` se lo comería.
 */
export async function renameTournament(formData: FormData): Promise<void> {
  const seasonId = String(formData.get('seasonId') ?? '')
  const name = String(formData.get('name') ?? '')

  let problem: string | null = null
  try {
    const supabase = await serverClient()
    await renameSeason(supabase, seasonId, name)
  } catch (error) {
    if (!(error instanceof EdgeError)) throw error
    problem = error.message
  }

  revalidatePath(`/torneo/${seasonId}`, 'layout')
  revalidatePath('/torneos')
  redirect(
    problem === null
      ? `/torneo/${seasonId}/ajustes`
      : `/torneo/${seasonId}/ajustes?error=${encodeURIComponent(problem)}`,
  )
}

export async function addSeat(seasonId: string, displayName: string): Promise<WriteResult> {
  return onSeason(seasonId, async (supabase) => {
    await addSquadSeat(supabase, seasonId, displayName)
  })
}

export async function editSeatName(
  seasonId: string,
  entryId: string,
  displayName: string,
): Promise<WriteResult> {
  return onSeason(seasonId, async (supabase) => {
    await renameSeat(supabase, entryId, displayName)
  })
}

/**
 * Quien organiza toma uno de los asientos del plantel y pasa a jugar el torneo.
 *
 * Organizar y jugar son cosas distintas: el admin sigue siendo admin, lo único
 * que cambia es que ahora tiene un asiento. Nada más que hacer acá — todo lo
 * que pregunta "¿cuál es mi jugador?" ya sale de `myEntryId`, que mira
 * `player_id` y nunca miró quién creó el torneo.
 */
export async function takeSeat(seasonId: string, entryId: string): Promise<WriteResult> {
  return onSeason(seasonId, async (supabase) => {
    await claimOwnSeat(supabase, seasonId, entryId)
  })
}

/** Suelta el asiento de quien lo reclamó. El nombre se queda: el asiento sigue siendo el mismo. */
export async function unlinkSeatOwner(seasonId: string, entryId: string): Promise<WriteResult> {
  return onSeason(seasonId, async (supabase) => {
    await unlinkSeat(supabase, entryId)
  })
}

/**
 * Saca un asiento. Falla, y tiene que fallar, cuando ese asiento ya jugó:
 * `pairs` y `awards` lo referencian con `on delete no action` para que dar de
 * baja a alguien no borre las fechas que ya se jugaron. El mensaje lo escribe
 * `removeSeat`; acá sólo se muestra.
 */
export async function dropSeat(seasonId: string, entryId: string): Promise<WriteResult> {
  return onSeason(seasonId, async (supabase) => {
    await removeSeat(supabase, entryId)
  })
}

/** Guarda al toque de cada `−`/`+`. `assertValidConfig` corre adentro y su mensaje se muestra en línea. */
export async function saveConfig(seasonId: string, config: SeasonConfig): Promise<WriteResult> {
  return onSeason(seasonId, async (supabase) => {
    await updateSeasonConfig(supabase, seasonId, config)
  })
}

export async function saveRules(seasonId: string, text: string): Promise<WriteResult> {
  return onSeason(seasonId, async (supabase) => {
    await updateSeasonRules(supabase, seasonId, text)
  })
}
