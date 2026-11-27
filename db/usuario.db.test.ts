import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import type { Database } from './database.types'
import { EdgeError } from './errors'
import { adminClient } from './test/admin'
import { createTestUser } from './test/users'
import { chooseMyUsername, myUsername, usernameAvailable } from './usuario'

/**
 * El @usuario (odd/tasks/amigos-faciles.md, S7, T7): único sin importar
 * mayúsculas, de 3 a 20 caracteres, se elige una sola vez y no se cambia. Lo
 * escribe sólo `choose_my_username` (0121) o el trigger de alta (0119), que
 * nunca falla por el @usuario.
 */

const db = () => adminClient()
const PASSWORD = 'test-password-not-for-humans'

let counter = 0
/** Un @usuario que ninguna corrida anterior usó: la base local no se resetea. */
function freshHandle(prefix = 'tu'): string {
  return `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`.slice(0, 20)
}

async function usernameOf(playerId: string): Promise<string | null> {
  const { data, error } = await db().from('players').select('username').eq('id', playerId).single()
  if (error) throw new Error(error.message)
  return data.username
}

function anonClient() {
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
}

/** Un alta como la del registro: el trigger lee `display_name` y `username` del metadata. */
async function signUpWith(metadata: Record<string, unknown>): Promise<{ display_name: string; username: string | null }> {
  const email = `usuario-alta-${Date.now()}-${counter++}@example.com`
  const { data, error } = await db().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: metadata,
  })
  if (error || data.user === null) throw new Error(`el alta falló: ${error?.message}`)
  const { data: players, error: readError } = await db()
    .from('players')
    .select('display_name, username')
    .eq('user_id', data.user.id)
  if (readError) throw new Error(readError.message)
  expect(players).toHaveLength(1)
  return players[0]!
}

describe('choose_my_username', () => {
  it('guarda el @usuario elegido, en minúsculas, y lo devuelve', async () => {
    const yo = await createTestUser()
    const handle = freshHandle('Nico.')

    expect(await chooseMyUsername(yo.client, handle)).toBe(handle.toLowerCase())
    expect(await usernameOf(yo.playerId)).toBe(handle.toLowerCase())
  })

  it('rechaza un formato inválido con el motivo, y no guarda nada', async () => {
    const yo = await createTestUser()
    // Directo a la RPC: el envoltorio valida antes y esto prueba la base.
    for (const malo of ['ab', 'a'.repeat(21), '.nico', '_nico', 'nico arias', 'niño', 'nico-arias', '']) {
      const { data, error } = await yo.client.rpc('choose_my_username', { p_username: malo })
      expect(data, malo).toBeNull()
      expect(error?.message, malo).toBe(
        'Usá de 3 a 20 letras, números, punto o guion bajo, empezando con una letra o un número.',
      )
    }
    expect(await usernameOf(yo.playerId)).toBeNull()
  })

  it('la base pasa a minúsculas lo que le llega', async () => {
    const yo = await createTestUser()
    const handle = freshHandle('Mayus.')
    const { data, error } = await yo.client.rpc('choose_my_username', { p_username: ` ${handle} ` })
    expect(error).toBeNull()
    expect(data).toBe(handle.toLowerCase())
    expect(await usernameOf(yo.playerId)).toBe(handle.toLowerCase())
  })

  it('es único sin importar mayúsculas: el segundo ve que ya está en uso', async () => {
    const primero = await createTestUser()
    const segundo = await createTestUser()
    const handle = freshHandle()
    await chooseMyUsername(primero.client, handle)

    await expect(chooseMyUsername(segundo.client, handle.toUpperCase())).rejects.toThrow(
      new EdgeError('Ese @usuario ya está en uso.'),
    )
    const { error } = await segundo.client.rpc('choose_my_username', { p_username: handle.toUpperCase() })
    expect(error?.message).toBe('Ese @usuario ya está en uso.')
    expect(await usernameOf(segundo.playerId)).toBeNull()
    expect(await usernameOf(primero.playerId)).toBe(handle)
  })

  it('se elige una sola vez: la segunda llamada falla y el de antes queda', async () => {
    const yo = await createTestUser()
    const primero = freshHandle()
    await chooseMyUsername(yo.client, primero)

    await expect(chooseMyUsername(yo.client, freshHandle())).rejects.toThrow(new EdgeError('Ya elegiste tu @usuario.'))
    await expect(chooseMyUsername(yo.client, primero)).rejects.toThrow(new EdgeError('Ya elegiste tu @usuario.'))
    expect(await usernameOf(yo.playerId)).toBe(primero)
  })

  it('sólo escribe el jugador de quien llama, nunca el de otro', async () => {
    const yo = await createTestUser()
    const otro = await createTestUser()
    const handle = freshHandle()

    await chooseMyUsername(yo.client, handle)

    expect(await usernameOf(otro.playerId)).toBeNull()
    // No hay forma de nombrar a otro jugador: la función no recibe uno.
    const { error } = await yo.client.rpc('choose_my_username' as never, {
      p_username: freshHandle(),
      p_player: otro.playerId,
    } as never)
    expect(error).not.toBeNull()
    expect(await usernameOf(otro.playerId)).toBeNull()
  })

  it('sin sesión no se puede llamar', async () => {
    const { error } = await anonClient().rpc('choose_my_username', { p_username: freshHandle() })
    expect(error?.code).toBe('42501')
  })
})

