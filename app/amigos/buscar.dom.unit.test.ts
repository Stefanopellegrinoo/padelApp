// @vitest-environment jsdom
//
// El buscador de Amigos por @usuario (odd/tasks/amigos-faciles.md, S8, S9,
// `design/amigos-faciles/05-buscar-por-usuario.html`): busca cuando dejás de escribir y desde 3
// letras; los resultados reemplazan a las secciones de abajo mientras haya búsqueda, cada uno con
// su estado y un enlace a su perfil; sin nadie, el link de amistad. Borrar devuelve las secciones.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UsernameMatch } from '@/db/buscar'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement('a', { href, ...rest }, children as never),
}))

vi.mock('@/app/amigos/actions', () => ({
  buscarPorUsuario: vi.fn(async () => ({ ok: true, resultados: [] })),
  agregarAmigo: vi.fn(async () => ({ ok: true, estado: 'sent' })),
  aceptarPedidoDe: vi.fn(async () => ({ ok: true })),
  cambiarMiLink: vi.fn(),
}))

const actions = await import('@/app/amigos/actions')
const { BuscarPorUsuario } = await import('./buscar')

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

const TOKEN = 'abc0000000000000000000000000000f'

const NICANOR: UsernameMatch = { playerId: 'p-nicanor', displayName: 'Nicanor Ortiz', username: 'nicanorortiz', estado: 'received' }
const NICO: UsernameMatch = { playerId: 'p-nico', displayName: 'Nico Arias', username: 'nico.arias', estado: 'friends' }
const NICOLAS: UsernameMatch = { playerId: 'p-nicolas', displayName: 'Nicolás Ibarra', username: 'nicoibarra', estado: 'none' }
const NICOLE: UsernameMatch = { playerId: 'p-nicole', displayName: 'Nicole Vidal', username: 'nicolevidal', estado: 'sent' }

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  vi.clearAllMocks()
  vi.mocked(actions.buscarPorUsuario).mockResolvedValue({ ok: true, resultados: [NICANOR, NICO, NICOLAS, NICOLE] })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

function montar() {
  act(() =>
    root.render(
      createElement(BuscarPorUsuario, {
        token: TOKEN,
        children: createElement('section', { id: 'secciones' }, 'Tus amigos'),
      }),
    ),
  )
}

const campo = () => host.querySelector('input[type="search"]') as HTMLInputElement
const secciones = () => host.querySelector('#secciones') as HTMLElement
const seVenLasSecciones = () => secciones().closest('[hidden]') === null
const filas = () => [...host.querySelectorAll('li')]
const boton = (texto: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto) as HTMLButtonElement | undefined

function escribir(texto: string) {
  const input = campo()
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, texto)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Deja pasar la espera y que vuelva la búsqueda. */
async function esperar(ms = 300) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function tocar(el: HTMLElement | null | undefined) {
  if (el === undefined || el === null) throw new Error('No está el botón')
  await act(async () => el.click())
}

