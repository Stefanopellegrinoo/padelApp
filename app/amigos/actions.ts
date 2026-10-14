'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  acceptFriendship,
  requestFriendship,
  createCasualMatch,
  updateCasualMatch,
  deleteCasualMatch,
  type CasualResultInput,
} from '@/db/friends'
import { EdgeError } from '@/db/errors'
import { serverClient } from '@/db/server'
import { playersFromJson } from './[playerId]/cargar-state'

/**
 * Las escrituras de Amigos que NO tienen estado de cliente que muestre un
 * error -- mismo patrón que `renameTournament`
 * (`app/torneo/[id]/ajustes/actions.ts`): un `<form>` sin JavaScript, y el
 * error vuelve por la query. Las dos únicas escrituras que la usan (pedir y
 * aceptar amistad) siempre vuelven a `/amigos` -- por eso el destino es fijo,
 * no un parámetro.
 *
 * Review final de 2b, Minor 4: `removeCasualMatch` (más abajo) pasaba por
 * acá también, con un `path` parametrizado a `/amigos/{playerId}` armado con
 * el `friendPlayerId` del `<form>`. Pero el redirect correcto usa el
 * `friendPlayerId` que DEVUELVE `deleteCasualMatch` -- se conoce recién
 * DESPUÉS de escribir, y este helper arma su `path` ANTES de llamar a
 * `work`. No hay forma de que un solo parámetro sirva a la vez de "destino
 * fijo, conocido de entrada" (este caso) y "destino que depende de si la
 * escritura funcionó" (el de borrar) -- por eso `removeCasualMatch` ahora
 * arma su propio try/catch, como ya hace `editCasualMatch`, y este helper
 * volvió a los dos casos para los que alcanza con un destino fijo.
 */
async function onAmigos(
  work: (supabase: Awaited<ReturnType<typeof serverClient>>) => Promise<void>,
): Promise<void> {
  let problem: string | null = null
  try {
    const supabase = await serverClient()
    await work(supabase)
  } catch (error) {
    if (!(error instanceof EdgeError)) throw error
    problem = error.message
  }

  revalidatePath('/amigos')
  redirect(problem === null ? '/amigos' : `/amigos?error=${encodeURIComponent(problem)}`)
}

export async function sendFriendRequest(formData: FormData): Promise<void> {
  const friendPlayerId = String(formData.get('friendPlayerId') ?? '').trim()
  await onAmigos((supabase) => requestFriendship(supabase, friendPlayerId))
}

export async function accept(formData: FormData): Promise<void> {
  const friendshipId = String(formData.get('friendshipId') ?? '')
  await onAmigos((supabase) => acceptFriendship(supabase, friendshipId))
}

// ── el partido casual: cargar, editar, borrar ───────────────────────────────

export interface CasualFormState {
  error: string | null
}

/**
 * Los campos del formulario tal cual llegan de `FormData`: `parseCasualResult`
 * (`db/friends.ts`) es el único lugar que valida, para que
 * `createCasualMatch`/`updateCasualMatch` se puedan probar sin pasar por esta
 * capa (ver los tests de `db/friends.db.test.ts`).
 *
 * Pegamento hasta la Tarea 4b (plan-amigos-deporte-y-2v2): el formulario
 * todavía es el viejo, con dos números de marcador. En PADEL esos dos números
 * pasan a ser UN set a un set, con `gamesPerSet` = el mayor de los dos -- el
 * resultado sale igual de validado por `matchError`, sólo que con el formato
 * más permisivo que el formulario viejo puede expresar.
 */
function casualInputFrom(formData: FormData): CasualResultInput {
  const campo = (name: string) => String(formData.get(name) ?? '')
  const input: CasualResultInput = {
    sport: campo('sport'),
    playedOn: campo('playedOn'),
    outcome: campo('outcome'),
    scoreMine: campo('scoreMine'),
    scoreTheirs: campo('scoreTheirs'),
    teamMine: campo('teamMine'),
    teamTheirs: campo('teamTheirs'),
    setsToWin: '',
    gamesPerSet: '',
    sets: '',
  }
  if (input.sport !== 'PADEL') return input
  const mine = Number(input.scoreMine)
  const theirs = Number(input.scoreTheirs)
  return {
    ...input,
    scoreMine: '',
    scoreTheirs: '',
    setsToWin: '1',
    gamesPerSet: String(Math.max(mine, theirs)),
    sets: JSON.stringify([{ mine, theirs }]),
  }
}

