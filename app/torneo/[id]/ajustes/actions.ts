'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { isTournamentSport, type DisciplineId } from '@/core'
import type { DisciplineRules } from '@/app/deporte/personalizar-reglas-state'
import { offeredModalities } from '@/app/deporte/tarjeta-state'
import { addDiscipline, updateDisciplineRules, writeDisciplineRules } from '@/db/discipline'
import { addToDiscipline, removeFromDiscipline } from '@/db/discipline-entries'
import { createTeam, deleteTeam } from '@/db/discipline-teams'
import { transferSeasonAdmin } from '@/db/account'
import { addSquadSeat, claimOwnSeat, removeSeat, renameSeat, unlinkSeat } from '@/db/entries'
import { EdgeError } from '@/db/errors'
import { deleteSeason, regenerateInviteToken, renameSeason, updateSeasonPlayersCanScore } from '@/db/season'
import { serverClient } from '@/db/server'
import { newSportOf, type NewSportInput } from './nuevo-deporte-state'

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
    await claimOwnSeat(supabase, entryId)
  })
}

/** Suelta el asiento de quien lo reclamó. El nombre se queda: el asiento sigue siendo el mismo. */
export async function unlinkSeatOwner(seasonId: string, entryId: string): Promise<WriteResult> {
  return onSeason(seasonId, async (supabase) => {
    await unlinkSeat(supabase, entryId)
  })
}

