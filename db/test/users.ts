import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../database.types'
import { adminClient } from './admin'

export interface TestUser {
  client: SupabaseClient<Database>
  userId: string
  playerId: string
}

const PASSWORD = 'test-password-not-for-humans'

let counter = 0

// Crea un usuario real (Admin API) y su player, y devuelve un cliente logueado
// como esa persona — con la key `anon`, así que sujeto a RLS de punta a punta.
//
// El trigger de alta que crea el player solo (Task 7) todavía no existe en
// este punto del plan, así que el player se inserta acá a mano con la llave
// de service_role.
export async function createTestUser(email?: string): Promise<TestUser> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (url === undefined || anonKey === undefined) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY.')
  }

  const admin = adminClient()
  const userEmail = email ?? `rls-test-${Date.now()}-${counter++}@example.com`

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: userEmail,
    password: PASSWORD,
    email_confirm: true,
  })
  if (createError || created.user === null) {
    throw new Error(`No se pudo crear el usuario de test: ${createError?.message}`)
  }

  const { data: player, error: playerError } = await admin
    .from('players')
    .insert({ display_name: userEmail, user_id: created.user.id })
    .select('id')
    .single()
  if (playerError || player === null) {
    throw new Error(`No se pudo crear el player de test: ${playerError?.message}`)
  }

  const client = createClient<Database>(url, anonKey)
  const { error: signInError } = await client.auth.signInWithPassword({
    email: userEmail,
    password: PASSWORD,
  })
  if (signInError) {
    throw new Error(`No se pudo loguear al usuario de test: ${signInError.message}`)
  }

  return { client, userId: created.user.id, playerId: player.id }
}
