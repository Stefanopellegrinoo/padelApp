// @vitest-environment jsdom
//
// Sin red en el club (T17): qué cuenta como "sin conexión" y qué dice `app/error.tsx` cuando cae
// ahí por eso. La página de error vive en `app/`, pero se prueba acá, al lado de `sin-conexion.ts`,
// que es de donde saca la regla.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NO_SE_PUDO, SIN_CONEXION, mensajeDeFalla, pareceSinConexion } from './sin-conexion'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement('a', { href, ...rest }, children as never),
}))

const { default: PaginaDeError } = await import('@/app/error')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let enLinea: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  enLinea = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

afterEach(() => {
  enLinea.mockRestore()
})

describe('pareceSinConexion y mensajeDeFalla', () => {
  it('el fetch que falla como falla sin red, en los tres navegadores', () => {
    expect(pareceSinConexion(new TypeError('Failed to fetch'))).toBe(true)
    expect(pareceSinConexion(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(true)
    expect(pareceSinConexion(new TypeError('Load failed'))).toBe(true)
    expect(mensajeDeFalla(new TypeError('Failed to fetch'))).toBe(SIN_CONEXION)
  })

  it('un error cualquiera con red no es "sin conexión"', () => {
    expect(pareceSinConexion(new Error('boom'))).toBe(false)
    expect(pareceSinConexion(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(false)
    expect(mensajeDeFalla(new Error('boom'))).toBe(NO_SE_PUDO)
  })

  it('con el navegador sin red, cualquier falla es "sin conexión"', () => {
    enLinea.mockReturnValue(false)
    expect(pareceSinConexion(new Error('boom'))).toBe(true)
  })

  it('lo que Next tira a propósito (un redirect de la action) sigue de largo', () => {
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;push;/amigos;307;' })
    expect(() => mensajeDeFalla(redirect)).toThrow(redirect)
  })
})

describe('app/error.tsx', () => {
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

  const montar = (error: Error & { digest?: string }, reset = vi.fn()) => {
    act(() => root.render(createElement(PaginaDeError, { error, reset })))
    return reset
  }
  const boton = (texto: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === texto)

  it('sin red dice que no hay conexión (no lo del link del torneo) y ofrece "Probar de nuevo"', () => {
    enLinea.mockReturnValue(false)
    const reset = montar(new Error('boom'))
    expect(host.querySelector('h1')?.textContent).toBe('Sin conexión')
    expect(host.textContent).not.toContain('link de un torneo')
    act(() => boton('Probar de nuevo')?.click())
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('un fetch fallido también es "Sin conexión", aunque el navegador crea que hay red', () => {
    montar(new TypeError('Failed to fetch'))
    expect(host.querySelector('h1')?.textContent).toBe('Sin conexión')
    expect(host.textContent).not.toContain('link de un torneo')
  })

  it('cualquier otra falla sigue siendo "Algo se rompió", con su referencia', () => {
    montar(Object.assign(new Error('boom'), { digest: 'abc123' }))
    expect(host.querySelector('h1')?.textContent).toBe('Algo se rompió')
    expect(host.textContent).toContain('link de un torneo')
    expect(host.textContent).toContain('Referencia: abc123')
    expect(boton('Probar de nuevo')).toBeDefined()
  })
})
