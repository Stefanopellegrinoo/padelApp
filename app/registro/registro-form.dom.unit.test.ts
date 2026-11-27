// @vitest-environment jsdom
//
// El @usuario en el registro (odd/tasks/amigos-faciles.md, S7; lámina 07, pasos 1 y 2): el campo
// con la @ puesta, la regla, "está libre" / "ya está en uso" mientras escribís, dos libres que se
// ponen con un toque, y "Crear cuenta" frenado mientras el que escribiste no se puede usar.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UsernameStatus } from '@/db/usuario'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement('a', { href, ...rest }, children as never),
}))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}))
vi.mock('@/app/auth/actions', () => ({ signUp: vi.fn(async () => ({ error: null })) }))
vi.mock('@/app/auth/usuario-actions', () => ({ revisarUsuario: vi.fn() }))
vi.mock('@/db/client', () => ({ browserClient: vi.fn() }))

const { revisarUsuario } = await import('@/app/auth/usuario-actions')
const { default: RegistroForm } = await import('./registro-form')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const REGLA = '3 a 20 caracteres: letras, números, punto y guion bajo. No se puede cambiar después.'
const ESTADOS: Record<string, UsernameStatus> = {
  martinperez: { kind: 'libre', username: 'martinperez', message: '@martinperez está libre' },
  'nico.arias2': { kind: 'libre', username: 'nico.arias2', message: '@nico.arias2 está libre' },
  'nico.arias': {
    kind: 'en-uso',
    username: 'nico.arias',
    message: '@nico.arias ya está en uso',
    suggestions: ['nico.arias2', 'nicoarias.padel'],
  },
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  vi.mocked(revisarUsuario)
    .mockReset()
    .mockImplementation(async (raw: string) => ESTADOS[raw] ?? { kind: 'vacio' })
  act(() => root.render(createElement(RegistroForm)))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const campo = (id: string) => host.querySelector(`#${id}`) as HTMLInputElement
const boton = (texto: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto) as HTMLButtonElement | undefined
const aviso = () => host.querySelector('#username-aviso') as HTMLElement

function escribir(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Lo que tarda el campo en preguntar (espera a que dejes de escribir) y la respuesta. */
const esperar = () => act(() => new Promise((resolve) => setTimeout(resolve, 450)))

function completarElResto() {
  escribir(campo('displayName'), 'Martín Pérez')
  escribir(campo('email'), 'martin@example.com')
  escribir(campo('password'), 'pibesdelmartes')
}

describe('registro: @usuario', () => {
  it('el campo tiene la @ puesta, va entre el nombre y el mail, y dice la regla', () => {
    const label = host.querySelector('label[for="username"]')
    expect(label?.textContent).toBe('@usuario')
    const input = campo('username')
    expect(input.name).toBe('username')
    expect(input.getAttribute('autocapitalize')).toBe('none')
    expect(input.maxLength).toBe(20)
    expect(input.parentElement?.querySelector('[aria-hidden="true"]')?.textContent).toBe('@')
    expect(host.textContent).toContain(REGLA)

    const ids = [...host.querySelectorAll('input:not([type="hidden"])')].map((el) => el.id)
    expect(ids).toEqual(['displayName', 'username', 'email', 'password'])
  })

  it('libre: "@martinperez está libre", y se puede crear la cuenta', async () => {
    completarElResto()
    escribir(campo('username'), 'MartinPerez')
    expect(campo('username').value).toBe('martinperez')
    await esperar()

    expect(revisarUsuario).toHaveBeenLastCalledWith('martinperez')
    expect(aviso().textContent).toBe('@martinperez está libre')
    expect(aviso().getAttribute('aria-live')).toBe('polite')
    expect(campo('username').getAttribute('aria-invalid')).toBe('false')
    expect(boton('Crear cuenta')?.disabled).toBe(false)
  })

  it('en uso: lo dice, ofrece dos libres, y "Crear cuenta" queda frenado', async () => {
    completarElResto()
    escribir(campo('username'), 'nico.arias')
    await esperar()

    expect(aviso().textContent).toBe('@nico.arias ya está en uso')
    expect(campo('username').getAttribute('aria-invalid')).toBe('true')
    const grupo = host.querySelector('[role="group"][aria-label="Libres para usar"]')
    expect([...(grupo?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual([
      '@nico.arias2',
      '@nicoarias.padel',
    ])
    expect(boton('Crear cuenta')?.disabled).toBe(true)
  })

  it('un toque en una libre la pone en el campo', async () => {
    completarElResto()
    escribir(campo('username'), 'nico.arias')
    await esperar()

    act(() => boton('@nico.arias2')!.click())
    await esperar()

    expect(campo('username').value).toBe('nico.arias2')
    expect(aviso().textContent).toBe('@nico.arias2 está libre')
    expect(host.querySelector('[aria-label="Libres para usar"]')).toBeNull()
    expect(boton('Crear cuenta')?.disabled).toBe(false)
  })

  it('un formato inválido lo dice enseguida, sin preguntarle a la base', async () => {
    completarElResto()
    escribir(campo('username'), '.ni')
    await esperar()

    expect(aviso().textContent).toBe(
      'Usá de 3 a 20 letras, números, punto o guion bajo, empezando con una letra o un número.',
    )
    expect(revisarUsuario).not.toHaveBeenCalled()
    expect(boton('Crear cuenta')?.disabled).toBe(true)
  })

  it('sin @usuario no se puede crear la cuenta', () => {
    completarElResto()
    expect(aviso().textContent).toBe('')
    expect(boton('Crear cuenta')?.disabled).toBe(true)
  })
})
