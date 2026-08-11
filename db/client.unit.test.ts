import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWithFreshTokenRetry } from './client'

/**
 * El reintento existe para una carrera que no se puede reproducir a pedido: sólo
 * aparece con la máquina cargada, cuando el contenedor que valida el token lee
 * "ahora" una fracción por detrás del que lo firmó. Así que en vez de intentar
 * provocarla, se prueba el helper contra un `fetch` falso: lo que importa es que
 * reintente EXACTAMENTE ante `PGRST303` y ante nada más.
 */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubFetch(responses: Response[]): { calls: () => number } {
  let calls = 0
  vi.stubGlobal('fetch', () => {
    const next = responses[calls] ?? responses[responses.length - 1]
    calls += 1
    return Promise.resolve(next as Response)
  })
  return { calls: () => calls }
}

describe('fetchWithFreshTokenRetry', () => {
  it('retries once when the token is rejected as issued in the future', async () => {
    const fetches = stubFetch([
      jsonResponse(401, { code: 'PGRST303', message: 'JWT issued at future' }),
      jsonResponse(200, [{ id: 'season-1' }]),
    ])

    const response = await fetchWithFreshTokenRetry('http://example.test/rest/v1/seasons')

    expect(response.status).toBe(200)
    expect(fetches.calls()).toBe(2)
  })

  it('does not retry another 401, so a real permission failure still surfaces', async () => {
    const fetches = stubFetch([
      jsonResponse(401, { code: '42501', message: 'permission denied for table seasons' }),
    ])

    const response = await fetchWithFreshTokenRetry('http://example.test/rest/v1/seasons')

    expect(response.status).toBe(401)
    expect(fetches.calls()).toBe(1)
  })

  it('does not retry a non-401, even carrying that code', async () => {
    const fetches = stubFetch([jsonResponse(500, { code: 'PGRST303' })])

    const response = await fetchWithFreshTokenRetry('http://example.test/rest/v1/seasons')

    expect(response.status).toBe(500)
    expect(fetches.calls()).toBe(1)
  })

  it('leaves a successful response untouched and reads its body once', async () => {
    stubFetch([jsonResponse(200, [{ id: 'season-1' }])])

    const response = await fetchWithFreshTokenRetry('http://example.test/rest/v1/seasons')

    expect(response.status).toBe(200)
    // El helper clona antes de mirar el cuerpo: si consumiera el original, quien
    // llama recibiría un stream ya leído y fallaría al parsearlo.
    await expect(response.json()).resolves.toEqual([{ id: 'season-1' }])
  })

  it('gives up after one retry instead of looping', async () => {
    const fetches = stubFetch([
      jsonResponse(401, { code: 'PGRST303' }),
      jsonResponse(401, { code: 'PGRST303' }),
    ])

    const response = await fetchWithFreshTokenRetry('http://example.test/rest/v1/seasons')

    expect(response.status).toBe(401)
    expect(fetches.calls()).toBe(2)
  })
})
