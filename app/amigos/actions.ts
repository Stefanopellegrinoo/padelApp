'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  acceptFriendship,
  requestFriendship,
  createCasualMatch,
  updateCasualMatch,
  deleteCasualMatch,
  type CasualMatchInput,
} from '@/db/friends'
import { EdgeError } from '@/db/errors'
import { serverClient } from '@/db/server'

/**
 * Las escrituras de Amigos que NO tienen estado de cliente que muestre un
 * error -- mismo patrón que `renameTournament`
 * (`app/torneo/[id]/ajustes/actions.ts`): un `<form>` sin JavaScript, y el
 * error vuelve por la query. `path` es el destino del redirect: las dos
 * escrituras originales (pedir/aceptar amistad) siempre vuelven a `/amigos`,
 * pero borrar un partido casual pasa por acá también y tiene que volver a
 * `/amigos/{playerId}`, no a la lista -- por eso es un parámetro y no un
 * literal.
 */
async function onAmigos(
  path: string,
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

  revalidatePath(path)
  redirect(problem === null ? path : `${path}?error=${encodeURIComponent(problem)}`)
}

export async function sendFriendRequest(formData: FormData): Promise<void> {
  const friendPlayerId = String(formData.get('friendPlayerId') ?? '').trim()
  await onAmigos('/amigos', (supabase) => requestFriendship(supabase, friendPlayerId))
}

export async function accept(formData: FormData): Promise<void> {
  const friendshipId = String(formData.get('friendshipId') ?? '')
  await onAmigos('/amigos', (supabase) => acceptFriendship(supabase, friendshipId))
}

// ── el partido casual: cargar, editar, borrar ───────────────────────────────

export interface CasualFormState {
  error: string | null
}

/**
 * Los siete campos del formulario tal cual llegan de `FormData` -- ni un
 * `Number()` ni un `.trim()` acá: `parseCasualInput` (`db/friends.ts`) es el
 * único lugar que valida, para que `createCasualMatch`/`updateCasualMatch` se
 * puedan probar sin pasar por esta capa (ver los tests de
 * `db/friends.db.test.ts`).
 */
function casualInputFrom(formData: FormData): CasualMatchInput {
  return {
    sport: String(formData.get('sport') ?? ''),
    playedOn: String(formData.get('playedOn') ?? ''),
    outcome: String(formData.get('outcome') ?? ''),
    scoreMine: String(formData.get('scoreMine') ?? ''),
    scoreTheirs: String(formData.get('scoreTheirs') ?? ''),
    teamMine: String(formData.get('teamMine') ?? ''),
    teamTheirs: String(formData.get('teamTheirs') ?? ''),
  }
}

/**
 * Carga un partido casual nuevo. Firma de `useActionState`
 * (`(prevState, formData) => nextState`) en vez del patrón sin-JS de arriba:
 * a diferencia de pedir/aceptar amistad (un solo campo, nada que validar en
 * el borde), este formulario tiene siete campos y una validación real
 * (`parseCasualInput`) que puede rechazar -- mostrar el error SIN perder lo
 * ya tipeado, en la misma pantalla, es lo que `registro-form.tsx` ya resuelve
 * con este hook. `friendPlayerId` viaja en un input oculto, no en un
 * argumento -- mismo criterio que `next` en `registro-form.tsx`: este repo no
 * tiene precedente de `action.bind()`.
 */
export async function loadCasualMatch(_state: CasualFormState, formData: FormData): Promise<CasualFormState> {
  const friendPlayerId = String(formData.get('friendPlayerId') ?? '')
  try {
    const supabase = await serverClient()
    await createCasualMatch(supabase, friendPlayerId, casualInputFrom(formData))
  } catch (error) {
    if (!(error instanceof EdgeError)) throw error
    return { error: error.message }
  }

  revalidatePath(`/amigos/${friendPlayerId}`)
  redirect(`/amigos/${friendPlayerId}`)
}

/**
 * Edita un partido casual existente -- mismo patrón que `loadCasualMatch`.
 *
 * El redirect usa el `friendPlayerId` que DEVUELVE `updateCasualMatch`, no el
 * del `<form>` (que igual viaja, para el hidden field que comparte con
 * `loadCasualMatch`, pero esta action no lo lee): son dos fuentes para el
 * mismo dato, una para escribir y otra para redirigir, y un formulario
 * armado a mano podría hacerlas divergir -- consecuencia menor (redirect a
 * la página equivocada después de una escritura correcta), pero evitable
 * leyendo una sola vez.
 */
export async function editCasualMatch(_state: CasualFormState, formData: FormData): Promise<CasualFormState> {
  const matchId = String(formData.get('matchId') ?? '')
  let friendPlayerId: string
  try {
    const supabase = await serverClient()
    friendPlayerId = await updateCasualMatch(supabase, matchId, casualInputFrom(formData))
  } catch (error) {
    if (!(error instanceof EdgeError)) throw error
    return { error: error.message }
  }

  revalidatePath(`/amigos/${friendPlayerId}`)
  redirect(`/amigos/${friendPlayerId}`)
}

/**
 * Borra un partido casual. Patrón sin-JS: no hay nada que validar en el
 * borde ni un campo que mantener tipeado tras un error -- un botón que puede
 * fallar y volver con `?error=...`, igual que `accept`.
 */
export async function removeCasualMatch(formData: FormData): Promise<void> {
  const friendPlayerId = String(formData.get('friendPlayerId') ?? '')
  const matchId = String(formData.get('matchId') ?? '')
  await onAmigos(`/amigos/${friendPlayerId}`, (supabase) => deleteCasualMatch(supabase, matchId))
}
