// @vitest-environment jsdom
//
// jsdom y no `renderToStaticMarkup`: lo que se fija acá pasa al TOCAR "Cargar resultado" —que el
// botón diga que abrió (`aria-expanded`) y que el panel quede a la vista—, y el HTML estático
// descarta los `onClick` y los efectos. Va aparte de `carga.unit.test.ts` porque aquel es una suite
// de entorno node y no conviene cambiarle el entorno.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MatchFormat } from '@/core'
import type { WriteResult } from './actions'
import { Carga, type CargaContext } from './carga'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// `carga.tsx` importa las server actions, que traen la base. Acá no se guarda nada: el espía
// responde lo que cada test le diga, y por defecto que salió bien.
const saveMatchResult = vi.fn(async (..._args: unknown[]): Promise<WriteResult> => ({ ok: true }))
vi.mock('./actions', () => ({
  saveMatchResult: (...args: unknown[]) => saveMatchResult(...args),
  closeTheMatchday: vi.fn(),
  redraftTheMatchday: vi.fn(),
  reopenTheMatchday: vi.fn(),
}))
vi.mock('./borrar', () => ({ BorrarFecha: () => null }))

const PADEL: MatchFormat = { setsToWin: 1, gamesPerSet: 4, tieBreak: true, openScore: false }
const FIFA: MatchFormat = { ...PADEL, openScore: true }

const contextOf = (format: MatchFormat): CargaContext => ({
  seasonId: 's1',
  matchdayId: 'm1',
  disciplina: 'padel',
  matchdayNumber: 1,
  format,
  unit: 'games',
})

// jsdom no trae `scrollIntoView`: se instala un espía y se devuelve lo que había.
const original = Element.prototype.scrollIntoView
const scrollIntoView = vi.fn()

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  scrollIntoView.mockClear()
  saveMatchResult.mockClear()
  saveMatchResult.mockResolvedValue({ ok: true })
  Element.prototype.scrollIntoView = scrollIntoView
})

afterEach(() => {
  if (root !== null) act(() => root?.unmount())
  container?.remove()
  container = null
  root = null
  if (original === undefined) delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  else Element.prototype.scrollIntoView = original
})

const carga = (format: MatchFormat) =>
  createElement(Carga, {
    context: contextOf(format),
    matchId: 'p1',
    pairAName: 'Ana & Beto',
    pairBName: 'Caro & Dani',
  })

async function montar(format: MatchFormat): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(carga(format))
  })
  return container
}

const botonDe = (dentro: ParentNode, texto: string): HTMLButtonElement => {
  const boton = [...dentro.querySelectorAll('button')].find((candidato) => candidato.textContent?.trim() === texto)
  if (boton === undefined) throw new Error(`No hay un botón "${texto}".`)
  return boton
}

async function tocar(boton: HTMLButtonElement): Promise<void> {
  await act(async () => {
    boton.click()
  })
}

