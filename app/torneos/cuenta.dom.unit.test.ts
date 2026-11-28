// @vitest-environment jsdom
//
// El menú de la cuenta en Inicio (`cuenta.tsx`): "Tu perfil" va primero (odd/tasks/amigos-faciles.md,
// T9, S9), y el resto queda como estaba.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement('a', { href, ...rest }, children as never),
}))
vi.mock('@/app/auth/actions', () => ({ signOut: vi.fn() }))
vi.mock('@/app/submit-button', () => ({
  SubmitButton: ({ children, ...rest }: { children: unknown }) => createElement('button', rest, children as never),
}))

const { Cuenta } = await import('./cuenta')

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

describe('el menú de la cuenta', () => {
  it('"Tu perfil" primero, a /perfil; después Amigos, Privacidad, Borrar cuenta y Cerrar sesión', async () => {
    act(() => root.render(createElement(Cuenta, { name: 'Martín Pérez' })))
    await act(async () => (host.querySelector('button[aria-label="Tu cuenta, Martín Pérez"]') as HTMLButtonElement).click())
    const items = [...host.querySelectorAll('[role="menuitem"]')]
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      'Tu perfil',
      'Amigos',
      'Privacidad',
      'Borrar cuenta',
      'Cerrar sesión',
    ])
    expect(items[0]?.getAttribute('href')).toBe('/perfil')
    expect(items[1]?.getAttribute('href')).toBe('/amigos')
  })
})
