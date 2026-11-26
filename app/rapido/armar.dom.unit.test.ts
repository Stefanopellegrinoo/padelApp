// @vitest-environment jsdom
//
// Armar el torneo rápido rápido: Enter en un nombre pasa al siguiente (y al final agrega uno), y
// "Empezar" es la única acción principal, apagada con la razón a la vista mientras falte algo.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Armado } from './rapido-state'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement('a', { href, ...rest }, children as never),
}))

const { Armar } = await import('./armar')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let empezar: ReturnType<typeof vi.fn<(armado: Armado) => void>>

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  empezar = vi.fn<(armado: Armado) => void>()
  act(() => root.render(createElement(Armar, { onEmpezar: empezar })))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const campo = (n: number) => host.querySelector(`input[aria-label="Jugador ${n}"]`) as HTMLInputElement | null
const boton = (texto: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto) as HTMLButtonElement

/** Escribir en un input controlado de React: el setter nativo y el evento `input`. */
function escribir(input: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, valor)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function enter(input: HTMLInputElement) {
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  })
}

it('el Hero dice dónde estás y Volver va al inicio de la app', () => {
  expect(host.querySelector('h1')?.textContent).toBe('Torneo rápido')
  expect(host.querySelector('header a')?.getAttribute('href')).toBe('/')
  expect(host.querySelector('header a')?.textContent).toBe('Inicio')
})

it('los nombres son de 16 px (sin zoom de iOS) y Enter dice "siguiente"', () => {
  expect(campo(1)?.className.split(' ')).toContain('text-[16px]')
  expect(campo(1)?.getAttribute('enterkeyhint')).toBe('next')
})

it('Enter en un nombre pasa al siguiente', () => {
  campo(1)!.focus()
  escribir(campo(1)!, 'Ana')
  enter(campo(1)!)
  expect(document.activeElement).toBe(campo(2))
})

it('Enter en el último con nombre agrega otro casillero y va ahí', () => {
  expect(campo(5)).toBeNull()
  escribir(campo(4)!, 'Dani')
  campo(4)!.focus()
  enter(campo(4)!)
  expect(campo(5)).not.toBeNull()
  expect(document.activeElement).toBe(campo(5))
})

it('"Empezar" está apagado con la razón a la vista hasta que alcanzan los jugadores', () => {
  expect(boton('Empezar').disabled).toBe(true)
  expect(host.textContent).toContain('Faltan jugadores: parejas arranca en 4.')

  ;['Ana', 'Beto', 'Cami', 'Dani'].forEach((nombre, i) => escribir(campo(i + 1)!, nombre))
  expect(boton('Empezar').disabled).toBe(false)
  act(() => boton('Empezar').click())
  expect(empezar).toHaveBeenCalledTimes(1)
  expect(empezar.mock.calls[0]![0].jugadores).toEqual(['Ana', 'Beto', 'Cami', 'Dani'])
})

it('el deporte es un grupo con título y dice cuál está elegido', () => {
  const padel = boton('Pádel') ?? [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Pádel'))!
  expect(padel.getAttribute('aria-pressed')).toBe('true')
  const grupo = padel.closest('[role="group"]')!
  expect(document.getElementById(grupo.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('Deporte')
})

it('los ocho deportes entran en una grilla de tres, cada uno con su número y su unidad (bowling, sus pinos)', () => {
  const grupo = [...host.querySelectorAll('[role="group"]')].find((g) => g.textContent?.includes('Pádel'))!
  expect(grupo.className.split(' ')).toEqual(expect.arrayContaining(['grid', 'grid-cols-3']))
  const textos = [...grupo.querySelectorAll('button')].map((b) => b.textContent)
  expect(textos).toEqual([
    'PádelA 4 games',
    'Ping pongA 11 puntos',
    'TenisA 6 games',
    'Fútbol tenisA 15 puntos',
    'PoolA 3 bolas',
    'Beer pongA 10 vasos',
    'AjedrezGana o tablas',
    'BowlingPor pinos',
  ])
  act(() => [...grupo.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Pool'))!.click())
  expect(host.querySelector('[data-deporte]')?.getAttribute('data-deporte')).toBe('POOL')
})

// Como en la hoja con un amigo y en el asistente: cada deporte en su color y con su ícono. En 360
// el nombre baja a dos renglones como mucho y lo de abajo entra en uno: todos los bloques parejos.
it('cada deporte es un bloque en su color, con su ícono, el nombre en dos renglones como mucho y un renglón abajo', () => {
  const grupo = [...host.querySelectorAll('[role="group"]')].find((g) => g.textContent?.includes('Pádel'))!
  const bloques = [...grupo.querySelectorAll('button')]
  expect(bloques.map((b) => b.getAttribute('data-deporte'))).toEqual([
    'PADEL', 'PING_PONG', 'TENIS', 'FUTBOL_TENIS', 'POOL', 'BEER_PONG', 'AJEDREZ', 'BOWLING',
  ])
  for (const bloque of bloques) {
    expect(bloque.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    expect(bloque.querySelector('[data-nombre]')?.className.split(' ')).toContain('line-clamp-2')
    expect(bloque.querySelector('[data-sub]')?.className.split(' ')).toContain('whitespace-nowrap')
    expect(bloque.className.split(' ')).toContain('min-h-[96px]')
  }
  // Elegido, lleno de su color; los otros, en su tinte.
  expect(bloques[0]!.className.split(' ')).toContain('bg-sport')
  expect(bloques[1]!.className.split(' ')).toContain('bg-sport-tint')
})

// Ajedrez (odd/tasks/mas-deportes.md, S3): una partida es uno contra uno.
it('el ajedrez se juega de a uno: no pregunta cómo se juega y arranca con tres', () => {
  act(() => boton('AjedrezGana o tablas').click())
  expect(host.textContent).not.toContain('Cómo se juega')
  expect(host.textContent).not.toContain('Parejas')
  for (const [n, nombre] of [[1, 'Ana'], [2, 'Beto'], [3, 'Cami']] as const) escribir(campo(n)!, nombre)
  act(() => boton('Empezar').click())
  expect(empezar).toHaveBeenCalledTimes(1)
  expect(empezar.mock.calls[0]![0]).toMatchObject({ deporte: 'AJEDREZ', modalidad: 'INDIVIDUAL' })
})
