import { describe, it, expect } from 'vitest'
import { adminClient } from './test/admin'

const PASSWORD = 'test-password-not-for-humans'

// El trigger `on_auth_user_created` (0003_new_user.sql) es el único que
// inserta en `players` para un alta nueva. Se lee con service_role porque
// esto prueba al trigger, no RLS.
async function playersFor(userId: string) {
  const { data, error } = await adminClient()
    .from('players')
    .select('id, display_name')
    .eq('user_id', userId)
  if (error) throw new Error(error.message)
  return data
}

describe('alta de cuenta', () => {
  it('crea un player al registrarse', async () => {
    const email = `alta-${Date.now()}@example.com`
    const { data, error } = await adminClient().auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    })
    if (error || data.user === null) throw new Error(error?.message)

    const players = await playersFor(data.user.id)

    expect(players).toHaveLength(1)
  })

  it('usa el display_name del formulario', async () => {
    const email = `alta-${Date.now()}@example.com`
    const { data, error } = await adminClient().auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: 'Marce' },
    })
    if (error || data.user === null) throw new Error(error?.message)

    const players = await playersFor(data.user.id)

    expect(players[0]?.display_name).toBe('Marce')
  })

  it('cae al pedazo del mail cuando no viene nombre', async () => {
    const email = `sin-nombre-${Date.now()}@example.com`
    const { data, error } = await adminClient().auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    })
    if (error || data.user === null) throw new Error(error?.message)

    const players = await playersFor(data.user.id)

    expect(players[0]?.display_name).toBe(email.split('@')[0])
  })

  it('un player por usuario, no dos', async () => {
    const email = `unico-${Date.now()}@example.com`
    const { data, error } = await adminClient().auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    })
    if (error || data.user === null) throw new Error(error?.message)

    // El trigger ya insertó un player para este usuario. Un segundo insert a
    // mano —el patrón que usaba `db/test/users.ts` antes de este trigger—
    // choca con el unique de `players.user_id`.
    const { error: duplicateError } = await adminClient()
      .from('players')
      .insert({ display_name: 'Duplicado', user_id: data.user.id })

    expect(duplicateError?.code).toBe('23505')
  })
})
