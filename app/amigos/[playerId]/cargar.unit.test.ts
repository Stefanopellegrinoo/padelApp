// @vitest-environment jsdom
//
// Corre en jsdom en vez de en el `node` de siempre (`vitest.config.ts`, sin
// tocarlo -- este pragma alcanza por archivo). Hace falta un DOM real: el bug
// de Important 1 (review final de 2b) es que React 19 llama
// `HTMLFormElement.reset()` NATIVO sobre el `<form>` cuando una action
// termina -- `renderToStaticMarkup`, lo que usa el resto de las pantallas de
// este repo (`historial.unit.test.ts`), no monta nada en un DOM y no puede
// disparar ese reset. `act`/`createRoot` sí necesitan uno.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadCasualMatch, removeCasualMatch, type CasualFormState } from '../actions'
import type { CasualMatch } from '@/db/friends'
import { CasualForm, CasualMatchRow, type CasualFormInitial } from './cargar'
import { CargarConAmigo } from './cargar-con-amigo'

// Las actions reales pegan a Supabase; acá sólo importa si se las llama.
vi.mock('../actions', () => ({ loadCasualMatch: vi.fn(), editCasualMatch: vi.fn(), removeCasualMatch: vi.fn() }))

// React exige esta bandera para no advertir que un `act()` corre "fuera de
// un entorno de test" -- jsdom no la prende sola, y sin ella la salida se
// llena de warnings que no aportan nada (el test igual corre bien).
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// jsdom todavía no trae `showModal` ni `close` (la hoja, `app/ui/sheet.tsx`):
// lo mínimo que hace la plataforma, como en `sheet.dom.unit.test.ts`.
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
  localStorage.clear()
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

/** Hoy en `YYYY-MM-DD` local, como lo prellena el formulario. */
function hoy(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Monta un `CasualForm` nuevo (o editando) y devuelve cómo tocarlo. */
async function montar({
  action = fallaSiempre,
  initial,
  onSaved,
}: {
  action?: (state: CasualFormState, formData: FormData) => Promise<CasualFormState>
  initial?: CasualFormInitial
  onSaved?: (resumen: string) => void
} = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      createElement(CasualForm, {
        friendPlayerId: 'amigo-1',
        friends: AMIGOS,
        action,
        submitLabel: initial === undefined ? 'Guardar' : 'Guardar cambios',
        initial,
        onSaved,
      }),
    )
  })
  const el = container
  return {
    el,
    radio: (name: string, value: string) => el.querySelector(`input[name="${name}"][value="${value}"]`) as HTMLInputElement,
    hidden: (name: string) => (el.querySelector(`input[name="${name}"]`) as HTMLInputElement | null)?.value,
    input: (name: string) => el.querySelector(`input[name="${name}"]`) as HTMLInputElement,
    slot: (key: string) => el.querySelector(`select[data-slot="${key}"]`) as HTMLSelectElement,
    boton: (texto: string) =>
      Array.from(el.querySelectorAll('button')).find((b) => b.textContent === texto) as HTMLButtonElement,
    stepper: (key: string, texto: '+' | '−') =>
      Array.from(el.querySelectorAll(`[data-stepper="${key}"] button`)).find(
        (b) => b.textContent === texto,
      ) as HTMLButtonElement,
    pastillas: () => Array.from(el.querySelectorAll('[aria-label^="Set "]')).map((p) => p.textContent),
    submit: () => el.querySelector('button[type="submit"]') as HTMLButtonElement,
    enviar: () =>
      act(async () => {
        el.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      }),
  }
}
const tocar = (b: HTMLElement) => act(async () => b.click())

const editando = (sport: string, extra: Partial<CasualFormInitial> = {}): CasualFormInitial => ({
  matchId: 'm1',
  sport,
  playedOn: '2026-08-30',
  outcome: 'won',
  scoreMine: '',
  scoreTheirs: '',
  teamMine: '',
  teamTheirs: '',
  roster: 'Vos contra Fede',
  ...extra,
})

