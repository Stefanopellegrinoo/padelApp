'use server'

import { revalidatePath } from 'next/cache'
import { EdgeError } from '@/db/errors'
import {
  clearPairs,
  generatePairs,
  lockPair,
  nameGuest,
  openMatchday,
  seedAttendances,
  setAttendance,
  syncGuestSeat,
  unlockPair,
} from '@/db/matchday'
import { pairLocksOf } from '@/db/read'
import { serverClient } from '@/db/server'

export type WriteResult = { ok: true } | { ok: false; error: string }

/**
 * Todas las acciones del armado empiezan por `seedAttendances`.
 *
 * La pantalla dibuja "sin fila = viene" y `playingEntryIds` cuenta filas
 * PLAYING existentes: sin la siembra, el panel diría "10 confirmados" y la
 * fecha tendría 0 presentes. El admin puede además no haber tocado un solo
 * tilde, así que "Generar parejas" y "Confirmar fecha" también la llaman.
 */
async function inDraft(
  seasonId: string,
  matchdayId: string,
  matchdayNumber: number,
  work: (supabase: Awaited<ReturnType<typeof serverClient>>) => Promise<void>,
): Promise<WriteResult> {
  try {
    const supabase = await serverClient()
    await seedAttendances(supabase, matchdayId)
    await work(supabase)
    revalidatePath(`/torneo/${seasonId}/fechas/${matchdayNumber}`)
    revalidatePath(`/torneo/${seasonId}/fechas`)
    return { ok: true }
  } catch (error) {
    if (error instanceof EdgeError) return { ok: false, error: error.message }
    throw error
  }
}

/**
 * Un tilde. El orden es `seedAttendances` → `setAttendance` → `syncGuestSeat`,
 * y no es negociable: el asiento de invitado aparece o desaparece según la
 * paridad de los confirmados, así que se decide DESPUÉS de escribir el tilde.
 */
export async function toggleAttendance(
  seasonId: string,
  matchdayId: string,
  matchdayNumber: number,
  entryId: string,
  status: 'PLAYING' | 'ABSENT',
): Promise<WriteResult> {
  return inDraft(seasonId, matchdayId, matchdayNumber, async (supabase) => {
    await setAttendance(supabase, matchdayId, entryId, status)
    await syncGuestSeat(supabase, matchdayId)
  })
}

/**
 * El nombre del invitado, y después `syncGuestSeat` — que acá es la única
 * salida de un caso real: con número par y un invitado YA NOMBRADO,
 * `syncGuestSeat` lo deja (alguien lo puso a propósito) y la fecha queda impar
 * y sin poder generarse. Borrar el nombre es la forma de decir "ya no viene", y
 * sin este sync el asiento no se iría hasta el próximo tilde de asistencia.
 */
export async function saveGuestName(
  seasonId: string,
  matchdayId: string,
  matchdayNumber: number,
  entryId: string,
  displayName: string,
): Promise<WriteResult> {
  return inDraft(seasonId, matchdayId, matchdayNumber, async (supabase) => {
    await nameGuest(supabase, entryId, displayName)
    await syncGuestSeat(supabase, matchdayId)
  })
}

/**
 * Con quién juega el invitado (spec 2.6). `null` es "el que toque": se destraba
 * y el sorteo decide.
 *
 * Borra las parejas ya generadas por el mismo motivo que las borra un cambio de
 * asistencia: quedaron contestando otra pregunta. `openMatchday` sólo compara
 * quiénes están, no con quién, así que sin este `clearPairs` el admin podría
 * confirmar una fecha donde el invitado NO juega con el que eligió.
 */
export async function setGuestPartner(
  seasonId: string,
  matchdayId: string,
  matchdayNumber: number,
  guestEntryId: string,
  partnerEntryId: string | null,
): Promise<WriteResult> {
  return inDraft(seasonId, matchdayId, matchdayNumber, async (supabase) => {
    const locks = await pairLocksOf(supabase, matchdayId)
    for (const lock of locks) {
      if (lock.a === guestEntryId || lock.b === guestEntryId) {
        await unlockPair(supabase, lock.id)
      }
    }
    if (partnerEntryId !== null) {
      await lockPair(supabase, matchdayId, guestEntryId, partnerEntryId)
    }
    await clearPairs(supabase, matchdayId)
  })
}

/** Sortea, o vuelve a sortear: `generatePairs` borra las anteriores sola. */
export async function drawPairs(
  seasonId: string,
  matchdayId: string,
  matchdayNumber: number,
): Promise<WriteResult> {
  return inDraft(seasonId, matchdayId, matchdayNumber, async (supabase) => {
    await generatePairs(supabase, matchdayId)
  })
}

/** `DRAFT → OPEN`. La fecha pasa a estar en juego y esta pantalla cambia de cara. */
export async function confirmMatchday(
  seasonId: string,
  matchdayId: string,
  matchdayNumber: number,
): Promise<WriteResult> {
  return inDraft(seasonId, matchdayId, matchdayNumber, async (supabase) => {
    await openMatchday(supabase, matchdayId)
  })
}
