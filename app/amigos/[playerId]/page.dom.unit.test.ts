// @vitest-environment jsdom
//
// El Volver del historial con un amigo, según de dónde se llegó (odd/tasks/amigos-faciles.md, T3,
// pendiente de L9): desde la lista de Amigos vuelve a Amigos; sin origen, a Inicio; desde el perfil
// del torneo ("Amigos ›", `?desde=torneo`) desanda al perfil, y si no hay nada atrás va a Inicio.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement('a', { href, ...rest }, children as never),
}))

vi.mock('@/db/server', () => ({
  serverClient: async () => ({ rpc: async () => ({ data: 'p-yo' }) }),
}))

vi.mock('@/db/friends', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/db/friends')>()
  return { ...real, historyWith: vi.fn(async () => []), friendsOf: vi.fn(async () => []) }
})

vi.mock('@/db/read', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/db/read')>()
  return { ...real, playerNames: vi.fn(async () => new Map([['p-nico', 'Nico Arias']])) }
})

// La hoja de cargar no es lo que se prueba acá.
vi.mock('./cargar-con-amigo', () => ({ CargarConAmigo: () => null }))

const { default: AmigoPage } = await import('./page')
const { registrar } = await import('@/app/torneo/[id]/historial')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let back: ReturnType<typeof vi.spyOn>
let prevenido: boolean | undefined

function mirarClick(event: Event) {
  prevenido = event.defaultPrevented
  event.preventDefault()
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  back = vi.spyOn(history, 'back').mockImplementation(() => {})
  prevenido = undefined
  document.addEventListener('click', mirarClick)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  back.mockRestore()
  document.removeEventListener('click', mirarClick)
})

async function abrir(desde?: string) {
  const page = await AmigoPage({
    params: Promise.resolve({ playerId: 'p-nico' }),
    searchParams: Promise.resolve(desde === undefined ? {} : { desde }),
  })
  act(() => root.render(page))
  return host.querySelector('header a') as HTMLAnchorElement
}

async function tocar(link: HTMLAnchorElement) {
  await act(async () => link.click())
}

describe('Volver en el historial con un amigo', () => {
  // Primero, sin nada anotado en el historial de la app: entrar por un link directo.
  it('desde el torneo sin nada atrás: dice "Volver" y va a Inicio', async () => {
    const volver = await abrir('torneo')
    expect(volver.textContent).toBe('Volver')
    expect(volver.getAttribute('href')).toBe('/torneos')
    await tocar(volver)
    expect(back).not.toHaveBeenCalled()
    expect(prevenido).toBe(false)
  })

  it('desde el torneo ("Amigos ›"): desanda al perfil del torneo', async () => {
    registrar('/torneo/s1/padel/jugador/e1')
    registrar('/amigos/p-nico')
    const volver = await abrir('torneo')
    expect(volver.textContent).toBe('Volver')
    await tocar(volver)
    expect(back).toHaveBeenCalledOnce()
    expect(prevenido).toBe(true)
  })

  it('desde la lista de Amigos (`?desde=amigos`): "Amigos", a /amigos, como siempre', async () => {
    const volver = await abrir('amigos')
    expect(volver.textContent).toBe('Amigos')
    expect(volver.getAttribute('href')).toBe('/amigos')
    await tocar(volver)
    expect(back).not.toHaveBeenCalled()
  })

  // T9, S9: "Ver historial" del perfil llega con `?desde=perfil`.
  it('desde el perfil (`?desde=perfil`): "Perfil", a /perfil/<id>', async () => {
    const volver = await abrir('perfil')
    expect(volver.textContent).toBe('Perfil')
    expect(volver.getAttribute('href')).toBe('/perfil/p-nico')
    await tocar(volver)
    expect(back).not.toHaveBeenCalled()
  })

  it('un origen que no se conoce es como sin origen', async () => {
    const volver = await abrir('cualquiera')
    expect(volver.textContent).toBe('Inicio')
    expect(volver.getAttribute('href')).toBe('/torneos')
  })

  it('sin origen (Inicio o un link): "Inicio", a /torneos, como siempre', async () => {
    const volver = await abrir()
    expect(volver.textContent).toBe('Inicio')
    expect(volver.getAttribute('href')).toBe('/torneos')
    await tocar(volver)
    expect(back).not.toHaveBeenCalled()
  })
})

// odd/tasks/amigos-faciles.md, T4, S5: quien se sumó con un link de amistad cae acá con
// `?amistad=nueva` y ve "Listo, ya son amigos". El parámetro sale de la URL para que recargar no
// lo repita.
describe('el aviso al sumarse con un link de amistad', () => {
  async function abrirCon(searchParams: { desde?: string; amistad?: string }) {
    const page = await AmigoPage({ params: Promise.resolve({ playerId: 'p-nico' }), searchParams: Promise.resolve(searchParams) })
    await act(async () => root.render(page))
  }
  const aviso = () => [...host.querySelectorAll('[role="status"]')].map((el) => el.textContent).join('')

  it('con `?amistad=nueva` avisa "Listo, ya son amigos" y saca el parámetro de la URL', async () => {
    window.history.replaceState(null, '', '/amigos/p-nico?desde=amigos&amistad=nueva')
    await abrirCon({ desde: 'amigos', amistad: 'nueva' })
    expect(aviso()).toBe('Listo, ya son amigos')
    expect(window.location.pathname + window.location.search).toBe('/amigos/p-nico?desde=amigos')
  })

  it('sin el parámetro no hay aviso', async () => {
    window.history.replaceState(null, '', '/amigos/p-nico?desde=amigos')
    await abrirCon({ desde: 'amigos' })
    expect(aviso()).toBe('')
  })
})