/**
 * Carga un partido casual nuevo. Firma de `useActionState`
 * (`(prevState, formData) => nextState`) en vez del patrón sin-JS de arriba:
 * a diferencia de pedir/aceptar amistad (un solo campo, nada que validar en
 * el borde), este formulario tiene varios campos y una validación real
 * (`parseCasualResult`) que puede rechazar -- mostrar el error SIN perder lo
 * ya tipeado, en la misma pantalla, es lo que `registro-form.tsx` ya resuelve
 * con este hook. `friendPlayerId` viaja en un input oculto, no en un
 * argumento -- mismo criterio que `next` en `registro-form.tsx`: este repo no
 * tiene precedente de `action.bind()`.
 */
export async function loadCasualMatch(_state: CasualFormState, formData: FormData): Promise<CasualFormState> {
  const friendPlayerId = String(formData.get('friendPlayerId') ?? '')
  try {
    const supabase = await serverClient()
    // `players` es un borde de confianza: `playersFromJson` valida la forma.
    // Yo no viajo en el plantel -- la base me pone del lado A.
    const players = playersFromJson(String(formData.get('players') ?? ''))
    await createCasualMatch(supabase, players, casualInputFrom(formData))
  } catch (error) {
    if (!(error instanceof EdgeError)) throw error
    return { error: error.message }
  }

  revalidatePath(`/amigos/${friendPlayerId}`)
  redirect(`/amigos/${friendPlayerId}`)
}

/**
 * A dónde vuelve Editar/Borrar: a la pantalla del amigo desde la que se envió
 * el formulario, si es parte del partido (en un 2v2 la base devuelve "el
 * primer otro jugador con cuenta", que puede ser otro amigo); si no, a lo que
 * devolvió la base, o `/amigos`. Se consulta ANTES de escribir: al borrar, las
 * filas ya no existen después.
 */
async function isParticipant(
  supabase: Awaited<ReturnType<typeof serverClient>>,
  matchId: string,
  playerId: string,
): Promise<boolean> {
  if (playerId === '' || matchId === '') return false
  const { data } = await supabase
    .from('casual_match_players')
    .select('player_id')
    .eq('match_id', matchId)
    .eq('player_id', playerId)
  return (data ?? []).length > 0
}

const friendPath = (friendPlayerId: string | null): string =>
  friendPlayerId === null ? '/amigos' : `/amigos/${friendPlayerId}`

/**
 * Edita un partido casual existente -- mismo patrón que `loadCasualMatch`.
 *
 * El redirect vuelve a la pantalla del `<form>` si ese amigo es parte del
 * partido (`isParticipant`, verificado en la base -- un formulario armado a
 * mano no puede mandar a cualquier página); si no, al `friendPlayerId` que
 * DEVUELVE `updateCasualMatch`.
 */
export async function editCasualMatch(_state: CasualFormState, formData: FormData): Promise<CasualFormState> {
  const matchId = String(formData.get('matchId') ?? '')
  const submitted = String(formData.get('friendPlayerId') ?? '')
  let friendPlayerId: string | null
  try {
    const supabase = await serverClient()
    const stays = await isParticipant(supabase, matchId, submitted)
    const fromDb = await updateCasualMatch(supabase, matchId, casualInputFrom(formData))
    friendPlayerId = stays ? submitted : fromDb
  } catch (error) {
    if (!(error instanceof EdgeError)) throw error
    return { error: error.message }
  }

  // `null`: todos los demás jugadores eran invitados -- no hay pantalla de
  // amigo a la que volver.
  const path = friendPath(friendPlayerId)
  revalidatePath(path)
  redirect(path)
}

/**
 * Borra un partido casual. Patrón sin-JS: no hay nada que validar en el
 * borde ni un campo que mantener tipeado tras un error -- un botón que puede
 * fallar y volver con `?error=...`, igual que `accept`.
 *
 * En éxito, mismo criterio de redirect que `editCasualMatch`. En error no hay fila que leer (el borrado no llegó a pasar), así
 * que ahí sí se usa el del `<form>` -- es el único valor disponible para
 * saber a qué pantalla volver, y errar ese destino no es un problema de
 * permisos (el prefijo `/amigos/` sigue siendo same-origin).
 */
export async function removeCasualMatch(formData: FormData): Promise<void> {
  const matchId = String(formData.get('matchId') ?? '')
  const submitted = String(formData.get('friendPlayerId') ?? '')
  let path = `/amigos/${submitted}`
  let problem: string | null = null
  try {
    const supabase = await serverClient()
    const stays = await isParticipant(supabase, matchId, submitted)
    const fromDb = await deleteCasualMatch(supabase, matchId)
    // `null`: todos los demás eran invitados -- se vuelve a `/amigos`.
    path = friendPath(stays ? submitted : fromDb)
  } catch (error) {
    if (!(error instanceof EdgeError)) throw error
    problem = error.message
  }

  revalidatePath(path)
  redirect(problem === null ? path : `${path}?error=${encodeURIComponent(problem)}`)
}
