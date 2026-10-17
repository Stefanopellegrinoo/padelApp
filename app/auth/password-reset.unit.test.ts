import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Recuperar contraseña: las dos server actions con el cliente de Supabase
 * mockeado. Lo que se cuida acá es lo que no se ve en pantalla: que pedir el
 * link no confirme qué mails tienen cuenta, y que guardar la clave nueva sólo
 * ande con la sesión que deja el link del mail.
 */

const auth = {
  resetPasswordForEmail: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
}

vi.mock('@/db/server', () => ({ serverClient: async () => ({ auth }) }))

const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT ${path}`)
})
vi.mock('next/navigation', () => ({ redirect: (path: string) => redirect(path) }))

const { requestPasswordReset, setNewPassword } = await import('./actions')

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('requestPasswordReset', () => {
  const initial = { error: null, sent: false }

  it('rechaza un mail mal escrito sin llamar a Supabase', async () => {
    const state = await requestPasswordReset(initial, form({ email: 'sin-arroba' }))

    expect(state).toEqual({ error: 'Escribí un mail válido, con @ y dominio.', sent: false })
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled()
  })

  it('pide el mail a Supabase con el mail sin espacios y dice que lo mandó', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })

    const state = await requestPasswordReset(initial, form({ email: '  ana@mail.com ' }))

    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('ana@mail.com')
    expect(state).toEqual({ error: null, sent: true })
  })

  it('avisa que espere si se pidieron demasiados links', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ data: null, error: { status: 429, message: 'rate limit' } })

    const state = await requestPasswordReset(initial, form({ email: 'ana@mail.com' }))

    expect(state).toEqual({ error: 'Pediste muchos links seguidos. Esperá un rato y probá de nuevo.', sent: false })
  })

  it('si el mail no sale, lo dice en vez de fingir que salió', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ data: null, error: { status: 500, message: 'smtp' } })

    const state = await requestPasswordReset(initial, form({ email: 'ana@mail.com' }))

    expect(state).toEqual({ error: 'No pudimos mandar el mail. Probá de nuevo en un rato.', sent: false })
  })
})

describe('setNewPassword', () => {
  const initial = { error: null }

  it('pide mínimo 6 caracteres sin llamar a Supabase', async () => {
    const state = await setNewPassword(initial, form({ password: '12345' }))

    expect(state).toEqual({ error: 'Mínimo 6 caracteres.' })
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it('sin la sesión del link no cambia nada y manda a pedir otro', async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: null })

    const state = await setNewPassword(initial, form({ password: 'nueva123' }))

    expect(state).toEqual({ error: 'El link venció. Pedí uno nuevo.' })
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it('avisa si la clave nueva es igual a la anterior', async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    auth.updateUser.mockResolvedValue({ data: null, error: { code: 'same_password', message: 'same' } })

    const state = await setNewPassword(initial, form({ password: 'vieja123' }))

    expect(state).toEqual({ error: 'Tiene que ser distinta de la que tenías.' })
  })

  it('si Supabase falla por otra cosa, lo dice', async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    auth.updateUser.mockResolvedValue({ data: null, error: { code: 'unexpected_failure', message: 'boom' } })

    const state = await setNewPassword(initial, form({ password: 'nueva123' }))

    expect(state).toEqual({ error: 'No pudimos guardar la contraseña. Probá de nuevo.' })
  })

  it('guarda la clave nueva y entra directo a Mis torneos', async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    auth.updateUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })

    await expect(setNewPassword(initial, form({ password: 'nueva123' }))).rejects.toThrow('NEXT_REDIRECT /torneos')
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'nueva123' })
  })
})
