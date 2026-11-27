import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { deleteMyAccount } from './account'
import type { Database } from './database.types'
import {
  acceptFriendInvite,
  friendInvitePreview,
  myFriendInvite,
  rotateFriendInvite,
} from './friends'
import { playerNames } from './read'
import { adminClient } from './test/admin'
import { createTestUser, type TestUser } from './test/users'

// El link de amistad (odd/tasks/amigos-faciles.md, S5, T4; migraciones 0112-0116).
// Un token largo por jugador, que sólo se lee y se escribe por funciones
// `security definer` que sacan la identidad de `auth.uid()`. Compartirlo es tu
// consentimiento: quien lo abre y confirma queda como tu amigo al toque.

const db = () => adminClient()
const VENCIDO = 'Este link ya no anda, pedile uno nuevo'

function anonClient() {
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
}

function par(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x]
}

/** Lo que una llamada rechazada no puede tocar: las amistades y los links de estas personas. */
async function foto(...personas: TestUser[]) {
  const ids = personas.map((p) => p.playerId)
  const { data: amistades, error: e1 } = await db()
    .from('friendships')
    .select('*')
    .or(ids.flatMap((id) => [`player_a.eq.${id}`, `player_b.eq.${id}`]).join(','))
    .order('id')
  const { data: links, error: e2 } = await db().from('friend_invites').select('*').in('player_id', ids).order('player_id')
  if (e1 !== null || e2 !== null) throw new Error(e1?.message ?? e2?.message)
  return { amistades, links }
}

async function amistadEntre(x: TestUser, y: TestUser) {
  const [a, b] = par(x.playerId, y.playerId)
  const { data, error } = await db().from('friendships').select('*').eq('player_a', a).eq('player_b', b)
  if (error !== null) throw new Error(error.message)
  return data
}

async function pedido(de: TestUser, a: TestUser) {
  const [player_a, player_b] = par(de.playerId, a.playerId)
  const { error } = await db().from('friendships').insert({ player_a, player_b, requested_by: de.playerId })
  if (error !== null) throw new Error(error.message)
}

describe('friend_invites: permisos', () => {
  it('anon no lee la tabla ni ejecuta ninguna de las funciones', async () => {
    const anon = anonClient()
    const tabla = await anon.from('friend_invites').select('*').limit(1)
    expect(tabla.data).toBeNull()
    expect(tabla.error?.code).toBe('42501')

    const llamadas = [
      anon.rpc('my_friend_invite'),
      anon.rpc('rotate_friend_invite'),
      anon.rpc('friend_invite_preview', { p_token: 'x' }),
      anon.rpc('accept_friend_invite', { p_token: 'x' }),
    ]
    for (const { data, error } of await Promise.all(llamadas)) {
      expect(data).toBeNull()
      expect(error?.code).toBe('42501')
    }
  })

  it('cada uno lee sólo su propia fila', async () => {
    const yo = await createTestUser()
    const otro = await createTestUser()
    const mio = await myFriendInvite(yo.client)
    const suyo = await myFriendInvite(otro.client)

    const { data, error } = await yo.client.from('friend_invites').select('player_id, token')
    expect(error).toBeNull()
    expect(data).toEqual([{ player_id: yo.playerId, token: mio }])

    const ajena = await yo.client.from('friend_invites').select('token').eq('token', suyo)
    expect(ajena.data).toEqual([])
    const porJugador = await yo.client.from('friend_invites').select('token').eq('player_id', otro.playerId)
    expect(porJugador.data).toEqual([])
  })

  it('authenticated no inserta, no edita ni borra filas directo: sólo por las funciones', async () => {
    const yo = await createTestUser()
    const otro = await createTestUser()
    await myFriendInvite(yo.client)
    const antes = await foto(yo, otro)

    const insert = await otro.client
      .from('friend_invites')
      .insert({ player_id: otro.playerId, user_id: otro.userId, token: 'a'.repeat(32) })
    expect(insert.error?.code).toBe('42501')

    const update = await yo.client.from('friend_invites').update({ token: 'b'.repeat(32) }).eq('player_id', yo.playerId)
    expect(update.error?.code).toBe('42501')

    const borrar = await yo.client.from('friend_invites').delete().eq('player_id', yo.playerId)
    expect(borrar.error?.code).toBe('42501')

    expect(await foto(yo, otro)).toEqual(antes)
  })
})

