// @vitest-environment jsdom
//
// La pantalla única, tocada (odd/tasks/amigos-faciles.md, S7; lámina 07, pasos 3 y 4): "Usar @x"
// abre "¿Seguro?" con "@x no se puede cambiar después."; "Sí, usar este" lo guarda y "Volver" deja
// el campo como estaba. Mientras el que escribiste no se puede usar, no hay con qué seguir.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UsernameStatus } from '@/db/usuario'

vi.mock('./actions', () => ({ elegirUsuario: vi.fn(async () => ({ error: null })) }))
vi.mock('@/app/auth/usuario-actions', () => ({ revisarUsuario: vi.fn() }))

const { elegirUsuario } = await import('./actions')
const { revisarUsuario } = await import('@/app/auth/usuario-actions')
const { ElegirUsuario } = await import('./elegir')

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

const ESTADOS: Record<string, UsernameStatus> = {
  martinperez: { kind: 'libre', username: 'martinperez', message: '@martinperez está libre' },
  'martin.p': { kind: 'libre', username: 'martin.p', message: '@martin.p está libre' },
  'nico.arias': {
    kind: 'en-uso',
    username: 'nico.arias',
    message: '@nico.arias ya está en uso',
    suggestions: ['nico.arias2', 'nicoarias.padel'],
  },
}

let host: HTMLDivElement
let root: Root

beforeEach(async () => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  vi.mocked(elegirUsuario).mockReset().mockResolvedValue({ error: null })
  vi.mocked(revisarUsuario)
    .mockReset()
    .mockImplementation(async (raw: string) => ESTADOS[raw] ?? { kind: 'vacio' })
  act(() => root.render(createElement(ElegirUsuario, { inicial: 'martinperez', next: '/amigos' })))
  await esperar()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const campo = () => host.querySelector('#username') as HTMLInputElement
const botones = () => [...host.querySelectorAll('button')]
const boton = (texto: string) => botones().find((b) => b.textContent?.trim() === texto)
const hoja = () => host.querySelector('dialog') as HTMLDialogElement
const esperar = () => act(() => new Promise((resolve) => setTimeout(resolve, 450)))

function escribir(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(campo(), value)
    campo().dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('ElegirUsuario', () => {
  it('arranca con la sugerencia, libre, y "Usar @martinperez"', () => {
    expect(campo().value).toBe('martinperez')
    expect(host.querySelector('#username-aviso')?.textContent).toBe('@martinperez está libre')
    expect(boton('Usar @martinperez')?.disabled).toBe(false)
    expect(hoja().hasAttribute('open')).toBe(false)
  })

  it('"Usar" abre "¿Seguro?" con el aviso de que no se cambia', async () => {
    await act(async () => boton('Usar @martinperez')!.click())
    expect(hoja().hasAttribute('open')).toBe(true)
    const titulo = document.getElementById(hoja().getAttribute('aria-labelledby') ?? '')
    expect(titulo?.textContent).toBe('¿Seguro?')
    expect(hoja().textContent).toContain('@martinperez no se puede cambiar después.')
    expect(hoja().querySelector('button')?.textContent).toBe('Volver')
    expect([...hoja().querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Volver', 'Sí, usar este'])
  })

  it('"Volver" cierra la hoja sin guardar y deja el campo como estaba', async () => {
    escribir('martin.p')
    await esperar()
    await act(async () => boton('Usar @martin.p')!.click())
    await act(async () => boton('Volver')!.click())

    expect(hoja().hasAttribute('open')).toBe(false)
    expect(campo().value).toBe('martin.p')
    expect(elegirUsuario).not.toHaveBeenCalled()
  })

  it('"Sí, usar este" guarda el elegido y sigue a `next`', async () => {
    escribir('martin.p')
    await esperar()
    await act(async () => boton('Usar @martin.p')!.click())
    await act(async () => boton('Sí, usar este')!.click())

    expect(elegirUsuario).toHaveBeenCalledWith('martin.p', '/amigos')
  })

  it('si la base lo rechaza, cierra la hoja y muestra el motivo', async () => {
    vi.mocked(elegirUsuario).mockResolvedValueOnce({ error: 'Ese @usuario ya está en uso.' })
    await act(async () => boton('Usar @martinperez')!.click())
    await act(async () => boton('Sí, usar este')!.click())

    expect(hoja().hasAttribute('open')).toBe(false)
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Ese @usuario ya está en uso.')
  })

  it('uno en uso no se puede usar: ofrece dos libres', async () => {
    escribir('nico.arias')
    await esperar()

    expect(host.querySelector('#username-aviso')?.textContent).toBe('@nico.arias ya está en uso')
    expect(botones().find((b) => b.textContent?.startsWith('Usar'))?.disabled).toBe(true)
    act(() => boton('@nicoarias.padel')!.click())
    expect(campo().value).toBe('nicoarias.padel')
  })
})
