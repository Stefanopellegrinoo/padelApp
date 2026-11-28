'use server'

import { revalidatePath } from 'next/cache'
import { setMyDiscoverable } from '@/db/buscar'
import { EdgeError } from '@/db/errors'
import { serverClient } from '@/db/server'

/**
 * El interruptor "Que me encuentren por mi usuario" de tu perfil
 * (`interruptor.tsx`, odd/tasks/amigos-faciles.md, S8, S9). Siempre el tuyo:
 * `set_my_discoverable` (0125) saca el jugador de la sesión. Devuelve cómo
 * quedó, o el error para que la pantalla vuelva atrás.
 */
export async function guardarQueMeEncuentren(
  valor: boolean,
): Promise<{ ok: true; valor: boolean } | { ok: false; error: string }> {
  // Viene del cliente: un valor que no es sí o no no se guarda.
  if (typeof valor !== 'boolean') return { ok: false, error: 'Falta si te pueden encontrar.' }
  let guardado: boolean
  try {
    const supabase = await serverClient()
    guardado = await setMyDiscoverable(supabase, valor)
  } catch (error) {
    if (!(error instanceof EdgeError)) throw error
    return { ok: false, error: error.message }
  }

  revalidatePath('/perfil')
  return { ok: true, valor: guardado }
}
