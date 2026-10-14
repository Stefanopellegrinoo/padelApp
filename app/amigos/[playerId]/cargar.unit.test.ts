// @vitest-environment jsdom
//
// Único archivo de este repo que corre en jsdom en vez de en el `node` de
// siempre (`vitest.config.ts`, sin tocarlo -- este pragma alcanza por
// archivo). Hace falta un DOM real: el bug de Important 1 (review final de
// 2b) es que React 19 llama `HTMLFormElement.reset()` NATIVO sobre el
// `<form>` cuando una action termina -- `renderToStaticMarkup`, lo que usa
// el resto de las pantallas de este repo (`historial.unit.test.ts`), no
// monta nada en un DOM y no puede disparar ese reset. `act`/`createRoot` sí
// necesitan uno.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { CasualFormState } from '../actions'
import { CasualForm } from './cargar'

// React exige esta bandera para no advertir que un `act()` corre "fuera de
// un entorno de test" -- jsdom no la prende sola, y sin ella la salida se
// llena de warnings que no aportan nada (el test igual corre bien).
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Simula cualquiera de las validaciones de `parseCasualResult`
// (`db/friends.ts`) que pueden rechazar el submit -- cuál mensaje da es
// indiferente acá: lo que se prueba es que los CAMPOS sobreviven al rechazo,
// no el mensaje (eso ya lo prueba `db/friends.db.test.ts`).
async function fallaSiempre(_state: CasualFormState, _formData: FormData): Promise<CasualFormState> {
  return { error: 'Elegí una fecha real.' }
}

// React parchea el setter de `.value` de todo `<input>` para trackear su
// último valor "conocido" (`track()`, react-dom-client.development.js) --
// asignar `input.value = x` pasa por ESE setter parchado, así que el tracker
// queda sincronizado con `x` ANTES de que el evento 'input' llegue a
// procesarse, y React ve "no cambió nada" y no dispara el `onChange`
// sintético. El setter NATIVO (tomado del prototipo antes de que React lo
// pise) no actualiza el tracker -- por eso hace falta llamarlo directo para
// simular lo que escribe una persona. Mismo workaround que usa
// `@testing-library/user-event` para el mismo problema.
const inputValueDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
if (inputValueDescriptor?.set === undefined) {
  throw new Error('No se encontró el setter nativo de HTMLInputElement.value.')
}
const nativeInputValueSetter = inputValueDescriptor.set

function escribir(input: HTMLInputElement, texto: string): void {
  nativeInputValueSetter.call(input, texto)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root !== null) act(() => root?.unmount())
  if (container !== null) container.remove()
  container = null
  root = null
})

const selectValueDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')
if (selectValueDescriptor?.set === undefined) {
  throw new Error('No se encontró el setter nativo de HTMLSelectElement.value.')
}
const nativeSelectValueSetter = selectValueDescriptor.set

function elegir(select: HTMLSelectElement, valor: string): void {
  nativeSelectValueSetter.call(select, valor)
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

const AMIGOS = [
  { playerId: 'amigo-1', displayName: 'Fede' },
  { playerId: 'amigo-2', displayName: 'Lucas' },
]

describe('CasualForm', () => {
  it('conserva lo tipeado en un 2v2 FIFA con invitado cuando la action vuelve con un error', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        createElement(CasualForm, {
          friendPlayerId: 'amigo-1',
          friends: AMIGOS,
          action: fallaSiempre,
          submitLabel: 'Cargar partido',
        }),
      )
    })

    const radio = (name: string, value: string) =>
      container?.querySelector(`input[name="${name}"][value="${value}"]`) as HTMLInputElement
    const slot = (key: string) => container?.querySelector(`select[data-slot="${key}"]`) as HTMLSelectElement

    // Lo que tipeó una persona -- no un valor puesto por props.
    await act(async () => {
      radio('sport', 'FIFA').click()
      radio('mode', '2v2').click()
    })
    await act(async () => {
      elegir(slot('partner'), 'amigo-2')
      elegir(slot('rival2'), '__guest__')
    })
    const guestInput = container.querySelector('input[data-slot-name="rival2"]') as HTMLInputElement
    const teamInput = container.querySelector('input[name="teamMine"]') as HTMLInputElement
    await act(async () => {
      escribir(guestInput, 'Beto')
      escribir(teamInput, 'Los Pibes')
    })
    expect(slot('rival1').value).toBe('amigo-1') // el amigo de la pantalla viene preseleccionado

    const form = container.querySelector('form') as HTMLFormElement
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    // El error volvió -- si esto no aparece, las aserciones de abajo no
    // probaron el camino que existe (una action que nunca se ejecutó no
    // dispara el reset que este test viene a agarrar).
    expect(container.textContent).toContain('Elegí una fecha real.')
    expect(radio('sport', 'FIFA').checked).toBe(true)
    expect(radio('mode', '2v2').checked).toBe(true)
    expect(slot('partner').value).toBe('amigo-2')
    expect(slot('rival1').value).toBe('amigo-1')
    expect(slot('rival2').value).toBe('__guest__')
    expect((container.querySelector('input[data-slot-name="rival2"]') as HTMLInputElement).value).toBe('Beto')
    expect(teamInput.value).toBe('Los Pibes')
    const players = container.querySelector('input[name="players"]') as HTMLInputElement
    expect(JSON.parse(players.value)).toEqual([
      { side: 'mine', playerId: 'amigo-2', guestName: null },
      { side: 'theirs', playerId: 'amigo-1', guestName: null },
      { side: 'theirs', playerId: null, guestName: 'Beto' },
    ])
  })
})
