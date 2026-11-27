import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { friendsOf, genteDeTusTorneos, historyWith, type Friend, type GenteDeTorneo } from '@/db/friends'

/**
 * `/amigos` con "Gente de tus torneos" (odd/tasks/amigos-faciles.md, S3): la sección va abajo de
 * "Tus amigos", y las de antes siguen donde estaban. Server component llamado directo +
 * `renderToStaticMarkup`, lecturas mockeadas -- mismo patrón que `app/torneos/page.unit.test.ts`.
 */

vi.mock('@/db/server', () => ({
  serverClient: async () => ({ rpc: async () => ({ data: 'p-yo' }) }),
}))

vi.mock('@/app/amigos/actions', () => ({
  accept: vi.fn(),
  sendFriendRequest: vi.fn(),
  agregarAmigo: vi.fn(),
}))

vi.mock('@/db/friends', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/db/friends')>()
  return {
    ...real,
    friendsOf: vi.fn(async () => []),
    historyWith: vi.fn(async () => []),
    genteDeTusTorneos: vi.fn(async () => []),
  }
})

const amigo = (over: Partial<Friend>): Friend => ({
  friendshipId: `f-${over.playerId}`,
  playerId: 'p',
  displayName: 'Alguien',
  accepted: true,
  theyAsked: false,
  ...over,
})

const SEBA: GenteDeTorneo = { playerId: 'p-seba', displayName: 'Seba Molina', torneos: ['A', 'B'], fechasJuntos: 9 }

beforeEach(() => {
  vi.mocked(friendsOf).mockResolvedValue([
    amigo({ playerId: 'p-nico', displayName: 'Nico Arias' }),
    amigo({ playerId: 'p-juampi', displayName: 'Juampi Ledesma', accepted: false, theyAsked: true }),
    amigo({ playerId: 'p-tomi', displayName: 'Tomi Sosa', accepted: false, theyAsked: false }),
  ])
  vi.mocked(historyWith).mockResolvedValue([])
  vi.mocked(genteDeTusTorneos).mockResolvedValue([SEBA])
})

async function render(): Promise<string> {
  const { default: AmigosPage } = await import('./page')
  return renderToStaticMarkup(await AmigosPage({ searchParams: Promise.resolve({}) }))
}

const titulos = (html: string) => [...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1])

describe('/amigos', () => {
  it('"Gente de tus torneos" va justo abajo de "Tus amigos", con su fila y "Agregar"', async () => {
    const html = await render()
    expect(titulos(html)).toEqual(['Te pidieron', 'Tus amigos', 'Gente de tus torneos', 'Pedidos enviados', 'Sumar un amigo'])
    expect(html).toContain('Jugaron con vos y tienen cuenta')
    expect(html).toContain('Seba Molina')
    expect(html).toContain('2 torneos · 9 fechas juntos')
    expect(html).toContain('aria-label="Agregar a Seba Molina"')
  })

  it('sin nadie para sugerir, la sección no está y el resto sigue igual', async () => {
    vi.mocked(genteDeTusTorneos).mockResolvedValueOnce([])
    const html = await render()
    expect(titulos(html)).toEqual(['Te pidieron', 'Tus amigos', 'Pedidos enviados', 'Sumar un amigo'])
    expect(html).toContain('Nico Arias')
    expect(html).toContain('Juampi Ledesma')
    expect(html).toContain('Pendiente')
    expect(html).toContain('1 amigo')
  })

  it('si la lectura falla, la pantalla no se arma con datos a medias', async () => {
    const { EdgeError } = await import('@/db/errors')
    vi.mocked(genteDeTusTorneos).mockRejectedValueOnce(new EdgeError('No se pudo leer completa la gente de tus torneos (asientos). Recargá la pantalla.'))
    await expect(render()).rejects.toThrow('No se pudo leer completa la gente de tus torneos')
  })
})
