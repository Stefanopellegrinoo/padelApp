import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Borrar un partido casual vuelve al mismo perfil con el mismo origen: `?desde=amigos` (como
 * siempre) y ahora también `?desde=torneo` (odd/tasks/amigos-faciles.md, T3), así su Volver sigue
 * desandando al perfil del torneo. Cualquier otro valor no viaja.
 */

const redirect = vi.fn()
vi.mock('next/navigation', () => ({ redirect: (path: string) => redirect(path) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/db/server', () => ({ serverClient: async () => ({}) }))
vi.mock('@/db/friends', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/db/friends')>()
  return {
    ...real,
    casualParticipantIds: vi.fn(async () => ['p-yo', 'p-nico']),
    deleteCasualMatch: vi.fn(async () => 'p-nico'),
  }
})

const { removeCasualMatch } = await import('../actions')

function form(desde?: string): FormData {
  const data = new FormData()
  data.set('matchId', 'm1')
  data.set('friendPlayerId', 'p-nico')
  if (desde !== undefined) data.set('desde', desde)
  return data
}

beforeEach(() => redirect.mockClear())

describe('removeCasualMatch: vuelve con el mismo origen', () => {
  it.each([
    ['amigos', '/amigos/p-nico?desde=amigos'],
    ['torneo', '/amigos/p-nico?desde=torneo'],
    [undefined, '/amigos/p-nico'],
    ['cualquiera', '/amigos/p-nico'],
    ['perfil', '/amigos/p-nico?desde=perfil'],
  ])('desde=%s → %s', async (desde, destino) => {
    await removeCasualMatch(form(desde))
    expect(redirect).toHaveBeenCalledWith(destino)
  })
})