describe('my_friend_invite y rotate_friend_invite', () => {
  it('el link es largo, al azar y siempre el mismo hasta que lo cambiás', async () => {
    const yo = await createTestUser()
    const primero = await myFriendInvite(yo.client)
    const segundo = await myFriendInvite(yo.client)

    // La misma entropía que el link del torneo (`replace(gen_random_uuid()::text, '-', '')`).
    expect(primero).toMatch(/^[0-9a-f]{32}$/)
    expect(segundo).toBe(primero)
    const { data } = await db().from('friend_invites').select('player_id, user_id, token').eq('player_id', yo.playerId)
    expect(data).toEqual([{ player_id: yo.playerId, user_id: yo.userId, token: primero }])
  })

  it('cambiar el link: el viejo deja de andar al ver y al aceptar, el nuevo anda, y los amigos siguen', async () => {
    const yo = await createTestUser()
    const amigo = await createTestUser()
    const tarde = await createTestUser()
    const viejo = await myFriendInvite(yo.client)
    await acceptFriendInvite(amigo.client, viejo)

    const nuevo = await rotateFriendInvite(yo.client)
    expect(nuevo).toMatch(/^[0-9a-f]{32}$/)
    expect(nuevo).not.toBe(viejo)
    expect(await myFriendInvite(yo.client)).toBe(nuevo)

    expect(await friendInvitePreview(tarde.client, viejo)).toBeNull()
    const antes = await foto(yo, amigo, tarde)
    await expect(acceptFriendInvite(tarde.client, viejo)).rejects.toThrow(VENCIDO)
    expect(await foto(yo, amigo, tarde)).toEqual(antes)

    // La amistad hecha con el link viejo sigue en pie.
    const hecha = await amistadEntre(yo, amigo)
    expect(hecha).toHaveLength(1)
    expect(hecha[0]!.accepted_at).not.toBeNull()

    expect(await friendInvitePreview(tarde.client, nuevo)).toMatchObject({ inviterId: yo.playerId, relation: 'none' })
  })

  it('cambiar el link sin haberlo pedido antes también deja uno', async () => {
    const yo = await createTestUser()
    const token = await rotateFriendInvite(yo.client)
    expect(await myFriendInvite(yo.client)).toBe(token)
  })
})

describe('friend_invite_preview', () => {
  it('devuelve sólo quién invita, su nombre y la relación con quien mira', async () => {
    const yo = await createTestUser()
    const otro = await createTestUser()
    const token = await myFriendInvite(yo.client)
    const { data: nombre } = await db().from('players').select('display_name').eq('id', yo.playerId).single()

    const { data, error } = await otro.client.rpc('friend_invite_preview', { p_token: token })
    expect(error).toBeNull()
    expect(data).toEqual([{ inviter_id: yo.playerId, display_name: nombre!.display_name, relation: 'none' }])
  })

  it('con un token que no existe no devuelve nada', async () => {
    const otro = await createTestUser()
    const { data, error } = await otro.client.rpc('friend_invite_preview', { p_token: 'f'.repeat(32) })
    expect(error).toBeNull()
    expect(data).toEqual([])
    expect(await friendInvitePreview(otro.client, '')).toBeNull()
  })

  it('la relación: el propio link, pedidos en las dos direcciones y ya amigos', async () => {
    const yo = await createTestUser()
    const token = await myFriendInvite(yo.client)
    expect(await friendInvitePreview(yo.client, token)).toMatchObject({ relation: 'self' })

    const lePedi = await createTestUser()
    await pedido(lePedi, yo)
    expect(await friendInvitePreview(lePedi.client, token)).toMatchObject({ relation: 'pending' })

    const mePidio = await createTestUser()
    await pedido(yo, mePidio)
    expect(await friendInvitePreview(mePidio.client, token)).toMatchObject({ relation: 'pending' })

    const amigo = await createTestUser()
    await acceptFriendInvite(amigo.client, token)
    expect(await friendInvitePreview(amigo.client, token)).toMatchObject({ relation: 'friends' })
  })

  it('no deja una vía para listar: ver un link no cambia nada', async () => {
    const yo = await createTestUser()
    const otro = await createTestUser()
    const token = await myFriendInvite(yo.client)
    const antes = await foto(yo, otro)
    await friendInvitePreview(otro.client, token)
    expect(await foto(yo, otro)).toEqual(antes)
  })
})

