// @vitest-environment jsdom
//
// "Compartir mi link" en Amigos y su hoja "Tu link de amistad" (odd/tasks/amigos-faciles.md, S5):
// el link entero armado con el origen de la página, "Copiar", "Compartir" (el menú del teléfono; si
// no hay, copia) y "Cambiar el link", que trae uno nuevo y avisa que el de ahora deja de andar.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/amigos/actions', () => ({
  cambiarMiLink: vi.fn(async () => ({ ok: true, token: 'nuevo0000000000000000000000000000' })),
}))

const { cambiarMiLink } = await import('@/app/amigos/actions')
const { CompartirMiLink } = await import('./link')

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
const URL_LINK = `${window.location.origin}/amigo/${TOKEN}`

let host: HTMLDivElement
let root: Root
let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  vi.clearAllMocks()
  writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const boton = (texto: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto) as HTMLButtonElement | undefined
const hoja = () => host.querySelector('dialog') as HTMLDialogElement
const estado = () => hoja().querySelector('[aria-live="polite"]') as HTMLElement

async function tocar(el: HTMLElement | undefined) {
  if (el === undefined) throw new Error('No está el botón')
  await act(async () => el.click())
}

async function abrir() {
  act(() => root.render(createElement(CompartirMiLink, { token: TOKEN })))
  await tocar(boton('Compartir mi link'))
}

describe('CompartirMiLink', () => {
  it('"Compartir mi link" abre la hoja "Tu link de amistad" con su texto y el link entero', async () => {
    act(() => root.render(createElement(CompartirMiLink, { token: TOKEN })))
    expect(hoja().hasAttribute('open')).toBe(false)
    await tocar(boton('Compartir mi link'))

    expect(hoja().hasAttribute('open')).toBe(true)
    expect(hoja().querySelector('h2')?.textContent).toBe('Tu link de amistad')
    expect(hoja().textContent).toContain('Quien lo abra queda como tu amigo. Mandáselo a quien quieras sumar.')
    expect(hoja().querySelector('code')?.textContent).toBe(URL_LINK)
    expect(boton('Copiar')).toBeDefined()
    expect(boton('Compartir')).toBeDefined()
    expect(boton('Cambiar el link')).toBeDefined()
    expect(hoja().textContent).toContain('El de ahora deja de andar. Tus amigos siguen.')
  })

  it('"Copiar" copia el link y avisa "Copiado"', async () => {
    await abrir()
    await tocar(boton('Copiar'))
    expect(writeText).toHaveBeenCalledWith(URL_LINK)
    expect(estado().textContent).toBe('Copiado')
  })

  it('sin portapapeles no dice "Copiado": avisa que no se pudo y cómo copiarlo a mano', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    await abrir()
    await tocar(boton('Copiar'))
    expect(estado().textContent).toBe('')
    expect(hoja().textContent).toContain('No se pudo copiar. Mantené apretado el link para copiarlo.')
  })

  it('si el navegador rechaza copiar, avisa lo mismo y no deja el error suelto', async () => {
    writeText.mockRejectedValueOnce(new DOMException('denegado', 'NotAllowedError'))
    await abrir()
    await tocar(boton('Copiar'))
    expect(estado().textContent).toBe('')
    expect(hoja().textContent).toContain('No se pudo copiar. Mantené apretado el link para copiarlo.')
  })

  it('"Compartir" abre el menú del teléfono con el link', async () => {
    const share = vi.fn(async () => {})
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    await abrir()
    await tocar(boton('Compartir'))
    expect(share).toHaveBeenCalledWith({ url: URL_LINK })
    expect(writeText).not.toHaveBeenCalled()
  })

  it('"Compartir" sin menú del teléfono lo copia', async () => {
    await abrir()
    await tocar(boton('Compartir'))
    expect(writeText).toHaveBeenCalledWith(URL_LINK)
    expect(estado().textContent).toBe('Copiado')
  })

  it('cerrar el menú del teléfono sin elegir no copia nada', async () => {
    const share = vi.fn(async () => {
      throw new DOMException('cancelado', 'AbortError')
    })
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    await abrir()
    await tocar(boton('Compartir'))
    expect(writeText).not.toHaveBeenCalled()
    expect(estado().textContent).toBe('')
  })

  it('"Cambiar el link" trae uno nuevo y avisa que el de antes ya no anda', async () => {
    await abrir()
    await tocar(boton('Cambiar el link'))
    expect(cambiarMiLink).toHaveBeenCalledOnce()
    expect(hoja().querySelector('code')?.textContent).toBe(`${window.location.origin}/amigo/nuevo0000000000000000000000000000`)
    expect(estado().textContent).toBe('Listo, el link de antes ya no anda.')
  })

  it('si cambiar el link falla, queda el de antes y dice por qué', async () => {
    vi.mocked(cambiarMiLink).mockResolvedValueOnce({ ok: false, error: 'No se pudo cambiar el link.' })
    await abrir()
    await tocar(boton('Cambiar el link'))
    expect(hoja().querySelector('code')?.textContent).toBe(URL_LINK)
    expect(hoja().querySelector('[role="alert"]')?.textContent).toBe('No se pudo cambiar el link.')
  })
})
