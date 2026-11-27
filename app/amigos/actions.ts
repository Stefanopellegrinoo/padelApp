'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  acceptFriendRequestFrom,
  addFriend,
  cancelFriendRequest,
  rejectFriendRequest,
  requestFriendship,
  createCasualMatch,
  updateCasualMatch,
  deleteCasualMatch,
  casualParticipantIds,
} from '@/db/friends'
import { EdgeError } from '@/db/errors'
import { serverClient } from '@/db/server'
import { playersFromJson } from './[playerId]/cargar-state'
import { assertFriendPlays, casualInputFrom, redirectTarget } from './casual-form-data'

/**
 * Las escrituras de Amigos que NO tienen estado de cliente que muestre un
 * error -- mismo patrón que `renameTournament`
 * (`app/torneo/[id]/ajustes/actions.ts`): un `<form>` sin JavaScript, y el
 * error vuelve por la query. La única escritura que la usa (pedir amistad por
 * ID) siempre vuelve a `/amigos` -- por eso el destino es fijo, no un
 * parámetro. Aceptar un pedido ya no pasa por acá: va por la persona, con
 * `aceptarPedidoDe` (odd/tasks/amigos-faciles.md, T3).
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

// ── la amistad con una persona: el perfil del torneo (S2), Inicio y Amigos (S4) ──

export type AmistadResult = { ok: true } | { ok: false; error: string }

/**
 * Las cuatro escrituras del control del perfil del torneo, que también usan
 * los pedidos de Inicio y de Amigos (`pedidos.tsx`). Sin redirect: la
 * pantalla se queda donde está, con su `?desde=` intacto, y `revalidatePath`
 * le trae el estado nuevo de la base. Mismo registro que `cancelTheMatchday`
 * (`fechas/[n]/actions.ts`): llamadas directas desde el cliente, con el error
 * de vuelta en el resultado.
 *
 * Todas van por la persona (`friendPlayerId`), no por el id de la fila: la
 * pantalla no tiene por qué confiar en un id que vino del cliente, y
 * `db/friends.ts` resuelve la fila del par con la sesión.
 */
async function enElPerfil<T extends object>(
  work: (supabase: Awaited<ReturnType<typeof serverClient>>) => Promise<T>,
): Promise<({ ok: true } & T) | { ok: false; error: string }> {
  let result: T
  try {
    const supabase = await serverClient()
    result = await work(supabase)
  } catch (error) {
    if (!(error instanceof EdgeError)) throw error
    return { ok: false, error: error.message }
  }

  // Todos los perfiles del torneo (el de esta persona, y el chip en cualquier
  // otro lugar donde aparezca), la lista de Amigos e Inicio.
  revalidatePath('/torneo/[id]/[disciplina]/jugador/[entryId]', 'page')
  revalidatePath('/amigos')
  revalidatePath('/torneos')
  return { ok: true, ...result }
}

/** "Agregar": `estado` dice en qué quedó -- `friends` si el otro ya había pedido y esto lo aceptó. */
export async function agregarAmigo(
  friendPlayerId: string,
): Promise<{ ok: true; estado: 'sent' | 'friends' } | { ok: false; error: string }> {
  return enElPerfil(async (supabase) => ({ estado: await addFriend(supabase, friendPlayerId) }))
}

/** "Deshacer" en el aviso, o "Cancelar" en "Pedidos enviados": borra mi pedido, si sigue pendiente. */
export async function deshacerPedido(friendPlayerId: string): Promise<AmistadResult> {
  return enElPerfil(async (supabase) => {
    await cancelFriendRequest(supabase, friendPlayerId)
    return {}
  })
}

/** "Aceptar" en la tarjeta del encabezado, o en un pedido de Inicio o de Amigos. */
export async function aceptarPedidoDe(friendPlayerId: string): Promise<AmistadResult> {
  return enElPerfil(async (supabase) => {
    await acceptFriendRequestFrom(supabase, friendPlayerId)
    return {}
  })
}

/** ✕ en la tarjeta o en un pedido: rechaza el pedido. Al otro no le llega ningún aviso. */
export async function rechazarPedidoDe(friendPlayerId: string): Promise<AmistadResult> {
  return enElPerfil(async (supabase) => {
    await rejectFriendRequest(supabase, friendPlayerId)
    return {}
  })
}

// ── el partido casual: cargar, editar, borrar ───────────────────────────────

