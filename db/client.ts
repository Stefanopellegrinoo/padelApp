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
async function withFreshTokenRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init)
  if (response.status !== 401) return response

  const body: unknown = await response.clone().json().catch(() => null)
  const code = (body as { code?: unknown } | null)?.code
  if (code !== JWT_ISSUED_AT_FUTURE) return response

  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
  return fetch(input, init)
}

/** `SUPABASE_TRACE_MS` en ms. `null` —instrumento apagado— ante cualquier cosa que no sea un número finito ≥ 0. */
function parseTraceMs(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const ms = Number(raw)
  return Number.isFinite(ms) && ms >= 0 ? ms : null
}

/** Reseteado tras una pausa: así la ÚLTIMA línea de una ráfaga de consultas ya lee la cuenta completa. */
const QUIET_GAP_MS = 400

/**
 * Instrumento dev-only para medir lo que el harness de `scripts/ux-measure.mjs`
 * no puede ver: corre contra Supabase LOCAL (~0ms por consulta), así que un
 * número verde ahí no dice nada de lo que pasa contra una base a distancia
 * real. `SUPABASE_TRACE_MS` envuelve el mismo seam por el que pasan los tres
 * clientes (`browserClient`, `serverClient`, `middleware.ts`) para (a) contar
 * viajes de ida y vuelta por consulta y (b) opcionalmente sumarles un delay,
 * modelando la distancia real a la base.
 *
 * IMPOSIBLE de prender en producción: `NODE_ENV` es la puerta de AFUERA, no
 * `SUPABASE_TRACE_MS` sola. `next build` INLINEA `process.env.NODE_ENV` — el
 * bundler convierte la condición en `'production' === 'production'` y borra
 * la rama entera por dead-code elimination. No es un chequeo que alguien
 * pueda prender desde el dashboard de Vercel: en producción no queda código
 * que siquiera LEA `SUPABASE_TRACE_MS`. Una sola variable de entorno como
 * gate sería legible en runtime y por lo tanto activable por error — por eso
 * `NODE_ENV` va afuera, no como chequeo adicional adentro.
 */
function traced(fetchFn: typeof withFreshTokenRetry, delayMs: number): typeof withFreshTokenRetry {
  let count = 0
  let lastAt = 0

  return async (input, init) => {
    const now = Date.now()
    if (now - lastAt > QUIET_GAP_MS) count = 0
    lastAt = now
    count += 1

    // El reloj arranca ANTES del delay inyectado, no después: la línea tiene
    // que leer lo que el round trip cuesta CON la latencia simulada puesta,
    // que es el número que se compara contra los ~120ms/consulta reales.
    const started = Date.now()
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
    const response = await fetchFn(input, init)
    const path = typeof input === 'string' ? input : input.toString()
    // ponytail: la cuenta asume consultas SECUENCIALES, una a la vez — si dos
    // requests corren en paralelo se entrelazan y el número de la última línea
    // deja de ser exacto. Correcto para leer el costo de UN tilde a la vez,
    // que es para lo que sirve; para tráfico concurrente hace falta un id por
    // request, no sólo un contador global.
    console.log(`[db] #${count} ${Date.now() - started}ms ${init?.method ?? 'GET'} ${path}`)
    return response
  }
}

const traceMs = process.env.NODE_ENV === 'production' ? null : parseTraceMs(process.env.SUPABASE_TRACE_MS)

// El export es la función original, no un wrapper con un `if` adentro: sin
// instrumento activo el costo es literalmente cero, no una rama que se salta.
export const fetchWithFreshTokenRetry =
  traceMs === null ? withFreshTokenRetry : traced(withFreshTokenRetry, traceMs)

export function browserClient() {
  const { url, anonKey } = credentials()
  return createBrowserClient<Database>(url, anonKey, {
    global: { fetch: fetchWithFreshTokenRetry },
  })
}
