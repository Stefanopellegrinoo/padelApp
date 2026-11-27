// @vitest-environment jsdom
//
// El control de amistad del perfil del torneo (odd/tasks/amigos-faciles.md, S2): qué se ve en
// cada estado y qué acción manda cada toque. El estado sale SIEMPRE de la base (la página lo lee
// y lo pasa); después de cada acción el servidor revalida y la página vuelve con el nuevo.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement('a', { href, ...rest }, children as never),
}))

vi.mock('@/app/amigos/actions', () => ({
  agregarAmigo: vi.fn(async () => ({ ok: true, estado: 'sent' })),
  deshacerPedido: vi.fn(async () => ({ ok: true })),
  aceptarPedidoDe: vi.fn(async () => ({ ok: true })),
  rechazarPedidoDe: vi.fn(async () => ({ ok: true })),
}))

const actions = await import('@/app/amigos/actions')
const { ChipAmistad, PedidoRecibido } = await import('./amistad')

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

const boton = (texto: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto) as HTMLButtonElement | undefined
const aviso = () => host.querySelector('[role="status"]') as HTMLElement

async function tocar(el: HTMLElement | undefined) {
  if (el === undefined) throw new Error('No está el botón')
  await act(async () => el.click())
}

describe('ChipAmistad', () => {
  it('no son amigos: "Agregar" manda el pedido y avisa "Le mandaste el pedido a Nico" con Deshacer', async () => {
    act(() => root.render(createElement(ChipAmistad, { playerId: 'p2', nombre: 'Nico', estado: 'none' })))
    const agregar = boton('Agregar')
    expect(agregar?.getAttribute('aria-label')).toBe('Agregar a Nico como amigo')

    await tocar(agregar)
    expect(actions.agregarAmigo).toHaveBeenCalledWith('p2')
    expect(aviso().textContent).toContain('Le mandaste el pedido a Nico')

    // El servidor revalidó: la página vuelve con el pedido enviado.
    act(() => root.render(createElement(ChipAmistad, { playerId: 'p2', nombre: 'Nico', estado: 'sent' })))
    expect(host.textContent).toContain('Enviado')
    expect(boton('Agregar')).toBeUndefined()

    await tocar(boton('Deshacer'))
    expect(actions.deshacerPedido).toHaveBeenCalledWith('p2')
  })

  it('si "Agregar" aceptó un pedido que ya estaba (pantalla vieja), no dice que mandó uno', async () => {
    vi.mocked(actions.agregarAmigo).mockResolvedValueOnce({ ok: true, estado: 'friends' })
    act(() => root.render(createElement(ChipAmistad, { playerId: 'p2', nombre: 'Nico', estado: 'none' })))
    await tocar(boton('Agregar'))
    expect(aviso().textContent).not.toContain('Le mandaste')
  })

  it('un error de la acción se avisa, sin Deshacer', async () => {
    vi.mocked(actions.agregarAmigo).mockResolvedValueOnce({ ok: false, error: 'No se pudo enviar la solicitud: x' })
    act(() => root.render(createElement(ChipAmistad, { playerId: 'p2', nombre: 'Nico', estado: 'none' })))
    await tocar(boton('Agregar'))
    expect(aviso().textContent).toContain('No se pudo enviar la solicitud: x')
    expect(boton('Deshacer')).toBeUndefined()
  })

  it('pedido enviado (al volver a entrar): chip "Enviado", que no es un botón', () => {
    act(() => root.render(createElement(ChipAmistad, { playerId: 'p2', nombre: 'Nico', estado: 'sent' })))
    expect(host.textContent).toContain('Enviado')
    expect(host.querySelectorAll('button')).toHaveLength(0)
  })

  it('ya son amigos: "Amigos ›" lleva al historial entre los dos', () => {
    act(() => root.render(createElement(ChipAmistad, { playerId: 'p2', nombre: 'Nico', estado: 'friends' })))
    const link = host.querySelector('a') as HTMLAnchorElement
    expect(link.textContent).toBe('Amigos')
    expect(link.getAttribute('href')).toBe('/amigos/p2?desde=amigos')
    expect(link.getAttribute('aria-label')).toBe('Amigos: ver el historial con Nico')
  })

  it('el chip mide 34 a la vista y 44 para el dedo (S6)', () => {
    act(() => root.render(createElement(ChipAmistad, { playerId: 'p2', nombre: 'Nico', estado: 'none' })))
    const clases = boton('Agregar')?.className.split(' ') ?? []
    expect(clases).toEqual(expect.arrayContaining(['min-h-[34px]', 'after:-inset-y-[5px]']))
  })
})

describe('PedidoRecibido: la tarjeta blanca "Nico te pidió ser amigos"', () => {
  it('dice quién y cuándo; Aceptar acepta y ✕ rechaza', async () => {
    act(() => root.render(createElement(PedidoRecibido, { playerId: 'p2', nombre: 'Nico', hace: 'Hace 2 días' })))
    expect(host.textContent).toContain('Nico te pidió ser amigos')
    expect(host.textContent).toContain('Hace 2 días')

    await tocar(boton('Aceptar'))
    expect(actions.aceptarPedidoDe).toHaveBeenCalledWith('p2')

    const rechazar = host.querySelector('button[aria-label="Rechazar el pedido de Nico"]') as HTMLButtonElement
    await tocar(rechazar)
    expect(actions.rechazarPedidoDe).toHaveBeenCalledWith('p2')
  })

  it('si la acción falla, lo dice en la tarjeta', async () => {
    vi.mocked(actions.aceptarPedidoDe).mockResolvedValueOnce({ ok: false, error: 'No se pudo aceptar: el pedido ya no está.' })
    act(() => root.render(createElement(PedidoRecibido, { playerId: 'p2', nombre: 'Nico', hace: 'Hoy' })))
    await tocar(boton('Aceptar'))
    expect(host.textContent).toContain('No se pudo aceptar: el pedido ya no está.')
  })
})
