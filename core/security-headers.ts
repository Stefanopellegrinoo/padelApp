export type SecurityHeader = { key: string; value: string }

/**
 * Cabeceras de seguridad HTTP para toda la app.
 *
 * Viven en un módulo propio y no adentro de `next.config.ts` para poder
 * testearlas: una CSP mal escrita no tira al build —simplemente bloquea la app
 * en producción—, así que el único momento en que un error acá aparece es
 * cuando ya es tarde. La función es pura (no importa `next`), recibe lo que
 * cambia entre entornos y devuelve las cabeceras.
 *
 * La CSP se arma pensando en lo que la app REALMENTE carga (verificado): todo
 * es `self` salvo las llamadas a Supabase. Los scripts de Next van inline
 * (`'unsafe-inline'`), la fuente es self-hosted (`next/font`), no hay imágenes
 * externas ni `supabase.storage`. `'unsafe-eval'` sólo en dev: es lo que el HMR
 * de Next necesita, y en producción no queda código que use `eval`.
 */
export function securityHeaders(options: {
  isProd: boolean
  supabaseUrl?: string | null
}): SecurityHeader[] {
  const { isProd, supabaseUrl } = options
  const origin = supabaseOrigin(supabaseUrl)
  const connectSrc = ["'self'", origin].filter(Boolean).join(' ')
  const scriptSrc = `'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`
  const csp = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    `connect-src ${connectSrc}`,
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')

  const headers: SecurityHeader[] = [
    { key: 'Content-Security-Policy', value: csp },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ]

  // HSTS sólo en producción: en local la app corre por HTTP, y forzar HTTPS ahí
  // dejaría al navegador del dev pidiendo `https://localhost` para siempre.
  if (isProd) {
    headers.push({
      key: 'Strict-Transport-Security',
      value: 'max-age=63072000; includeSubDomains; preload',
    })
  }

  return headers
}

/** El origin de Supabase para `connect-src`, o `null` si la URL falta o no parsea. */
function supabaseOrigin(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}
