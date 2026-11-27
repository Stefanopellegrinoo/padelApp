// @vitest-environment jsdom
//
// "Gente de tus torneos" (odd/tasks/amigos-faciles.md, S3, S6): la lista con "Agregar", que pasa a
// "Enviado" y se queda así mientras sigas en la pantalla, aunque el servidor ya la saque de la lista.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenteDeTorneo } from '@/db/friends'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement('a', { href, ...rest }, children as never),
}))

vi.mock('@/app/amigos/actions', () => ({
  agregarAmigo: vi.fn(async () => ({ ok: true, estado: 'sent' })),
}))

const actions = await import('@/app/amigos/actions')
const { GenteDeTusTorneos, EmpezaPorTusTorneos } = await import('./gente')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  vi.clearAllMocks()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function persona(n: number, over: Partial<GenteDeTorneo> = {}): GenteDeTorneo {
  return {
    playerId: `p${n}`,
    displayName: `Persona ${n}`,
    seasonIds: ['s-martes'],
    torneos: ['Los Pibes del Martes'],
    fechasJuntos: 10 - n,
    ...over,
  }
}

const SEBA = persona(1, {
  displayName: 'Seba Molina',
  seasonIds: ['s-martes', 's-viernes'],
  torneos: ['Los Pibes del Martes', 'FIFA de los Viernes'],
  fechasJuntos: 9,
})
const LUCAS = persona(2, { displayName: 'Lucas Ferreyra', fechasJuntos: 7 })

const boton = (texto: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto) as HTMLButtonElement | undefined
const filas = () => [...host.querySelectorAll('li')]
const aviso = () => host.querySelector('[role="status"]') as HTMLElement

async function tocar(el: HTMLElement | null | undefined) {
  if (el === undefined || el === null) throw new Error('No está el botón')
  await act(async () => el.click())
}

describe('GenteDeTusTorneos (Amigos)', () => {
  it('título, "Jugaron con vos y tienen cuenta", y cada fila con nombre, de dónde y "Agregar"', () => {
    act(() => root.render(createElement(GenteDeTusTorneos, { gente: [SEBA, LUCAS] })))
    expect(host.querySelector('h2')?.textContent).toBe('Gente de tus torneos')
    expect(host.textContent).toContain('Jugaron con vos y tienen cuenta')
    expect(filas()).toHaveLength(2)
    expect(filas()[0]?.textContent).toContain('Seba Molina')
    // S11: los torneos, sin fechas (antes "2 torneos · 9 fechas juntos" y "Los Pibes del Martes · 7 fechas").
    expect(filas()[0]?.textContent).toContain('Los Pibes del Martes y FIFA de los Viernes')
    expect(filas()[1]?.textContent).toContain('Los Pibes del Martes')
    expect(host.textContent).not.toMatch(/fecha|torneos ·/)
    expect(filas()[0]?.querySelector('button')?.getAttribute('aria-label')).toBe('Agregar a Seba Molina')
    expect(host.querySelector('a[href="/amigos/gente"]')).toBeNull()
  })

  it('sin nadie para sugerir, no hay sección', () => {
    act(() => root.render(createElement(GenteDeTusTorneos, { gente: [] })))
    expect(host.innerHTML).toBe('')
  })

  // S10: la lista no es infinita.
  it('muestra las primeras 5, en el orden que llegan, y "Ver todas (11)" lleva a /amigos/gente', () => {
    const once = Array.from({ length: 11 }, (_, i) => persona(i + 1))
    act(() => root.render(createElement(GenteDeTusTorneos, { gente: once })))
    expect(filas().map((fila) => fila.querySelector('button')?.getAttribute('aria-label'))).toEqual([
      'Agregar a Persona 1',
      'Agregar a Persona 2',
      'Agregar a Persona 3',
      'Agregar a Persona 4',
      'Agregar a Persona 5',
    ])
    const ver = [...host.querySelectorAll('a[href="/amigos/gente"]')]
    expect(ver.length).toBeGreaterThan(0)
    expect(ver.every((link) => link.textContent === 'Ver todas (11)')).toBe(true)
    // El de arriba va en la línea del título.
    expect(host.querySelector('h2')?.parentElement?.querySelector('a[href="/amigos/gente"]')?.textContent).toBe('Ver todas (11)')
    // Ya no se despliega acá: el viejo "Ver los N" no está.
    expect(boton('Ver los 11')).toBeUndefined()
  })

  it('con 5 o menos, todas a la vista y sin "Ver todas"', () => {
    act(() => root.render(createElement(GenteDeTusTorneos, { gente: Array.from({ length: 5 }, (_, i) => persona(i + 1)) })))
    expect(filas()).toHaveLength(5)
    expect(host.querySelector('a[href="/amigos/gente"]')).toBeNull()
    expect(host.textContent).not.toContain('Ver todas')
  })

  it('con 6, "Ver todas (6)"', () => {
    act(() => root.render(createElement(GenteDeTusTorneos, { gente: Array.from({ length: 6 }, (_, i) => persona(i + 1)) })))
    expect(filas()).toHaveLength(5)
    expect(host.querySelector('a[href="/amigos/gente"]')?.textContent).toBe('Ver todas (6)')
  })

  it('"Agregar" manda el pedido y la fila queda en "Enviado", aunque el servidor ya no la sugiera', async () => {
    act(() => root.render(createElement(GenteDeTusTorneos, { gente: [SEBA, LUCAS] })))
    await tocar(filas()[1]?.querySelector('button'))
    expect(actions.agregarAmigo).toHaveBeenCalledWith('p2')

    // El servidor revalidó: Lucas ya está en "Pedidos enviados" y no viene más acá.
    act(() => root.render(createElement(GenteDeTusTorneos, { gente: [SEBA] })))
    expect(filas()).toHaveLength(2)
    expect(filas()[1]?.textContent).toContain('Lucas Ferreyra')
    expect(filas()[1]?.textContent).toContain('Enviado')
    expect(filas()[1]?.querySelector('button')).toBeNull()
    expect(filas()[0]?.querySelector('button')?.textContent).toBe('Agregar')
  })

  it('si al agregar ya te había pedido, quedan amigos: la fila dice "Amigos"', async () => {
    vi.mocked(actions.agregarAmigo).mockResolvedValueOnce({ ok: true, estado: 'friends' })
    act(() => root.render(createElement(GenteDeTusTorneos, { gente: [SEBA] })))
    await tocar(boton('Agregar'))
    expect(filas()[0]?.textContent).toContain('Amigos')
    expect(filas()[0]?.textContent).not.toContain('Enviado')
  })

  it('un error se avisa y el "Agregar" sigue ahí', async () => {
    vi.mocked(actions.agregarAmigo).mockResolvedValueOnce({ ok: false, error: 'No se pudo enviar la solicitud: x' })
    act(() => root.render(createElement(GenteDeTusTorneos, { gente: [SEBA] })))
    await tocar(boton('Agregar'))
    expect(aviso().textContent).toContain('No se pudo enviar la solicitud: x')
    expect(boton('Agregar')).toBeDefined()
  })

  it('el chip mide 34 a la vista y 44 para el dedo (S6)', () => {
    act(() => root.render(createElement(GenteDeTusTorneos, { gente: [SEBA] })))
    expect(boton('Agregar')?.className.split(' ')).toEqual(expect.arrayContaining(['min-h-[34px]', 'after:-inset-y-[5px]']))
  })
})

