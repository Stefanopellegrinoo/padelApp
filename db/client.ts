import { createBrowserClient, createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from './database.types'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

function credentials(): { url: string; anonKey: string } {
  if (url === undefined || anonKey === undefined) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY.')
  }
  return { url, anonKey }
}

export function browserClient() {
  const { url, anonKey } = credentials()
  return createBrowserClient<Database>(url, anonKey)
}

export async function serverClient() {
  const { url, anonKey } = credentials()
  const store = await cookies()
  return createServerClient<Database>(url, anonKey, {
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
}
