// @vitest-environment jsdom
//
// Un aviso que llega en la URL (`?amistad=nueva`, amigos-faciles S5): se muestra una vez al entrar
// y el parámetro sale de la URL, así volver atrás o recargar no lo repite.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AvisoAlEntrar } from './aviso-al-entrar'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

const region = () => host.querySelector('[role="status"]') as HTMLElement

it('muestra el mensaje al entrar, saca sólo su parámetro y se va solo', () => {
  window.history.replaceState(null, '', '/amigos/p?desde=amigos&amistad=nueva#arriba')
  act(() => root.render(createElement(AvisoAlEntrar, { message: 'Listo, ya son amigos', param: 'amistad' })))
  expect(region().textContent).toBe('Listo, ya son amigos')
  expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe('/amigos/p?desde=amigos#arriba')
  act(() => vi.advanceTimersByTime(2500))
  expect(region().textContent).toBe('')
})