describe('EmpezaPorTusTorneos (Inicio sin amigos)', () => {
  const sumaUnAmigo = createElement('li', null, 'Sumá un amigo')

  it('"Empezá por la gente de tus torneos", las dos primeras con "Agregar" y "Ver más gente" a /amigos/gente', () => {
    act(() => root.render(createElement(EmpezaPorTusTorneos, { gente: [SEBA, LUCAS, persona(3)], children: sumaUnAmigo })))
    expect(host.textContent).toContain('Empezá por la gente de tus torneos')
    expect(filas()).toHaveLength(2)
    expect(filas()[0]?.textContent).toContain('Seba Molina')
    expect(filas()[1]?.textContent).toContain('Lucas Ferreyra')
    expect(boton('Agregar')).toBeDefined()
    expect(host.querySelector('a[href="/amigos"]')).toBeNull()
    const ver = host.querySelector('a[href="/amigos/gente"]')
    expect(ver?.textContent).toBe('Ver más gente')
    expect(filas()[0]?.textContent).toContain('Los Pibes del Martes y FIFA de los Viernes')
    expect(host.textContent).not.toContain('Sumá un amigo')
  })

  it('con dos o menos no hay más gente que ver', () => {
    act(() => root.render(createElement(EmpezaPorTusTorneos, { gente: [SEBA, LUCAS], children: sumaUnAmigo })))
    expect(host.querySelector('a[href="/amigos/gente"]')).toBeNull()
    expect(host.textContent).not.toContain('Ver más gente')
  })

  it('sin nadie para sugerir, queda lo de siempre ("Sumá un amigo")', () => {
    act(() => root.render(createElement(EmpezaPorTusTorneos, { gente: [], children: sumaUnAmigo })))
    expect(host.textContent).toBe('Sumá un amigo')
  })

  it('"Agregar" en Inicio también queda en "Enviado"', async () => {
    act(() => root.render(createElement(EmpezaPorTusTorneos, { gente: [SEBA], children: sumaUnAmigo })))
    await tocar(boton('Agregar'))
    act(() => root.render(createElement(EmpezaPorTusTorneos, { gente: [], children: sumaUnAmigo })))
    expect(filas()[0]?.textContent).toContain('Enviado')
    expect(host.textContent).not.toContain('Sumá un amigo')
  })
})
