// @vitest-environment jsdom
//
// "Se juega el": el día de la fecha se cambia con el control de fecha de la app
// (`app/ui/campo-fecha.tsx`) y se guarda solo al elegirlo, sin botón, como
// antes. Si la base lo rechaza, vuelve al día que tenía y lo dice.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const changeMatchdayDate = vi.fn()
vi.mock('./actions', () => ({ changeMatchdayDate: (...args: unknown[]) => changeMatchdayDate(...args) }))

const { DiaDeLaFecha } = await import('./dia')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!

let host: HTMLDivElement
let root: Root

function montar() {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() =>
    root.render(createElement(DiaDeLaFecha, { seasonId: 's1', matchdayId: 'm1', matchdayNumber: 2, playedOn: '2026-11-26' })),
  )
  return host.querySelector('input[type="date"]') as HTMLInputElement
}

async function elegir(input: HTMLInputElement, value: string) {
  await act(async () => {
    setValue.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  changeMatchdayDate.mockReset()
})

describe('DiaDeLaFecha', () => {
  it('muestra "Se juega el" y el día escrito, con el campo nombrado', () => {
    const input = montar()
    expect(host.textContent).toContain('Se juega el')
    expect(host.textContent).toContain('Jueves 26 nov')
    expect(input.getAttribute('aria-label')).toBe('Se juega el')
  })

  it('al elegir otro día lo guarda solo y lo muestra', async () => {
    changeMatchdayDate.mockResolvedValue({ ok: true })
    const input = montar()
    await elegir(input, '2026-11-27')
    expect(changeMatchdayDate).toHaveBeenCalledWith('s1', 'm1', 2, '2026-11-27')
    expect(host.textContent).toContain('Viernes 27 nov')
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })

  it('el mismo día o vacío no guarda nada', async () => {
    const input = montar()
    await elegir(input, '')
    expect(changeMatchdayDate).not.toHaveBeenCalled()
  })

  it('si la base lo rechaza vuelve al día que tenía y avisa', async () => {
    changeMatchdayDate.mockResolvedValue({ ok: false, error: 'No se pudo cambiar el día.' })
    const input = montar()
    await elegir(input, '2026-11-27')
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('No se pudo cambiar el día.')
    expect(input.value).toBe('2026-11-26')
    expect(host.textContent).toContain('Jueves 26 nov')
  })
})
