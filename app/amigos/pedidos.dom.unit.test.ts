// @vitest-environment jsdom
//
// Los pedidos a la vista (odd/tasks/amigos-faciles.md, S4): en Inicio, resaltados arriba de tus
// amigos; en Amigos, "Te pidieron" y "Pedidos enviados". Aceptar avisa "Ahora sos amigo de Juampi"
// con "Ver"; ✕ y Cancelar borran el pedido sin deshacer. Un error deja la fila donde estaba.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

vi.mock('@/app/amigos/actions', () => ({
  aceptarPedidoDe: vi.fn(async () => ({ ok: true })),
  rechazarPedidoDe: vi.fn(async () => ({ ok: true })),
  deshacerPedido: vi.fn(async () => ({ ok: true })),
}))

const actions = await import('@/app/amigos/actions')
const { PedidosEnInicio, TePidieron, PedidosEnviados } = await import('./pedidos')

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

const JUAMPI = { playerId: 'p-juampi', displayName: 'Juampi Ledesma', torneos: ['Los Pibes del Martes'] }
const RAMA = { playerId: 'p-rama', displayName: 'Rama Benítez', torneos: [] }
const TOMI = { playerId: 'p-tomi', displayName: 'Tomi Sosa', meta: 'Sin respuesta · hace 3 días' }

const boton = (texto: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto) as HTMLButtonElement | undefined
const porLabel = (label: string) => host.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null
const filas = () => [...host.querySelectorAll('li')]
const aviso = () => host.querySelector('[role="status"]') as HTMLElement

async function tocar(el: HTMLElement | null | undefined) {
  if (el === undefined || el === null) throw new Error('No está el botón')
  await act(async () => el.click())
}

describe('PedidosEnInicio', () => {
  it('cada pedido resaltado: nombre, "Te pidió ser amigos · <torneo>", Aceptar y ✕', () => {
    act(() => root.render(createElement(PedidosEnInicio, { pedidos: [JUAMPI, RAMA] })))
    expect(filas()).toHaveLength(2)
    const [juampi, rama] = filas()
    expect(juampi?.className).toContain('bg-sport-tint')
    expect(juampi?.textContent).toContain('Juampi Ledesma')
    expect(juampi?.textContent).toContain('Te pidió ser amigos · Los Pibes del Martes')
    expect(juampi?.querySelector('button')?.textContent).toBe('Aceptar')
    expect(porLabel('Rechazar el pedido de Juampi')).not.toBeNull()
    // Sin torneo compartido, no dice de dónde.
    expect(rama?.textContent).toContain('Te pidió ser amigos')
    expect(rama?.textContent).not.toContain('·')
  })

  it('sin pedidos no dibuja ninguna fila', () => {
    act(() => root.render(createElement(PedidosEnInicio, { pedidos: [] })))
    expect(filas()).toHaveLength(0)
  })

  it('Aceptar: "Ahora sos amigo de Juampi" con "Ver", que lleva a su historial', async () => {
    act(() => root.render(createElement(PedidosEnInicio, { pedidos: [JUAMPI] })))
    await tocar(boton('Aceptar'))
    expect(actions.aceptarPedidoDe).toHaveBeenCalledWith('p-juampi')
    expect(filas()).toHaveLength(0)
    expect(aviso().textContent).toContain('Ahora sos amigo de Juampi')
    await tocar(boton('Ver'))
    expect(push).toHaveBeenCalledWith('/amigos/p-juampi')
  })

  it('el aviso sigue aunque la página ya no traiga el pedido (pasó a ser amigo)', async () => {
    act(() => root.render(createElement(PedidosEnInicio, { pedidos: [JUAMPI] })))
    await tocar(boton('Aceptar'))
    act(() => root.render(createElement(PedidosEnInicio, { pedidos: [] })))
    expect(aviso().textContent).toContain('Ahora sos amigo de Juampi')
  })

  it('✕ rechaza: la fila se va, sin aviso ni deshacer', async () => {
    act(() => root.render(createElement(PedidosEnInicio, { pedidos: [JUAMPI] })))
    await tocar(porLabel('Rechazar el pedido de Juampi'))
    expect(actions.rechazarPedidoDe).toHaveBeenCalledWith('p-juampi')
    expect(filas()).toHaveLength(0)
    expect(aviso().textContent).toBe('')
    expect(boton('Deshacer')).toBeUndefined()
  })

  it('si falla, la fila queda y avisa por qué', async () => {
    vi.mocked(actions.aceptarPedidoDe).mockResolvedValueOnce({ ok: false, error: 'No se pudo aceptar: el pedido ya no está.' })
    act(() => root.render(createElement(PedidosEnInicio, { pedidos: [JUAMPI] })))
    await tocar(boton('Aceptar'))
    expect(filas()).toHaveLength(1)
    expect(aviso().textContent).toContain('No se pudo aceptar: el pedido ya no está.')
    expect(boton('Ver')).toBeUndefined()
  })
})

