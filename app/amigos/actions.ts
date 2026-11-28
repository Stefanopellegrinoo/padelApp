'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  acceptFriendRequestFrom,
  addFriend,
  cancelFriendRequest,
  rejectFriendRequest,
  rotateFriendInvite,
  createCasualMatch,
  updateCasualMatch,
  deleteCasualMatch,
  casualParticipantIds,
} from '@/db/friends'
import { searchByUsername, type UsernameMatch } from '@/db/buscar'
import { EdgeError } from '@/db/errors'
import { serverClient } from '@/db/server'
import { playersFromJson } from './[playerId]/cargar-state'
import { assertFriendPlays, casualInputFrom, redirectTarget } from './casual-form-data'

/**
 * "Cambiar el link" en la hoja "Tu link de amistad" (`link.tsx`,
 * odd/tasks/amigos-faciles.md, S5): un token nuevo, y el de ahora deja de
 * andar. Sin redirect, como las de abajo: la hoja se queda abierta y muestra
 * el link nuevo, o el error.
 */
export async function cambiarMiLink(): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  let token: string
  try {
    const supabase = await serverClient()
    token = await rotateFriendInvite(supabase)
  } catch (error) {
    if (!(error instanceof EdgeError)) throw error
    return { ok: false, error: error.message }
  }

  revalidatePath('/amigos')
  return { ok: true, token }
}

/**
 * El buscador de Amigos por @usuario (`buscar.tsx`, S8): hasta 10 que empiezan
 * con lo que escribiste, cada uno con su estado conmigo. Es una lectura: no
 * revalida nada. Con menos de 3 letras, nada (lo mismo que hace la base).
 */
export async function buscarPorUsuario(
  query: string,
): Promise<{ ok: true; resultados: UsernameMatch[] } | { ok: false; error: string }> {
  try {
    const supabase = await serverClient()
    return { ok: true, resultados: await searchByUsername(supabase, String(query)) }
  } catch (error) {
    if (!(error instanceof EdgeError)) throw error
    return { ok: false, error: error.message }
  }
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
  // otro lugar donde aparezca), su perfil (`/perfil/<id>`), la lista de Amigos
  // e Inicio.
  revalidatePath('/torneo/[id]/[disciplina]/jugador/[entryId]', 'page')
  revalidatePath('/perfil/[playerId]', 'page')
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
 * fallar y volver con `?error=...`.
 *
 * En éxito, mismo criterio de redirect que `editCasualMatch`. En error no hay fila que leer (el borrado no llegó a pasar), así
 * que ahí sí se usa el del `<form>` -- es el único valor disponible para
 * saber a qué pantalla volver, y errar ese destino no es un problema de
 * permisos (el prefijo `/amigos/` sigue siendo same-origin).
 */
export async function removeCasualMatch(formData: FormData): Promise<void> {
  const matchId = String(formData.get('matchId') ?? '')
  const submitted = String(formData.get('friendPlayerId') ?? '')
  // De dónde se llegó al perfil (`?desde=amigos`, `?desde=torneo` o `?desde=perfil`): que Volver siga diciendo lo mismo.
  const origen = formData.get('desde')
  const desde = origen === 'amigos' || origen === 'torneo' || origen === 'perfil' ? `desde=${origen}` : null
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
