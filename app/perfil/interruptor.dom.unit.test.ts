// @vitest-environment jsdom
//
// "Que me encuentren por mi usuario" (odd/tasks/amigos-faciles.md, S8, S9): cambia al toque y
// guarda; si no se pudo guardar, vuelve a como estaba y dice por qué.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let resolver: (r: { ok: true; valor: boolean } | { ok: false; error: string }) => void = () => {}
const guardarQueMeEncuentren = vi.fn(
  (_valor: boolean) =>
    new Promise<{ ok: true; valor: boolean } | { ok: false; error: string }>((resolve) => {
      resolver = resolve
    }),
)
vi.mock('./actions', () => ({ guardarQueMeEncuentren }))

const { QueMeEncuentren } = await import('./interruptor')

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

const sw = () => host.querySelector('[role="switch"]') as HTMLButtonElement
const alerta = () => host.querySelector('[role="alert"]')

describe('QueMeEncuentren', () => {
  it('es un switch con nombre y ayuda', () => {
    act(() => root.render(createElement(QueMeEncuentren, { inicial: true })))
    expect(sw().getAttribute('aria-checked')).toBe('true')
    const nombre = document.getElementById(sw().getAttribute('aria-labelledby') ?? '')
    const ayuda = document.getElementById(sw().getAttribute('aria-describedby') ?? '')
    expect(nombre?.textContent).toBe('Que me encuentren por mi usuario')
    expect(ayuda?.textContent).toBe('Si lo apagás, solo te encuentran con tu link o desde un torneo.')
  })

  it('cambia al toque, antes de que responda, y queda así si se guardó', async () => {
    act(() => root.render(createElement(QueMeEncuentren, { inicial: true })))
    await act(async () => sw().click())
    expect(sw().getAttribute('aria-checked')).toBe('false')
    expect(guardarQueMeEncuentren).toHaveBeenCalledWith(false)
    await act(async () => resolver({ ok: true, valor: false }))
    expect(sw().getAttribute('aria-checked')).toBe('false')
    expect(alerta()).toBeNull()
  })

  it('si no se pudo guardar, vuelve a como estaba y muestra el error', async () => {
    act(() => root.render(createElement(QueMeEncuentren, { inicial: false })))
    await act(async () => sw().click())
    expect(sw().getAttribute('aria-checked')).toBe('true')
    await act(async () => resolver({ ok: false, error: 'No se pudo guardar. Probá de nuevo.' }))
    expect(sw().getAttribute('aria-checked')).toBe('false')
    expect(alerta()?.textContent).toBe('No se pudo guardar. Probá de nuevo.')
  })

  it('al volver a tocar, el error se va', async () => {
    act(() => root.render(createElement(QueMeEncuentren, { inicial: true })))
    await act(async () => sw().click())
    await act(async () => resolver({ ok: false, error: 'Falló' }))
    await act(async () => sw().click())
    expect(alerta()).toBeNull()
  })
})
