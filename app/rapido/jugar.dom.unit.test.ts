// @vitest-environment jsdom
//
// Jugar el torneo rápido (S8e): tocar el partido abre la hoja, el segundo toque guarda, después de
// guardar el siguiente sin cargar queda a un toque ("Siguiente" del aviso), un partido cargado abre
// precargado para corregirlo y "Nuevo torneo" sigue preguntando. jsdom porque todo pasa al TOCAR.
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { ARMADO_INICIAL, cargarMarcador, type TorneoRapido } from './rapido-state'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement('a', { href, ...rest }, children as never),
}))

const { Jugar } = await import('./jugar')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// jsdom todavía no trae `showModal` ni `close` (lo mismo que `app/ui/sheet.dom.unit.test.ts`).
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

let host: HTMLDivElement
let root: Root
let cargas: Array<[number, number, number]>
let nuevo: ReturnType<typeof vi.fn>

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  cargas = []
  nuevo = vi.fn()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

/** Individual de 3: tres partidos, uno por ronda. */
const TORNEO: TorneoRapido = {
  armado: { ...ARMADO_INICIAL, modalidad: 'INDIVIDUAL', jugadores: ['Ana', 'Beto', 'Cami'] },
  jugadores: ['Ana', 'Beto', 'Cami'],
  partidos: [
    { ronda: 1, a: [0], b: [1], marcador: null },
    { ronda: 2, a: [0], b: [2], marcador: null },
    { ronda: 3, a: [1], b: [2], marcador: null },
  ],
}

/** La pantalla como la usa `page.tsx`: el torneo vive arriba y cada carga lo reemplaza. */
function Pantalla({ inicial }: { inicial: TorneoRapido }) {
  const [torneo, setTorneo] = useState(inicial)
  return createElement(Jugar, {
    torneo,
    onCargarMarcador: (indice: number, a: number, b: number) => {
      cargas.push([indice, a, b])
      setTorneo((t) => cargarMarcador(t, indice, a, b))
    },
    onNuevoTorneo: nuevo,
  })
}

const montar = (torneo: TorneoRapido = TORNEO) => act(() => root.render(createElement(Pantalla, { inicial: torneo })))
const botones = () => [...host.querySelectorAll('button')]
const porEtiqueta = (texto: string) =>
  botones().find((b) => b.getAttribute('aria-label') === texto) as HTMLButtonElement | undefined
