// @vitest-environment jsdom
//
// "Tus torneos" en Inicio: una grilla de bloques del color de su deporte. Dos filas a la vista (de
// dos en el teléfono, de tres en pantalla ancha) y el resto detrás de "Ver los N torneos", que la
// abre ahí mismo. Lo que no se ve se esconde con clases (`hidden`, `sm:flex`): el ancho lo decide
// el CSS, no JS.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement('a', { href, ...rest }, children as never),
}))
const { TusTorneos } = await import('./torneos')
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

const torneo = (n: number) => ({
  id: `s${n}`,
  name: `Torneo ${n}`,
  sport: n % 2 === 0 ? 'FIFA' : 'PADEL',
  sports: n % 2 === 0 ? 'FIFA' : 'Pádel',
  progreso: 'Fecha 1 de 10',
  position: n === 1 ? 2 : null,
  squadSize: 8,
})

function montar(cuantos: number) {
  const torneos = Array.from({ length: cuantos }, (_, i) => torneo(i + 1))
  act(() => root.render(createElement(TusTorneos, { torneos, children: createElement('p', null, 'acciones') })))
}

const items = () => [...host.querySelectorAll('li')]
const clases = (el: Element) => el.className.split(' ')
const boton = () => host.querySelector('button[aria-expanded]') as HTMLButtonElement | null

it('es la sección "Tus torneos": una grilla de dos columnas que pasa a tres en pantalla ancha', () => {
  montar(3)
  expect(host.querySelector('h2')?.textContent).toBe('Tus torneos')
  const grilla = host.querySelector('ul')!
  expect(clases(grilla)).toEqual(expect.arrayContaining(['grid', 'grid-cols-2', 'sm:grid-cols-3']))
  expect(host.textContent).toContain('acciones')
})

it('cada bloque lleva a su torneo, en el color de su deporte, y se lee entero', () => {
  montar(1)
  const li = items()[0]!
  expect(li.getAttribute('data-deporte')).toBe('PADEL')
  const link = li.querySelector('a')!
  expect(link.getAttribute('href')).toBe('/torneo/s1')
  expect(link.getAttribute('aria-label')).toBe('Torneo 1, Pádel, vas 2° de 8, Fecha 1 de 10')
  // El nombre corta en dos renglones con puntos suspensivos; nunca de costado a mitad de palabra.
  expect(clases(link.querySelector('[data-nombre]')!)).toContain('line-clamp-2')
})

it('con cuatro o menos, todos a la vista y sin botón', () => {
  montar(4)
  expect(items().every((li) => !clases(li).includes('hidden'))).toBe(true)
  expect(boton()).toBeNull()
})

it('con cinco o seis, el botón es sólo del teléfono: en pantalla ancha ya se ven todos', () => {
  montar(6)
  expect(items().slice(4).every((li) => clases(li).includes('hidden') && clases(li).includes('sm:flex'))).toBe(true)
  expect(boton()?.textContent).toBe('Ver los 6 torneos')
  expect(clases(boton()!)).toContain('sm:hidden')
})

it('con muchos, "Ver los N torneos" dice cuántos son y abre la grilla ahí mismo; "Ver menos" la vuelve a plegar', () => {
  montar(20)
  const b = boton()!
  expect(b.textContent).toBe('Ver los 20 torneos')
  expect(b.getAttribute('aria-expanded')).toBe('false')
  expect(b.getAttribute('aria-controls')).toBe(host.querySelector('ul')!.id)
  expect(clases(b)).not.toContain('sm:hidden')
  expect(items()).toHaveLength(20)
  expect(items().slice(0, 4).every((li) => !clases(li).includes('hidden'))).toBe(true)
  expect(items().slice(4, 6).every((li) => clases(li).includes('sm:flex'))).toBe(true)
  expect(items().slice(6).every((li) => clases(li).includes('hidden') && !clases(li).includes('sm:flex'))).toBe(true)
  // Lo plegado no se puede alcanzar con el teclado: `hidden` es `display: none`.

  act(() => b.click())
  expect(b.getAttribute('aria-expanded')).toBe('true')
  expect(b.textContent).toBe('Ver menos')
  expect(items().every((li) => !clases(li).includes('hidden'))).toBe(true)

  act(() => b.click())
  expect(b.getAttribute('aria-expanded')).toBe('false')
  expect(items()[6]!.className.split(' ')).toContain('hidden')
})

it('el botón mide 44 o más', () => {
  montar(7)
  expect(clases(boton()!)).toContain('min-h-[44px]')
})
