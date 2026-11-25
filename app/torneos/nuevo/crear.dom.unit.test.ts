// @vitest-environment jsdom
//
// El wizard TOCADO: lo que el HTML estático no ve. Cargar el plantel de corrido (Enter pasa al
// renglón que sigue y, en el último, abre uno nuevo) y el encabezado de cada paso (el número, los
// puntitos y "Volver" que nombra adónde vuelve).
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Squad } from './wizard-state'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement('a', { href, ...rest }, children as never),
}))
vi.mock('./actions', () => ({ createTournament: vi.fn() }))

const { Crear, PasoJugadores } = await import('./crear')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
  window.scrollTo = () => {}
})

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

/** El plantel con su estado, como lo tiene `Crear`. */
function Plantel({ inicial }: { inicial: Squad }) {
  const [squad, setSquad] = useState(inicial)
  return createElement(PasoJugadores, {
    squad,
    myName: 'Colo',
    floor: 4,
    warning: null,
    onChange: setSquad,
    onLeave: () => {},
  })
}

const campos = () => [...host.querySelectorAll<HTMLInputElement>('input')]

/** Tipea como React lo escucha: el setter nativo y un `input` que burbujea. */
function tipear(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function enter(input: HTMLInputElement) {
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  act(() => {
    input.dispatchEvent(event)
  })
  return event
}

const boton = (texto: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto) as HTMLButtonElement | undefined

describe('PasoJugadores: el plantel de corrido', () => {
  it('Enter pasa al renglón que sigue, sin mandar nada', () => {
    act(() => root.render(createElement(Plantel, { inicial: { names: ['Colo', '', '', ''], mySeat: 0 } })))
    const [, segundo, tercero] = campos()
    segundo!.focus()
    tipear(segundo!, 'Nacho')
    const event = enter(campos()[1]!)
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(tercero)
  })

  it('Enter en el último renglón con un nombre abre uno nuevo y lo enfoca', () => {
    act(() => root.render(createElement(Plantel, { inicial: { names: ['Colo', 'Nacho'], mySeat: 0 } })))
    expect(campos()).toHaveLength(2)
    campos()[1]!.focus()
    enter(campos()[1]!)
    expect(campos()).toHaveLength(3)
    expect(document.activeElement).toBe(campos()[2])
    expect(campos()[2]!.value).toBe('')
  })

  it('Enter en un renglón vacío al final no agrega otro', () => {
    act(() => root.render(createElement(Plantel, { inicial: { names: ['Colo', 'Nacho', ''], mySeat: 0 } })))
    campos()[2]!.focus()
    enter(campos()[2]!)
    expect(campos()).toHaveLength(3)
    expect(document.activeElement).toBe(campos()[2])
  })

  it('los campos piden "siguiente" al teclado del teléfono, miden 16px o más y nombran su renglón', () => {
    act(() => root.render(createElement(Plantel, { inicial: { names: ['Colo', ''], mySeat: 0 } })))
    for (const [at, input] of campos().entries()) {
      expect(input.getAttribute('enterkeyhint')).toBe('next')
      expect(Number(/text-\[(\d+)px\]/.exec(input.className)?.[1])).toBeGreaterThanOrEqual(16)
      expect(input.getAttribute('aria-label')).toBe(`Jugador ${at + 1}`)
    }
  })

  it('el tuyo está marcado y su cruz pregunta antes de sacarte', () => {
    act(() => root.render(createElement(Plantel, { inicial: { names: ['Colo', 'Nacho'], mySeat: 0 } })))
    expect(host.querySelector('.marca-vos')?.textContent).toBe('vos')
    expect(host.querySelector('button[aria-label="Sacarme del plantel"]')).not.toBeNull()
  })
})

describe('Crear: el encabezado de cada paso', () => {
  it('paso 1: el número, cuatro puntitos (uno lleno) y "Volver" a Inicio', () => {
    act(() => root.render(createElement(Crear, { myName: 'Colo' })))
    const header = host.querySelector('header')!
    expect(header.querySelector('h1')?.textContent).toBe('Nuevo torneo')
    expect(header.textContent).toContain('Paso 1 de 4')
    const pips = header.querySelectorAll('[data-pip]')
    expect(pips).toHaveLength(4)
    expect([...pips].map((pip) => pip.getAttribute('data-pip'))).toEqual(['hecho', 'falta', 'falta', 'falta'])
    const volver = header.querySelector('a')!
    expect(volver.getAttribute('href')).toBe('/torneos')
    expect(volver.textContent).toBe('Inicio')
  })

  it('un solo botón principal, "Continuar", que espera el nombre y un deporte', () => {
    act(() => root.render(createElement(Crear, { myName: 'Colo' })))
    expect(boton('Continuar')?.disabled).toBe(true)
    tipear(host.querySelector('input')!, 'Los Jueves')
    act(() => boton('Pádel')!.click())
    expect(boton('Continuar')?.disabled).toBe(false)
  })

  it('paso 2: "Volver" es un botón que nombra el paso de antes y vuelve a él', () => {
    act(() => root.render(createElement(Crear, { myName: 'Colo' })))
    tipear(host.querySelector('input')!, 'Los Jueves')
    act(() => boton('Pádel')!.click())
    act(() => boton('Continuar')!.click())

    const header = host.querySelector('header')!
    expect(header.querySelector('h1')?.textContent).toBe('¿Quiénes juegan?')
    expect(header.textContent).toContain('Paso 2 de 4')
    expect([...header.querySelectorAll('[data-pip]')].map((pip) => pip.getAttribute('data-pip'))).toEqual([
      'hecho',
      'hecho',
      'falta',
      'falta',
    ])
    // Pádel pide 4: el plantel ya muestra los 4 renglones, el primero con vos.
    expect(campos().map((input) => input.value)).toEqual(['Colo', '', '', ''])

    act(() => boton('Nuevo torneo')!.click())
    expect(host.querySelector('h1')?.textContent).toBe('Nuevo torneo')
  })
})
