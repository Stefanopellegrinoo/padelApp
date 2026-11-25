// @vitest-environment jsdom
//
// `Volver` con `label` y `desanda`: nombra el destino y aun así desanda el historial cuando hay algo
// atrás en la app (el torneo rápido: se llega desde Inicio o desde la portada, y "Inicio" es las dos).
// Sin nada atrás va a `href`. El resto de su conducta la fija `app/ui/volver.dom.unit.test.ts`.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement('a', { href, ...rest }, children as never),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let back: ReturnType<typeof vi.spyOn>
let prevenido: boolean | undefined

function mirarClick(event: Event) {
  prevenido = event.defaultPrevented
  event.preventDefault()
}

beforeEach(() => {
  // El historial es estado del módulo: cada test arranca con uno limpio.
  vi.resetModules()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  back = vi.spyOn(history, 'back').mockImplementation(() => {})
  prevenido = undefined
  document.addEventListener('click', mirarClick)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  back.mockRestore()
  document.removeEventListener('click', mirarClick)
})

const link = () => host.querySelector('a') as HTMLAnchorElement

it('con label y desanda, y una pantalla atrás: se lee con su destino y desanda con history.back()', async () => {
  const { Volver } = await import('./volver')
  const { registrar } = await import('./historial')
  registrar('/torneos')
  registrar('/rapido')
  act(() => root.render(createElement(Volver, { href: '/', label: 'Inicio', desanda: true })))
  expect(link().textContent).toBe('Inicio')
  act(() => link().click())
  expect(back).toHaveBeenCalledTimes(1)
  expect(prevenido).toBe(true)
})

it('con label y desanda, sin nada atrás (link directo): va a href', async () => {
  const { Volver } = await import('./volver')
  const { registrar } = await import('./historial')
  registrar('/rapido')
  act(() => root.render(createElement(Volver, { href: '/', label: 'Inicio', desanda: true })))
  act(() => link().click())
  expect(back).not.toHaveBeenCalled()
  expect(prevenido).toBe(false)
  expect(link().getAttribute('href')).toBe('/')
})
