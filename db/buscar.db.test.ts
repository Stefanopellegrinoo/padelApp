import { afterAll, describe, expect, it } from 'vitest'
import { myDiscoverable, searchByUsername, setMyDiscoverable } from './buscar'
import { addFriend } from './friends'
import { adminClient } from './test/admin'
import { createTestUser, type TestUser } from './test/users'

/**
 * El buscador por @usuario (odd/tasks/amigos-faciles.md, S8, T8): por el
 * comienzo, desde 3 letras, hasta 10, en orden alfabético y sin vos. Sólo
 * aparece quien tiene cuenta, eligió su @usuario y no apagó "Que me
 * encuentren por mi usuario". Devuelve jugador, nombre y @usuario; nada más.
 *
 * La base local no se resetea: cada test arma sus @usuario con un prefijo que
 * ninguna corrida anterior usó, y al final se los saca, así ninguna corrida
 * le deja resultados a la siguiente.
 */

const db = () => adminClient()
const creados: string[] = []

let counter = 0
/** Un prefijo de 8 letras que no usó nadie: deja 12 caracteres para el resto del @usuario. */
function freshPrefix(): string {
  return `b${(Date.now() + counter++).toString(36).slice(-5)}${Math.random().toString(36).slice(2, 4)}`.replace(
    /[^a-z0-9]/g,
    'x',
  )
}

async function setUsername(playerId: string, username: string): Promise<void> {
  const { error } = await db().from('players').update({ username }).eq('id', playerId)
  if (error) throw new Error(error.message)
  creados.push(playerId)
}

async function userWith(username: string, displayName?: string): Promise<TestUser> {
  const user = await createTestUser()
  await setUsername(user.playerId, username)
  if (displayName !== undefined) {
    const { error } = await db().from('players').update({ display_name: displayName }).eq('id', user.playerId)
    if (error) throw new Error(error.message)
  }
  return user
}

async function search(user: TestUser, query: string) {
  const { data, error } = await user.client.rpc('search_players_by_username', { p_query: query })
  expect(error, query).toBeNull()
  return data ?? []
}

const handles = (rows: Array<{ username: string }>) => rows.map((row) => row.username)

afterAll(async () => {
  if (creados.length > 0) await db().from('players').update({ username: null }).in('id', creados)
})

describe('search_players_by_username', () => {
  it('busca por el comienzo, sin importar mayúsculas ni la @ de adelante', async () => {
    const p = freshPrefix()
    const yo = await createTestUser()
    await userWith(`${p}nico`)
    await userWith(`${p}nicole`)
    await userWith(`${p}tomi`)

    expect(handles(await search(yo, `@${p.toUpperCase()}NIC`))).toEqual([`${p}nico`, `${p}nicole`])
    expect(handles(await search(yo, `  ${p}t `))).toEqual([`${p}tomi`])
    expect(handles(await search(yo, ` @${p}nicole`))).toEqual([`${p}nicole`])
    // El comienzo, no cualquier parte.
    expect(await search(yo, 'nicole')).not.toContainEqual(expect.objectContaining({ username: `${p}nicole` }))
  })

  it('desde 3 letras encuentra; con menos no devuelve nada', async () => {
    const p = freshPrefix()
    const yo = await createTestUser()
    await userWith(`${p}abc`)

    const tres = await search(yo, p.slice(0, 3))
    expect(tres.length).toBeGreaterThan(0)
    expect(tres.length).toBeLessThanOrEqual(10)
    expect(tres.every((row) => row.username.startsWith(p.slice(0, 3)))).toBe(true)

    for (const corta of [p.slice(0, 2), `@${p.slice(0, 2)}`, ` ${p.slice(0, 2).toUpperCase()} `, p.slice(0, 1), '', '@', '   ']) {
      expect(await search(yo, corta), JSON.stringify(corta)).toEqual([])
    }
  })

  it('el guion bajo y el % de la búsqueda no hacen de comodín', async () => {
    const p = freshPrefix()
    const yo = await createTestUser()
    await userWith(`${p}a_b`)
    await userWith(`${p}axb`)

    expect(handles(await search(yo, `${p}a_b`))).toEqual([`${p}a_b`])
    expect(handles(await search(yo, `${p}a_`))).toEqual([`${p}a_b`])
    expect(await search(yo, `${p}%`)).toEqual([])
    expect(await search(yo, `${p}a%b`)).toEqual([])
    expect(await search(yo, '%%%')).toEqual([])
    expect(await search(yo, '___')).toEqual([])
    expect(await search(yo, `${p}\\`)).toEqual([])
  })

  it('trae hasta 10, en orden alfabético por @usuario', async () => {
    const p = freshPrefix()
    const yo = await createTestUser()
    const sufijos = ['m', 'b', '_k', 'a', 'z', '0c', 'q', '.d', 'x', 'e', 'y', 'f']
    for (const sufijo of sufijos) await userWith(`${p}${sufijo}`)

    const esperados = sufijos.map((sufijo) => `${p}${sufijo}`).sort().slice(0, 10)
    expect(handles(await search(yo, p))).toEqual(esperados)
  })

  it('no trae a quien busca, ni a quien no tiene @usuario, borró su cuenta o apagó que lo encuentren', async () => {
    const p = freshPrefix()
    const yo = await userWith(`${p}yo`)
    await userWith(`${p}otro`)
    // Sin @usuario, aunque el nombre empiece igual: se busca por @usuario y nada más.
    const sinUsuario = await createTestUser()
    const { error: nameError } = await db()
      .from('players')
      .update({ display_name: `${p}sinusuario` })
      .eq('id', sinUsuario.playerId)
    if (nameError) throw new Error(nameError.message)
    const seFue = await userWith(`${p}sefue`)
    const { error: deleteError } = await seFue.client.rpc('delete_my_account')
    if (deleteError) throw new Error(deleteError.message)
    const oculto = await userWith(`${p}oculto`)
    await setMyDiscoverable(oculto.client, false)

    expect(handles(await search(yo, p))).toEqual([`${p}otro`])
  })

  it('devuelve sólo id, display_name y username', async () => {
    const p = freshPrefix()
    const yo = await createTestUser()
    const otro = await userWith(`${p}claves`, 'Claves Pérez')

    const rows = await search(yo, p)
    expect(rows).toEqual([{ id: otro.playerId, display_name: 'Claves Pérez', username: `${p}claves` }])
    expect(Object.keys(rows[0]!).sort()).toEqual(['display_name', 'id', 'username'])
  })
})