describe('accept_friend_invite', () => {
  it('quedan amigos al toque, quien abre y quien invitó, y nadie más', async () => {
    const yo = await createTestUser()
    const otro = await createTestUser()
    const tercero = await createTestUser()
    const token = await myFriendInvite(yo.client)
    const antesTercero = await foto(tercero)

    expect(await acceptFriendInvite(otro.client, token)).toBe(yo.playerId)

    const [a, b] = par(yo.playerId, otro.playerId)
    const filas = await amistadEntre(yo, otro)
    expect(filas).toHaveLength(1)
    expect(filas[0]).toMatchObject({ player_a: a, player_b: b, requested_by: yo.playerId })
    expect(filas[0]!.accepted_at).not.toBeNull()
    const { count } = await db()
      .from('friendships')
      .select('*', { count: 'exact', head: true })
      .or(`player_a.eq.${otro.playerId},player_b.eq.${otro.playerId}`)
    expect(count).toBe(1)
    expect(await foto(tercero)).toEqual(antesTercero)
  })

  it('acepta un pedido pendiente que le había hecho quien abre el link', async () => {
    const yo = await createTestUser()
    const otro = await createTestUser()
    await pedido(otro, yo)
    const token = await myFriendInvite(yo.client)

    await acceptFriendInvite(otro.client, token)

    const filas = await amistadEntre(yo, otro)
    expect(filas).toHaveLength(1)
    expect(filas[0]!.requested_by).toBe(otro.playerId)
    expect(filas[0]!.accepted_at).not.toBeNull()
  })

  it('acepta un pedido pendiente que le había hecho quien invita', async () => {
    const yo = await createTestUser()
    const otro = await createTestUser()
    await pedido(yo, otro)
    const token = await myFriendInvite(yo.client)

    await acceptFriendInvite(otro.client, token)

    const filas = await amistadEntre(yo, otro)
    expect(filas).toHaveLength(1)
    expect(filas[0]!.requested_by).toBe(yo.playerId)
    expect(filas[0]!.accepted_at).not.toBeNull()
  })

  it('si ya eran amigos no cambia nada', async () => {
    const yo = await createTestUser()
    const otro = await createTestUser()
    const token = await myFriendInvite(yo.client)
    await acceptFriendInvite(otro.client, token)
    const antes = await foto(yo, otro)

    expect(await acceptFriendInvite(otro.client, token)).toBe(yo.playerId)
    expect(await foto(yo, otro)).toEqual(antes)
  })

  it('el propio link no se acepta, y no cambia nada', async () => {
    const yo = await createTestUser()
    const token = await myFriendInvite(yo.client)
    const antes = await foto(yo)

    await expect(acceptFriendInvite(yo.client, token)).rejects.toThrow('No te podés agregar a vos mismo como amigo.')
    expect(await foto(yo)).toEqual(antes)
  })

  it('un token que no existe no se acepta, y no cambia nada', async () => {
    const yo = await createTestUser()
    const otro = await createTestUser()
    await myFriendInvite(yo.client)
    const antes = await foto(yo, otro)

    await expect(acceptFriendInvite(otro.client, 'f'.repeat(32))).rejects.toThrow(VENCIDO)
    await expect(acceptFriendInvite(otro.client, '')).rejects.toThrow(VENCIDO)
    expect(await foto(yo, otro)).toEqual(antes)
  })

  it('después de aceptar, el nombre de quien invitó se resuelve como el de cualquier amigo', async () => {
    const yo = await createTestUser()
    const otro = await createTestUser()
    const token = await myFriendInvite(yo.client)
    const { data: nombre } = await db().from('players').select('display_name').eq('id', yo.playerId).single()

    // Antes no: el link es la única ventana a ese nombre.
    expect((await playerNames(otro.client, [yo.playerId])).get(yo.playerId)).toBeUndefined()
    await acceptFriendInvite(otro.client, token)
    expect((await playerNames(otro.client, [yo.playerId])).get(yo.playerId)).toBe(nombre!.display_name)
  })
})

describe('borrar la cuenta (0108) se lleva el link', () => {
  it('la fila desaparece y el link viejo deja de andar', async () => {
    const yo = await createTestUser()
    const otro = await createTestUser()
    const token = await myFriendInvite(yo.client)

    await deleteMyAccount(yo.client)

    const { count } = await db()
      .from('friend_invites')
      .select('*', { count: 'exact', head: true })
      .eq('player_id', yo.playerId)
    expect(count).toBe(0)
    expect(await friendInvitePreview(otro.client, token)).toBeNull()
    await expect(acceptFriendInvite(otro.client, token)).rejects.toThrow(VENCIDO)
    expect(await amistadEntre(yo, otro)).toEqual([])
  })
})
