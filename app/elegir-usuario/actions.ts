'use server'

import { redirect } from 'next/navigation'
import { afterLogin } from '@/app/auth/next-path'
import { EdgeError } from '@/db/errors'
import { serverClient } from '@/db/server'
import { chooseMyUsername } from '@/db/usuario'

/**
 * "Sí, usar este" en la pantalla única (odd/tasks/amigos-faciles.md, S7):
 * guarda tu @usuario para siempre (`choose_my_username`, 0121) y sigue a
 * donde ibas. `next` se valida como en el login (`afterLogin`): una ruta de
 * esta app, y si no hay, Inicio. Si la base lo rechaza ("Ese @usuario ya está
 * en uso.") vuelve el motivo. El `redirect` va fuera del `try`: adentro, el
 * `catch` se lo comería.
 */
export async function elegirUsuario(username: string, next: string): Promise<{ error: string | null }> {
  try {
    await chooseMyUsername(await serverClient(), username)
  } catch (error) {
    if (!(error instanceof EdgeError)) throw error
    return { error: error.message }
  }
  redirect(afterLogin(next))
}