describe('BuscarPorUsuario', () => {
  it('el campo "Buscá por @usuario", con su etiqueta y la ayuda, y las secciones de siempre abajo', () => {
    montar()
    expect(campo().placeholder).toBe('Buscá por @usuario')
    expect(host.querySelector(`label[for="${campo().id}"]`)?.textContent).toBe('Buscar por @usuario')
    expect(host.querySelector('[role="search"]')).not.toBeNull()
    expect(host.textContent).toContain('Para sumar a quien no está en tus torneos')
    expect(seVenLasSecciones()).toBe(true)
  })

  it('con menos de 3 letras pide más, no busca y deja las secciones', async () => {
    montar()
    escribir('@ni')
    await esperar(1000)
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Escribí al menos 3 letras de su @usuario')
    expect(actions.buscarPorUsuario).not.toHaveBeenCalled()
    expect(seVenLasSecciones()).toBe(true)
  })

  it('busca cuando dejás de escribir, una sola vez y con lo último', async () => {
    montar()
    escribir('nic')
    await esperar(200)
    escribir('nico')
    await esperar(200)
    expect(actions.buscarPorUsuario).not.toHaveBeenCalled()
    await esperar(100)
    expect(actions.buscarPorUsuario).toHaveBeenCalledExactlyOnceWith('nico')
  })

  it('manda lo limpio: sin la @, sin espacios y en minúsculas', async () => {
    montar()
    escribir(' @NIC ')
    await esperar()
    expect(actions.buscarPorUsuario).toHaveBeenCalledExactlyOnceWith('nic')
  })

  it('los resultados reemplazan a las secciones: nombre al perfil, @usuario con lo escrito en negrita', async () => {
    montar()
    escribir('Nic')
    await esperar()

    expect(seVenLasSecciones()).toBe(false)
    expect(host.textContent).toContain('4 usuarios empiezan con @nic')
    expect(filas()).toHaveLength(4)
    const [nicanor] = filas()
    const perfil = nicanor!.querySelector('a[href="/perfil/p-nicanor"]')
    expect(perfil?.textContent).toContain('Nicanor Ortiz')
    expect(perfil?.querySelector('b')?.textContent).toBe('@nic')
    expect(perfil?.textContent).toContain('@nicanorortiz')
    expect(filas().map((fila) => fila.querySelector('a')?.getAttribute('href'))).toEqual([
      '/perfil/p-nicanor',
      '/perfil/p-nico',
      '/perfil/p-nicolas',
      '/perfil/p-nicole',
    ])
  })

  it('los cuatro estados: Te pidió · Aceptar, Amigos ›, Agregar y Enviado', async () => {
    montar()
    escribir('nic')
    await esperar()
    const [nicanor, nico, nicolas, nicole] = filas()

    // Te pidió: sólo Aceptar, resaltado; rechazar va desde el perfil.
    expect(nicanor!.textContent).toContain('Te pidió')
    expect(nicanor!.querySelector('button[aria-label="Aceptar el pedido de Nicanor Ortiz"]')?.textContent).toBe('Aceptar')
    expect(nicanor!.querySelectorAll('button')).toHaveLength(1)
    expect(nicanor!.className).toContain('bg-sport-tint')

    const amigos = nico!.querySelector('a[aria-label="Amigos: ver el historial con Nico Arias"]')
    expect(amigos?.getAttribute('href')).toBe('/amigos/p-nico?desde=amigos')
    expect(amigos?.textContent).toBe('Amigos')
    expect(nico!.querySelector('button')).toBeNull()

    const agregar = nicolas!.querySelector('button[aria-label="Agregar a Nicolás Ibarra"]')
    expect(agregar?.textContent).toBe('Agregar')
    // S6: chip de 34 a la vista, 44 de toque.
    expect(agregar?.className).toContain('min-h-[34px]')
    expect(agregar?.className).toContain('after:-inset-y-[5px]')

    expect(nicole!.textContent).toContain('Enviado')
    expect(nicole!.querySelector('button')).toBeNull()
  })

  it('"Agregar" manda el pedido y queda en "Enviado"', async () => {
    montar()
    escribir('nic')
    await esperar()
    await tocar(host.querySelector<HTMLButtonElement>('button[aria-label="Agregar a Nicolás Ibarra"]'))

    expect(actions.agregarAmigo).toHaveBeenCalledExactlyOnceWith('p-nicolas')
    const nicolas = filas()[2]!
    expect(nicolas.textContent).toContain('Enviado')
    expect(nicolas.querySelector('button')).toBeNull()
    await esperar(5000)
    expect(filas()[2]!.textContent).toContain('Enviado')
  })

  it('"Agregar" a quien justo te había pedido los deja amigos', async () => {
    vi.mocked(actions.agregarAmigo).mockResolvedValueOnce({ ok: true, estado: 'friends' })
    montar()
    escribir('nic')
    await esperar()
    await tocar(host.querySelector<HTMLButtonElement>('button[aria-label="Agregar a Nicolás Ibarra"]'))
    expect(filas()[2]!.querySelector('a[aria-label="Amigos: ver el historial con Nicolás Ibarra"]')).not.toBeNull()
  })

  it('"Aceptar" acepta su pedido y pasa a "Amigos ›"', async () => {
    montar()
    escribir('nic')
    await esperar()
    await tocar(boton('Aceptar'))

    expect(actions.aceptarPedidoDe).toHaveBeenCalledExactlyOnceWith('p-nicanor')
    const nicanor = filas()[0]!
    expect(nicanor.textContent).not.toContain('Te pidió')
    expect(nicanor.querySelector('a[href="/amigos/p-nicanor?desde=amigos"]')).not.toBeNull()
  })

  it('si una acción falla, lo dice y la fila queda como estaba', async () => {
    vi.mocked(actions.agregarAmigo).mockResolvedValueOnce({ ok: false, error: 'Esa persona ya no tiene cuenta.' })
    montar()
    escribir('nic')
    await esperar()
    await tocar(host.querySelector<HTMLButtonElement>('button[aria-label="Agregar a Nicolás Ibarra"]'))
    expect(host.textContent).toContain('Esa persona ya no tiene cuenta.')
    expect(filas()[2]!.querySelector('button[aria-label="Agregar a Nicolás Ibarra"]')).not.toBeNull()
  })

  it('sin nadie: el texto y "Compartir mi link", que abre la hoja del link', async () => {
    vi.mocked(actions.buscarPorUsuario).mockResolvedValue({ ok: true, resultados: [] })
    montar()
    escribir('zzz')
    await esperar()

    expect(seVenLasSecciones()).toBe(false)
    expect(host.textContent).toContain('No hay nadie con ese @usuario. Si todavía no lo eligió, mandale tu link.')
    const compartir = boton('Compartir mi link')
    expect(compartir?.className).toContain('text-accent-link')
    await tocar(compartir)
    const hoja = host.querySelector('dialog')!
    expect(hoja.hasAttribute('open')).toBe(true)
    expect(hoja.textContent).toContain('Tu link de amistad')
    expect(hoja.querySelector('code')?.textContent).toBe(`${window.location.origin}/amigo/${TOKEN}`)
  })

  it('si la búsqueda falla, lo dice', async () => {
    vi.mocked(actions.buscarPorUsuario).mockResolvedValue({ ok: false, error: 'No se pudo buscar. Probá de nuevo.' })
    montar()
    escribir('nic')
    await esperar()
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('No se pudo buscar. Probá de nuevo.')
  })

  it('una respuesta que llega tarde, de algo que ya cambiaste, no se muestra', async () => {
    let tarde: (valor: { ok: true; resultados: UsernameMatch[] }) => void = () => {}
    vi.mocked(actions.buscarPorUsuario)
      .mockImplementationOnce(() => new Promise((resolve) => (tarde = resolve)))
      .mockResolvedValueOnce({ ok: true, resultados: [NICOLE] })
    montar()
    escribir('nic')
    await esperar()
    escribir('nicole')
    await esperar()
    await act(async () => tarde({ ok: true, resultados: [NICANOR, NICO] }))

    expect(filas()).toHaveLength(1)
    expect(filas()[0]!.textContent).toContain('Nicole Vidal')
  })

  it('borrar la búsqueda devuelve las secciones, con la ✕ o dejando el campo vacío', async () => {
    montar()
    escribir('nic')
    await esperar()
    expect(seVenLasSecciones()).toBe(false)

    await tocar(host.querySelector<HTMLButtonElement>('button[aria-label="Borrar la búsqueda"]'))
    expect(campo().value).toBe('')
    expect(seVenLasSecciones()).toBe(true)
    expect(filas()).toHaveLength(0)
    expect(document.activeElement).toBe(campo())

    escribir('nic')
    await esperar()
    escribir('')
    expect(seVenLasSecciones()).toBe(true)
    expect(filas()).toHaveLength(0)
    expect(host.querySelector('button[aria-label="Borrar la búsqueda"]')).toBeNull()
  })
})
