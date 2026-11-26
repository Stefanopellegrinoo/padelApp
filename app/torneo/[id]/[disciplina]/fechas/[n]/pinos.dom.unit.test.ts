// @vitest-environment jsdom
//
// La carga de pinos de una fecha por ranking (bowling, S4): una fila por presente, un toque para
// escribir, Enter guarda y pasa al siguiente, y un error —la red del club— no borra lo escrito
// (T17, igual que la hoja de `carga.tsx`). jsdom porque todo esto pasa al tipear.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WriteResult } from './actions'
import { CargaDePinos } from './pinos'
import type { JugadorPinosVM } from './pinos-state'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const saveMatchdayScore = vi.fn(async (..._args: unknown[]): Promise<WriteResult> => ({ ok: true }))
vi.mock('./actions', () => ({
  saveMatchdayScore: (...args: unknown[]) => saveMatchdayScore(...args),
}))

const CONTEXT = { seasonId: 's1', matchdayId: 'm1', matchdayNumber: 3 }
const JUGADORES: JugadorPinosVM[] = [
  { entryId: 'a', name: 'Ana', vos: false, score: null },
  { entryId: 'b', name: 'Beto', vos: true, score: 150 },
  { entryId: 'c', name: 'Caro', vos: false, score: null },
]

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  saveMatchdayScore.mockReset()
  saveMatchdayScore.mockResolvedValue({ ok: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function montar(jugadores: JugadorPinosVM[] = JUGADORES): Promise<void> {
  await act(async () => {
    root.render(createElement(CargaDePinos, { context: CONTEXT, jugadores }))
  })
}

const campo = (nombre: string) => host.querySelector(`input[aria-label="Pinos de ${nombre}"]`) as HTMLInputElement

async function tipear(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    input.focus()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function enter(input: HTMLInputElement): Promise<void> {
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
}

async function salir(input: HTMLInputElement): Promise<void> {
  await act(async () => {
    input.blur()
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
}

describe('una fila por presente', () => {
  it('cada uno tiene su campo numérico de 16px o más, con lo que ya cargó', async () => {
    await montar()
    for (const nombre of ['Ana', 'Beto', 'Caro']) {
      const input = campo(nombre)
      expect(input).not.toBeNull()
      expect(input.getAttribute('inputmode')).toBe('numeric')
      expect(input.type).toBe('text')
      expect(input.className).toMatch(/text-\[(1[6-9]|[2-9]\d)px\]/)
    }
    expect(campo('Beto').value).toBe('150')
    expect(campo('Ana').value).toBe('')
  })

  it('la fila entera es la etiqueta del campo: tocar el nombre enfoca', async () => {
    await montar()
    const label = campo('Ana').closest('label')
    expect(label).not.toBeNull()
    expect(label?.textContent).toContain('Ana')
    expect(label?.className).toContain('min-h-[64px]')
  })

  it('tu fila lleva la marca de vos', async () => {
    await montar()
    expect(campo('Beto').closest('label')?.textContent).toContain('vos')
  })
})

describe('guardar', () => {
  it('Enter guarda esa fila y pasa a la siguiente', async () => {
    await montar()
    await tipear(campo('Ana'), '180')
    await enter(campo('Ana'))
    expect(saveMatchdayScore).toHaveBeenCalledWith('s1', 3, 'm1', 'a', 180)
    // El blur que produce pasar a la siguiente no vuelve a mandar lo mismo.
    expect(saveMatchdayScore).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(campo('Beto'))
  })

  it('salir de una fila cambiada guarda; salir sin cambiar no', async () => {
    await montar()
    await tipear(campo('Beto'), '150')
    await salir(campo('Beto'))
    expect(saveMatchdayScore).not.toHaveBeenCalled()

    await tipear(campo('Caro'), '99')
    await salir(campo('Caro'))
    expect(saveMatchdayScore).toHaveBeenCalledWith('s1', 3, 'm1', 'c', 99)
  })

  it('lo que no es un total no se manda, y la fila dice por qué', async () => {
    await montar()
    await tipear(campo('Ana'), '12a')
    await enter(campo('Ana'))
    expect(saveMatchdayScore).not.toHaveBeenCalled()
    expect(campo('Ana').getAttribute('aria-invalid')).toBe('true')
    expect(campo('Ana').closest('li')?.textContent).toContain('Sólo números.')
  })

  it('sin red, lo escrito queda y la fila avisa (T17)', async () => {
    saveMatchdayScore.mockRejectedValue(new TypeError('Failed to fetch'))
    await montar()
    await tipear(campo('Ana'), '201')
    await enter(campo('Ana'))
    expect(campo('Ana').value).toBe('201')
    expect(campo('Ana').closest('li')?.querySelector('[role="alert"]')?.textContent).toBe('Sin conexión. Probá de nuevo.')
  })

  it('el rechazo del servidor también queda en la fila, y volver a Enter reintenta', async () => {
    saveMatchdayScore.mockResolvedValueOnce({ ok: false, error: 'No se pudieron guardar los pinos.' })
    await montar()
    await tipear(campo('Caro'), '120')
    await enter(campo('Caro'))
    expect(campo('Caro').closest('li')?.textContent).toContain('No se pudieron guardar los pinos.')
    await enter(campo('Caro'))
    expect(saveMatchdayScore).toHaveBeenCalledTimes(2)
    expect(campo('Caro').closest('li')?.querySelector('[role="alert"]')).toBeNull()
  })
})
