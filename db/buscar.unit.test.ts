import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Client } from './client'
import { EdgeError } from './errors'
import { friendsOf, type Friend } from './friends'
import { myDiscoverable, searchByUsername, setMyDiscoverable } from './buscar'

/**
 * El envoltorio del buscador (odd/tasks/amigos-faciles.md, S8): limpia lo
 * escrito como la base, no le pregunta con menos de 3 letras y le pone a cada
 * resultado su estado de amistad con UNA lectura de tus amistades, no una por
 * persona.
 */

vi.mock('./friends', () => ({ friendsOf: vi.fn() }))

const amistad = (over: Partial<Friend>): Friend => ({
  friendshipId: `f-${over.playerId}`,
  playerId: 'p',
  displayName: '',
  accepted: false,
  theyAsked: false,
  createdAt: '2026-11-24T12:00:00Z',
  ...over,
})

function clientWith(rpc: (name: string, args?: unknown) => Promise<{ data: unknown; error: unknown }>) {
  const spy = vi.fn(rpc)
  return { client: { rpc: spy } as unknown as Client, rpc: spy }
}

beforeEach(() => {
  vi.mocked(friendsOf).mockReset().mockResolvedValue([])
})

describe('searchByUsername', () => {
  it('con menos de 3 letras no le pregunta a la base', async () => {
    const { client, rpc } = clientWith(async () => ({ data: [], error: null }))
    for (const corta of ['', 'ni', '@ni', '  N ']) expect(await searchByUsername(client, corta)).toEqual([])
    expect(rpc).not.toHaveBeenCalled()
    expect(friendsOf).not.toHaveBeenCalled()
  })

  it('manda lo limpio, y le pone a cada uno su estado con una sola lectura de amistades', async () => {
    const { client, rpc } = clientWith(async () => ({
      data: [
        { id: 'p-amigo', display_name: 'Amigo', username: 'nicamigo' },
        { id: 'p-mandado', display_name: 'Mandado', username: 'nicmandado' },
        { id: 'p-nada', display_name: 'Nada', username: 'nicnada' },
        { id: 'p-pidio', display_name: 'Pidió', username: 'nicpidio' },
      ],
      error: null,
    }))
    vi.mocked(friendsOf).mockResolvedValue([
      amistad({ playerId: 'p-amigo', accepted: true }),
      amistad({ playerId: 'p-mandado' }),
      amistad({ playerId: 'p-pidio', theyAsked: true }),
      amistad({ playerId: 'p-otro', accepted: true }),
    ])

    expect(await searchByUsername(client, ' @NIC')).toEqual([
      { playerId: 'p-amigo', displayName: 'Amigo', username: 'nicamigo', estado: 'friends' },
      { playerId: 'p-mandado', displayName: 'Mandado', username: 'nicmandado', estado: 'sent' },
      { playerId: 'p-nada', displayName: 'Nada', username: 'nicnada', estado: 'none' },
      { playerId: 'p-pidio', displayName: 'Pidió', username: 'nicpidio', estado: 'received' },
    ])
    expect(rpc).toHaveBeenCalledExactlyOnceWith('search_players_by_username', { p_query: 'nic' })
    expect(friendsOf).toHaveBeenCalledTimes(1)
  })

  it('sin resultados no lee las amistades', async () => {
    const { client } = clientWith(async () => ({ data: [], error: null }))
    expect(await searchByUsername(client, 'nadie')).toEqual([])
    expect(friendsOf).not.toHaveBeenCalled()
  })

  it('si la base falla, un error para leer', async () => {
    const { client } = clientWith(async () => ({ data: null, error: { code: 'XX000', message: 'boom' } }))
    await expect(searchByUsername(client, 'nico')).rejects.toEqual(new EdgeError('No se pudo buscar. Probá de nuevo.'))
  })
})

describe('"Que me encuentren por mi usuario"', () => {
  it('lee el mío', async () => {
    const { client, rpc } = clientWith(async () => ({ data: false, error: null }))
    expect(await myDiscoverable(client)).toBe(false)
    expect(rpc).toHaveBeenCalledExactlyOnceWith('my_discoverable')
  })

  it('si no hay jugador, cuenta como prendido (el default)', async () => {
    const { client } = clientWith(async () => ({ data: null, error: null }))
    expect(await myDiscoverable(client)).toBe(true)
  })

  it('lo cambia y devuelve cómo quedó', async () => {
    const { client, rpc } = clientWith(async () => ({ data: false, error: null }))
    expect(await setMyDiscoverable(client, false)).toBe(false)
    expect(rpc).toHaveBeenCalledExactlyOnceWith('set_my_discoverable', { p_discoverable: false })
  })

  it('los errores para leer', async () => {
    const leer = clientWith(async () => ({ data: null, error: { code: 'XX000', message: 'boom' } }))
    await expect(myDiscoverable(leer.client)).rejects.toEqual(
      new EdgeError('No se pudo leer si te encuentran por tu @usuario.'),
    )
    const propio = clientWith(async () => ({ data: null, error: { code: 'P0001', message: 'Tenés que iniciar sesión.' } }))
    await expect(setMyDiscoverable(propio.client, true)).rejects.toEqual(new EdgeError('Tenés que iniciar sesión.'))
    const otro = clientWith(async () => ({ data: null, error: { code: 'XX000', message: 'boom' } }))
    await expect(setMyDiscoverable(otro.client, true)).rejects.toEqual(new EdgeError('No se pudo guardar. Probá de nuevo.'))
  })
})