/** Tipea en un campo controlado de React: hay que pasar por el setter nativo y avisar con `input`. */
async function tipear(campo: HTMLInputElement, texto: string): Promise<void> {
  await act(async () => {
    const valor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    valor?.call(campo, texto)
    campo.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('Cargar resultado — al abrir, el panel queda a la vista', () => {
  it('antes del toque el botón dice que está cerrado y no se scrollea', async () => {
    const vista = await montar(PADEL)

    expect(botonDe(vista, 'Cargar resultado').getAttribute('aria-expanded')).toBe('false')
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('al tocarlo el botón dice que abrió, aparece "¿Quién ganó?" y se scrollea una vez a lo más cercano', async () => {
    const vista = await montar(PADEL)

    await tocar(botonDe(vista, 'Cargar resultado'))

    expect(botonDe(vista, 'Cargar resultado').getAttribute('aria-expanded')).toBe('true')
    expect(vista.textContent).toContain('¿Quién ganó?')
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('el scroll es del contenedor de la carga, no del botón suelto', async () => {
    const vista = await montar(PADEL)

    await tocar(botonDe(vista, 'Cargar resultado'))

    const contenedor = scrollIntoView.mock.contexts[0] as Element
    expect(contenedor.contains(botonDe(vista, 'Cargar resultado'))).toBe(true)
    expect(contenedor.textContent).toContain('¿Quién ganó?')
    // Deja lugar abajo para la barra fija de pestañas: sin esto `nearest` lo pega al borde y la barra lo tapa.
    expect(contenedor.className).toContain('scroll-mb-24')
  })

  it('pasar al paso del perdedor vuelve a mirar: ese paso es más alto y puede quedar tapado', async () => {
    const vista = await montar(PADEL)
    await tocar(botonDe(vista, 'Cargar resultado'))

    await tocar(botonDe(vista, 'Ana & Beto'))

    expect(vista.textContent).toContain('del perdedor')
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' })
  })

  it('un re-render sin cambios no vuelve a scrollear', async () => {
    const vista = await montar(PADEL)
    await tocar(botonDe(vista, 'Cargar resultado'))

    await act(async () => {
      root?.render(carga(PADEL))
    })

    expect(vista.textContent).toContain('¿Quién ganó?')
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('volver a tocarlo cierra el panel, lo marca cerrado y tampoco scrollea', async () => {
    const vista = await montar(PADEL)
    await tocar(botonDe(vista, 'Cargar resultado'))

    await tocar(botonDe(vista, 'Cargar resultado'))

    expect(botonDe(vista, 'Cargar resultado').getAttribute('aria-expanded')).toBe('false')
    expect(vista.textContent).not.toContain('¿Quién ganó?')
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('cerrar y volver a abrir scrollea otra vez', async () => {
    const vista = await montar(PADEL)
    await tocar(botonDe(vista, 'Cargar resultado'))
    await tocar(botonDe(vista, 'Cargar resultado'))

    await tocar(botonDe(vista, 'Cargar resultado'))

    expect(botonDe(vista, 'Cargar resultado').getAttribute('aria-expanded')).toBe('true')
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it('con marcador abierto (FIFA) también scrollea al abrir', async () => {
    const vista = await montar(FIFA)

    await tocar(botonDe(vista, 'Cargar resultado'))

    expect(botonDe(vista, 'Cargar resultado').getAttribute('aria-expanded')).toBe('true')
    expect(vista.textContent).toContain('Guardar resultado')
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('FIFA: si el guardado rebota, el error se suma al panel y vuelve a mirar; tipear no scrollea', async () => {
    saveMatchResult.mockResolvedValue({ ok: false, error: 'Esta disciplina no admite empates.' })
    const vista = await montar(FIFA)
    await tocar(botonDe(vista, 'Cargar resultado'))

    const [golesA, golesB] = [...vista.querySelectorAll('input')]
    await tipear(golesA as HTMLInputElement, '0')
    await tipear(golesB as HTMLInputElement, '0')
    // Los campos son lo que más se toca con el teclado del celular abierto: mover la pantalla ahí estorba.
    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    await tocar(botonDe(vista, 'Guardar resultado'))

    expect(vista.textContent).toContain('Esta disciplina no admite empates.')
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it('pádel: si el guardado rebota el panel se cierra, el error queda junto al botón y no scrollea', async () => {
    saveMatchResult.mockResolvedValue({ ok: false, error: 'No se pudo guardar.' })
    const vista = await montar(PADEL)
    await tocar(botonDe(vista, 'Cargar resultado'))
    await tocar(botonDe(vista, 'Ana & Beto'))
    expect(scrollIntoView).toHaveBeenCalledTimes(2)

    await tocar(botonDe(vista, '0'))

    expect(vista.textContent).toContain('No se pudo guardar.')
    expect(botonDe(vista, 'Cargar resultado').getAttribute('aria-expanded')).toBe('false')
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })
})
