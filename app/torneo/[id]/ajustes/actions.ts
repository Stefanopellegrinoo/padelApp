'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { DisciplineId, SeasonConfig, SideSize } from '@/core'
import { type DisciplineKind, newDisciplineSpec } from '@/app/torneos/nuevo/wizard-state'
import { addDiscipline, updateDisciplineConfig } from '@/db/discipline'
import { addSquadSeat, claimOwnSeat, removeSeat, renameSeat, unlinkSeat } from '@/db/entries'
import { EdgeError } from '@/db/errors'
import { deleteSeason, renameSeason, updateSeasonRules } from '@/db/season'
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

/**
 * Agrega un asiento. `beforeEntryId` es "antes de este asiento" (spec
 * "Ubicar al que llega en el orden de desempate"); `null` agrega al final,
 * que es el default de `addSquadSeat` y el comportamiento de siempre.
 */
export async function addSeat(
  seasonId: string,
  displayName: string,
  beforeEntryId: string | null = null,
): Promise<WriteResult> {
  return onSeason(seasonId, async (supabase) => {
    await addSquadSeat(supabase, seasonId, displayName, beforeEntryId)
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

/**
 * Guarda al toque de cada `−`/`+`. `assertValidConfig` corre adentro y su
 * mensaje se muestra en línea.
 *
 * Escribe `disciplines.config`, no `seasons.config` (PR 5/6): `seasonHeader`
 * ya no lee de la temporada, así que escribir ahí dejaría la pantalla
 * mostrando el valor viejo después de guardar.
 */
export async function saveConfig(
  seasonId: string,
  disciplineId: DisciplineId,
  config: SeasonConfig,
): Promise<WriteResult> {
  return onSeason(seasonId, async (supabase) => {
    await updateDisciplineConfig(supabase, disciplineId, config)
  })
}

/**
 * Suma una disciplina a un torneo YA EN CURSO (REQ-D1-2). A diferencia del
 * wizard —una fila por `kind`, decisión #3823— acá NO se filtra el `kind` ya
 * presente: un segundo PADEL es exactamente el caso que habilita el ordinal
 * de `core/discipline-slug.ts` (`padel`, `padel-2`).
 *
 * `config` sale de `defaultConfig(entryIds.length)`: el tamaño real del
 * plantel elegido, no el de la temporada entera si el admin destildó a
 * alguien (REQ-D1-4, solape parcial). Si queda impar o por debajo del
 * mínimo, `assertValidConfig` (adentro de `addDiscipline`) lo rechaza con el
 * mismo mensaje en español que ya usa Formato — no hace falta duplicar esa
 * validación acá.
 *
 * `newDisciplineSpec` es lo que le pone la FORMA DEL MARCADOR (PR20 rebanada
 * D2) y, desde PR21 Rebanada F, los LADOS (`pairSize`): sin él, `defaultConfig`
 * nace en pádel de a dos y una FIFA agregada desde acá no podía cargar ni un
 * `3-1` ni un `0-0`, ni nacer de a uno. Es la misma función que usa el wizard
 * por dentro (`buildDisciplines`) — los dos caminos que crean una disciplina
 * escriben lo mismo o el torneo depende de por dónde entraste.
 *
 * `pairSize` es OBLIGATORIO acá (a diferencia de `newDisciplineSpec`, que sí
 * lo deja opcional para quedar general): el único caller de producción
 * (`Disciplinas`) SIEMPRE tiene un `pairSize` —el radio "Lados" nace en 2—,
 * así que dejarlo opcional acá sólo abriría la puerta a olvidarlo en el
 * sitio del submit sin que nada lo marque. Con el parámetro obligatorio,
 * olvidarlo es un error de `tsc`, no un test que haya que escribir y
 * mantener — mismo criterio que `newTournamentPayload` (`wizard-state.ts`).
 */
export async function addDisciplineToSeason(
  seasonId: string,
  kind: DisciplineKind,
  entryIds: string[],
  pairSize: SideSize,
): Promise<WriteResult> {
  return onSeason(seasonId, async (supabase) => {
    await addDiscipline(supabase, seasonId, newDisciplineSpec(kind, entryIds.length, pairSize), entryIds)
  })
}

export async function saveRules(seasonId: string, text: string): Promise<WriteResult> {
  return onSeason(seasonId, async (supabase) => {
    await updateSeasonRules(supabase, seasonId, text)
  })
}

/**
 * Borra el torneo entero y vuelve a Mis torneos.
 *
 * No usa `onSeason`: ése revalida la temporada que acaba de dejar de existir, y
 * el `redirect` tiene que quedar FUERA del try porque tira por dentro para
 * cortar el render — adentro, el catch se lo comería y la pantalla se quedaría
 * dibujando un torneo borrado.
 *
 * En el camino feliz esta función no vuelve. El `WriteResult` es sólo para el
 * error, que la pantalla muestra en el modal.
 */
export async function removeTournament(seasonId: string): Promise<WriteResult> {
  try {
    const supabase = await serverClient()
    await deleteSeason(supabase, seasonId)
  } catch (error) {
    if (error instanceof EdgeError) return { ok: false, error: error.message }
    throw error
  }

  revalidatePath('/torneos')
  redirect('/torneos')
}
