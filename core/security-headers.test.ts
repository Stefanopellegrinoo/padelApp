import { describe, expect, it } from 'vitest'
import { securityHeaders } from './security-headers'

const prod = { isProd: true, supabaseUrl: 'https://abc.supabase.co' }

function value(headers: ReturnType<typeof securityHeaders>, key: string): string | undefined {
  return headers.find((h) => h.key === key)?.value
}

describe('securityHeaders', () => {
  it('manda las cabeceras de seguridad de base', () => {
    const headers = securityHeaders(prod)
    expect(value(headers, 'X-Frame-Options')).toBe('DENY')
    expect(value(headers, 'X-Content-Type-Options')).toBe('nosniff')
    expect(value(headers, 'Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(value(headers, 'Permissions-Policy')).toContain('camera=()')
  })

  it('la CSP permite lo propio y a Supabase para connect', () => {
    const csp = value(securityHeaders(prod), 'Content-Security-Policy')!
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("connect-src 'self' https://abc.supabase.co")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
  })

  it('la CSP no deja pasar scripts de afuera (script-src sin dominios externos)', () => {
    const csp = value(securityHeaders(prod), 'Content-Security-Policy')!
    const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src '))!
    expect(scriptSrc).toBe("script-src 'self' 'unsafe-inline'")
    // Sin 'unsafe-eval' en producción: no queda código que evalúe.
    expect(scriptSrc).not.toContain('unsafe-eval')
    // Ningún dominio externo en script-src: scripts sólo de la propia app.
    expect(scriptSrc).not.toMatch(/https?:/)
  })

  it('sólo suma HSTS en producción', () => {
    expect(value(securityHeaders(prod), 'Strict-Transport-Security')).toBe(
      'max-age=63072000; includeSubDomains; preload',
    )
    expect(value(securityHeaders({ isProd: false, supabaseUrl: null }), 'Strict-Transport-Security')).toBeUndefined()
  })

  it('permite eval sólo en dev, donde el HMR lo necesita', () => {
    const devCsp = value(securityHeaders({ isProd: false, supabaseUrl: null }), 'Content-Security-Policy')!
    expect(devCsp).toContain("'unsafe-eval'")
  })

  it('sin URL de Supabase, connect-src queda en self y no rompe el parse', () => {
    const csp = value(securityHeaders({ isProd: true, supabaseUrl: null }), 'Content-Security-Policy')!
    expect(csp).toContain("connect-src 'self'")
    expect(csp).not.toContain('null')
  })
})
