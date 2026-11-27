// @vitest-environment jsdom
//
// "Ver todas" de "Gente de tus torneos" (odd/tasks/amigos-faciles.md, S10, S11, S3;
// `design/amigos-faciles/08-gente-de-tus-torneos-paginada.html`): filtro por torneo que sobrevive
// a recargar (`?torneo=`), de a 20 con "Mostrar más (k)", el final de la lista y "Enviado" que
// se queda mientras sigas en la pantalla.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenteDeTorneo } from '@/db/friends'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement('a', { href, ...rest }, children as never),
}))

vi.mock('next/navigation', () => ({ usePathname: () => '/amigos/gente' }))

vi.mock('@/app/amigos/actions', () => ({
  agregarAmigo: vi.fn(async () => ({ ok: true, estado: 'sent' })),
}))

const actions = await import('@/app/amigos/actions')
const { GenteTodas } = await import('./todas')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  window.history.replaceState(null, '', '/amigos/gente')
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  vi.clearAllMocks()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const MARTES: [string, string] = ['s-martes', 'Los Pibes del Martes']
const JUEVES: [string, string] = ['s-jueves', 'Copa del Jueves']
const VIERNES: [string, string] = ['s-viernes', 'FIFA de los Viernes']

function persona(n: number, torneos: Array<[string, string]> = [MARTES]): GenteDeTorneo {
  return {
    playerId: `p${n}`,
    displayName: `Persona ${n}`,
    seasonIds: torneos.map(([id]) => id),
    torneos: torneos.map(([, nombre]) => nombre),
    fechasJuntos: 100 - n,
  }
}

/** n personas: las múltiplos de 3 también juegan la Copa del Jueves; la 2, además, el FIFA. */
const muchas = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const k = i + 1
    if (k === 2) return persona(k, [MARTES, JUEVES, VIERNES])
    return persona(k, k % 3 === 0 ? [MARTES, JUEVES] : [MARTES])
  })

const montar = (gente: GenteDeTorneo[], torneo: string | null = null) =>
  act(() => root.render(createElement(GenteTodas, { gente, torneo })))

const filas = () => [...host.querySelectorAll('ul li')]
const boton = (texto: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto) as HTMLButtonElement | undefined
const chips = () => [...host.querySelectorAll('[role="group"][aria-label="Filtrar por torneo"] button')] as HTMLButtonElement[]
const chip = (texto: string) => chips().find((b) => b.textContent === texto)
const subtitulo = () => host.querySelector('header p')?.textContent

async function tocar(el: HTMLElement | null | undefined) {
  if (el === undefined || el === null) throw new Error('No está el botón')
  await act(async () => el.click())
}

describe('el encabezado', () => {
  it('Volver "Amigos" a /amigos, el título y "N personas"', () => {
    montar(muchas(23))
    const volver = host.querySelector('header a')
    expect(volver?.getAttribute('href')).toBe('/amigos')
    expect(volver?.textContent).toContain('Amigos')
    expect(host.querySelector('h1')?.textContent).toBe('Gente de tus torneos')
    expect(subtitulo()).toBe('23 personas')
  })

  it('con una sola: "1 persona"', () => {
    montar([persona(1)])
    expect(subtitulo()).toBe('1 persona')
  })
})