describe('players.username no se escribe directo', () => {
  it('ni el propio ni el de otro: permiso denegado y nada cambia', async () => {
    const yo = await createTestUser()
    const otro = await createTestUser()
    const mio = freshHandle()
    await chooseMyUsername(yo.client, mio)

    for (const playerId of [yo.playerId, otro.playerId]) {
      const { error } = await yo.client.from('players').update({ username: freshHandle() }).eq('id', playerId)
      expect(error?.code).toBe('42501')
    }
    const { error: insertError } = await yo.client
      .from('players')
      .insert({ display_name: 'Colado', username: freshHandle() })
    expect(insertError?.code).toBe('42501')

    expect(await usernameOf(yo.playerId)).toBe(mio)
    expect(await usernameOf(otro.playerId)).toBeNull()
  })

  it('la base rechaza un formato inválido aunque lo escriba service_role', async () => {
    const { error } = await db().from('players').insert({ display_name: 'Formato', username: 'Mayus' })
    expect(error?.code).toBe('23514')
  })
})

describe('username_available', () => {
  it('libre da true; tomado da false, en cualquier combinación de mayúsculas', async () => {
    const yo = await createTestUser()
    const handle = freshHandle()

    expect(await usernameAvailable(yo.client, handle)).toBe(true)
    await chooseMyUsername(yo.client, handle)
    expect(await usernameAvailable(yo.client, handle)).toBe(false)
    expect(await usernameAvailable(yo.client, handle.toUpperCase())).toBe(false)
  })

  it('un formato inválido no está disponible', async () => {
    const yo = await createTestUser()
    for (const malo of ['ab', '.nico', 'nico arias', 'a'.repeat(21)]) {
      expect(await usernameAvailable(yo.client, malo), malo).toBe(false)
    }
  })

  it('se puede preguntar sin sesión (el registro es anónimo) y sólo dice sí o no', async () => {
    const yo = await createTestUser()
    const handle = freshHandle()
    await chooseMyUsername(yo.client, handle)
    const anon = anonClient()

    expect(await usernameAvailable(anon, handle)).toBe(false)
    expect(await usernameAvailable(anon, freshHandle())).toBe(true)
  })
})

describe('my_username', () => {
  it('null hasta que lo elegís; después, el tuyo', async () => {
    const yo = await createTestUser()
    const otro = await createTestUser()
    await chooseMyUsername(otro.client, freshHandle())

    expect(await myUsername(yo.client)).toBeNull()
    const handle = freshHandle()
    await chooseMyUsername(yo.client, handle)
    expect(await myUsername(yo.client)).toBe(handle)
  })

  it('sin sesión no se puede llamar', async () => {
    const { error } = await anonClient().rpc('my_username')
    expect(error?.code).toBe('42501')
  })
})

describe('alta de cuenta con @usuario', () => {
  it('un @usuario válido y libre queda guardado, en minúsculas, con el nombre de siempre', async () => {
    const handle = freshHandle('Alta.')
    expect(await signUpWith({ display_name: 'Martín Pérez', username: handle })).toEqual({
      display_name: 'Martín Pérez',
      username: handle.toLowerCase(),
    })
  })

  it('un @usuario tomado no frena el alta: el jugador queda sin @usuario', async () => {
    const yo = await createTestUser()
    const handle = freshHandle()
    await chooseMyUsername(yo.client, handle)

    expect(await signUpWith({ display_name: 'Nico Arias', username: handle.toUpperCase() })).toEqual({
      display_name: 'Nico Arias',
      username: null,
    })
    expect(await usernameOf(yo.playerId)).toBe(handle)
  })

  it('un @usuario inválido tampoco: queda sin @usuario', async () => {
    for (const malo of ['ab', '.nico', 'nico arias', 'a'.repeat(21), 42, { x: 1 }]) {
      expect(await signUpWith({ display_name: '  Juampi  ', username: malo })).toEqual({
        display_name: 'Juampi',
        username: null,
      })
    }
  })

  it('sin @usuario, el nombre sale como antes (del mail si no hay nombre)', async () => {
    const email = `sin-usuario-${Date.now()}-${counter++}@example.com`
    const { data, error } = await db().auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
    if (error || data.user === null) throw new Error(error?.message)
    const { data: player } = await db()
      .from('players')
      .select('display_name, username')
      .eq('user_id', data.user.id)
      .single()
    expect(player).toEqual({ display_name: email.split('@')[0], username: null })
  })

  it('el registro real por GoTrue (como la app) guarda el @usuario', async () => {
    const handle = freshHandle()
    const email = `usuario-signup-${Date.now()}-${counter++}@example.com`
    const { data, error } = await anonClient().auth.signUp({
      email,
      password: PASSWORD,
      options: { data: { display_name: 'Facu Gómez', username: handle } },
    })
    if (error || data.user === null) throw new Error(error?.message)
    const { data: player } = await db()
      .from('players')
      .select('display_name, username')
      .eq('user_id', data.user.id)
      .single()
    expect(player).toEqual({ display_name: 'Facu Gómez', username: handle })
  })
})
