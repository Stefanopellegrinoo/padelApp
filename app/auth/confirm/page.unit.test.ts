import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * La página a la que lleva el link del mail. Abrirla NO puede gastar el link:
 * los escáneres de correo (Outlook Safe Links, antivirus) abren los links antes
 * que la persona, y si el GET verificara el token, a la persona le llegaría ya
 * vencido. El token se usa recién con el botón (`confirmRecovery`).
 */

const verifyOtp = vi.fn()
vi.mock('@/db/server', () => ({ serverClient: async () => ({ auth: { verifyOtp } }) }))
vi.mock('@/app/auth/actions', () => ({ confirmRecovery: vi.fn() }))

const { default: ConfirmPage } = await import('./page')

async function render(params: Record<string, string>): Promise<string> {
  return renderToStaticMarkup(await ConfirmPage({ searchParams: Promise.resolve(params) }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('/auth/confirm', () => {
  it('con un link de recuperación muestra el botón, con el token adentro, sin gastarlo', async () => {
    const html = await render({ token_hash: 'pkce_abc', type: 'recovery' })

    expect(html).toContain('Elegir contraseña nueva')
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="token_hash"[^>]*value="pkce_abc"/)
    expect(verifyOtp).not.toHaveBeenCalled()
  })

  it('sin token manda a pedir otro link', async () => {
    const html = await render({ type: 'recovery' })

    expect(html).toContain('El link venció')
    expect(html).toContain('href="/login/recuperar"')
    expect(html).not.toContain('name="token_hash"')
  })

  it('sólo acepta links de recuperación', async () => {
    const html = await render({ token_hash: 'pkce_abc', type: 'signup' })

    expect(html).toContain('El link venció')
    expect(html).not.toContain('name="token_hash"')
  })
})
