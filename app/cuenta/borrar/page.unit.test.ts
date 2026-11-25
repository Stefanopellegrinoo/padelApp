// @vitest-environment jsdom
//
// Borrar la cuenta (`odd/tasks/borrar-cuenta.md`) con la cara del prototipo: el encabezado en
// bloque con "Volver" a Inicio, lo que se va y lo que queda, y la confirmación de siempre (tildar
// y apretar el botón rojo). La acción y sus mensajes de error no cambian.
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
vi.mock('@/db/server', () => ({ serverClient: async () => ({ auth: { getUser } }) }))
vi.mock('@/app/auth/actions', () => ({ deleteAccount: async () => {} }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`)
  },
}))

const { default: BorrarCuentaPage } = await import('./page')

async function pantalla(searchParams: { error?: string } = {}): Promise<HTMLElement> {
  const main = document.createElement('div')
  main.innerHTML = renderToStaticMarkup(await BorrarCuentaPage({ searchParams: Promise.resolve(searchParams) }))
  return main
}

beforeEach(() => {
  getUser.mockResolvedValue({ data: { user: { email: 'ana@padel.test' } } })
})

describe('/cuenta/borrar', () => {
  it('el título va en el bloque de arriba y Volver nombra su destino: Inicio', async () => {
    const page = await pantalla()
    const header = page.querySelector('header')!
    expect(header.querySelector('h1')?.textContent).toBe('Borrar tu cuenta')
    const volver = header.querySelector('a')!
    expect(volver.getAttribute('href')).toBe('/torneos')
    expect(volver.textContent).toBe('Inicio')
  })

  it('dice qué se va (con tu mail) y qué queda', async () => {
    const page = await pantalla()
    expect(page.textContent).toContain('ana@padel.test')
    expect([...page.querySelectorAll('h2')].map((h2) => h2.textContent)).toEqual(['Se borra', 'Queda'])
  })

  it('la confirmación de siempre: casilla obligatoria y el botón que borra, aparte y en rojo', async () => {
    const page = await pantalla()
    const form = page.querySelector('form')!
    const casilla = form.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(casilla.required).toBe(true)
    expect(casilla.closest('label')?.textContent).toBe('Entiendo que no se puede deshacer')
    const boton = form.querySelector('button[type="submit"]')!
    expect(boton.textContent).toBe('Borrar mi cuenta')
    expect(boton.className).toContain('text-live')
    expect(boton.className).toContain('min-h-[56px]')
    expect(page.querySelector('a[href="/privacidad"]')?.textContent).toBe('Política de privacidad')
  })

  it('el error de la acción se anuncia', async () => {
    const page = await pantalla({ error: 'Pasale la administración a otro jugador.' })
    expect(page.querySelector('[role="alert"]')?.textContent).toBe('Pasale la administración a otro jugador.')
  })

  it('sin sesión manda a entrar y vuelve acá', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null } })
    await expect(pantalla()).rejects.toThrow('redirect /login?next=/cuenta/borrar')
  })
})
