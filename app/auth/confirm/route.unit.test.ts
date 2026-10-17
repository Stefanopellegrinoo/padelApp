import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

/**
 * El link del mail de recuperar contraseña. Se verifica con `token_hash` y no
 * con el `code` de PKCE: el `code` sólo se canjea en el mismo navegador que
 * pidió el mail, y en el celular el mail se abre casi siempre en otro (la app
 * de Gmail tiene su navegador propio).
 */

const verifyOtp = vi.fn()
vi.mock('@/db/server', () => ({ serverClient: async () => ({ auth: { verifyOtp } }) }))

const { GET } = await import('./route')

async function visit(query: string): Promise<string | null> {
  const response = await GET(new Request(`https://app.test/auth/confirm${query}`) as unknown as NextRequest)
  return response.headers.get('location')
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /auth/confirm', () => {
  it('con un link de recuperación válido deja la sesión y va a elegir la clave nueva', async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: null })

    const location = await visit('?token_hash=abc123&type=recovery')

    expect(verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 'abc123' })
    expect(location).toBe('/login/nueva-clave')
  })

  it('un link vencido o ya usado vuelve a pedir otro', async () => {
    verifyOtp.mockResolvedValue({ data: null, error: { message: 'expired' } })

    const location = await visit('?token_hash=abc123&type=recovery')

    expect(location).toBe('/login/recuperar?error=link')
  })

  it('sin token no llama a Supabase', async () => {
    const location = await visit('?type=recovery')

    expect(verifyOtp).not.toHaveBeenCalled()
    expect(location).toBe('/login/recuperar?error=link')
  })

  it('sólo acepta links de recuperación', async () => {
    const location = await visit('?token_hash=abc123&type=signup')

    expect(verifyOtp).not.toHaveBeenCalled()
    expect(location).toBe('/login/recuperar?error=link')
  })

  it('ignora un next del link: no hay redirector abierto', async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: null })

    const location = await visit('?token_hash=abc123&type=recovery&next=https://otro-sitio.com')

    expect(location).toBe('/login/nueva-clave')
  })
})