describe('CasualForm', () => {
  it('conserva lo tipeado en un 2v2 FIFA con invitado cuando la action vuelve con un error', async () => {
    const f = await montar()

    // Lo que tipeó una persona -- no un valor puesto por props.
    await tocar(f.radio('sport', 'FIFA'))
    await tocar(f.radio('mode', '2v2'))
    await act(async () => {
      elegir(f.slot('partner'), 'amigo-2')
      elegir(f.slot('rival2'), '__guest__')
    })
    const guestInput = f.el.querySelector('input[data-slot-name="rival2"]') as HTMLInputElement
    const teamInput = f.input('teamMine')
    await act(async () => {
      escribir(guestInput, 'Beto')
      escribir(teamInput, 'Los Pibes')
      escribir(f.input('scoreMine'), '3')
      escribir(f.input('scoreTheirs'), '1')
    })
    expect(f.slot('rival1').value).toBe('amigo-1') // el amigo de la pantalla viene preseleccionado

    await f.enviar()

    // El error volvió -- si esto no aparece, las aserciones de abajo no
    // probaron el camino que existe (una action que nunca se ejecutó no
    // dispara el reset que este test viene a agarrar).
    expect(f.el.textContent).toContain('Elegí una fecha real.')
    expect(f.radio('sport', 'FIFA').checked).toBe(true)
    expect(f.radio('mode', '2v2').checked).toBe(true)
    expect(f.radio('outcome', 'won').checked).toBe(true)
    expect(f.slot('partner').value).toBe('amigo-2')
    expect(f.slot('rival1').value).toBe('amigo-1')
    expect(f.slot('rival2').value).toBe('__guest__')
    expect((f.el.querySelector('input[data-slot-name="rival2"]') as HTMLInputElement).value).toBe('Beto')
    expect(teamInput.value).toBe('Los Pibes')
    expect(f.input('scoreMine').value).toBe('3')
    expect(f.input('scoreTheirs').value).toBe('1')
    expect(JSON.parse(f.hidden('players')!)).toEqual([
      { side: 'mine', playerId: 'amigo-2', guestName: null },
      { side: 'theirs', playerId: 'amigo-1', guestName: null },
      { side: 'theirs', playerId: null, guestName: 'Beto' },
    ])
  })

  describe('lo que ya viene puesto (S8e: la menor cantidad de pasos)', () => {
    it('un partido nuevo arranca con la fecha de hoy, que se puede cambiar', async () => {
      const f = await montar()
      expect(f.input('playedOn').value).toBe(hoy())
      await act(async () => escribir(f.input('playedOn'), '2026-11-20'))
      expect(f.input('playedOn').value).toBe('2026-11-20')
    })

    it('al editar, la fecha es la del partido', async () => {
      const f = await montar({ initial: editando('FIFA') })
      expect(f.input('playedOn').value).toBe('2026-08-30')
    })

    it('en 1 vs 1 el rival es el amigo de la pantalla: no hay nada que elegir', async () => {
      const f = await montar()
      expect(f.radio('mode', '1v1').checked).toBe(true)
      expect(f.el.querySelector('select')).toBeNull()
      expect(JSON.parse(f.hidden('players')!)).toEqual([{ side: 'theirs', playerId: 'amigo-1', guestName: null }])
    })

    it('recuerda el último deporte, modo y formato usados', async () => {
      const primero = await montar()
      await tocar(primero.radio('sport', 'PING_PONG'))
      await tocar(primero.stepper('setsToWin', '+'))
      await tocar(primero.radio('mode', '2v2'))
      await primero.enviar()
      act(() => root?.unmount())
      root = null

      const segundo = await montar()
      expect(segundo.radio('sport', 'PING_PONG').checked).toBe(true)
      expect(segundo.radio('mode', '2v2').checked).toBe(true)
      expect(segundo.hidden('setsToWin')).toBe('3')
    })

    it('editar no usa lo recordado: muestra lo del partido', async () => {
      localStorage.setItem('padel:partido-con-amigo', JSON.stringify({ sport: 'PING_PONG', mode: '2v2' }))
      const f = await montar({ initial: editando('FIFA') })
      expect(f.radio('sport', 'FIFA').checked).toBe(true)
    })

    it('lo recordado que no sirve (roto o de un deporte que ya no está) se ignora', async () => {
      localStorage.setItem('padel:partido-con-amigo', '{roto')
      const roto = await montar()
      expect(roto.radio('sport', 'PADEL').checked).toBe(true)
      act(() => root?.unmount())
      root = null
      localStorage.setItem('padel:partido-con-amigo', JSON.stringify({ sport: 'TEJO', mode: '3v3' }))
      const viejo = await montar()
      expect(viejo.radio('sport', 'PADEL').checked).toBe(true)
      expect(viejo.radio('mode', '1v1').checked).toBe(true)
    })
  })

  describe('pádel: formato y sets en dos toques', () => {
    it('un set: el toque del perdedor guarda, sin tocar Guardar', async () => {
      const action = vi.fn(fallaSiempre)
      const f = await montar({ action })
      await tocar(f.boton('Vos'))
      expect(action).not.toHaveBeenCalled()
      await tocar(f.boton('2'))
      expect(action).toHaveBeenCalledTimes(1)
      const data = action.mock.calls[0]![1]
      expect(data.get('sport')).toBe('PADEL')
      expect(data.get('playedOn')).toBe(hoy())
      expect(JSON.parse(String(data.get('sets')))).toEqual([{ mine: 4, theirs: 2 }])
    })

    it('arma 3 sets con dos toques cada uno, guarda en el último y un error deja todo cargado', async () => {
      const action = vi.fn(fallaSiempre)
      const f = await montar({ action })
      expect(f.hidden('setsToWin')).toBe('1')
      expect(f.hidden('gamesPerSet')).toBe('4')
      await tocar(f.stepper('setsToWin', '+')) // 2 sets a ganar, a 4 games
      expect(f.submit().disabled).toBe(true)

      await tocar(f.boton('Vos'))
      await tocar(f.boton('2'))
      await tocar(f.boton('Fede'))
      await tocar(f.boton('0'))
      expect(f.submit().disabled).toBe(true) // 1-1: falta el desempate
      expect(action).not.toHaveBeenCalled()
      await tocar(f.boton('Vos'))
      await tocar(f.boton('1'))

      expect(action).toHaveBeenCalledTimes(1)
      expect(f.el.textContent).toContain('Elegí una fecha real.')
      expect(f.pastillas()).toEqual(['4-2', '0-4', '4-1'])
      expect(JSON.parse(f.hidden('sets')!)).toEqual([
        { mine: 4, theirs: 2 },
        { mine: 0, theirs: 4 },
        { mine: 4, theirs: 1 },
      ])
      // Reintentar es un toque.
      expect(f.submit().disabled).toBe(false)
    })

    it('con jugadores sin completar el último toque no guarda: lo dice y queda Guardar', async () => {
      const action = vi.fn(fallaSiempre)
      const f = await montar({ action })
      await tocar(f.radio('mode', '2v2'))
      await tocar(f.boton('Vos y tu pareja'))
      await tocar(f.boton('3'))
      expect(action).not.toHaveBeenCalled()
      expect(f.el.textContent).toContain('Elegí a todos los jugadores.')
      expect(f.submit().disabled).toBe(true)
      await act(async () => {
        elegir(f.slot('partner'), 'amigo-2')
        elegir(f.slot('rival2'), '__guest__')
      })
      await act(async () => escribir(f.el.querySelector('input[data-slot-name="rival2"]') as HTMLInputElement, 'Beto'))
      expect(f.submit().disabled).toBe(false)
      await f.enviar()
      expect(action).toHaveBeenCalledTimes(1)
    })

    it('cambiar los games por set vacía los sets cargados', async () => {
      const f = await montar({ action: vi.fn(fallaSiempre) })
      await tocar(f.stepper('setsToWin', '+'))
      await tocar(f.boton('Vos'))
      await tocar(f.boton('2'))
      expect(JSON.parse(f.hidden('sets')!)).toHaveLength(1)
      await tocar(f.stepper('gamesPerSet', '+'))
      expect(f.hidden('gamesPerSet')).toBe('5')
      expect(JSON.parse(f.hidden('sets')!)).toEqual([])
    })

    it('al editar un partido de 3 sets prellena los steppers y los sets', async () => {
      const f = await montar({
        initial: editando('PADEL', {
          sets: [
            { mine: 6, theirs: 3 },
            { mine: 4, theirs: 6 },
            { mine: 6, theirs: 5 },
          ],
        }),
      })
      expect(f.hidden('setsToWin')).toBe('2')
      expect(f.hidden('gamesPerSet')).toBe('6')
      expect(f.pastillas()).toEqual(['6-3', '4-6', '6-5'])
      expect(f.submit().disabled).toBe(false)
      expect(f.submit().textContent).toBe('Guardar cambios')
    })

    // Como la hoja de la fecha (`DosToques`): cada set arranca con su toque marcado, así que
    // confirmar lo mismo es un toque y corregir un set es uno o dos, sin "Volver a cargar".
    it('al corregir, cada set arranca con su ganador y su número marcados; cambiar uno no obliga a recargar todos', async () => {
      const action = vi.fn(fallaSiempre)
      const f = await montar({
        action,
        initial: editando('PADEL', {
          otherName: 'Fede',
          sets: [
            { mine: 6, theirs: 3 },
            { mine: 4, theirs: 6 },
            { mine: 6, theirs: 5 },
          ],
        }),
      })
      expect(f.boton('Vos').getAttribute('aria-pressed')).toBe('true')
      expect(f.boton('3').getAttribute('aria-pressed')).toBe('true')

      await tocar(f.boton('4')) // el primer set fue 6-4, no 6-3
      expect(f.boton('Fede').getAttribute('aria-pressed')).toBe('true')
      expect(f.boton('4').getAttribute('aria-pressed')).toBe('true')
      await tocar(f.boton('4'))
      expect(f.boton('Vos').getAttribute('aria-pressed')).toBe('true')
      expect(f.boton('5').getAttribute('aria-pressed')).toBe('true')
      expect(action).not.toHaveBeenCalled()
      await tocar(f.boton('5'))

      expect(action).toHaveBeenCalledTimes(1)
      expect(JSON.parse(String(action.mock.calls[0]![1].get('sets')))).toEqual([
        { mine: 6, theirs: 4 },
        { mine: 4, theirs: 6 },
        { mine: 6, theirs: 5 },
      ])
    })

    it('al corregir un partido de un set, un toque guarda', async () => {
      const action = vi.fn(fallaSiempre)
      const f = await montar({ action, initial: editando('PADEL', { sets: [{ mine: 4, theirs: 2 }] }) })
      await tocar(f.boton('3'))
      expect(action).toHaveBeenCalledTimes(1)
      expect(JSON.parse(String(action.mock.calls[0]![1].get('sets')))).toEqual([{ mine: 4, theirs: 3 }])
    })

    it('al corregir sólo la fecha, "Guardar cambios" manda los sets de antes', async () => {
      const action = vi.fn(fallaSiempre)
      const f = await montar({
        action,
        initial: editando('PADEL', {
          sets: [
            { mine: 6, theirs: 3 },
            { mine: 6, theirs: 4 },
          ],
        }),
      })
      await act(async () => escribir(f.input('playedOn'), '2026-08-29'))
      await f.enviar()
      expect(action).toHaveBeenCalledTimes(1)
      const data = action.mock.calls[0]![1]
      expect(data.get('playedOn')).toBe('2026-08-29')
      expect(JSON.parse(String(data.get('sets')))).toEqual([
        { mine: 6, theirs: 3 },
        { mine: 6, theirs: 4 },
      ])
    })

    it('equivocarse de ganador sin sets cargados tiene vuelta atrás', async () => {
      const f = await montar()
      expect(f.boton('Volver a cargar')).toBeUndefined()
      await tocar(f.boton('Vos'))
      expect(f.boton('Vos').getAttribute('aria-pressed')).toBe('true')
      await tocar(f.boton('Volver a cargar'))
      expect(f.boton('Vos').getAttribute('aria-pressed')).toBe('false')
    })

    it('en 1v1 el otro lado es el amigo; en 2v2 son las parejas', async () => {
      const f = await montar()
      expect(f.boton('Fede')).toBeDefined()
      await tocar(f.radio('mode', '2v2'))
      expect(f.boton('Vos y tu pareja')).toBeDefined()
      expect(f.boton('Ellos')).toBeDefined()
      await act(async () => elegir(f.slot('partner'), 'amigo-2'))
      expect(f.boton('Vos y Lucas')).toBeDefined()
    })

    it('después de guardar avisa qué se guardó', async () => {
      const onSaved = vi.fn()
      const f = await montar({
        action: async (state) => ({ error: null, saved: (state.saved ?? 0) + 1 }),
        onSaved,
      })
      await tocar(f.boton('Fede'))
      await tocar(f.boton('3'))
      expect(onSaved).toHaveBeenCalledTimes(1)
      expect(onSaved).toHaveBeenCalledWith('Perdiste 3-4')
    })
  })

  describe('goles: el marcador primero', () => {
    it('elegir FIFA lleva el foco al primer campo; Enter pasa al segundo', async () => {
      const f = await montar()
      await tocar(f.radio('sport', 'FIFA'))
      expect(document.activeElement).toBe(f.input('scoreMine'))
      await act(async () => {
        f.input('scoreMine').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
      expect(document.activeElement).toBe(f.input('scoreTheirs'))
    })

    it('el marcador decide quién ganó; empatado, lo elegís vos', async () => {
      const f = await montar()
      await tocar(f.radio('sport', 'FIFA'))
      await act(async () => {
        escribir(f.input('scoreMine'), '1')
        escribir(f.input('scoreTheirs'), '3')
      })
      expect(f.radio('outcome', 'lost').checked).toBe(true)
      await act(async () => escribir(f.input('scoreMine'), '3'))
      // 3-3: puede haber penales, no se adivina.
      expect(f.radio('outcome', 'won').checked).toBe(false)
      expect(f.radio('outcome', 'lost').checked).toBe(false)
      expect(f.submit().disabled).toBe(true)
      await tocar(f.radio('outcome', 'drew'))
      expect(f.submit().disabled).toBe(false)
    })

    it('Enter en el segundo campo guarda', async () => {
      const action = vi.fn(fallaSiempre)
      const f = await montar({ action })
      await tocar(f.radio('sport', 'FIFA'))
      await act(async () => {
        escribir(f.input('scoreMine'), '2')
        escribir(f.input('scoreTheirs'), '0')
      })
      await act(async () => {
        f.input('scoreTheirs').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
      expect(action).toHaveBeenCalledTimes(1)
      expect(action.mock.calls[0]![1].get('outcome')).toBe('won')
    })
  })

  describe('el resultado sale de la familia del deporte', () => {
    it('básquet no tiene empate y cuenta puntos', async () => {
      const f = await montar({ initial: editando('BASQUET', { scoreMine: '80', scoreTheirs: '70' }) })
      expect(f.el.querySelector('input[name="outcome"][value="drew"]')).toBeNull()
      expect(f.el.querySelector('input[name="outcome"][value="won"]')).not.toBeNull()
      expect(f.el.textContent).toContain('Tus puntos')
      expect(f.el.querySelector('input[name="teamMine"]')).toBeNull()
    })

    it('FIFA tiene empate, cuenta goles y pide equipos', async () => {
      const f = await montar({ initial: editando('FIFA', { scoreMine: '2', scoreTheirs: '1' }) })
      expect(f.el.querySelector('input[name="outcome"][value="drew"]')).not.toBeNull()
      expect(f.el.textContent).toContain('Tus goles')
      expect(f.el.querySelector('input[name="teamMine"]')).not.toBeNull()
    })
  })

  describe('los cinco deportes del registro', () => {
    let enviado: FormData | null = null
    async function guardar(_state: CasualFormState, formData: FormData): Promise<CasualFormState> {
      enviado = formData
      return { error: 'no' }
    }

    it('hay un chip por deporte, en el orden del registro', async () => {
      const f = await montar()
      const radios = Array.from(f.el.querySelectorAll('input[name="sport"]')) as HTMLInputElement[]
      expect(radios.map((r) => r.value)).toEqual(['PADEL', 'PING_PONG', 'FIFA', 'FUTBOL', 'BASQUET'])
      expect(radios.map((r) => r.closest('label')?.textContent)).toEqual([
        'Pádel',
        'Ping pong',
        'FIFA',
        'Fútbol',
        'Básquet',
      ])
    })

    it('pasar de pádel a ping pong vacía los sets y toma el formato del ping pong', async () => {
      const f = await montar()
      await tocar(f.stepper('setsToWin', '+'))
      await tocar(f.boton('Vos'))
      await tocar(f.boton('2'))
      expect(f.pastillas()).toEqual(['4-2'])
      await tocar(f.radio('sport', 'PING_PONG'))
      expect(f.pastillas()).toEqual([])
      expect(f.hidden('gamesPerSet')).toBe('11')
      expect(f.hidden('setsToWin')).toBe('2')
    })

    it('volver de ping pong a pádel vuelve al formato del pádel', async () => {
      const f = await montar()
      await tocar(f.radio('sport', 'PING_PONG'))
      await tocar(f.boton('Vos'))
      await tocar(f.boton('5'))
      expect(f.pastillas()).toEqual(['11-5'])
      await tocar(f.radio('sport', 'PADEL'))
      expect(f.pastillas()).toEqual([])
      expect(f.hidden('gamesPerSet')).toBe('4')
      expect(f.hidden('setsToWin')).toBe('1')
    })

    it('en ping pong un deuce 12-10 se carga en dos toques', async () => {
      const f = await montar()
      await tocar(f.radio('sport', 'PING_PONG'))
      await tocar(f.boton('Vos'))
      expect(f.boton('16-14')).toBeTruthy()
      const deuce = f.boton('12-10')
      expect(deuce.getAttribute('aria-label') ?? deuce.textContent).toContain('12 a 10')
      await tocar(deuce)
      expect(f.pastillas()).toEqual(['12-10'])
      expect(JSON.parse(f.hidden('sets')!)).toEqual([{ mine: 12, theirs: 10 }])
    })

    it('pádel no ofrece deuce', async () => {
      const f = await montar()
      await tocar(f.boton('Vos'))
      expect(f.el.querySelector('button[aria-label$=" a 2"]')).toBeNull()
    })

    it('editar un ping pong con un deuce prellena las dos pastillas y sigue siendo a 11', async () => {
      const f = await montar({
        initial: editando('PING_PONG', {
          sets: [
            { mine: 12, theirs: 10 },
            { mine: 11, theirs: 5 },
          ],
        }),
      })
      expect(f.pastillas()).toEqual(['12-10', '11-5'])
      expect(f.hidden('gamesPerSet')).toBe('11')
    })

    it('cambiar de deporte no arrastra el resultado de goles del anterior', async () => {
      enviado = null
      const f = await montar({ action: guardar })
      await tocar(f.radio('sport', 'FIFA'))
      await tocar(f.radio('outcome', 'drew'))
      await act(async () => {
        escribir(f.input('scoreMine'), '2')
        escribir(f.input('teamMine'), 'Boca')
      })
      await tocar(f.radio('sport', 'BASQUET'))
      await f.enviar()
      expect(enviado).not.toBeNull()
      expect(enviado!.get('sport')).toBe('BASQUET')
      expect(enviado!.get('outcome')).toBeNull()
      expect(enviado!.get('scoreMine')).toBe('')
      expect(enviado!.has('teamMine')).toBe(false)

      // Y volver a FIFA no revive el empate ni el equipo escondidos.
      await tocar(f.radio('sport', 'FIFA'))
      expect(f.radio('outcome', 'drew').checked).toBe(false)
      expect(f.input('teamMine').value).toBe('')
    })

    it('editar un deporte fuera del registro no elige chip ni muestra resultado, y lo pide', async () => {
      const f = await montar({ initial: editando('TEJO') })
      const radios = Array.from(f.el.querySelectorAll('input[name="sport"]')) as HTMLInputElement[]
      expect(radios.some((r) => r.checked)).toBe(false)
      expect(f.el.querySelector('input[name="outcome"]')).toBeNull()
      expect(f.el.querySelector('input[name="sets"]')).toBeNull()
      expect(f.el.textContent).toContain('Elegí el deporte para cargar el resultado.')
      expect(f.submit().disabled).toBe(true)
    })
  })
})

describe('CargarConAmigo: el botón de abajo y la hoja', () => {
  async function montarPantalla() {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(CargarConAmigo, { friendPlayerId: 'amigo-1', nombre: 'Fede Paz', friends: AMIGOS }))
    })
    const el = container
    return {
      el,
      dialogo: () => el.querySelector('dialog') as HTMLDialogElement,
      boton: (texto: string) =>
        Array.from(el.querySelectorAll('button')).find((b) => b.textContent === texto) as HTMLButtonElement,
    }
  }

  it('el botón nombra al amigo y abre la hoja con el formulario', async () => {
    const f = await montarPantalla()
    expect(f.dialogo().open).toBe(false)
    await tocar(f.boton('Cargar partido con Fede'))
    expect(f.dialogo().open).toBe(true)
    expect(f.dialogo().textContent).toContain('Partido con Fede')
    expect((f.el.querySelector('input[name="playedOn"]') as HTMLInputElement).value).toBe(hoy())
  })

  it('un error deja la hoja abierta con lo cargado', async () => {
    vi.mocked(loadCasualMatch).mockImplementation(fallaSiempre)
    const f = await montarPantalla()
    await tocar(f.boton('Cargar partido con Fede'))
    await tocar(f.boton('Vos'))
    await tocar(f.boton('1'))
    expect(f.dialogo().open).toBe(true)
    expect(f.el.textContent).toContain('Elegí una fecha real.')
    expect(Array.from(f.el.querySelectorAll('[aria-label^="Set "]')).map((p) => p.textContent)).toEqual(['4-1'])
  })

  it('guardar cierra la hoja, avisa qué se guardó y la próxima vez arranca de cero', async () => {
    vi.mocked(loadCasualMatch).mockImplementation(async (state) => ({ error: null, saved: (state.saved ?? 0) + 1 }))
    const f = await montarPantalla()
    await tocar(f.boton('Cargar partido con Fede'))
    await tocar(f.boton('Vos'))
    await tocar(f.boton('1'))
    expect(f.dialogo().open).toBe(false)
    expect(f.el.querySelector('[role="status"]')?.textContent).toBe('Guardado: Ganaste 4-1')
    await tocar(f.boton('Cargar partido con Fede'))
    expect(f.el.querySelectorAll('[aria-label^="Set "]')).toHaveLength(0)
  })
})

describe('CasualMatchRow: tocar el partido lo abre para corregir; borrar pide confirmación', () => {
  const partido: CasualMatch = {
    matchId: 'm1',
    playedOn: '2026-08-23',
    sport: 'FIFA',
    together: false,
    partners: [],
    rivals: ['Fede'],
    sets: null,
    outcome: 'lost',
    score: { mine: 1, theirs: 2 },
    teams: { mine: null, theirs: null },
    createdBy: 'Fede',
    updatedBy: 'Fede',
    createdById: 'fede-id',
    updatedById: 'fede-id',
  }

  async function montarFila() {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        createElement(
          'ul',
          null,
          createElement(CasualMatchRow, { friendPlayerId: 'amigo-1', partido, resumen: 'Perdiste 1-2', children: 'fila' }),
        ),
      )
    })
    const el = container
    return {
      el,
      dialogo: () => el.querySelector('dialog') as HTMLDialogElement,
      boton: (t: string) =>
        Array.from(el.querySelectorAll('button')).find((b) => b.textContent === t) as HTMLButtonElement | undefined,
      corregir: () => el.querySelector('button[aria-label^="Corregir"]') as HTMLButtonElement,
    }
  }

  it('la fila es un botón que nombra el partido; tocarlo abre la hoja precargada', async () => {
    const f = await montarFila()
    expect(f.corregir().getAttribute('aria-label')).toBe('Corregir: Perdiste 1-2')
    expect(f.dialogo().open).toBe(false)
    await tocar(f.corregir())
    expect(f.dialogo().open).toBe(true)
    expect(f.boton('Guardar cambios')).toBeDefined()
    expect(f.boton('Cancelar')).toBeDefined()
    expect((f.el.querySelector('input[name="scoreMine"]') as HTMLInputElement).value).toBe('1')
    expect((f.el.querySelector('input[name="playedOn"]') as HTMLInputElement).value).toBe('2026-08-23')
  })

  it('el primer toque de Borrar no envía; "Sí, borrar" envía el borrado y No lo cancela', async () => {
    const f = await montarFila()
    vi.mocked(removeCasualMatch).mockClear()
    await tocar(f.corregir())

    await tocar(f.boton('Borrar partido')!)
    expect(removeCasualMatch).not.toHaveBeenCalled()
    expect(f.el.textContent).toContain('¿Borrar el partido?')
    // Borrar se desmonta: el foco va al "No" (default seguro), no al body.
    expect(document.activeElement).toBe(f.boton('No'))
    expect(f.el.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Confirmar borrado')

    await tocar(f.boton('No')!)
    expect(f.el.textContent).not.toContain('¿Borrar el partido?')
    expect(f.boton('Borrar partido')).toBeDefined()

    await tocar(f.boton('Borrar partido')!)
    await tocar(f.boton('Sí, borrar')!)
    expect(removeCasualMatch).toHaveBeenCalledTimes(1)
  })
})
