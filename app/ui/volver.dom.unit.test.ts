// @vitest-environment jsdom
//
// `Volver` cambió de cara (chip → flecha y destino, como el prototipo) pero no de conducta: sin
// `label` desanda si hay algo atrás en la app y si no va a `href`; con `label` va siempre a `href`.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement('a', { href, ...rest }, children as never),
}))

const { Volver } = await import('@/app/torneo/[id]/volver')
const { registrar } = await import('@/app/torneo/[id]/historial')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let back: ReturnType<typeof vi.spyOn>
let prevenido: boolean | undefined

/** Anota si `Volver` frenó la navegación del link, y la frena siempre (jsdom no navega). */
function mirarClick(event: Event) {
  prevenido = event.defaultPrevented
  event.preventDefault()
}

beforeEach(() => {
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

it('se lee con su destino y la flecha es decorativa; el área de toque mide 44', () => {
  act(() => root.render(createElement(Volver, { href: '/torneos', label: 'Mis torneos' })))
  expect(link().getAttribute('href')).toBe('/torneos')
  expect(link().textContent).toBe('Mis torneos')
  expect(link().querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  expect(link().className.split(' ')).toContain('min-h-[44px]')
})

it('sin label y con una pantalla atrás: desanda con history.back()', () => {
  registrar('/torneo/s/padel/stats')
  registrar('/torneo/s/padel/jugador/e')
  act(() => root.render(createElement(Volver, { href: '/torneo/s/padel' })))
  expect(link().textContent).toBe('Volver')
  act(() => link().click())
  expect(back).toHaveBeenCalledTimes(1)
  expect(prevenido).toBe(true)
})

it('con label va siempre a href, aunque haya algo atrás', () => {
  registrar('/torneo/s/padel/stats')
  registrar('/torneo/s/padel')
  act(() => root.render(createElement(Volver, { href: '/torneos', label: 'Mis torneos' })))
  act(() => link().click())
  expect(back).not.toHaveBeenCalled()
  expect(prevenido).toBe(false)
})
