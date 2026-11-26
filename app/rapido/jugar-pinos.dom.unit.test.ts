// @vitest-environment jsdom
//
// El torneo rápido de bowling (S4): armar sin modalidad, una fila de pinos por jugador (Enter
// guarda y pasa al siguiente), el ranking con puestos compartidos y el campeón cuando todos
// cargaron. jsdom porque todo pasa al tipear.
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ARMADO_INICIAL, armar, cargarPinos, type Armado, type TorneoRapido } from './rapido-state'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement('a', { href, ...rest }, children as never),
}))

const { Jugar } = await import('./jugar')
const { Armar } = await import('./armar')

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

const TORNEO: TorneoRapido = armar({ ...ARMADO_INICIAL, deporte: 'BOWLING', jugadores: ['Ana', 'Beto', 'Caro'] }, () => 0)

/** `Jugar` con el estado de verdad: lo cargado vuelve como en `page.tsx`. */
function montar(inicial: TorneoRapido = TORNEO) {
  function ConEstado() {
    const [torneo, setTorneo] = useState(inicial)
    return createElement(Jugar, {
      torneo,
      onCargarMarcador: () => {
        throw new Error('bowling no tiene partidos')
      },
      onCargarPinos: (indice: number, pinos: number | null) => setTorneo((t) => cargarPinos(t, indice, pinos)),
      onNuevoTorneo: () => {},
    })
  }
  act(() => root.render(createElement(ConEstado)))
}

const campo = (nombre: string) => host.querySelector(`input[aria-label="Pinos de ${nombre}"]`) as HTMLInputElement
function escribir(input: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    input.focus()
    setter.call(input, valor)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function enter(input: HTMLInputElement) {
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  })
}
/** Lo que se ve de cada fila del ranking, sin el texto para lector de pantalla. */
const puestos = () =>
  [...host.querySelectorAll('[data-fila-pinos]')].map((fila) => {
    const copia = fila.cloneNode(true) as HTMLElement
    copia.querySelectorAll('.sr-only').forEach((oculto) => oculto.remove())
    return copia.textContent?.replace(/\s+/g, ' ').trim()
  })

describe('jugar un bowling', () => {
  it('una fila de pinos por jugador, numérica y de 16px o más; sin rondas ni partidos', () => {
    montar()
    for (const nombre of ['Ana', 'Beto', 'Caro']) {
      expect(campo(nombre).getAttribute('inputmode')).toBe('numeric')
      expect(campo(nombre).className).toMatch(/text-\[(1[6-9]|[2-9]\d)px\]/)
    }
    expect(host.textContent).not.toContain('Ronda 1')
    expect(host.textContent).toContain('0 de 3')
  })

  it('Enter guarda la fila y pasa a la siguiente; el ranking comparte el puesto (S4)', () => {
    montar()
    escribir(campo('Ana'), '180')
    enter(campo('Ana'))
    expect(document.activeElement).toBe(campo('Beto'))
    escribir(campo('Beto'), '180')
    enter(campo('Beto'))
    expect(puestos()).toEqual(['1 Ana 180', '1 Beto 180', '– Caro –'])
    expect(host.textContent).toContain('2 de 3')
    expect(host.textContent).not.toContain('Campeones')
  })

  it('lo que no es un total no se guarda y la fila dice por qué', () => {
    montar()
    escribir(campo('Ana'), '12a')
    enter(campo('Ana'))
    expect(campo('Ana').getAttribute('aria-invalid')).toBe('true')
    expect(host.textContent).toContain('Sólo números.')
    expect(host.textContent).toContain('0 de 3')
  })

  it('con todos cargados aparece el campeón con sus pinos, y los empatados lo comparten', () => {
    montar(cargarPinos(cargarPinos(TORNEO, 0, 200), 1, 200))
    escribir(campo('Caro'), '150')
    enter(campo('Caro'))
    expect(host.textContent).toContain('Campeones')
    expect(host.textContent).toContain('Ana y Beto')
    expect(puestos()).toEqual(['1 Ana 200', '1 Beto 200', '3 Caro 150'])
  })
})

describe('armar un bowling', () => {
  it('elegir Bowling saca "Cómo se juega" y arranca con dos', () => {
    const empezar = vi.fn<(armado: Armado) => void>()
    act(() => root.render(createElement(Armar, { onEmpezar: empezar })))
    const bowling = [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Bowling'))!
    expect(bowling.textContent).toContain('Cada uno su total')
    act(() => bowling.click())
    expect(host.textContent).not.toContain('Cómo se juega')
    const nombre = (n: number) => host.querySelector(`input[aria-label="Jugador ${n}"]`) as HTMLInputElement
    escribir(nombre(1), 'Ana')
    escribir(nombre(2), 'Beto')
    const boton = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Empezar') as HTMLButtonElement
    expect(boton.disabled).toBe(false)
    act(() => boton.click())
    expect(empezar.mock.calls[0]![0].deporte).toBe('BOWLING')
  })
})
