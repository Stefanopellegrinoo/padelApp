// @vitest-environment jsdom
//
// El perfil de otro jugador (odd/tasks/amigos-faciles.md, T9, S9, S11;
// `design/amigos-faciles/06-perfil.html`): nombre, @usuario, la amistad en el encabezado con los
// mismos estados que el perfil del torneo, los torneos que comparten con su deporte (sin fechas)
// y, sólo entre amigos, el cara a cara y "Ver historial". Si no se puede ver, no existe; si es el
// tuyo, va a /perfil.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Perfil } from '@/db/perfil'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement('a', { href, ...rest }, children as never),
}))

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})
const redirect = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT ${to}`)
})
vi.mock('next/navigation', () => ({ notFound, redirect, useRouter: () => ({ push: vi.fn() }) }))

vi.mock('@/db/server', () => ({ serverClient: async () => ({}) }))

let perfil: Perfil | null = null
vi.mock('@/db/perfil', () => ({ perfilDe: vi.fn(async () => perfil) }))

vi.mock('@/app/amigos/actions', () => ({
  agregarAmigo: vi.fn(async () => ({ ok: true, estado: 'sent' })),
  deshacerPedido: vi.fn(async () => ({ ok: true })),
  aceptarPedidoDe: vi.fn(async () => ({ ok: true })),
  rechazarPedidoDe: vi.fn(async () => ({ ok: true })),
}))

const actions = await import('@/app/amigos/actions')
const { default: PerfilPage } = await import('./page')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  vi.clearAllMocks()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const NICO: Perfil = {
  playerId: 'p-nico',
  displayName: 'Nicolás Ibarra',
  username: 'nicoibarra',
  hasAccount: true,
  esVos: false,
  amistad: { kind: 'none' },
  torneos: [
    { seasonId: 's-martes', name: 'Los Pibes del Martes', sports: ['PADEL'] },
    { seasonId: 's-jueves', name: 'Copa del Jueves', sports: ['FIFA', 'TENIS'] },
  ],
  caraACara: null,
}

async function abrir(datos: Perfil | null) {
  perfil = datos
  const page = await PerfilPage({ params: Promise.resolve({ playerId: datos?.playerId ?? 'p-nadie' }) })
  await act(async () => root.render(page))
}

const header = () => host.querySelector('header') as HTMLElement
const boton = (texto: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto) as HTMLButtonElement | undefined
const titulos = () => [...host.querySelectorAll('h2')].map((h) => h.textContent)

describe('el encabezado', () => {
  it('nombre y @usuario', async () => {
    await abrir(NICO)
    expect(header().querySelector('h1')?.textContent).toBe('Nicolás Ibarra')
    expect(header().textContent).toContain('@nicoibarra')
    expect(header().textContent).toContain('NI')
  })

  it('sin @usuario todavía, no hay línea del @', async () => {
    await abrir({ ...NICO, username: null })
    expect(header().textContent).not.toContain('@')
  })

  it('sin amistad: "Agregar amigo"; al tocarlo manda el pedido y avisa con "Deshacer"', async () => {
    await abrir(NICO)
    const agregar = boton('Agregar amigo')
    expect(agregar).toBeDefined()
    await act(async () => agregar?.click())
    expect(actions.agregarAmigo).toHaveBeenCalledWith('p-nico')
    const aviso = host.querySelector('[role="status"]')
    expect(aviso?.textContent).toContain('Le mandaste el pedido a Nicolás')
    await act(async () => boton('Deshacer')?.click())
    expect(actions.deshacerPedido).toHaveBeenCalledWith('p-nico')
  })

  it('pedido enviado: "Enviado", sin botón de agregar', async () => {
    await abrir({ ...NICO, amistad: { kind: 'sent', friendshipId: 'f1' } })
    expect(header().textContent).toContain('Enviado')
    expect(boton('Agregar amigo')).toBeUndefined()
  })

  it('él te pidió: la tarjeta "<nombre> te pidió ser amigos" con Aceptar y ✕', async () => {
    await abrir({ ...NICO, amistad: { kind: 'received', friendshipId: 'f1', requestedAt: new Date().toISOString() } })
    expect(header().textContent).toContain('Nicolás te pidió ser amigos')
    await act(async () => boton('Aceptar')?.click())
    expect(actions.aceptarPedidoDe).toHaveBeenCalledWith('p-nico')
    await act(async () => (host.querySelector('button[aria-label="Rechazar el pedido de Nicolás"]') as HTMLButtonElement).click())
    expect(actions.rechazarPedidoDe).toHaveBeenCalledWith('p-nico')
    expect(boton('Agregar amigo')).toBeUndefined()
  })

  it('amigos: "Amigos ✓"', async () => {
    await abrir({
      ...NICO,
      amistad: { kind: 'friends', friendshipId: 'f1' },
      caraACara: { playerId: 'p-nico', displayName: 'Nicolás Ibarra', contra: { won: 7, lost: 5, drew: 0 }, juntos: { won: 0, lost: 0, drew: 0 }, ultimo: null },
    })
    const amigos = [...header().querySelectorAll('span')].find((s) => s.textContent === 'Amigos')
    expect(amigos?.querySelector('svg')).not.toBeNull()
    expect(boton('Agregar amigo')).toBeUndefined()
  })

  it('una cuenta borrada: sin ninguna acción de amistad', async () => {
    await abrir({ ...NICO, hasAccount: false, username: null, amistad: null })
    expect(header().querySelectorAll('button')).toHaveLength(0)
    expect(header().textContent).not.toMatch(/Agregar|Enviado|Amigos|te pidió/)
  })
})

describe('los torneos que comparten', () => {
  it('una fila por torneo con su deporte, que lleva al torneo; sin fechas', async () => {
    await abrir(NICO)
    expect(titulos()).toContain('Torneos que comparten')
    const filas = [...host.querySelectorAll('a[href^="/torneo/"]')]
    expect(filas.map((a) => a.getAttribute('href'))).toEqual(['/torneo/s-martes', '/torneo/s-jueves'])
    expect(filas[0]?.textContent).toContain('Los Pibes del Martes')
    expect(filas[0]?.textContent).toContain('Pádel')
    expect(filas[1]?.textContent).toContain('FIFA y Tenis')
    expect(host.textContent).not.toMatch(/[Ff]echa/)
  })

  it('sin torneos en común, no hay sección', async () => {
    await abrir({ ...NICO, torneos: [] })
    expect(titulos()).not.toContain('Torneos que comparten')
  })
})

describe('sólo entre amigos', () => {
  it('sin ser amigos no hay cara a cara ni historial', async () => {
    for (const amistad of [{ kind: 'none' }, { kind: 'sent', friendshipId: 'f' }] as const) {
      await abrir({ ...NICO, amistad })
      expect(titulos()).not.toContain('Cara a cara')
      expect(host.querySelector('a[href^="/amigos/"]')).toBeNull()
    }
  })

  it('amigos: el cara a cara en números grandes y "Ver historial" con Volver al perfil', async () => {
    await abrir({
      ...NICO,
      amistad: { kind: 'friends', friendshipId: 'f1' },
      caraACara: {
        playerId: 'p-nico',
        displayName: 'Nicolás Ibarra',
        contra: { won: 7, lost: 5, drew: 0 },
        juntos: { won: 0, lost: 0, drew: 0 },
        ultimo: null,
      },
    })
    expect(titulos()).toContain('Cara a cara')
    const numeros = [...host.querySelectorAll('.font-cond')].map((n) => n.textContent)
    expect(numeros).toEqual(['7', '5'])
    expect(host.textContent).toContain('Ganaste')
    expect(host.textContent).toContain('Perdiste')
    const historial = host.querySelector('a[href="/amigos/p-nico?desde=perfil"]')
    expect(historial?.textContent).toContain('Ver historial')
  })
})

describe('a dónde va', () => {
  it('si no se puede ver, no existe', async () => {
    await expect(abrir(null)).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
  })

  it('el tuyo va a /perfil', async () => {
    await expect(abrir({ ...NICO, esVos: true, amistad: null })).rejects.toThrow('NEXT_REDIRECT /perfil')
  })
})
