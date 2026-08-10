import { createClient } from '@supabase/supabase-js'
import type { Database } from '../database.types'

// Saltea RLS: sirve para ARMAR la escena de un test, nunca para asertar sobre
// ella — asertar con esta llave haría pasar cualquier política, esté rota o no.
export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (url === undefined || serviceRoleKey === undefined) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.')
  }
  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
