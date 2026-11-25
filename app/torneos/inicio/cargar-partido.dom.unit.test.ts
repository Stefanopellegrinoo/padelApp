// @vitest-environment jsdom
//
// "Cargar partido", abajo de Inicio: abre la hoja con los caminos más cortos para cargar un
// resultado. Cada fecha en juego donde podés cargar va derecho a su pantalla; el partido con un
// amigo va a Amigos.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement('a', { href, ...rest }, children as never),
}))
const { CargarPartido } = await import('./cargar-partido')
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const FECHAS = [
  { id: 'a', href: '/torneo/s1/padel/fechas/8', titulo: 'Fecha 8', torneo: 'Los Pibes del Martes', dia: 'mar 24 nov', sport: 'PADEL' },
  { id: 'b', href: '/torneo/s2/fifa/fechas/3', titulo: 'Fecha 3', torneo: 'FIFA de los Viernes', dia: null, sport: 'FIFA' },
]

const dialogo = () => host.querySelector('dialog') as HTMLDialogElement
const abrir = () => {
  const cta = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Cargar partido') as HTMLButtonElement
  act(() => cta.click())
}

it('cerrada, sólo está el botón; tocarlo abre la hoja "Cargar partido"', () => {
  act(() => root.render(createElement(CargarPartido, { fechas: FECHAS })))
  expect(dialogo().open).toBe(false)
  abrir()
  expect(dialogo().open).toBe(true)
  const titulo = document.getElementById(dialogo().getAttribute('aria-labelledby') ?? '')
  expect(titulo?.textContent).toBe('Cargar partido')
})

it('el partido con un amigo y cada fecha en juego, link directo a su pantalla con el torneo y el día', () => {
  act(() => root.render(createElement(CargarPartido, { fechas: FECHAS })))
  abrir()
  const links = [...dialogo().querySelectorAll('a')]
  // El amigo primero: con muchas fechas abiertas quedaría fuera de la hoja.
  expect(links.map((a) => a.getAttribute('href'))).toEqual([
    '/amigos',
    '/torneo/s1/padel/fechas/8',
    '/torneo/s2/fifa/fechas/3',
  ])
  expect(links[0]?.textContent).toContain('Partido con un amigo')
  expect(links[1]?.textContent).toContain('Fecha 8')
  expect(links[1]?.textContent).toContain('Los Pibes del Martes')
  expect(links[1]?.textContent).toContain('mar 24 nov')
  expect(links[2]?.closest('[data-deporte]')?.getAttribute('data-deporte')).toBe('FIFA')
})

it('sin fechas en juego queda el partido con un amigo, sin el título de las fechas', () => {
  act(() => root.render(createElement(CargarPartido, { fechas: [] })))
  abrir()
  const links = [...dialogo().querySelectorAll('a')]
  expect(links.map((a) => a.getAttribute('href'))).toEqual(['/amigos'])
  expect(dialogo().textContent).not.toContain('Fechas en juego')
})

it('Cancelar la cierra', () => {
  act(() => root.render(createElement(CargarPartido, { fechas: FECHAS })))
  abrir()
  const cancelar = [...dialogo().querySelectorAll('button')].find((b) => b.textContent === 'Cancelar') as HTMLButtonElement
  act(() => cancelar.click())
  expect(dialogo().open).toBe(false)
})