const porTexto = (texto: string) => botones().find((b) => b.textContent?.trim() === texto) as HTMLButtonElement | undefined
const hojas = () => [...host.querySelectorAll('dialog')]
const hojaAbierta = () => hojas().find((d) => d.open)
const enHoja = (texto: string) =>
  [...(hojaAbierta()?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === texto) as
    | HTMLButtonElement
    | undefined
const tocar = (boton: HTMLButtonElement | undefined) => {
  expect(boton).toBeDefined()
  act(() => boton!.click())
}
const aviso = () => host.querySelector('[role="status"]') as HTMLElement

it('tocar un partido sin cargar abre su hoja, con la ronda de título', () => {
  montar()
  expect(hojaAbierta()).toBeUndefined()
  tocar(porEtiqueta('Cargar Ana contra Beto'))
  const hoja = hojaAbierta()!
  const titulo = document.getElementById(hoja.getAttribute('aria-labelledby') ?? '')
  expect(titulo?.textContent).toBe('Ronda 1')
  // Sin ganador elegido los números se ven pero no se tocan.
  expect(enHoja('2')?.disabled).toBe(true)
})

it('dos toques: quién ganó y los games del que perdió; el segundo guarda y cierra la hoja', () => {
  montar()
  tocar(porEtiqueta('Cargar Ana contra Beto'))
  tocar(enHoja('Beto'))
  expect(enHoja('Beto')?.getAttribute('aria-pressed')).toBe('true')
  expect(hojaAbierta()?.textContent).toContain('Games de Ana')
  expect(cargas).toEqual([])

  tocar(enHoja('2'))
  expect(cargas).toEqual([[0, 2, 4]])
  expect(hojaAbierta()).toBeUndefined()
  expect(aviso().textContent).toContain('Guardado: Beto 4-2')
})

it('el partido recién guardado destella 700 ms; los demás, no', async () => {
  montar()
  tocar(porEtiqueta('Cargar Ana contra Beto'))
  tocar(enHoja('Ana'))
  tocar(enHoja('1'))
  expect(document.getElementById('partido-0')?.classList.contains('destello')).toBe(true)
  expect(document.getElementById('partido-1')?.classList.contains('destello')).toBe(false)

  await act(async () => {
    await new Promise((listo) => setTimeout(listo, 750))
  })
  expect(document.getElementById('partido-0')?.classList.contains('destello')).toBe(false)
})

it('"Siguiente" del aviso abre el próximo sin cargar', () => {
  montar()
  tocar(porEtiqueta('Cargar Ana contra Beto'))
  tocar(enHoja('Ana'))
  tocar(enHoja('1'))

  const siguiente = [...aviso().querySelectorAll('button')].find((b) => b.textContent === 'Siguiente')
  tocar(siguiente)
  const hoja = hojaAbierta()!
  expect(document.getElementById(hoja.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('Ronda 2')
  expect(enHoja('Cami')).toBeDefined()
})

it('con el último partido guardado no hay "Siguiente" y aparece el campeón', () => {
  montar({
    ...TORNEO,
    partidos: [
      { ...TORNEO.partidos[0]!, marcador: { a: 4, b: 0 } },
      { ...TORNEO.partidos[1]!, marcador: { a: 4, b: 1 } },
      TORNEO.partidos[2]!,
    ],
  })
  expect(host.textContent).not.toContain('Campeón')
  tocar(porEtiqueta('Cargar Beto contra Cami'))
  tocar(enHoja('Beto'))
  tocar(enHoja('2'))

  expect([...aviso().querySelectorAll('button')].map((b) => b.textContent)).not.toContain('Siguiente')
  expect(host.querySelector('header')?.textContent).toContain('Campeón')
  expect(host.querySelector('header')?.textContent).toContain('Ana')
})

// T17: el aviso no se queda encima del campeón que acaba de mostrar.
it('"Ver campeón" lleva el foco al campeón y cierra el aviso', () => {
  // jsdom no scrollea: `verCampeon` sube la pantalla con `scrollTo`.
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  montar({
    ...TORNEO,
    partidos: [
      { ...TORNEO.partidos[0]!, marcador: { a: 4, b: 0 } },
      { ...TORNEO.partidos[1]!, marcador: { a: 4, b: 1 } },
      TORNEO.partidos[2]!,
    ],
  })
  tocar(porEtiqueta('Cargar Beto contra Cami'))
  tocar(enHoja('Beto'))
  tocar(enHoja('2'))
  expect(aviso().dataset.visible).toBe('true')

  tocar([...aviso().querySelectorAll('button')].find((b) => b.textContent === 'Ver campeón'))

  expect(document.activeElement?.textContent).toContain('Campeón')
  expect(aviso().dataset.visible).toBe('false')
  expect(aviso().textContent).toBe('')
  expect(scroll).toHaveBeenCalled()
  scroll.mockRestore()
})

// Pádel nace con el set real (S6): el 4-3 ya no es un toque, así que el precargado usa un 4-2.
it('un partido cargado abre precargado: el ganador elegido y su número marcado; un toque corrige', () => {
  montar({ ...TORNEO, partidos: [{ ...TORNEO.partidos[0]!, marcador: { a: 4, b: 2 } }, ...TORNEO.partidos.slice(1)] })
  tocar(porEtiqueta('Corregir Ana 4, Beto 2'))
  expect(enHoja('Ana')?.getAttribute('aria-pressed')).toBe('true')
  expect(enHoja('2')?.getAttribute('aria-pressed')).toBe('true')

  tocar(enHoja('1'))
  expect(cargas).toEqual([[0, 4, 1]])
  expect(porEtiqueta('Corregir Ana 4, Beto 1')).toBeDefined()
})

it('cambiar de ganador al corregir suelta el número marcado', () => {
  montar({ ...TORNEO, partidos: [{ ...TORNEO.partidos[0]!, marcador: { a: 4, b: 2 } }, ...TORNEO.partidos.slice(1)] })
  tocar(porEtiqueta('Corregir Ana 4, Beto 2'))
  tocar(enHoja('Beto'))
  expect(enHoja('2')?.getAttribute('aria-pressed')).toBe('false')
  expect(cargas).toEqual([])
})

it('la tabla se actualiza con lo cargado', () => {
  montar()
  tocar(porEtiqueta('Cargar Ana contra Beto'))
  tocar(enHoja('Ana'))
  tocar(enHoja('1'))
  const filas = [...host.querySelectorAll('[data-fila-tabla]')].map((fila) => fila.textContent)
  expect(filas[0]).toContain('Ana')
  expect(filas[0]).toContain('+3')
})

it('"Nuevo torneo" pregunta antes de borrar; Cancelar no borra nada', () => {
  montar()
  tocar(porTexto('Nuevo torneo'))
  expect(hojaAbierta()?.textContent).toContain('¿Arrancar un torneo nuevo?')

  tocar(enHoja('Cancelar'))
  expect(hojaAbierta()).toBeUndefined()
  expect(nuevo).not.toHaveBeenCalled()

  tocar(porTexto('Nuevo torneo'))
  tocar(enHoja('Sí, empezar de nuevo'))
  expect(nuevo).toHaveBeenCalledTimes(1)
})

it('Volver va al inicio de la app y lo nombra', () => {
  montar()
  const volver = host.querySelector('header a') as HTMLAnchorElement
  expect(volver.getAttribute('href')).toBe('/')
  expect(volver.textContent).toBe('Inicio')
})

it('antes del primer resultado la tabla no inventa puestos', () => {
  montar()
  const filas = [...host.querySelectorAll('[data-fila-tabla]')]
  expect(filas.map((fila) => fila.firstElementChild?.textContent)).toEqual(['–', '–', '–'])
  tocar(porEtiqueta('Cargar Ana contra Beto'))
  tocar(enHoja('Ana'))
  tocar(enHoja('0'))
  expect([...host.querySelectorAll('[data-fila-tabla]')].map((fila) => fila.firstElementChild?.textContent)).toEqual([
    '1°',
    '2°',
    '3°',
  ])
})

// S6 y la carga con ventaja: los mismos botones que una fecha.
const conDeporte = (deporte: TorneoRapido['armado']['deporte']): TorneoRapido => ({
  ...TORNEO,
  armado: { ...TORNEO.armado, deporte },
})

it('tenis: 7-5 y 7-6 son botones aparte, el del tie-break dicho en claro, y guardan con un toque', () => {
  montar(conDeporte('TENIS'))
  tocar(porEtiqueta('Cargar Ana contra Beto'))
  tocar(enHoja('Ana'))
  expect(hojaAbierta()?.textContent).toContain('El 7-6 es con tie-break.')
  expect(enHoja('5')).toBeUndefined()
  tocar(enHoja('7-6'))
  expect(cargas).toEqual([[0, 7, 6]])
  expect(aviso().textContent).toContain('Guardado: Ana 7-6')
})

it('fútbol tenis: un 16-14 se carga con su botón y al corregir vuelve marcado', () => {
  montar(conDeporte('FUTBOL_TENIS'))
  tocar(porEtiqueta('Cargar Ana contra Beto'))
  tocar(enHoja('Beto'))
  expect(hojaAbierta()?.textContent).toContain('Puntos de Ana')
  tocar(enHoja('16-14'))
  expect(cargas).toEqual([[0, 14, 16]])
  tocar(porEtiqueta('Corregir Ana 14, Beto 16'))
  expect(enHoja('16-14')?.getAttribute('aria-pressed')).toBe('true')
})

it('pool: a 3 bolas, sin botones de ventaja', () => {
  montar(conDeporte('POOL'))
  tocar(porEtiqueta('Cargar Ana contra Beto'))
  tocar(enHoja('Ana'))
  expect(hojaAbierta()?.textContent).toContain('Bolas de Beto')
  expect(enHoja('3')).toBeUndefined()
  tocar(enHoja('2'))
  expect(cargas).toEqual([[0, 3, 2]])
})

it('un pádel guardado antes del set real (4-3) se ve como se cargó y se corrige con un toque', () => {
  montar({ ...TORNEO, partidos: [{ ...TORNEO.partidos[0]!, marcador: { a: 4, b: 3 } }, ...TORNEO.partidos.slice(1)] })
  tocar(porEtiqueta('Corregir Ana 4, Beto 3'))
  expect(enHoja('Ana')?.getAttribute('aria-pressed')).toBe('true')
  // Ningún botón dice 4-3: no se marca ninguno, pero se ven los del set real.
  expect(hojaAbierta()?.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(1)
  tocar(enHoja('5-4'))
  expect(cargas).toEqual([[0, 5, 4]])
})
