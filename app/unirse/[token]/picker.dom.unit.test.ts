// @vitest-environment jsdom
//
// El que llega por el link elige cuál es su asiento: tocar uno lo marca como "vos" y deja entrar
// con ese nombre; tocarlo otra vez lo suelta; uno ya tomado no se puede elegir.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('./actions', () => ({ claimSeat: vi.fn() }))
const { Picker } = await import('./picker')
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
})

const seat = (entry_id: string, display_name: string, claimed = false) => ({
  entry_id,
  display_name,
  claimed,
  season_id: 's1',
  season_name: 'Los Pibes',
  admin_name: 'Ana',
})

function render(initialSelected: string | null = null) {
  act(() =>
    root.render(
      createElement(Picker, {
        token: 'tok',
        seats: [seat('e1', 'Nico Arias'), seat('e2', 'Tomi', true)] as never,
        initialSelected,
        claimError: undefined,
        adminName: 'Ana',
      }),
    ),
  )
}

const boton = (texto: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(texto)) as HTMLButtonElement

it('sin elegir: ningún asiento marcado y el botón de abajo pide elegir', () => {
  render()
  expect(boton('Nico Arias').getAttribute('aria-pressed')).toBe('false')
  expect(boton('Elegí tu nombre').disabled).toBe(true)
  expect(host.querySelector('form')).toBeNull()
})

it('tocar un asiento lo marca y deja entrar con ese nombre; tocarlo de nuevo lo suelta', () => {
  render()
  act(() => boton('Nico Arias').click())
  expect(boton('Nico Arias').getAttribute('aria-pressed')).toBe('true')
  expect(boton('Nico Arias').textContent).toContain('Sos vos')
  const form = host.querySelector('form') as HTMLFormElement
  expect((form.querySelector('input[name="entryId"]') as HTMLInputElement).value).toBe('e1')
  expect((form.querySelector('input[name="token"]') as HTMLInputElement).value).toBe('tok')
  expect(form.querySelector('button[type="submit"]')?.textContent).toBe('Entrar como Nico Arias')
  act(() => boton('Nico Arias').click())
  expect(boton('Nico Arias').getAttribute('aria-pressed')).toBe('false')
  expect(host.querySelector('form')).toBeNull()
})

it('un asiento tomado no se elige y dice que ya entró', () => {
  render()
  expect(boton('Tomi').disabled).toBe(true)
  expect(boton('Tomi').textContent).toContain('Ya entró')
})

it('vuelve de un error con el asiento que había elegido', () => {
  render('e1')
  expect(boton('Nico Arias').getAttribute('aria-pressed')).toBe('true')
})