describe('TePidieron (Amigos)', () => {
  it('"Te pidieron" con "De <torneo>" (varios: "y N más"), Aceptar y ✕; sin torneo, sin meta', () => {
    const varios = { ...JUAMPI, torneos: ['Los Pibes del Martes', 'FIFA de los Viernes'] }
    act(() => root.render(createElement(TePidieron, { pedidos: [varios, RAMA] })))
    expect(host.querySelector('h2')?.textContent).toBe('Te pidieron')
    const [juampi, rama] = filas()
    expect(juampi?.textContent).toContain('De Los Pibes del Martes y 1 más')
    expect(rama?.textContent).toBe('RBRama BenítezAceptar')
    expect(porLabel('Rechazar el pedido de Rama')).not.toBeNull()
  })

  it('sin pedidos, no hay sección', () => {
    act(() => root.render(createElement(TePidieron, { pedidos: [] })))
    expect(host.querySelector('h2')).toBeNull()
  })

  it('Aceptar avisa, y "Ver" va al historial con Volver a Amigos', async () => {
    act(() => root.render(createElement(TePidieron, { pedidos: [JUAMPI] })))
    await tocar(boton('Aceptar'))
    expect(aviso().textContent).toContain('Ahora sos amigo de Juampi')
    await tocar(boton('Ver'))
    expect(push).toHaveBeenCalledWith('/amigos/p-juampi?desde=amigos')
  })

  it('✕ rechaza; si falla, la fila queda', async () => {
    vi.mocked(actions.rechazarPedidoDe).mockResolvedValueOnce({ ok: false, error: 'No se pudo rechazar: el pedido ya no está pendiente.' })
    act(() => root.render(createElement(TePidieron, { pedidos: [JUAMPI] })))
    await tocar(porLabel('Rechazar el pedido de Juampi'))
    expect(actions.rechazarPedidoDe).toHaveBeenCalledWith('p-juampi')
    expect(filas()).toHaveLength(1)
    expect(aviso().textContent).toContain('No se pudo rechazar')
    await tocar(porLabel('Rechazar el pedido de Juampi'))
    expect(filas()).toHaveLength(0)
  })
})

describe('PedidosEnviados (Amigos)', () => {
  it('"Pedidos enviados" con "Sin respuesta · hace 3 días" y "Cancelar"', () => {
    act(() => root.render(createElement(PedidosEnviados, { enviados: [TOMI] })))
    expect(host.querySelector('h2')?.textContent).toBe('Pedidos enviados')
    expect(filas()[0]?.textContent).toContain('Tomi Sosa')
    expect(filas()[0]?.textContent).toContain('Sin respuesta · hace 3 días')
    const cancelar = porLabel('Cancelar el pedido a Tomi')
    expect(cancelar?.textContent).toBe('Cancelar')
  })

  it('Cancelar borra mi pedido y la fila se va', async () => {
    act(() => root.render(createElement(PedidosEnviados, { enviados: [TOMI] })))
    await tocar(porLabel('Cancelar el pedido a Tomi'))
    expect(actions.deshacerPedido).toHaveBeenCalledWith('p-tomi')
    expect(filas()).toHaveLength(0)
  })

  it('si falla (ya te aceptó), la fila queda y avisa', async () => {
    vi.mocked(actions.deshacerPedido).mockResolvedValueOnce({ ok: false, error: 'No se pudo deshacer: el pedido ya no está pendiente.' })
    act(() => root.render(createElement(PedidosEnviados, { enviados: [TOMI] })))
    await tocar(porLabel('Cancelar el pedido a Tomi'))
    expect(filas()).toHaveLength(1)
    expect(aviso().textContent).toContain('No se pudo deshacer')
  })

  it('sin pedidos enviados, no hay sección', () => {
    act(() => root.render(createElement(PedidosEnviados, { enviados: [] })))
    expect(host.querySelector('h2')).toBeNull()
  })
})
