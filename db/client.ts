import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

/**
 * Cualquier cliente de Supabase tipado contra el schema generado: el del
 * browser, el del servidor, o el de los tests. Las funciones de `db/` piden
 * esto y no un cliente concreto, así que la misma función corre en los tres
 * lados sin saber cuál le tocó.
 */
export type Client = SupabaseClient<Database>

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

/**
 * Las credenciales se leen y se validan AL LLAMAR, no al importar el módulo: un
 * `throw` en tiempo de import rompe el build de Next antes de que nadie pueda
 * leer el mensaje.
 */
export function credentials(): { url: string; anonKey: string } {
  if (url === undefined || anonKey === undefined) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY.')
  }
  return { url, anonKey }
}

export function browserClient() {
  const { url, anonKey } = credentials()
  return createBrowserClient<Database>(url, anonKey)
}
