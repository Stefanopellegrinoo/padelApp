'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { EdgeError } from '@/db/errors'
import { acceptFriendInvite } from '@/db/friends'
import { serverClient } from '@/db/server'

/**
 * "Sumarme como amigo" (odd/tasks/amigos-faciles.md, S5). Un `<form>` sin
 * JavaScript, como `claimSeat` en `/unirse/[token]`: la pantalla es de
 * servidor y no tiene estado donde volcar un error, así que el motivo vuelve
 * por la query.
 *
 * Sólo viaja el token: quién se suma lo pone la base con la sesión, y a quién
 * lo dice el token (`accept_friend_invite`, 0116). Sale a su historial con
 * `?amistad=nueva`, que muestra "Listo, ya son amigos".
 */
export async function sumarmeComoAmigo(form: FormData): Promise<void> {
  const token = String(form.get('token') ?? '')
  let inviter: string
  try {
    const supabase = await serverClient()
    inviter = await acceptFriendInvite(supabase, token)
  } catch (error) {
    if (!(error instanceof EdgeError)) throw error
    redirect(`/amigo/${encodeURIComponent(token)}?error=${encodeURIComponent(error.message)}`)
  }

  revalidatePath('/amigos')
  revalidatePath('/torneos')
  redirect(`/amigos/${inviter}?desde=amigos&amistad=nueva`)
}
