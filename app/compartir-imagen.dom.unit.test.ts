// @vitest-environment jsdom
//
// "Compartir" arma una imagen con la tabla para mandarla al grupo: en el celular abre el menú
// del sistema con el archivo, en la compu lo descarga.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CompartirImagen } from './compartir-imagen'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let textos: string[]
let colores: string[]

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  textos = []
  colores = []
  // jsdom no dibuja: un contexto que anota lo que se escribe (y con qué colores) alcanza para
  // saber qué lleva la imagen.
  const ctx = new Proxy(
    {
      fillText: (texto: string) => textos.push(texto),
      measureText: (texto: string) => ({ width: texto.length * 10 }),
    },
    {
      get: (target, key) => (key in target ? target[key as keyof typeof target] : () => {}),
      set: (_, key, value) => {
        if (key === 'fillStyle') colores.push(String(value).toLowerCase())
        return true
      },
    },
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
    callback(new Blob(['png'], { type: 'image/png' })),
  )
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  delete (navigator as { share?: unknown }).share
  delete (navigator as { canShare?: unknown }).canShare
})

const TABLA = [
  { nombre: '1. Juan', puntos: 12 },
  { nombre: '2. Pedro', puntos: '1' },
]

async function render(filas: Parameters<typeof CompartirImagen>[0]['filas'] = TABLA) {
  await act(async () =>
    root.render(
      createElement(CompartirImagen, {
        archivo: 'liga-jueves',
        titulo: 'Liga Jueves',
        subtitulo: 'Tabla · fecha 3 de 10',
        filas,
      }),
    ),
  )
}
const boton = () => host.querySelector('button')!

describe('CompartirImagen', () => {
  it('con menú de compartir: manda la imagen de la tabla como archivo', async () => {
    const share = vi.fn(async () => {})
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    await render()

    act(() => boton().click())

    expect(share).toHaveBeenCalledTimes(1)
    const [{ files, title }] = share.mock.calls[0] as unknown as [{ files: File[]; title: string }]
    expect(title).toBe('Liga Jueves')
    expect(files.map((file) => [file.name, file.type])).toEqual([['liga-jueves.png', 'image/png']])
    expect(textos).toEqual(expect.arrayContaining(['Liga Jueves', 'Tabla · fecha 3 de 10', '1. Juan', '12 pts', '2. Pedro', '1 pt']))
  })

  it('los partidos de una fecha: títulos de ronda y filas sin puntos', async () => {
    await render([
      { nombre: 'Ronda 1', titulo: true },
      { nombre: 'Juan & Pedro  vs  Luis & Ana' },
      { nombre: 'Libre: Tomi & Nico' },
    ])

    expect(textos).toEqual(expect.arrayContaining(['Ronda 1', 'Juan & Pedro  vs  Luis & Ana', 'Libre: Tomi & Nico']))
    expect(textos.filter((texto) => /\bpts?\b/.test(texto))).toEqual([])
  })

  it('con la paleta del prototipo: el bloque azul cancha arriba y nada del verde viejo', async () => {
    await render()

    // Lo primero que se pinta después del fondo es el bloque del encabezado.
    expect(colores[0]).toBe('#ffffff')
    expect(colores[1]).toBe('#1f45e0')
    expect(colores).toContain('#0e1a4a')
    for (const viejo of ['#0d1512', '#16201c', '#eaf2ee', '#8ea298', '#34c08a']) expect(colores).not.toContain(viejo)
  })

  it('sin menú de compartir: descarga la imagen', async () => {
    const createObjectURL = vi.fn(() => 'blob:tabla')
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('liga-jueves.png')
      expect(this.href).toBe('blob:tabla')
    })
    await render()

    act(() => boton().click())

    expect(click).toHaveBeenCalledTimes(1)
  })
})