/** Regenera el link de invitación (S8). Devuelve el token nuevo junto con el resultado. */
export async function regenerateInviteLink(
  seasonId: string,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  try {
    const supabase = await serverClient()
    const token = await regenerateInviteToken(supabase, seasonId)
    revalidatePath(`/torneo/${seasonId}`, 'layout')
    return { ok: true, token }
  } catch (error) {
    if (error instanceof EdgeError) return { ok: false, error: error.message }
    throw error
  }
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
 * "Listo" de la hoja "Personalizar reglas" (docs/torneos-deportes.md §5): escribe sólo lo que
 * cambió entre lo que la hoja abrió (`before`) y lo que quedó (`next`). El diff y el orden
 * (config, Masters, fecha por default) viven en `writeDisciplineRules` (`db/discipline.ts`), que
 * se prueba contra la base; acá va el cliente de la sesión y la revalidación.
 *
 * Escribe `disciplines.*`, no `seasons.config` (PR 5/6): `seasonHeader` ya no lee de la
 * temporada. `assertValidConfig` corre adentro y su mensaje vuelve a la hoja.
 *
 * ponytail: sin guard de FORMA del `formatoDefault` acá. La hoja sólo arma las tres opciones que
 * acepta el CHECK `disciplines_formato_default_kind` (0074/0095), y sólo quien organiza llega
 * hasta acá (RLS); un valor armado a mano volvería como el mensaje crudo de Postgres. Si hace
 * falta: un guard de forma en `updateDisciplineFormatoDefault` que tire un `EdgeError` en español.
 */
export async function saveDisciplineRules(
  seasonId: string,
  disciplineId: DisciplineId,
  before: DisciplineRules,
  next: DisciplineRules,
): Promise<WriteResult> {
  return onSeason(seasonId, async (supabase) => {
    await writeDisciplineRules(supabase, disciplineId, before, next)
  })
}

/**
 * "+ Agregar un deporte" a un torneo YA EN CURSO (REQ-D1-2, docs/torneos-deportes.md §5): la misma
 * tarjeta del paso 3 del wizard. A diferencia del wizard —una fila por `kind`, decisión #3823— acá NO
 * se filtra el `kind` ya presente: un segundo PADEL es exactamente el caso que habilita el ordinal de
 * `core/discipline-slug.ts` (`padel`, `padel-2`).
 *
 * `input` es JSON de cliente (Server Action): `kind` y `modality` se miran antes de `fichaSeed`, que
 * tira un Error común —bug del llamador— si el deporte no ofrece esa modalidad. El resto lo valida
 * `addDiscipline` antes de escribir (config, "Al azar" / "Igual que", plantel), y por eso la config
 * llega del tamaño de `entryIds`: acá no se rehace, o un cliente torcido cambiaría los puntos en silencio.
 *
 * ponytail: sin guard de FORMA del `formatoDefault`, igual que `saveDisciplineRules`; un valor armado a
 * mano vuelve como el mensaje crudo del CHECK de Postgres, y no deja nada creado.
 */
export async function addSportToSeason(seasonId: string, input: NewSportInput): Promise<WriteResult> {
  return onSeason(seasonId, async (supabase) => {
    const { kind, modality, entryIds } = input
    if (!isTournamentSport(kind) || !offeredModalities(kind).includes(modality) || !Array.isArray(entryIds)) {
      throw new EdgeError('Elegí un deporte y una modalidad de la lista.')
    }
    await addDiscipline(supabase, seasonId, newSportOf(input), entryIds)
  })
}

/**
 * Suma un asiento del plantel a esta disciplina (§2.6 del diseño, "Quién
 * juega"). `addToDiscipline` no valida a mano que `entryId` sea del plantel
 * de `seasonId`: la FK compuesta `(entry_id, season_id) references entries
 * (id, season_id)` de `discipline_entries` (0023:25) ya rechaza un `entryId`
 * de otro torneo con un error de Postgres, y `is_season_admin(season_id)`
 * (0023:60-62) exige además que quien llama organice ESTA temporada. El
 * único caller de producción (`QuienJuega`) ni siquiera arma ese caso: sólo
 * ofrece este botón para asientos que salen de `seasonSquadMembersOf(seasonId)`.
 */
export async function addDisciplineMember(
  seasonId: string,
  disciplineId: DisciplineId,
  entryId: string,
): Promise<WriteResult> {
  return onSeason(seasonId, async (supabase) => {
    await addToDiscipline(supabase, disciplineId, seasonId, entryId)
  })
}

/**
 * Saca un asiento de esta disciplina — no del plantel entero, ver
 * `dropSeat` más arriba para eso. Las guardas ("ya jugó", pareja fija sin
 * resolver, presentismo en una fecha sin armar) viven en
 * `removeFromDiscipline` (`db/discipline-entries.ts`) y no nombran la
 * disciplina — a propósito, mismo criterio que `PublicFormat.kind`
 * (`db/read.ts:167`): `db/` no importa de `app/`, que es donde vive
 * `DISCIPLINE_LABELS`. Acá SÍ hay `disciplineLabel` a mano (lo manda
 * `QuienJuega`, que lo recibe de la página), así que la traducción es
 * simplemente anteponerla — mismo formato que `mismatchMessages`
 * (`../page.tsx:126`, `${label}: ${message}`) — y no reinterpretar el string
 * de adentro.
 */
export async function dropDisciplineMember(
  seasonId: string,
  disciplineId: DisciplineId,
  entryId: string,
  disciplineLabel: string,
): Promise<WriteResult> {
  return onSeason(seasonId, async (supabase) => {
    try {
      await removeFromDiscipline(supabase, disciplineId, seasonId, entryId)
    } catch (error) {
      if (error instanceof EdgeError) throw new EdgeError(`${disciplineLabel}: ${error.message}`)
      throw error
    }
  })
}

/**
 * Arma un equipo fijo (docs/tipos-de-torneo.md §1, sección Equipos de
 * Ajustes). Las guardas (misma persona, no juega la disciplina, disciplina
 * sin `fixed_teams`, alguien que ya tiene equipo) viven en `createTeam`
 * (`db/discipline-teams.ts`) y se muestran tal cual, mismo criterio que
 * `dropSeat` con `removeSeat`.
 */
export async function addTeam(
  seasonId: string,
  disciplineId: DisciplineId,
  entryA: string,
  entryB: string,
): Promise<WriteResult> {
  return onSeason(seasonId, async (supabase) => {
    await createTeam(supabase, disciplineId, seasonId, entryA, entryB)
  })
}

/** Deshace un equipo — no toca `discipline_entries` ni lo ya jugado, ver `deleteTeam`. */
export async function removeTeam(seasonId: string, teamId: string): Promise<WriteResult> {
  return onSeason(seasonId, async (supabase) => {
    await deleteTeam(supabase, teamId)
  })
}

export async function saveRules(seasonId: string, disciplineId: DisciplineId, text: string): Promise<WriteResult> {
  return onSeason(seasonId, async (supabase) => {
    await updateDisciplineRules(supabase, seasonId, disciplineId, text)
  })
}

/**
 * El permiso para que el plantel cargue los resultados. Revalida la temporada
 * entera como todo lo de acá, y por un motivo concreto: lo que cambia con esto
 * es la pantalla de la FECHA —le aparecen o le desaparecen los botones de
 * carga a todos los demás—, no esta.
 */
export async function savePlayersCanScore(
  seasonId: string,
  enabled: boolean,
): Promise<WriteResult> {
  return onSeason(seasonId, async (supabase) => {
    await updateSeasonPlayersCanScore(supabase, seasonId, enabled)
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

/**
 * Pasa la administración al jugador del asiento `entryId` (S1,
 * `odd/tasks/borrar-cuenta.md`). Si sale bien, Ajustes ya no es de quien
 * llama: se lo manda al torneo.
 */
export async function transferAdmin(seasonId: string, entryId: string): Promise<WriteResult> {
  const result = await onSeason(seasonId, (supabase) => transferSeasonAdmin(supabase, seasonId, entryId))
  if (result.ok) redirect(`/torneo/${seasonId}`)
  return result
}
