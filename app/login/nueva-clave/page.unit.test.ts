import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
vi.mock('@/db/server', () => ({ serverClient: async () => ({ auth: { getUser } }) }))
vi.mock('@/app/auth/actions', () => ({ setNewPassword: vi.fn() }))

const { default: NuevaClavePage } = await import('./page')

async function render(): Promise<string> {
  return renderToStaticMarkup(await NuevaClavePage())
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Elegí tu contraseña nueva', () => {
  it('sin la sesión del link no muestra el formulario: manda a pedir otro', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null })

    const html = await render()

    expect(html).toContain('El link venció')
    expect(html).toContain('href="/login/recuperar"')
    expect(html).not.toContain('type="password"')
  })

  it('con la sesión del link muestra para qué cuenta es y el campo de la clave nueva', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'ana@mail.com' } }, error: null })

    const html = await render()

    expect(html).toContain('Elegí tu contraseña nueva')
    expect(html).toContain('Para ana@mail.com.')
    expect(html).toContain('autoComplete="new-password"')
    expect(html).toContain('Guardar y entrar')
  })
})
