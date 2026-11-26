// @vitest-environment jsdom
//
// El control de fecha que reemplaza al `<input type="date">` pelado (T18): una
// fila a lo ancho con el día escrito ("Jueves 26 nov") que abre el selector
// nativo. El campo de verdad sigue ahí, transparente y encima de la fila: es el
// que recibe el toque (iOS abre la rueda), el que se manda en el formulario y
// el que nombra el lector de pantalla.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CampoFecha } from './campo-fecha'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!

let host: HTMLDivElement
let root: Root

function montar(props: Partial<Parameters<typeof CampoFecha>[0]> = {}) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const onChange = vi.fn()
  act(() => root.render(createElement(CampoFecha, { value: '2026-11-26', onChange, label: 'Día de la fecha', ...props })))
  const input = host.querySelector('input') as HTMLInputElement
  return { input, onChange }
}

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  delete (HTMLInputElement.prototype as { showPicker?: unknown }).showPicker
})

describe('CampoFecha', () => {
  it('muestra el día escrito y deja el campo nativo de fecha, nombrado y de 16 px', () => {
    const { input } = montar({ name: 'playedOn', kicker: 'Se juega el' })
    expect(host.textContent).toContain('Jueves 26 nov')
    expect(host.textContent).toContain('Se juega el')
    expect(input.type).toBe('date')
    expect(input.name).toBe('playedOn')
    expect(input.value).toBe('2026-11-26')
    expect(input.getAttribute('aria-label')).toBe('Día de la fecha')
    // Menos de 16 px y Safari hace zoom al tocarlo.
    expect(input.className).toContain('text-[16px]')
    // La fila mide al menos 44 px y ocupa el ancho: nunca se sale de la pantalla.
    const fila = input.parentElement as HTMLElement
    expect(fila.className).toMatch(/min-h-\[(4[4-9]|5\d)px\]/)
    expect(fila.className).toContain('w-full')
    expect(fila.className).toContain('min-w-0')
  })

  it('sin día elegido lo pide', () => {
    montar({ value: '' })
    expect(host.textContent).toContain('Elegí el día')
  })

  it('al tocarlo abre el selector nativo', () => {
    const showPicker = vi.fn()
    ;(HTMLInputElement.prototype as { showPicker?: unknown }).showPicker = showPicker
    const { input } = montar()
    act(() => input.click())
    expect(showPicker).toHaveBeenCalledTimes(1)
  })

  it('si el navegador no tiene showPicker (o lo rechaza) no rompe: queda el toque nativo', () => {
    const { input } = montar()
    expect(() => act(() => input.click())).not.toThrow()
    ;(HTMLInputElement.prototype as { showPicker?: unknown }).showPicker = () => {
      throw new DOMException('no', 'NotAllowedError')
    }
    expect(() => act(() => input.click())).not.toThrow()
  })

  it('al elegir otro día avisa el valor nuevo', () => {
    const { input, onChange } = montar()
    act(() => {
      setValue.call(input, '2026-12-03')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith('2026-12-03')
  })

  it('apagado, el campo no se puede tocar', () => {
    const { input } = montar({ disabled: true })
    expect(input.disabled).toBe(true)
  })
})
