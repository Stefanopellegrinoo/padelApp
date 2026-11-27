import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { firstFreeUsername, myDisplayName, myUsername } from '@/db/usuario'

/**
 * `/elegir-usuario`, la pantalla única (odd/tasks/amigos-faciles.md, S7; lámina 07, paso 3): para
 * quien tiene sesión y todavía no eligió su @usuario. Viene con una sugerencia libre sacada del
 * nombre y no se saltea: no hay "Ahora no" ni Volver. Quien ya lo eligió sigue de largo.
 */

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`)
})
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url) }))

let user: { id: string } | null = { id: 'u-martin' }
vi.mock('@/db/server', () => ({
  serverClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
}))
vi.mock('@/db/usuario', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/db/usuario')>()
  return { ...real, myUsername: vi.fn(), myDisplayName: vi.fn(), firstFreeUsername: vi.fn() }
})
vi.mock('./actions', () => ({ elegirUsuario: vi.fn() }))
vi.mock('@/app/auth/usuario-actions', () => ({ revisarUsuario: vi.fn() }))

beforeEach(() => {
  user = { id: 'u-martin' }
  redirect.mockClear()
  vi.mocked(myUsername).mockReset().mockResolvedValue(null)
  vi.mocked(myDisplayName).mockReset().mockResolvedValue('Martín Pérez')
  vi.mocked(firstFreeUsername).mockReset().mockResolvedValue('martinperez')
})

async function render(searchParams: { next?: string } = {}): Promise<string> {
  const { default: ElegirUsuarioPage } = await import('./page')
  return renderToStaticMarkup(await ElegirUsuarioPage({ searchParams: Promise.resolve(searchParams) }))
}

describe('/elegir-usuario', () => {
  it('saluda, explica y trae la sugerencia libre ya escrita', async () => {
    const html = await render({ next: '/amigos' })
    expect(firstFreeUsername).toHaveBeenCalledWith(expect.anything(), 'Martín Pérez')
    expect(html).toContain('Hola, Martín')
    expect(html).toMatch(/<h1[^>]*>Elegí tu @usuario<\/h1>/)
    expect(html).toContain('Es como te van a encontrar tus amigos. Lo elegís una sola vez.')
    expect(html).toMatch(/<label[^>]*for="username"[^>]*>@usuario<\/label>/)
    expect(html).toMatch(/<input[^>]*id="username"[^>]*value="martinperez"/)
    expect(html).toContain('3 a 20 caracteres: letras, números, punto y guion bajo. No se puede cambiar después.')
    expect(html).toContain('Usar @martinperez')
    expect(html).toContain('Es un paso obligatorio, una sola vez. Después entrás directo.')
  })

  it('no se puede saltear: no hay "Ahora no" ni Volver, ni un link para irse', async () => {
    const html = await render()
    expect(html).not.toContain('Ahora no')
    // El único "Volver" es el de la hoja "¿Seguro?", que vuelve al campo, no a otra pantalla.
    const [pantalla, hoja] = html.split('<dialog')
    expect(pantalla).not.toContain('Volver')
    expect(hoja).toContain('Volver')
    expect(html).not.toMatch(/<a[^>]*href=/)
  })

  it('quien ya lo eligió sigue a `next`, o a Inicio', async () => {
    vi.mocked(myUsername).mockResolvedValue('martinperez')
    await expect(render({ next: '/amigos/p-1?desde=amigos' })).rejects.toThrow(
      'NEXT_REDIRECT /amigos/p-1?desde=amigos',
    )
    await expect(render()).rejects.toThrow('NEXT_REDIRECT /torneos')
    await expect(render({ next: 'https://otro-sitio.com' })).rejects.toThrow('NEXT_REDIRECT /torneos')
    expect(firstFreeUsername).not.toHaveBeenCalled()
  })

  it('sin sesión va a entrar, y vuelve a donde iba', async () => {
    user = null
    await expect(render({ next: '/amigos' })).rejects.toThrow(`NEXT_REDIRECT /login?next=${encodeURIComponent('/amigos')}`)
    expect(myUsername).not.toHaveBeenCalled()
  })
})
