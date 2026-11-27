import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  friendsOf,
  genteDeTusTorneos,
  historyWith,
  torneosCompartidosCon,
  type Friend,
  type GenteDeTorneo,
} from '@/db/friends'

/**
 * `/amigos` con "Gente de tus torneos" (odd/tasks/amigos-faciles.md, S3): la sección va abajo de
 * "Tus amigos", y las de antes siguen donde estaban. Server component llamado directo +
 * `renderToStaticMarkup`, lecturas mockeadas -- mismo patrón que `app/torneos/page.unit.test.ts`.
 */

vi.mock('@/db/server', () => ({
  serverClient: async () => ({ rpc: async () => ({ data: 'p-yo' }) }),
}))

vi.mock('@/app/amigos/actions', () => ({
  cambiarMiLink: vi.fn(),
  agregarAmigo: vi.fn(),
  aceptarPedidoDe: vi.fn(),
  rechazarPedidoDe: vi.fn(),
  deshacerPedido: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

vi.mock('@/db/friends', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/db/friends')>()
  return {
    ...real,
    friendsOf: vi.fn(async () => []),
    historyWith: vi.fn(async () => []),
    genteDeTusTorneos: vi.fn(async () => []),
    torneosCompartidosCon: vi.fn(async () => new Map()),
    myFriendInvite: vi.fn(async () => 'abc0000000000000000000000000000f'),
  }
})

const amigo = (over: Partial<Friend>): Friend => ({
  friendshipId: `f-${over.playerId}`,
  playerId: 'p',
  displayName: 'Alguien',
  accepted: true,
  theyAsked: false,
  createdAt: '2026-11-24T12:00:00Z',
  ...over,
})

const SEBA: GenteDeTorneo = {
  playerId: 'p-seba',
  displayName: 'Seba Molina',
  seasonIds: ['s-martes', 's-jueves'],
  torneos: ['Los Pibes del Martes', 'Copa del Jueves'],
  fechasJuntos: 9,
}

const persona = (n: number): GenteDeTorneo => ({
  playerId: `p-${n}`,
  displayName: `Persona ${n}`,
  seasonIds: ['s-martes'],
  torneos: ['Los Pibes del Martes'],
  fechasJuntos: 10 - n,
})

beforeEach(() => {
  vi.mocked(friendsOf).mockResolvedValue([
    amigo({ playerId: 'p-nico', displayName: 'Nico Arias' }),
    amigo({ playerId: 'p-juampi', displayName: 'Juampi Ledesma', accepted: false, theyAsked: true }),
    amigo({ playerId: 'p-tomi', displayName: 'Tomi Sosa', accepted: false, theyAsked: false }),
  ])
  vi.mocked(historyWith).mockResolvedValue([])
  vi.mocked(genteDeTusTorneos).mockResolvedValue([SEBA])
  vi.mocked(torneosCompartidosCon).mockClear().mockResolvedValue(new Map([['p-juampi', ['Los Pibes del Martes']]]))
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-27T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

async function render(): Promise<string> {
  const { default: AmigosPage } = await import('./page')
  return renderToStaticMarkup(await AmigosPage())
}

// Las secciones de la pantalla, sin el título de la hoja del link, que vive en el encabezado.
const titulos = (html: string) =>
  [...html.slice(html.indexOf('</header>')).matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1])

describe('/amigos', () => {
  it('"Gente de tus torneos" va justo abajo de "Tus amigos", con su fila y "Agregar"', async () => {
    const html = await render()
    expect(titulos(html)).toEqual(['Te pidieron', 'Tus amigos', 'Gente de tus torneos', 'Pedidos enviados'])
    expect(html).toContain('Jugaron con vos y tienen cuenta')
    expect(html).toContain('Seba Molina')
    // S11: los torneos, sin fechas (antes "2 torneos · 9 fechas juntos").
    expect(html).toContain('Los Pibes del Martes y Copa del Jueves')
    expect(html).not.toContain('fechas juntos')
    expect(html).toContain('aria-label="Agregar a Seba Molina"')
    expect(html).not.toContain('href="/amigos/gente"')
  })

  // S10: en Amigos, las primeras 5 y "Ver todas (N)".
  it('con 7 para sugerir: las primeras 5 y "Ver todas (7)" a /amigos/gente', async () => {
    vi.mocked(genteDeTusTorneos).mockResolvedValueOnce(Array.from({ length: 7 }, (_, i) => persona(i + 1)))
    const html = await render()
    const gente = html.slice(html.search(/<h2[^>]*>Gente de tus torneos<\/h2>/), html.search(/<h2[^>]*>Pedidos enviados<\/h2>/))
    expect([...gente.matchAll(/aria-label="Agregar a ([^"]*)"/g)].map((m) => m[1])).toEqual([
      'Persona 1',
      'Persona 2',
      'Persona 3',
      'Persona 4',
      'Persona 5',
    ])
    expect(gente).toMatch(/<a [^>]*href="\/amigos\/gente"[^>]*>Ver todas \(7\)<\/a>/)
  })

  it('sin nadie para sugerir, la sección no está y el resto sigue igual', async () => {
    vi.mocked(genteDeTusTorneos).mockResolvedValueOnce([])
    const html = await render()
    expect(titulos(html)).toEqual(['Te pidieron', 'Tus amigos', 'Pedidos enviados'])
    expect(html).toContain('Nico Arias')
    expect(html).toContain('Juampi Ledesma')
    expect(html).toContain('Tomi Sosa')
    expect(html).toContain('1 amigo')
  })

  // odd/tasks/amigos-faciles.md, T3, S4.
  it('"Te pidieron" dice de dónde lo conocés, con Aceptar y ✕; ya no manda el id de la fila', async () => {
    const html = await render()
    const pidieron = html.slice(html.search(/<h2[^>]*>Te pidieron<\/h2>/), html.search(/<h2[^>]*>Tus amigos<\/h2>/))
    expect(pidieron).toContain('Juampi Ledesma')
    expect(pidieron).toContain('De Los Pibes del Martes')
    expect(pidieron).toMatch(/<button[^>]*>Aceptar<\/button>/)
    expect(pidieron).toContain('aria-label="Rechazar el pedido de Juampi"')
    expect(html).not.toContain('name="friendshipId"')
    // Sólo se busca de dónde conocés a quien te pidió.
    expect(torneosCompartidosCon).toHaveBeenCalledTimes(1)
    expect(vi.mocked(torneosCompartidosCon).mock.calls[0]?.[1]).toEqual(['p-juampi'])
  })

  it('"Pedidos enviados": "Sin respuesta · hace 3 días" y "Cancelar", sin el viejo "Pendiente"', async () => {
    const html = await render()
    const enviados = html.slice(html.search(/<h2[^>]*>Pedidos enviados<\/h2>/))
    expect(enviados).toContain('Tomi Sosa')
    expect(enviados).toContain('Sin respuesta · hace 3 días')
    expect(enviados).toMatch(/aria-label="Cancelar el pedido a Tomi"[^>]*>Cancelar<\/button>/)
    expect(html).not.toContain('Pendiente')
  })

  it('sin pedidos, ni las secciones ni la lectura de torneos compartidos', async () => {
    vi.mocked(friendsOf).mockResolvedValueOnce([amigo({ playerId: 'p-nico', displayName: 'Nico Arias' })])
    const html = await render()
    expect(titulos(html)).toEqual(['Tus amigos', 'Gente de tus torneos'])
    expect(torneosCompartidosCon).not.toHaveBeenCalled()
  })

  // odd/tasks/amigos-faciles.md, T4, S5: "Compartir mi link" en la línea del título, y el ID se va.
  it('"Compartir mi link" va en la misma línea que el título "Amigos"', async () => {
    const html = await render()
    expect(html).toMatch(
      /<div class="[^"]*flex[^"]*items-center[^"]*"><h1[^>]*>Amigos<\/h1><button[^>]*>.*?Compartir mi link<\/button>/,
    )
    // La hoja ya lleva el link, armado en el cliente con el origen de la página.
    expect(html).toContain('/amigo/abc0000000000000000000000000000f')
  })

  it('el cuadro del ID y el formulario para pegarlo ya no están', async () => {
    const html = await render()
    expect(html).not.toContain('Tu ID')
    expect(html).not.toContain('Sumar un amigo')
    expect(html).not.toContain('name="friendPlayerId"')
    expect(html).not.toContain('p-yo')
  })

  it('sin amigos, "Sumá al primero" manda al link y no al ID', async () => {
    vi.mocked(friendsOf).mockResolvedValueOnce([])
    const html = await render()
    expect(html).toContain('Sumá al primero')
    expect(html).toContain('Compartí tu link, acá arriba')
    expect(html).not.toContain('Con su ID')
  })

  it('si la lectura falla, la pantalla no se arma con datos a medias', async () => {
    const { EdgeError } = await import('@/db/errors')
    vi.mocked(genteDeTusTorneos).mockRejectedValueOnce(new EdgeError('No se pudo leer completa la gente de tus torneos (asientos). Recargá la pantalla.'))
    await expect(render()).rejects.toThrow('No se pudo leer completa la gente de tus torneos')
  })
})
