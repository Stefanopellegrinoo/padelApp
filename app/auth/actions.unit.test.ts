import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `signUp` con el @usuario (odd/tasks/amigos-faciles.md, S7): se valida también en el servidor y
 * viaja como `username` en el metadata del alta, que es lo que lee el trigger (0119). Uno inválido
 * o ya tomado vuelve con el motivo, sin crear la cuenta.
 */

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`)
})
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url) }))

const authSignUp = vi.fn(async () => ({ error: null }))
const authSignIn = vi.fn(async () => ({ error: null }))
let available: { data: boolean | null; error: { message: string } | null } = { data: true, error: null }
let mine: { data: string | null; error: { message: string } | null } = { data: 'martinperez', error: null }
const rpc = vi.fn(async (name: string) => (name === 'my_username' ? mine : available))
vi.mock('@/db/server', () => ({
  serverClient: async () => ({ auth: { signUp: authSignUp, signInWithPassword: authSignIn }, rpc }),
}))

const { signIn, signUp } = await import('./actions')

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

const VALIDO = {
  displayName: 'Martín Pérez',
  username: '@MartinPerez',
  email: 'martin@example.com',
  password: 'pibesdelmartes',
  next: '/amigo/abc',
}

beforeEach(() => {
  vi.clearAllMocks()
  available = { data: true, error: null }
  mine = { data: 'martinperez', error: null }
})

describe('signUp', () => {
  it('crea la cuenta con el @usuario normalizado en el metadata y vuelve a `next`', async () => {
    await expect(signUp({ error: null }, form(VALIDO))).rejects.toThrow('NEXT_REDIRECT /amigo/abc')
    expect(rpc).toHaveBeenCalledWith('username_available', { p_username: 'martinperez' })
    expect(authSignUp).toHaveBeenCalledWith({
      email: 'martin@example.com',
      password: 'pibesdelmartes',
      options: { data: { display_name: 'Martín Pérez', username: 'martinperez' } },
    })
  })

  it('un @usuario inválido vuelve con el motivo y no crea nada', async () => {
    expect(await signUp({ error: null }, form({ ...VALIDO, username: 'ab' }))).toEqual({
      error: 'Usá de 3 a 20 letras, números, punto o guion bajo, empezando con una letra o un número.',
    })
    expect(await signUp({ error: null }, form({ ...VALIDO, username: '' }))).toEqual({ error: 'Elegí tu @usuario.' })
    expect(authSignUp).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('uno ya tomado vuelve con "Ese @usuario ya está en uso." y no crea nada', async () => {
    available = { data: false, error: null }
    expect(await signUp({ error: null }, form(VALIDO))).toEqual({ error: 'Ese @usuario ya está en uso.' })
    expect(authSignUp).not.toHaveBeenCalled()
  })

  it('si no se pudo revisar, igual crea la cuenta: el alta nunca falla por el @usuario', async () => {
    available = { data: null, error: { message: 'se cayó' } }
    await expect(signUp({ error: null }, form(VALIDO))).rejects.toThrow('NEXT_REDIRECT /amigo/abc')
    expect(authSignUp).toHaveBeenCalledTimes(1)
  })

  it('los errores de siempre siguen igual: el nombre se valida antes', async () => {
    expect(await signUp({ error: null }, form({ ...VALIDO, displayName: '' }))).toEqual({ error: 'Escribí tu nombre.' })
    expect(rpc).not.toHaveBeenCalled()
  })
})

/**
 * La redirección de una server action se dibuja en la MISMA respuesta del POST: el middleware no
 * ve un GET a `/torneos` y no puede mandar a elegir el @usuario. Por eso entrar ya decide acá: sin
 * @usuario, primero la pantalla única, que después sigue a donde ibas.
 */
describe('después de entrar, sin @usuario', () => {
  it('signIn va a elegirlo y después a `next`', async () => {
    mine = { data: null, error: null }
    await expect(
      signIn({ error: null }, form({ email: 'martin@example.com', password: 'pibesdelmartes', next: '/amigos' })),
    ).rejects.toThrow(`NEXT_REDIRECT /elegir-usuario?next=${encodeURIComponent('/amigos')}`)
  })

  it('signIn sin `next` va a elegirlo y después a Inicio', async () => {
    mine = { data: null, error: null }
    await expect(
      signIn({ error: null }, form({ email: 'martin@example.com', password: 'pibesdelmartes', next: '/' })),
    ).rejects.toThrow(`NEXT_REDIRECT /elegir-usuario?next=${encodeURIComponent('/torneos')}`)
  })

  it('signIn con @usuario sigue derecho, como siempre', async () => {
    await expect(
      signIn({ error: null }, form({ email: 'martin@example.com', password: 'pibesdelmartes', next: '/' })),
    ).rejects.toThrow('NEXT_REDIRECT /torneos')
  })

  it('signUp cuyo @usuario otro tomó en el medio va a elegir uno', async () => {
    mine = { data: null, error: null }
    await expect(signUp({ error: null }, form(VALIDO))).rejects.toThrow(
      `NEXT_REDIRECT /elegir-usuario?next=${encodeURIComponent('/amigo/abc')}`,
    )
  })

  it('si no se pudo preguntar, sigue derecho: la puerta del middleware lo agarra después', async () => {
    mine = { data: null, error: { message: 'se cayó' } }
    await expect(
      signIn({ error: null }, form({ email: 'martin@example.com', password: 'pibesdelmartes', next: '/amigos' })),
    ).rejects.toThrow('NEXT_REDIRECT /amigos')
  })

  it('con credenciales malas no pregunta nada', async () => {
    authSignIn.mockResolvedValueOnce({ error: { message: 'Invalid login' } } as never)
    expect(
      await signIn({ error: null }, form({ email: 'martin@example.com', password: 'mala', next: '/' })),
    ).toEqual({ error: 'Mail o contraseña incorrectos.' })
    expect(rpc).not.toHaveBeenCalled()
  })
})
