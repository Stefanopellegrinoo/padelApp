// @vitest-environment jsdom
//
// Tu perfil (odd/tasks/amigos-faciles.md, T9, S9, S8; `design/amigos-faciles/06-perfil.html`,
// lámina 3): tu nombre, tu @usuario fijo, "Compartir mi link", el interruptor "Que me encuentren
// por mi usuario" y Privacidad y Borrar cuenta a mano.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement('a', { href, ...rest }, children as never),
}))

vi.mock('@/db/server', () => ({ serverClient: async () => ({}) }))
vi.mock('@/db/usuario', () => ({
  myDisplayName: vi.fn(async () => 'Martín Pérez'),
  myUsername: vi.fn(async () => 'martinperez'),
}))
vi.mock('@/db/buscar', () => ({ myDiscoverable: vi.fn(async () => true) }))
vi.mock('@/db/friends', () => ({ myFriendInvite: vi.fn(async () => 'tok123') }))
vi.mock('@/app/amigos/actions', () => ({ cambiarMiLink: vi.fn() }))
vi.mock('./actions', () => ({ guardarQueMeEncuentren: vi.fn(async (valor: boolean) => ({ ok: true, valor })) }))

const { default: MiPerfil } = await import('./page')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function abrir() {
  const page = await MiPerfil()
  await act(async () => root.render(page))
}

describe('Tu perfil', () => {
  it('"Tu perfil", tu nombre y tu @usuario con el candado y "no se puede cambiar"', async () => {
    await abrir()
    const header = host.querySelector('header') as HTMLElement
    expect(header.textContent).toContain('Tu perfil')
    expect(header.querySelector('h1')?.textContent).toBe('Martín Pérez')
    expect(header.textContent).toContain('@martinperez')
    expect(header.textContent).toContain('Tu @usuario no se puede cambiar')
    expect(header.querySelector('[data-icono="candado"]')).not.toBeNull()
    // Tu nombre no se edita acá (decisión del orquestador).
    expect(host.querySelector('input')).toBeNull()
  })

  it('"Compartir mi link" en el encabezado', async () => {
    await abrir()
    const compartir = [...host.querySelectorAll('header button')].find((b) => b.textContent?.includes('Compartir mi link'))
    expect(compartir).toBeDefined()
  })

  it('el interruptor, prendido, con su ayuda', async () => {
    await abrir()
    const sw = host.querySelector('[role="switch"]') as HTMLButtonElement
    expect(sw.getAttribute('aria-checked')).toBe('true')
    expect(host.textContent).toContain('Que me encuentren por mi usuario')
    expect(host.textContent).toContain('Si lo apagás, solo te encuentran con tu link o desde un torneo.')
  })

  it('Privacidad y Borrar cuenta', async () => {
    await abrir()
    expect(host.querySelector('a[href="/privacidad"]')?.textContent).toContain('Privacidad')
    expect(host.querySelector('a[href="/cuenta/borrar"]')?.textContent).toContain('Borrar cuenta')
  })
})