describe('los chips de filtro', () => {
  it('"Todos" y uno por torneo con gente para sugerir, el de más gente primero; "Todos" elegido', () => {
    montar(muchas(23))
    expect(chips().map((b) => b.textContent)).toEqual(['Todos', 'Los Pibes del Martes', 'Copa del Jueves', 'FIFA de los Viernes'])
    expect(chips().map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false'])
    // Se deslizan de costado.
    expect(host.querySelector('[role="group"]')?.className).toContain('overflow-x-auto')
  })

  it('un torneo sin nadie para sugerir no tiene chip', () => {
    montar([persona(1, [MARTES])])
    expect(chips().map((b) => b.textContent)).toEqual(['Todos', 'Los Pibes del Martes'])
  })

  it('tocar un torneo: lo elige, deja sólo su gente (en el mismo orden), cambia el número y la URL', async () => {
    montar(muchas(23))
    await tocar(chip('Copa del Jueves'))
    expect(chip('Copa del Jueves')?.getAttribute('aria-pressed')).toBe('true')
    expect(chip('Todos')?.getAttribute('aria-pressed')).toBe('false')
    // 2, 3, 6, 9, 12, 15, 18, 21.
    expect(filas()).toHaveLength(8)
    expect(filas()[0]?.textContent).toContain('Persona 2')
    expect(filas()[1]?.textContent).toContain('Persona 3')
    expect(filas()[7]?.textContent).toContain('Persona 21')
    expect(subtitulo()).toBe('8 personas')
    expect(window.location.pathname).toBe('/amigos/gente')
    expect(window.location.search).toBe('?torneo=s-jueves')
    // Entran todas: ni "Mostrar más" ni el final.
    expect(host.textContent).not.toContain('Mostrar más')
    expect(host.textContent).not.toContain('Son todas')

    await tocar(chip('Todos'))
    expect(chip('Todos')?.getAttribute('aria-pressed')).toBe('true')
    expect(subtitulo()).toBe('23 personas')
    expect(window.location.search).toBe('')
  })

  it('al abrir con ?torneo=<id> (recargar), arranca filtrada', () => {
    montar(muchas(23), 's-viernes')
    expect(chip('FIFA de los Viernes')?.getAttribute('aria-pressed')).toBe('true')
    expect(chip('Todos')?.getAttribute('aria-pressed')).toBe('false')
    expect(filas()).toHaveLength(1)
    expect(filas()[0]?.textContent).toContain('Persona 2')
    expect(subtitulo()).toBe('1 persona')
  })

  it('un torneo sin nadie: lo dice, con "Ver todos" que saca el filtro', async () => {
    window.history.replaceState(null, '', '/amigos/gente?torneo=s-otro')
    montar(muchas(3), 's-otro')
    expect(filas()).toHaveLength(0)
    expect(subtitulo()).toBe('0 personas')
    expect(host.textContent).toContain('Nadie para sugerir en este torneo.')
    expect(chips().every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true)
    await tocar(boton('Ver todos'))
    expect(filas()).toHaveLength(3)
    expect(chip('Todos')?.getAttribute('aria-pressed')).toBe('true')
    expect(window.location.search).toBe('')
  })

  it('sin nadie para sugerir: lo dice y no hay chips de torneo', () => {
    montar([])
    expect(subtitulo()).toBe('0 personas')
    expect(host.textContent).toContain('Nadie para sugerir por ahora.')
    expect(chips().map((b) => b.textContent)).toEqual(['Todos'])
  })
})

describe('de a 20', () => {
  it('las primeras 20 en el orden que llegan, con el formato de S11 y sin fechas', () => {
    montar(muchas(45))
    expect(filas()).toHaveLength(20)
    expect(filas()[0]?.textContent).toContain('Persona 1')
    expect(filas()[0]?.textContent).toContain('Los Pibes del Martes')
    expect(filas()[1]?.textContent).toContain('Los Pibes del Martes y 2 más')
    expect(filas()[2]?.textContent).toContain('Los Pibes del Martes y Copa del Jueves')
    expect(filas()[19]?.textContent).toContain('Persona 20')
    expect(host.textContent).not.toMatch(/fecha/)
  })

  it('"Mostrar más (20)" suma las siguientes 20; "Mostrar más (5)", las que quedan; después "Son todas: 45 personas"', async () => {
    montar(muchas(45))
    expect(host.textContent).not.toContain('Son todas')
    await tocar(boton('Mostrar más (20)'))
    expect(filas()).toHaveLength(40)
    expect(filas()[20]?.textContent).toContain('Persona 21')
    // El foco va a la primera nueva, así no se pierde cuando el botón se va.
    expect(document.activeElement).toBe(filas()[20])
    await tocar(boton('Mostrar más (5)'))
    expect(filas()).toHaveLength(45)
    expect(boton('Mostrar más (0)')).toBeUndefined()
    expect(host.textContent).not.toContain('Mostrar más')
    const fin = host.querySelector('[role="status"]')
    expect(fin?.textContent).toBe('Son todas: 45 personas')
  })

  it('con 20 o menos no hay "Mostrar más" ni el final', () => {
    montar(muchas(20))
    expect(filas()).toHaveLength(20)
    expect(host.textContent).not.toContain('Mostrar más')
    expect(host.textContent).not.toContain('Son todas')
  })

  it('cambiar de filtro vuelve a las primeras 20', async () => {
    montar(muchas(45))
    await tocar(boton('Mostrar más (20)'))
    await tocar(chip('Los Pibes del Martes'))
    await tocar(chip('Todos'))
    expect(filas()).toHaveLength(20)
    expect(boton('Mostrar más (20)')).toBeDefined()
  })
})

describe('Agregar', () => {
  it('chip de 34 a la vista y 44 para el dedo (S6); manda el pedido y queda "Enviado"', async () => {
    montar(muchas(3))
    const agregar = filas()[1]?.querySelector('button') as HTMLButtonElement
    expect(agregar.getAttribute('aria-label')).toBe('Agregar a Persona 2')
    expect(agregar.className.split(' ')).toEqual(expect.arrayContaining(['min-h-[34px]', 'after:-inset-y-[5px]']))
    await tocar(agregar)
    expect(actions.agregarAmigo).toHaveBeenCalledWith('p2')
    expect(filas()[1]?.textContent).toContain('Enviado')
    expect(filas()[1]?.querySelector('button')).toBeNull()
  })

  it('"Enviado" se queda al mostrar más, al filtrar y aunque el servidor ya no la sugiera', async () => {
    const gente = muchas(45)
    montar(gente)
    await tocar(filas()[2]?.querySelector('button'))
    expect(filas()[2]?.textContent).toContain('Enviado')

    // El servidor revalidó: la persona 3 ya está en "Pedidos enviados" y no viene más.
    montar(gente.filter((p) => p.playerId !== 'p3'))
    expect(filas()[2]?.textContent).toContain('Persona 3')
    expect(filas()[2]?.textContent).toContain('Enviado')

    await tocar(boton('Mostrar más (20)'))
    expect(filas()[2]?.textContent).toContain('Enviado')
    expect(filas()[3]?.querySelector('button')?.textContent).toBe('Agregar')

    await tocar(chip('Copa del Jueves'))
    expect(filas()[1]?.textContent).toContain('Persona 3')
    expect(filas()[1]?.textContent).toContain('Enviado')
    // 3, 6, ..., 45 y la 2: la 3 sigue en la foto.
    expect(filas()).toHaveLength(16)
  })
})