export interface CasualFormState {
  error: string | null
  /**
   * Cuántas veces se guardó desde que se abrió el formulario. Cargar y
   * corregir ya no redirigen (la hoja se cierra y avisa, S8e): cada guardado
   * bueno devuelve un estado nuevo, y la hoja lo nota por eso.
   */
  saved?: number
}

/** Lo que cambia cuando se guarda un partido con un amigo: su perfil, la lista y los amigos de Inicio. */
function revalidarPartido(path: string): void {
  revalidatePath(path)
  revalidatePath('/amigos')
  revalidatePath('/torneos')
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
export async function loadCasualMatch(state: CasualFormState, formData: FormData): Promise<CasualFormState> {
  const friendPlayerId = String(formData.get('friendPlayerId') ?? '')
  try {
    const supabase = await serverClient()
    // `players` es un borde de confianza: `playersFromJson` valida la forma.
    // Yo no viajo en el plantel -- la base me pone del lado A.
    const players = playersFromJson(String(formData.get('players') ?? ''))
    assertFriendPlays(friendPlayerId, players)
    await createCasualMatch(supabase, players, casualInputFrom(formData))
  } catch (error) {
    if (!(error instanceof EdgeError)) throw error
    return { error: error.message, saved: state.saved }
  }

  // Sin redirect: la pantalla es la misma, y la hoja se cierra sola al ver
  // el estado nuevo. `revalidatePath` trae el partido a la lista.
  revalidarPartido(`/amigos/${friendPlayerId}`)
  return { error: null, saved: (state.saved ?? 0) + 1 }
}

/**
 * Edita un partido casual existente -- mismo patrón que `loadCasualMatch`.
 *
 * El redirect (`redirectTarget`) vuelve a la pantalla del `<form>` si ese amigo
 * es parte del partido (`casualParticipantIds`, verificado en la base -- un formulario armado a
 * mano no puede mandar a cualquier página); si no, al `friendPlayerId` que
 * DEVUELVE `updateCasualMatch`.
 */
export async function editCasualMatch(state: CasualFormState, formData: FormData): Promise<CasualFormState> {
  const matchId = String(formData.get('matchId') ?? '')
  const submitted = String(formData.get('friendPlayerId') ?? '')
  let path: string
  try {
    const supabase = await serverClient()
    const ids = await casualParticipantIds(supabase, matchId)
    const fromDb = await updateCasualMatch(supabase, matchId, casualInputFrom(formData))
    path = redirectTarget(submitted, ids, fromDb)
  } catch (error) {
    if (!(error instanceof EdgeError)) throw error
    return { error: error.message, saved: state.saved }
  }

  revalidarPartido(path)
  // Si el partido sigue en esta pantalla, se queda acá (la hoja se cierra
  // sola); si no, va a la del amigo que sí está.
  if (path === `/amigos/${submitted}`) return { error: null, saved: (state.saved ?? 0) + 1 }
  redirect(path)
}

/**
 * Borra un partido casual. Patrón sin-JS: no hay nada que validar en el
 * borde ni un campo que mantener tipeado tras un error -- un botón que puede
 * fallar y volver con `?error=...`, igual que `sendFriendRequest`.
 *
 * En éxito, mismo criterio de redirect que `editCasualMatch`. En error no hay fila que leer (el borrado no llegó a pasar), así
 * que ahí sí se usa el del `<form>` -- es el único valor disponible para
 * saber a qué pantalla volver, y errar ese destino no es un problema de
 * permisos (el prefijo `/amigos/` sigue siendo same-origin).
 */
export async function removeCasualMatch(formData: FormData): Promise<void> {
  const matchId = String(formData.get('matchId') ?? '')
  const submitted = String(formData.get('friendPlayerId') ?? '')
  // De dónde se llegó al perfil (`?desde=amigos` o `?desde=torneo`): que Volver siga diciendo lo mismo.
  const origen = formData.get('desde')
  const desde = origen === 'amigos' || origen === 'torneo' ? `desde=${origen}` : null
  let path = `/amigos/${submitted}`
  let problem: string | null = null
  try {
    const supabase = await serverClient()
    const ids = await casualParticipantIds(supabase, matchId)
    const fromDb = await deleteCasualMatch(supabase, matchId)
    path = redirectTarget(submitted, ids, fromDb)
  } catch (error) {
    if (!(error instanceof EdgeError)) throw error
    problem = error.message
  }

  revalidarPartido(path)
  const query = [desde, problem === null ? null : `error=${encodeURIComponent(problem)}`].filter((q) => q !== null)
  redirect(query.length === 0 ? path : `${path}?${query.join('&')}`)
}
