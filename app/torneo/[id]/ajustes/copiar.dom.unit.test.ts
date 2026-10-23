// @vitest-environment jsdom
//
// La fila "Link de invitación": en el celular comparte con el menú del sistema, en la compu copia,
// y "Regenerar" nunca corre sin confirmar (está pegado al otro botón y no tiene vuelta).
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CopiarLink } from './copiar'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const regenerateInviteLink = vi.fn(async () => ({ ok: true as const, token: 'nuevo' }))
vi.mock('./actions', () => ({ regenerateInviteLink: () => regenerateInviteLink() }))

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
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  regenerateInviteLink.mockClear()
})

function render() {
  act(() => root.render(createElement(CopiarLink, { seasonId: 's1', seasonName: 'Liga Jueves', token: 'abc' })))
}
const boton = (texto: RegExp) => [...host.querySelectorAll('button')].find((b) => texto.test(b.textContent ?? ''))!

describe('CopiarLink', () => {
  it('con menú de compartir: el botón dice "Compartir" y manda el link de invitación', () => {
    const share = vi.fn(async () => {})
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    render()

    act(() => boton(/Compartir/).click())

    expect(share).toHaveBeenCalledWith({
      title: 'Liga Jueves',
      text: 'Sumate a Liga Jueves en Padel Liga',
      url: `${location.origin}/unirse/abc`,
    })
    delete (navigator as { share?: unknown }).share
  })

  it('sin menú de compartir: copia el link y lo confirma', () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render()

    act(() => boton(/Copiar/).click())

    expect(writeText).toHaveBeenCalledWith(`${location.origin}/unirse/abc`)
    expect(host.textContent).toContain('Copiado ✓')
  })

  it('Regenerar cancelado no toca el link', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render()

    act(() => boton(/Regenerar/).click())

    expect(regenerateInviteLink).not.toHaveBeenCalled()
  })

  it('Regenerar confirmado pide el link nuevo', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render()

    await act(async () => boton(/Regenerar/).click())

    expect(regenerateInviteLink).toHaveBeenCalledOnce()
  })
})
