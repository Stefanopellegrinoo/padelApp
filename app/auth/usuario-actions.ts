'use server'

import { EdgeError } from '@/db/errors'
import { serverClient } from '@/db/server'
import { usernameStatus, type UsernameStatus } from '@/db/usuario'

/**
 * Lo que dice el campo @usuario mientras escribís, en el registro y en la
 * pantalla única (odd/tasks/amigos-faciles.md, S7). Anda sin sesión: el
 * registro es anónimo, y `username_available` (0120) es la única función de
 * este feature abierta a `anon`, que sólo contesta sí o no por uno exacto.
 *
 * `null` si no se pudo preguntar: el campo no dice nada antes que decir algo
 * que no sabe.
 */
export async function revisarUsuario(raw: string): Promise<UsernameStatus | null> {
  try {
    return await usernameStatus(await serverClient(), raw.slice(0, 64))
  } catch (error) {
    if (!(error instanceof EdgeError)) throw error
    return null
  }
}