describe('searchByUsername', () => {
  it('le pone a cada uno su estado de amistad conmigo', async () => {
    const p = freshPrefix()
    const yo = await createTestUser()
    const nada = await userWith(`${p}nada`, 'Nada')
    const mandado = await userWith(`${p}mandado`, 'Mandado')
    const pidio = await userWith(`${p}pidio`, 'Pidió')
    const amigo = await userWith(`${p}amigo`, 'Amigo')
    expect(await addFriend(yo.client, mandado.playerId)).toBe('sent')
    expect(await addFriend(pidio.client, yo.playerId)).toBe('sent')
    expect(await addFriend(amigo.client, yo.playerId)).toBe('sent')
    expect(await addFriend(yo.client, amigo.playerId)).toBe('friends')

    expect(await searchByUsername(yo.client, `@${p.toUpperCase()}`)).toEqual([
      { playerId: amigo.playerId, displayName: 'Amigo', username: `${p}amigo`, estado: 'friends' },
      { playerId: mandado.playerId, displayName: 'Mandado', username: `${p}mandado`, estado: 'sent' },
      { playerId: nada.playerId, displayName: 'Nada', username: `${p}nada`, estado: 'none' },
      { playerId: pidio.playerId, displayName: 'Pidió', username: `${p}pidio`, estado: 'received' },
    ])
  })

  it('con menos de 3 letras no devuelve nada', async () => {
    const yo = await createTestUser()
    expect(await searchByUsername(yo.client, '@ab')).toEqual([])
  })
})

describe('"Que me encuentren por mi usuario"', () => {
  it('viene prendido, y lo prendo y apago yo', async () => {
    const yo = await createTestUser()
    expect(await myDiscoverable(yo.client)).toBe(true)

    expect(await setMyDiscoverable(yo.client, false)).toBe(false)
    expect(await myDiscoverable(yo.client)).toBe(false)

    expect(await setMyDiscoverable(yo.client, true)).toBe(true)
    expect(await myDiscoverable(yo.client)).toBe(true)
  })

  it('apagarlo me saca del buscador, y prenderlo me devuelve', async () => {
    const p = freshPrefix()
    const yo = await createTestUser()
    const otro = await userWith(`${p}vuelve`)

    await setMyDiscoverable(otro.client, false)
    expect(await search(yo, p)).toEqual([])
    await setMyDiscoverable(otro.client, true)
    expect(handles(await search(yo, p))).toEqual([`${p}vuelve`])
  })

  it('no cambia el de otro: la función no recibe jugador y players no se escribe directo', async () => {
    const yo = await createTestUser()
    const otro = await createTestUser()

    // Una firma con el jugador no existe: PostgREST no encuentra la función.
    const ajena = await yo.client.rpc('set_my_discoverable' as never, {
      p_discoverable: false,
      p_player: otro.playerId,
    } as never)
    expect(ajena.error).not.toBeNull()

    const directo = await yo.client.from('players').update({ discoverable: false }).eq('id', otro.playerId)
    expect(directo.error?.code).toBe('42501')

    expect(await setMyDiscoverable(yo.client, false)).toBe(false)
    expect(await myDiscoverable(otro.client)).toBe(true)
    const { data } = await db().from('players').select('discoverable').eq('id', otro.playerId).single()
    expect(data?.discoverable).toBe(true)
  })

  it('rechaza un valor vacío sin tocar nada', async () => {
    const yo = await createTestUser()
    const { error } = await yo.client.rpc('set_my_discoverable', { p_discoverable: null as unknown as boolean })
    expect(error?.message).toBe('Falta si te pueden encontrar.')
    expect(await myDiscoverable(yo.client)).toBe(true)
  })
})
