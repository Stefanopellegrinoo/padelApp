// @vitest-environment jsdom
//
// La hoja de abajo: un `<dialog>` nativo con `showModal`. Se cierra por cuatro caminos (Cancelar,
// Escape, tocar el fondo, arrastrarla) y en los cuatro avisa a la pantalla; el foco entra al
// abrir y vuelve al botón que la abrió al cerrar.
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { Sheet } from './sheet'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// jsdom todavía no trae `showModal` ni `close`: lo mínimo que hace la plataforma.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})

let host: HTMLDivElement
let root: Root
let onClose: ReturnType<typeof vi.fn>

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  onClose = vi.fn()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

/** Una pantalla mínima: un botón que abre la hoja y la hoja con un botón adentro. */
function Pantalla({ initialOpen = false }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen)
  return createElement(
    'div',
    null,
    createElement('button', { type: 'button', onClick: () => setOpen(true) }, 'Cargar'),
    createElement('button', { type: 'button', onClick: () => setOpen(false) }, 'Cerrar desde afuera'),
    createElement(Sheet, {
      open,
      title: 'Ronda 2',
      onClose: () => {
        onClose()
        setOpen(false)
      },
      children: createElement('button', { type: 'button' }, 'Martín y Tomi'),
    }),
  )
}

const dialogo = () => host.querySelector('dialog') as HTMLDialogElement
const boton = (texto: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === texto) as HTMLButtonElement

function abrir() {
  act(() => root.render(createElement(Pantalla)))
  const cargar = boton('Cargar')
  cargar.focus()
  act(() => cargar.click())
  return cargar
}

function arrastrar(desde: number, hasta: number) {
  const grabber = host.querySelector('[data-arrastre]') as HTMLElement
  act(() => {
    grabber.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientY: desde }))
    grabber.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: hasta }))
    grabber.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientY: hasta }))
  })
}

it('cerrada no está abierta; al abrirla es un diálogo modal nombrado por su título', () => {
  act(() => root.render(createElement(Pantalla)))
  expect(dialogo().open).toBe(false)

  abrir()
  const d = dialogo()
  expect(d.open).toBe(true)
  const titulo = document.getElementById(d.getAttribute('aria-labelledby') ?? '')
  expect(titulo?.tagName).toBe('H2')
  expect(titulo?.textContent).toBe('Ronda 2')
})

it('el foco entra al diálogo (no al primer botón, que amanecería con anillo) y vuelve al que la abrió', () => {
  const cargar = abrir()
  expect(document.activeElement).toBe(dialogo())

  act(() => boton('Cancelar').click())
  expect(dialogo().open).toBe(false)
  expect(document.activeElement).toBe(cargar)
})

it('"Cancelar" la cierra y avisa una vez', () => {
  abrir()
  act(() => boton('Cancelar').click())
  expect(dialogo().open).toBe(false)
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('Escape (el `cancel` del diálogo) la cierra y avisa', () => {
  abrir()
  act(() => {
    dialogo().dispatchEvent(new Event('cancel', { cancelable: true }))
  })
  expect(dialogo().open).toBe(false)
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('tocar el fondo la cierra; tocar adentro no', () => {
  abrir()
  act(() => boton('Martín y Tomi').click())
  expect(dialogo().open).toBe(true)
  expect(onClose).not.toHaveBeenCalled()

  act(() => {
    dialogo().dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  expect(dialogo().open).toBe(false)
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('arrastrarla hacia abajo más de 110 px la cierra; un arrastre corto y lento la deja', () => {
  abrir()
  const ahora = vi.spyOn(performance, 'now')
  ahora.mockReturnValue(0)
  const grabber = host.querySelector('[data-arrastre]') as HTMLElement
  act(() => {
    grabber.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientY: 100 }))
    grabber.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: 140 }))
  })
  expect(dialogo().style.transform).toBe('translateY(40px)')
  ahora.mockReturnValue(1000)
  act(() => {
    grabber.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientY: 140 }))
  })
  expect(dialogo().open).toBe(true)
  expect(dialogo().style.transform).toBe('')

  ahora.mockReturnValue(0)
  arrastrar(100, 230)
  expect(dialogo().open).toBe(false)
  expect(onClose).toHaveBeenCalledTimes(1)
  ahora.mockRestore()
})

it('si la pantalla la cierra (después de guardar) se cierra sin avisar de nuevo', () => {
  abrir()
  act(() => boton('Cerrar desde afuera').click())
  expect(dialogo().open).toBe(false)
  expect(onClose).not.toHaveBeenCalled()
})
