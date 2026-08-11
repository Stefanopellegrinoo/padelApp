import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { credentials, type Client } from './client'
import type { Database } from './database.types'

/**
 * El cliente del servidor vive en su propio módulo, aparte de `browserClient`.
 *
 * No es prolijidad: `next/headers` sólo existe del lado del servidor, y un
 * componente `'use client'` que importe CUALQUIER cosa de este archivo se lo
 * arrastra entero y rompe el build de producción. `tsc` y los tests no lo ven
 * —los dos pasan en verde—, así que sólo aparece en `npm run build`.
 */
export async function serverClient(): Promise<Client> {
  const { url, anonKey } = credentials()
  const store = await cookies()
  // El tipo de retorno se anota a mano contra `Client`: los genéricos de
  // `createServerClient` de `@supabase/ssr@0.5.2` quedaron pensados para una
  // forma vieja de `SupabaseClient` (3 parámetros posicionales) y ya no calzan
  // con la de `@supabase/supabase-js@2.112.2` instalada — no lo grita acá por
  // `skipLibCheck`, pero deja `Functions`/`rpc()` rotos para quien consuma
  // este cliente. Es el mismo objeto en tiempo de ejecución; sólo se corrige
  // el tipo con el que TypeScript lo ve.
  const client = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return store.getAll()
      },
      // El tipo va escrito a mano igual que en `middleware.ts`: `createServerClient`
      // tiene dos overloads —el viejo `get/set/remove` y este `getAll/setAll`— y
      // TypeScript no puede propagar el tipo contextual del callback a través de
      // firmas que no coinciden. Sin la anotación, `toSet` queda `any` implícito.
      setAll(toSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          for (const { name, value, options } of toSet) store.set(name, value, options)
        } catch {
          // Un Server Component no puede escribir cookies. El middleware ya
          // refrescó la sesión, así que acá no hay nada que hacer.
        }
      },
    },
  })
  // `as unknown as`: la forma que devuelve `createServerClient` y `Client` no
  // son estructuralmente asignables una a la otra por el desfasaje de arriba,
  // aunque en tiempo de ejecución sean el mismo objeto.
  return client as unknown as Client
}
