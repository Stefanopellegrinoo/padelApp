import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EdgeError } from '@/db/errors'
import { acceptFriendInvite } from '@/db/friends'

/**
 * "Sumarme como amigo" (odd/tasks/amigos-faciles.md, S5): quedan amigos y cae en el historial con
 * el aviso "Listo, ya son amigos" (`?amistad=nueva`). Si falla, vuelve al link con el motivo.
 */

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`)
})
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/db/server', () => ({ serverClient: async () => ({}) }))
vi.mock('@/db/friends', () => ({ acceptFriendInvite: vi.fn() }))

const { sumarmeComoAmigo } = await import('./actions')
const { revalidatePath } = await import('next/cache')

const TOKEN = 'abc0000000000000000000000000000f'
const form = (token: string) => {
  const data = new FormData()
  data.set('token', token)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('sumarmeComoAmigo', () => {
  it('acepta el link y va al historial con quien invitó, con el aviso', async () => {
    vi.mocked(acceptFriendInvite).mockResolvedValueOnce('p-martin')
    await expect(sumarmeComoAmigo(form(TOKEN))).rejects.toThrow(
      'NEXT_REDIRECT /amigos/p-martin?desde=amigos&amistad=nueva',
    )
    expect(acceptFriendInvite).toHaveBeenCalledWith(expect.anything(), TOKEN)
    expect(revalidatePath).toHaveBeenCalledWith('/amigos')
  })

  it('si la base lo rechaza, vuelve al link con el motivo', async () => {
    vi.mocked(acceptFriendInvite).mockRejectedValueOnce(new EdgeError('Este link ya no anda, pedile uno nuevo'))
    await expect(sumarmeComoAmigo(form(TOKEN))).rejects.toThrow(
      `NEXT_REDIRECT /amigo/${TOKEN}?error=${encodeURIComponent('Este link ya no anda, pedile uno nuevo')}`,
    )
  })

  it('un error que no es para la persona no se tapa', async () => {
    vi.mocked(acceptFriendInvite).mockRejectedValueOnce(new Error('se cayó la red'))
    await expect(sumarmeComoAmigo(form(TOKEN))).rejects.toThrow('se cayó la red')
    expect(redirect).not.toHaveBeenCalled()
  })
})
