import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { friendInvitePreview, type FriendInvitePreview } from '@/db/friends'

/**
 * `/amigo/[token]`, lo que ve quien abre un link de amistad (odd/tasks/amigos-faciles.md, S5):
 * sin sesión va al registro y vuelve; con sesión ve quién lo invita y "Sumarme como amigo". Ya
 * amigos va directo al historial; el propio link avisa; un link cambiado dice que ya no anda.
 */

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`)
})
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url) }))

let user: { id: string } | null = { id: 'u-juampi' }
vi.mock('@/db/server', () => ({
  serverClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
}))

vi.mock('@/db/friends', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/db/friends')>()
  return { ...real, friendInvitePreview: vi.fn() }
})

vi.mock('./actions', () => ({ sumarmeComoAmigo: vi.fn() }))

const TOKEN = 'abc0000000000000000000000000000f'
const MARTIN: FriendInvitePreview = { inviterId: 'p-martin', displayName: 'Martín Pérez', relation: 'none' }

beforeEach(() => {
  user = { id: 'u-juampi' }
  redirect.mockClear()
  vi.mocked(friendInvitePreview).mockReset().mockResolvedValue(MARTIN)
})

async function render(searchParams: { error?: string } = {}): Promise<string> {
  const { default: AmigoLinkPage } = await import('./page')
  return renderToStaticMarkup(
    await AmigoLinkPage({ params: Promise.resolve({ token: TOKEN }), searchParams: Promise.resolve(searchParams) }),
  )
}

describe('/amigo/[token]', () => {
  it('sin sesión va al registro, que después vuelve acá, sin mirar el link', async () => {
    user = null
    await expect(render()).rejects.toThrow(`NEXT_REDIRECT /registro?next=/amigo/${TOKEN}`)
    expect(friendInvitePreview).not.toHaveBeenCalled()
  })

  it('muestra quién invita, qué cambia siendo amigos, "Sumarme como amigo" y "Ahora no"', async () => {
    const html = await render()
    expect(friendInvitePreview).toHaveBeenCalledWith(expect.anything(), TOKEN)
    expect(html).toContain('Link de amistad')
    expect(html).toMatch(/<h1[^>]*>Martín Pérez<\/h1>/)
    expect(html).toContain('te invita a ser amigos')
    expect(html).toMatch(/<h2[^>]*>Siendo amigos<\/h2>/)
    expect(html).toContain('Ven el historial de lo que jueguen')
    expect(html).toContain('En torneos y en partidos sueltos')
    expect(html).toContain('Cargan partidos entre ustedes')
    expect(html).toContain('Sin armar un torneo')
    expect(html).toMatch(/<form[^>]*>.*<input type="hidden" name="token" value="abc0000000000000000000000000000f"\/>.*Sumarme como amigo<\/button><\/form>/)
    expect(html).toMatch(/<a[^>]*href="\/torneos"[^>]*>Ahora no<\/a>/)
  })

  it('con un pedido pendiente entre los dos, también ofrece sumarse', async () => {
    vi.mocked(friendInvitePreview).mockResolvedValueOnce({ ...MARTIN, relation: 'pending' })
    expect(await render()).toContain('Sumarme como amigo')
  })

  it('si ya son amigos, va directo al historial', async () => {
    vi.mocked(friendInvitePreview).mockResolvedValueOnce({ ...MARTIN, relation: 'friends' })
    await expect(render()).rejects.toThrow('NEXT_REDIRECT /amigos/p-martin?desde=amigos')
  })

  it('el propio link avisa en vez de ofrecer el botón', async () => {
    vi.mocked(friendInvitePreview).mockResolvedValueOnce({ ...MARTIN, relation: 'self' })
    const html = await render()
    expect(html).toContain('Es tu propio link')
    expect(html).toContain('Mandáselo a quien quieras sumar.')
    expect(html).not.toContain('Sumarme como amigo')
    expect(html).toMatch(/<a[^>]*href="\/amigos"[^>]*>Ir a Amigos<\/a>/)
  })

  it('un link cambiado o que no existe: "Este link ya no anda, pedile uno nuevo"', async () => {
    vi.mocked(friendInvitePreview).mockResolvedValueOnce(null)
    const html = await render()
    expect(html).toContain('Este link ya no anda, pedile uno nuevo')
    expect(html).not.toContain('Sumarme como amigo')
    expect(html).toMatch(/<a[^>]*href="\/torneos"[^>]*>Volver al inicio<\/a>/)
  })

  it('si sumarse falló, dice por qué arriba del botón', async () => {
    const html = await render({ error: 'No se pudo sumarte como amigo.' })
    expect(html).toMatch(/role="alert"[^>]*>No se pudo sumarte como amigo\.<\/p>/)
  })
})
