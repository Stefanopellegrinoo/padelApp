'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { acceptFriendship, requestFriendship } from '@/db/friends'
import { EdgeError } from '@/db/errors'
import { serverClient } from '@/db/server'

/**
 * Las dos escrituras de Amigos, con el mismo patrón que `renameTournament`
 * (`app/torneo/[id]/ajustes/actions.ts`): un `<form>` sin JavaScript, y el
 * error vuelve por la query porque no hay estado de cliente que lo muestre.
 */
async function onAmigos(work: (supabase: Awaited<ReturnType<typeof serverClient>>) => Promise<void>): Promise<void> {
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
