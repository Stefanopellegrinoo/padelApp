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

const JWT_ISSUED_AT_FUTURE = 'PGRST303'
const RETRY_DELAY_MS = 300

/**
 * PostgREST rechaza con 401 `PGRST303` ("JWT issued at future") un token recién
 * emitido cuando el reloj que lo valida lee "antes" que el reloj que lo firmó.
 * No es desfasaje de NTP —los relojes de host, Postgres y GoTrue coinciden al
 * segundo—, es contención de CPU en una máquina compartida: si el contenedor
 * que valida se queda sin turno de CPU una fracción de segundo justo después
 * del login, su lectura de "ahora" puede quedar por detrás de la del que
 * firmó. PostgREST no tiene ninguna perilla de leeway para esto (`postgrest
 * -e` no lista ninguna), así que la única corrección honesta es reintentar
 * una vez, en el único lugar por el que pasan todas las lecturas: el `fetch`
 * del cliente de Supabase.
 *
 * ponytail: un solo reintento, con una espera fija de 300ms. Si esto no
 * alcanza y hace falta un segundo reintento o backoff, ya no es un problema
 * de timing sino de la máquina bajo esa carga, y hay que mirar eso primero.
 */
export async function fetchWithFreshTokenRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init)
  if (response.status !== 401) return response

  const body: unknown = await response.clone().json().catch(() => null)
  const code = (body as { code?: unknown } | null)?.code
  if (code !== JWT_ISSUED_AT_FUTURE) return response

  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
  return fetch(input, init)
}

export function browserClient() {
  const { url, anonKey } = credentials()
  return createBrowserClient<Database>(url, anonKey, {
    global: { fetch: fetchWithFreshTokenRetry },
  })
}
