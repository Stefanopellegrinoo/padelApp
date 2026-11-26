// @vitest-environment jsdom
//
// El aviso de abajo ("Guardado: Martín y Tomi 6-4"): una región `status` que existe siempre, para
// que el lector de pantalla anuncie cada mensaje nuevo, y que se va sola.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Toast } from './toast'

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

it('sin mensaje la región ya está (vacía y escondida), lista para anunciar', () => {
  act(() => root.render(createElement(Toast, { message: null, onDismiss: () => {} })))
  expect(region()).not.toBeNull()
  expect(region().getAttribute('aria-live')).toBe('polite')
  expect(region().textContent).toBe('')
  expect(region().dataset.visible).toBe('false')
})

it('con mensaje lo muestra y se va solo a los 2,5 s', () => {
  const onDismiss = vi.fn()
  act(() => root.render(createElement(Toast, { message: 'Guardado', onDismiss })))
  expect(region().textContent).toBe('Guardado')
  expect(region().dataset.visible).toBe('true')
  expect(region().querySelector('button')).toBeNull()

  act(() => vi.advanceTimersByTime(2499))
  expect(onDismiss).not.toHaveBeenCalled()
  act(() => vi.advanceTimersByTime(1))
  expect(onDismiss).toHaveBeenCalledTimes(1)
})

it('con acción dura 4,5 s; tocarla la ejecuta y cierra el aviso', () => {
  const onDismiss = vi.fn()
  const onClick = vi.fn()
  act(() =>
    root.render(createElement(Toast, { message: 'Fecha 8 cerrada', action: { label: 'Ver', onClick }, onDismiss })),
  )
  act(() => vi.advanceTimersByTime(2500))
  expect(onDismiss).not.toHaveBeenCalled()

  const accion = region().querySelector('button') as HTMLButtonElement
  expect(accion.textContent).toBe('Ver')
  expect(accion.type).toBe('button')
  act(() => accion.click())
  expect(onClick).toHaveBeenCalledTimes(1)
  expect(onDismiss).toHaveBeenCalledTimes(1)
})

it('un mensaje nuevo reinicia el reloj', () => {
  const onDismiss = vi.fn()
  act(() => root.render(createElement(Toast, { message: 'Guardado', onDismiss })))
  act(() => vi.advanceTimersByTime(2000))
  act(() => root.render(createElement(Toast, { message: 'Guardado otra vez', onDismiss })))
  act(() => vi.advanceTimersByTime(2000))
  expect(onDismiss).not.toHaveBeenCalled()
  act(() => vi.advanceTimersByTime(500))
  expect(onDismiss).toHaveBeenCalledTimes(1)
})
