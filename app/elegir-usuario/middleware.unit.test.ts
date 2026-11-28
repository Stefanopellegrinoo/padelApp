import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * El middleware (`middleware.ts`) con la puerta del @usuario (odd/tasks/amigos-faciles.md, S7):
 * quien tiene sesión y no eligió su @usuario va una sola vez a `/elegir-usuario?next=<adonde
 * iba>`, desde cualquier pantalla privada. Cuesta una RPC por pedido privado con sesión, y ni eso
 * cuando la cookie ya dice que ese usuario tiene uno. Las pantallas públicas, el login, el
 * registro, la propia pantalla y los envíos de formularios no pasan por la puerta.
 *
 * Vive acá y no al lado de `middleware.ts` porque `vitest.config.ts` sólo junta tests de `app/`,
 * `db/` y `core/`.
 */

let user: { id: string } | null = null
let username: { data: string | null; error: { message: string } | null } = { data: 'martinperez', error: null }
const rpc = vi.fn(async () => username)

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user } }) }, rpc }),
}))
vi.mock('@/db/legacy-fecha-redirect', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/db/legacy-fecha-redirect')>()
  return { ...real, legacyFechaRedirectTarget: vi.fn(async () => '/torneo/s-1/padel/fechas/3') }
})

const { middleware } = await import('@/middleware')

const COOKIE = 'padel-usuario'

function request(path: string, init: { method?: string; cookie?: string } = {}) {
  return new NextRequest(new URL(path, 'http://app.test'), {
    method: init.method ?? 'GET',
    headers: init.cookie === undefined ? {} : { cookie: init.cookie },
  })
}

beforeEach(() => {
  user = { id: 'u-martin' }
  username = { data: 'martinperez', error: null }
  rpc.mockClear()
})

const location = (response: Response) => response.headers.get('location')

describe('middleware: sin sesión (como antes)', () => {
  it('una pantalla privada manda al login con `next`', async () => {
    user = null
    const response = await middleware(request('/amigos'))
    expect(response.status).toBe(307)
    expect(location(response)).toBe('http://app.test/login?next=%2Famigos')
    expect(rpc).not.toHaveBeenCalled()
  })

  // T9, S9: el perfil, el tuyo y el de otro, es privado.
  it('el perfil, el tuyo y el de otro, manda al login con `next`', async () => {
    user = null
    for (const path of ['/perfil', '/perfil/p-1']) {
      const response = await middleware(request(path))
      expect(response.status, path).toBe(307)
      expect(location(response), path).toBe(`http://app.test/login?next=${encodeURIComponent(path)}`)
    }
  })

  it('lo que sólo empieza parecido a /perfil no es privado', async () => {
    user = null
    expect(location(await middleware(request('/perfiles')))).toBeNull()
  })

  it('una pública sigue, y Reglas del torneo también', async () => {
    user = null
    for (const path of ['/', '/registro', '/torneo/s-1/reglas']) {
      const response = await middleware(request(path))
      expect(location(response), path).toBeNull()
    }
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('middleware: la puerta del @usuario', () => {
  it('sin @usuario, una pantalla privada manda a elegirlo y después vuelve', async () => {
    username = { data: null, error: null }
    const response = await middleware(request('/torneos'))
    expect(response.status).toBe(307)
    expect(location(response)).toBe('http://app.test/elegir-usuario?next=%2Ftorneos')
    expect(rpc).toHaveBeenCalledWith('my_username')

    const conQuery = await middleware(request('/amigos/p-1?desde=amigos'))
    expect(location(conQuery)).toBe(
      `http://app.test/elegir-usuario?next=${encodeURIComponent('/amigos/p-1?desde=amigos')}`,
    )
  })

  it('vale para todas las privadas: torneos, amigos y el torneo', async () => {
    username = { data: null, error: null }
    for (const path of ['/torneos', '/amigos', '/amigos/gente', '/torneo/s-1/padel', '/torneo/s-1/fechas/3', '/perfil', '/perfil/p-1']) {
      expect(location(await middleware(request(path))), path).toContain('/elegir-usuario?next=')
    }
  })

  it('con @usuario sigue, y lo recuerda en una cookie httpOnly para no volver a preguntar', async () => {
    const response = await middleware(request('/torneos'))
    expect(location(response)).toBeNull()
    expect(rpc).toHaveBeenCalledTimes(1)
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain(`${COOKIE}=u-martin`)
    expect(cookie.toLowerCase()).toContain('httponly')
    expect(cookie.toLowerCase()).toContain('path=/')
  })

  it('con la cookie de ese mismo usuario no pregunta', async () => {
    username = { data: null, error: null }
    const response = await middleware(request('/torneos', { cookie: `${COOKIE}=u-martin` }))
    expect(location(response)).toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('la cookie de otro usuario no sirve', async () => {
    username = { data: null, error: null }
    const response = await middleware(request('/torneos', { cookie: `${COOKIE}=u-otro` }))
    expect(location(response)).toBe('http://app.test/elegir-usuario?next=%2Ftorneos')
  })

  it('no pasan por la puerta: la propia pantalla, entrar, el registro, el callback, Privacidad, borrar la cuenta, la landing', async () => {
    username = { data: null, error: null }
    for (const path of [
      '/elegir-usuario',
      '/elegir-usuario?next=%2Ftorneos',
      '/login',
      '/registro',
      '/auth/callback?code=x',
      '/privacidad',
      '/cuenta/borrar',
      '/',
      '/torneo/s-1/reglas',
      '/amigo/abc0000000000000000000000000000f',
    ]) {
      expect(location(await middleware(request(path))), path).toBeNull()
    }
    expect(rpc).not.toHaveBeenCalled()
  })

  it('un envío de formulario (server action, cerrar sesión) no pasa por la puerta', async () => {
    username = { data: null, error: null }
    const response = await middleware(request('/torneos', { method: 'POST' }))
    expect(location(response)).toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('si no se pudo preguntar, deja pasar y no guarda la cookie', async () => {
    username = { data: null, error: { message: 'se cayó' } }
    const response = await middleware(request('/torneos'))
    expect(location(response)).toBeNull()
    expect(response.headers.get('set-cookie') ?? '').not.toContain(COOKIE)
  })

  it('la fecha vieja sin disciplina sigue redirigiendo, después de la puerta', async () => {
    const response = await middleware(request('/torneo/s-1/fechas/3'))
    expect(response.status).toBe(308)
    expect(location(response)).toBe('http://app.test/torneo/s-1/padel/fechas/3')

    username = { data: null, error: null }
    const sinUsuario = await middleware(request('/torneo/s-1/fechas/3'))
    expect(location(sinUsuario)).toBe(`http://app.test/elegir-usuario?next=${encodeURIComponent('/torneo/s-1/fechas/3')}`)
  })
})
