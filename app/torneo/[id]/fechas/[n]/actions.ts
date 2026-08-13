'use server'

import { revalidatePath } from 'next/cache'
import type { SetScore } from '@/core'
import { EdgeError } from '@/db/errors'
import {
  addGuest,
  clearPairs,
  closeMatchday,
  createMasters,
  generateMastersPairs,
  generatePairs,
  lockPair,
  nameGuest,
  openMatchday,
  redraftMatchday,
  removeGuest,
  reopenMatchday,
  saveResult,
  seedAttendances,
  setAttendance,
  setMatchdayDate,
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

/**
 * Lo mismo que `inDraft` pero sin sembrar asistencias: la fecha ya no está en
 * armado y `seedAttendances` rebotaría con "El presentismo sólo se toca con la
 * fecha en armado".
 */
async function onMatchday(
  seasonId: string,
  matchdayNumber: number,
  work: (supabase: Awaited<ReturnType<typeof serverClient>>) => Promise<void>,
): Promise<WriteResult> {
  try {
    const supabase = await serverClient()
    await work(supabase)
    revalidatePath(`/torneo/${seasonId}/fechas/${matchdayNumber}`)
    revalidatePath(`/torneo/${seasonId}/fechas`)
    // Cerrar y reabrir mueven la tabla y los puntos de la temporada entera.
    revalidatePath(`/torneo/${seasonId}`)
    return { ok: true }
  } catch (error) {
    if (error instanceof EdgeError) return { ok: false, error: error.message }
    throw error
  }
}

/** El resultado de un partido, entero. `saveResult` reemplaza los sets: nunca se llama de a un set. */
export async function saveMatchResult(
  seasonId: string,
  matchdayNumber: number,
  matchId: string,
  sets: SetScore[],
): Promise<WriteResult> {
  return onMatchday(seasonId, matchdayNumber, async (supabase) => {
    await saveResult(supabase, matchId, sets)
  })
}

/** `OPEN → CLOSED`, con los puntos congelados. Es lo que escribe la historia. */
export async function closeTheMatchday(
  seasonId: string,
  matchdayId: string,
  matchdayNumber: number,
): Promise<WriteResult> {
  return onMatchday(seasonId, matchdayNumber, async (supabase) => {
    await closeMatchday(supabase, matchdayId)
  })
}

/**
 * Crea la jornada del Masters. Es una fecha más —con `kind = 'MASTERS'`— y por
 * eso no tiene ruta propia: se juega en `/fechas/{n}` como cualquier otra.
 *
 * El número lo decide `create_masters` con el mismo `max(number) + 1`, así que
 * la pantalla no lo manda ni lo adivina.
 */
export async function buildMasters(seasonId: string, playedOn: string): Promise<WriteResult> {
  try {
    const supabase = await serverClient()
    await createMasters(supabase, seasonId, playedOn)
    revalidatePath(`/torneo/${seasonId}/fechas`)
    return { ok: true }
  } catch (error) {
    if (error instanceof EdgeError) return { ok: false, error: error.message }
    throw error
  }
}

/** Los 3 partidos con compañeros rotativos. Los 4 salen del ranking, no de asistencias. */
export async function drawMastersPairs(
  seasonId: string,
  matchdayId: string,
  matchdayNumber: number,
): Promise<WriteResult> {
  return onMatchday(seasonId, matchdayNumber, async (supabase) => {
    await generateMastersPairs(supabase, matchdayId)
  })
}

/** `CLOSED → OPEN`, borrando los awards. Sólo la última cerrada, y eso lo decide `reopen_matchday`. */
export async function reopenTheMatchday(
  seasonId: string,
  matchdayId: string,
  matchdayNumber: number,
): Promise<WriteResult> {
  return onMatchday(seasonId, matchdayNumber, async (supabase) => {
    await reopenMatchday(supabase, matchdayId)
  })
}

/**
 * `OPEN → DRAFT`. Las parejas quedan como están: lo que se corrige es quién juega.
 *
 * Pasa por `onMatchday`, no por `inDraft`, aunque la fecha va PARA el armado:
 * `inDraft` siembra asistencias ANTES de `work()`, y `seedAttendances` rebota
 * con "El presentismo sólo se toca con la fecha en armado" en cualquier estado
 * que no sea DRAFT — y acá todavía es OPEN cuando la acción arranca. Sembrar
 * pasa a ser trabajo de la próxima pantalla de armado, no de esta transición.
 */
export async function redraftTheMatchday(
  seasonId: string,
  matchdayId: string,
  matchdayNumber: number,
): Promise<WriteResult> {
  return onMatchday(seasonId, matchdayNumber, async (supabase) => {
    await redraftMatchday(supabase, matchdayId)
  })
}

/**
 * Suma una pareja invitada: dos asientos que juegan juntos y **no cobran
 * ninguno de los dos**. Es el equipo que viene de visita a la fecha.
 *
 * Van trabados desde el momento cero, y no es un detalle: `orderPool` manda a
 * los invitados al fondo del pool y `buildPairs` empareja primero-con-último,
 * así que dos invitados sueltos salen en DOS parejas mixtas. Que jueguen juntos
 * es una pareja fija, como los defensores, no un efecto automático — y sin el
 * lock `assertPointsCoverMatchday` rebota la fecha, porque quedarían más
 * parejas del torneo que valores de puntos.
 *
 * Suman dos, así que no cambian la paridad: el invitado suelto que aparece
 * cuando el plantel da impar sigue siendo cosa de `syncGuestSeat`.
 */
export async function addGuestPair(
  seasonId: string,
  matchdayId: string,
  matchdayNumber: number,
): Promise<WriteResult> {
  return inDraft(seasonId, matchdayId, matchdayNumber, async (supabase) => {
    await clearPairs(supabase, matchdayId)
    const one = await addGuest(supabase, matchdayId, { displayName: '' })
    const two = await addGuest(supabase, matchdayId, { displayName: '' })
    await lockPair(supabase, matchdayId, one, two)
    await syncGuestSeat(supabase, matchdayId)
  })
}

/** Saca la pareja invitada entera. El lock se va solo: `pair_locks` cae en cascada con el asiento. */
export async function removeGuestPair(
  seasonId: string,
  matchdayId: string,
  matchdayNumber: number,
  entryA: string,
  entryB: string,
): Promise<WriteResult> {
  return inDraft(seasonId, matchdayId, matchdayNumber, async (supabase) => {
    await clearPairs(supabase, matchdayId)
    await removeGuest(supabase, entryA)
    await removeGuest(supabase, entryB)
    await syncGuestSeat(supabase, matchdayId)
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

/**
 * Corrige el día de la fecha.
 *
 * No pasa por `inDraft`: ése siembra asistencias y sólo tiene sentido armando.
 * El día se puede corregir en cualquier estado —es una etiqueta, no entra en
 * ningún cálculo— y hasta ahora no se podía corregir en ninguno: se elegía una
 * sola vez, al abrirla, y quedaba para siempre.
 */
export async function changeMatchdayDate(
  seasonId: string,
  matchdayId: string,
  matchdayNumber: number,
  playedOn: string,
): Promise<WriteResult> {
  try {
    const supabase = await serverClient()
    await setMatchdayDate(supabase, matchdayId, playedOn)
  } catch (error) {
    if (error instanceof EdgeError) return { ok: false, error: error.message }
    throw error
  }

  // La lista de fechas y Mis torneos muestran este día ("próxima fecha"), así
  // que revalidar sólo esta pantalla dejaría el día viejo en las otras dos.
  revalidatePath(`/torneo/${seasonId}/fechas/${matchdayNumber}`)
  revalidatePath(`/torneo/${seasonId}/fechas`)
  revalidatePath(`/torneo/${seasonId}`)
  revalidatePath('/torneos')
  return { ok: true }
}
