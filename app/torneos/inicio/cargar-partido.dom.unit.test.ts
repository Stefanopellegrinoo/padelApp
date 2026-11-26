// @vitest-environment jsdom
//
// "Cargar partido", abajo de Inicio: abre la hoja con los caminos más cortos para cargar un
// resultado. Cada amigo va a su perfil con la hoja de carga ya abierta (`?cargar=1`): de Inicio a
// la hoja casual son dos toques (T17). Cada fecha en juego donde podés cargar va derecho a su
// pantalla.
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

const AMIGOS = [
  { playerId: 'p-nico', displayName: 'Nico Arias' },
  { playerId: 'p-facu', displayName: 'Facu Gómez' },
]

const dialogo = () => host.querySelector('dialog') as HTMLDialogElement
const abrir = () => {
  const cta = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Cargar partido') as HTMLButtonElement
  act(() => cta.click())
}

it('cerrada, sólo está el botón; tocarlo abre la hoja "Cargar partido"', () => {
  act(() => root.render(createElement(CargarPartido, { fechas: FECHAS, amigos: AMIGOS })))
  expect(dialogo().open).toBe(false)
  abrir()
  expect(dialogo().open).toBe(true)
  const titulo = document.getElementById(dialogo().getAttribute('aria-labelledby') ?? '')
  expect(titulo?.textContent).toBe('Cargar partido')
})

it('cada amigo, en el orden que llega, va a su perfil con la hoja abierta; después "Ver todos" y las fechas', () => {
  act(() => root.render(createElement(CargarPartido, { fechas: FECHAS, amigos: AMIGOS })))
  abrir()
  const links = [...dialogo().querySelectorAll('a')]
  // Los amigos primero: con muchas fechas abiertas quedarían fuera de la hoja.
  expect(links.map((a) => a.getAttribute('href'))).toEqual([
    '/amigos/p-nico?cargar=1',
    '/amigos/p-facu?cargar=1',
    '/amigos',
    '/torneo/s1/padel/fechas/8',
    '/torneo/s2/fifa/fechas/3',
  ])
  expect(links[0]?.textContent).toContain('Nico Arias')
  // El avatar es decorativo: el link se lee con el nombre.
  expect(links[0]?.querySelector('[aria-hidden="true"]')?.textContent).toBe('NA')
  expect(links[2]?.textContent).toContain('Ver todos')
  expect(links[3]?.textContent).toContain('Fecha 8')
  expect(links[3]?.textContent).toContain('Los Pibes del Martes')
  expect(links[3]?.textContent).toContain('mar 24 nov')
  expect(links[4]?.closest('[data-deporte]')?.getAttribute('data-deporte')).toBe('FIFA')
})

it('sin amigos queda el camino para sumar uno, y las fechas', () => {
  act(() => root.render(createElement(CargarPartido, { fechas: FECHAS, amigos: [] })))
  abrir()
  const links = [...dialogo().querySelectorAll('a')]
  expect(links.map((a) => a.getAttribute('href'))).toEqual(['/amigos', '/torneo/s1/padel/fechas/8', '/torneo/s2/fifa/fechas/3'])
  expect(links[0]?.textContent).toContain('Sumá un amigo')
})

it('sin fechas en juego quedan los amigos, sin el título de las fechas', () => {
  act(() => root.render(createElement(CargarPartido, { fechas: [], amigos: AMIGOS })))
  abrir()
  const links = [...dialogo().querySelectorAll('a')]
  expect(links.map((a) => a.getAttribute('href'))).toEqual(['/amigos/p-nico?cargar=1', '/amigos/p-facu?cargar=1', '/amigos'])
  expect(dialogo().textContent).not.toContain('Fechas en juego')
})

it('Cancelar la cierra', () => {
  act(() => root.render(createElement(CargarPartido, { fechas: FECHAS, amigos: AMIGOS })))
  abrir()
  const cancelar = [...dialogo().querySelectorAll('button')].find((b) => b.textContent === 'Cancelar') as HTMLButtonElement
  act(() => cancelar.click())
  expect(dialogo().open).toBe(false)
})

// En pantalla ancha el contenido de Inicio va centrado en `max-w-lg`: la barra de abajo, también (no
// pegada a la izquierda), y sigue pagando el área segura de abajo.
it('la barra de abajo va centrada con el contenido', () => {
  act(() => root.render(createElement(CargarPartido, { fechas: FECHAS, amigos: AMIGOS })))
  const cta = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Cargar partido')!
  const barra = cta.parentElement!.className.split(' ')
  expect(barra).toEqual(expect.arrayContaining(['fixed', 'inset-x-0', 'bottom-0', 'mx-auto', 'max-w-lg']))
  expect(barra.some((c) => c.includes('safe-area-inset-bottom'))).toBe(true)
})
