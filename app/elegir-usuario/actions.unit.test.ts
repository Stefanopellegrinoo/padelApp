import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EdgeError } from '@/db/errors'
import { chooseMyUsername } from '@/db/usuario'

/**
 * "Sí, usar este" (odd/tasks/amigos-faciles.md, S7): guarda el @usuario y sigue a `next`, que se
 * valida como en el login (una ruta de esta app; si no, Inicio). Si la base lo rechaza, vuelve el
 * motivo para mostrarlo en la pantalla.
 */

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`)
})
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url) }))
vi.mock('@/db/server', () => ({ serverClient: async () => ({}) }))
vi.mock('@/db/usuario', () => ({ chooseMyUsername: vi.fn() }))

const { elegirUsuario } = await import('./actions')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('elegirUsuario', () => {
  it('guarda el @usuario y sigue a `next`', async () => {
    vi.mocked(chooseMyUsername).mockResolvedValueOnce('martinperez')
    await expect(elegirUsuario('martinperez', '/amigos?x=1')).rejects.toThrow('NEXT_REDIRECT /amigos?x=1')
    expect(chooseMyUsername).toHaveBeenCalledWith(expect.anything(), 'martinperez')
  })

  it('sin `next`, o con uno de afuera, va a Inicio', async () => {
    vi.mocked(chooseMyUsername).mockResolvedValue('martinperez')
    await expect(elegirUsuario('martinperez', '')).rejects.toThrow('NEXT_REDIRECT /torneos')
    await expect(elegirUsuario('martinperez', '//otro-sitio.com')).rejects.toThrow('NEXT_REDIRECT /torneos')
  })

  it('si la base lo rechaza, vuelve el motivo y no sigue', async () => {
    vi.mocked(chooseMyUsername).mockRejectedValueOnce(new EdgeError('Ese @usuario ya está en uso.'))
    expect(await elegirUsuario('nico.arias', '/amigos')).toEqual({ error: 'Ese @usuario ya está en uso.' })
    expect(redirect).not.toHaveBeenCalled()
  })

  it('un error que no es para la persona no se tapa', async () => {
    vi.mocked(chooseMyUsername).mockRejectedValueOnce(new Error('se cayó la red'))
    await expect(elegirUsuario('nico.arias', '/amigos')).rejects.toThrow('se cayó la red')
  })
})
