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
import { afterEach, describe, expect, it, vi } from 'vitest'
import { removeCasualMatch, type CasualFormState } from '../actions'
import type { CasualMatch } from '@/db/friends'
import { CasualForm, CasualMatchRow, type CasualFormInitial } from './cargar'

// Las actions reales pegan a Supabase; acá sólo importa si se las llama.
vi.mock('../actions', () => ({ editCasualMatch: vi.fn(), removeCasualMatch: vi.fn() }))

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

  describe('pádel: formato y sets en dos toques', () => {
    async function montar(initial?: CasualFormInitial) {
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
            initial,
          }),
        )
      })
      const el = container
      return {
        hidden: (name: string) => (el.querySelector(`input[name="${name}"]`) as HTMLInputElement).value,
        boton: (texto: string) =>
          Array.from(el.querySelectorAll('button')).find((b) => b.textContent === texto) as HTMLButtonElement,
        stepper: (key: string, texto: '+' | '−') =>
          Array.from(el.querySelectorAll(`[data-stepper="${key}"] button`)).find(
            (b) => b.textContent === texto,
          ) as HTMLButtonElement,
        submit: () => el.querySelector('button[type="submit"]') as HTMLButtonElement,
      }
    }
    const tocar = (b: HTMLButtonElement) => act(async () => b.click())

    it('arma 3 sets con dos toques cada uno y habilita el envío recién al completarse', async () => {
      const f = await montar()
      expect(f.hidden('setsToWin')).toBe('1')
      expect(f.hidden('gamesPerSet')).toBe('4')
      await tocar(f.stepper('setsToWin', '+')) // 2 sets a ganar, a 4 games
      expect(f.submit().disabled).toBe(true)

      await tocar(f.boton('Ganó mi lado'))
      await tocar(f.boton('2'))
      await tocar(f.boton('Ganó Fede'))
      await tocar(f.boton('0'))
      expect(f.submit().disabled).toBe(true) // 1-1: falta el desempate
      await tocar(f.boton('Ganó mi lado'))
      await tocar(f.boton('1'))

      expect(JSON.parse(f.hidden('sets'))).toEqual([
        { mine: 4, theirs: 2 },
        { mine: 0, theirs: 4 },
        { mine: 4, theirs: 1 },
      ])
      expect(f.submit().disabled).toBe(false)
    })

    it('cambiar los games por set vacía los sets cargados', async () => {
      const f = await montar()
      await tocar(f.boton('Ganó mi lado'))
      await tocar(f.boton('2'))
      expect(JSON.parse(f.hidden('sets'))).toHaveLength(1)
      await tocar(f.stepper('gamesPerSet', '+'))
      expect(f.hidden('gamesPerSet')).toBe('5')
      expect(JSON.parse(f.hidden('sets'))).toEqual([])
    })

    it('al editar un partido de 3 sets prellena los steppers y los sets', async () => {
      const f = await montar({
        matchId: 'm1',
        sport: 'PADEL',
        playedOn: '2026-08-30',
        outcome: 'won',
        scoreMine: '',
        scoreTheirs: '',
        teamMine: '',
        teamTheirs: '',
        roster: 'vs Fede',
        sets: [
          { mine: 6, theirs: 3 },
          { mine: 4, theirs: 6 },
          { mine: 6, theirs: 5 },
        ],
      })
      expect(f.hidden('setsToWin')).toBe('2')
      expect(f.hidden('gamesPerSet')).toBe('6')
      expect(JSON.parse(f.hidden('sets'))).toHaveLength(3)
      expect(f.submit().disabled).toBe(false)
    })

    it('equivocarse de ganador sin sets cargados tiene vuelta atrás', async () => {
      const f = await montar()
      expect(f.boton('Volver a cargar')).toBeUndefined()
      await tocar(f.boton('Ganó mi lado'))
      await tocar(f.boton('Volver a cargar'))
      expect(f.boton('Ganó mi lado')).toBeDefined()
    })

    it('en 1v1 con un amigo rival nombra al amigo; en 2v2 queda genérico', async () => {
      const f = await montar()
      expect(f.boton('Ganó Fede')).toBeDefined()
      await tocar(
        Array.from(document.querySelectorAll('label')).find((l) => l.textContent === '2 vs 2')
          ?.querySelector('input') as HTMLButtonElement,
      )
      expect(f.boton('Ganó el otro lado')).toBeDefined()
    })
  })

  it('el <details> que envuelve al formulario sigue abierto cuando la action vuelve con error', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        createElement(
          'details',
          null,
          createElement('summary', null, 'Cargar partido'),
          createElement(CasualForm, {
            friendPlayerId: 'amigo-1',
            friends: AMIGOS,
            action: fallaSiempre,
            submitLabel: 'Enviar',
          }),
        ),
      )
    })
    const details = container.querySelector('details') as HTMLDetailsElement
    details.open = true
    const form = container.querySelector('form') as HTMLFormElement
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(container.textContent).toContain('Elegí una fecha real.')
    expect(details.open).toBe(true)
  })

  describe('CasualMatchRow: Borrar pide confirmación', () => {
    const partido = { matchId: 'm1' } as unknown as CasualMatch

    it('el primer toque no envía; Sí envía el borrado y No lo cancela', async () => {
      container = document.createElement('div')
      document.body.appendChild(container)
      root = createRoot(container)
      await act(async () => {
        root?.render(createElement(CasualMatchRow, { friendPlayerId: 'amigo-1', partido, children: 'fila' }))
      })
      const el = container
      vi.mocked(removeCasualMatch).mockClear()
      const boton = (t: string) =>
        Array.from(el.querySelectorAll('button')).find((b) => b.textContent === t) as HTMLButtonElement

      await act(async () => boton('Borrar').click())
      expect(removeCasualMatch).not.toHaveBeenCalled()
      expect(el.textContent).toContain('¿Borrar?')
      // Borrar se desmonta: el foco va al "No" (default seguro), no al body.
      expect(document.activeElement).toBe(boton('No'))
      expect(el.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Confirmar borrado')

      await act(async () => boton('No').click())
      expect(el.textContent).not.toContain('¿Borrar?')
      expect(boton('Borrar')).toBeDefined()

      await act(async () => boton('Borrar').click())
      await act(async () => boton('Sí').click())
      expect(removeCasualMatch).toHaveBeenCalledTimes(1)
    })
  })
})
