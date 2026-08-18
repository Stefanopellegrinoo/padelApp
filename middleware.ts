import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { fetchWithFreshTokenRetry, type Client } from './db/client'
import { legacyFechaRedirectTarget, parseLegacyFechaPath } from './db/legacy-fecha-redirect'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      global: { fetch: fetchWithFreshTokenRetry },
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(toSet: { name: string; value: string; options: CookieOptions }[]) {
          for (const { name, value } of toSet) request.cookies.set(name, value)
          response = NextResponse.next({ request })
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options)
        },
      },
    },
  )

  // Refresca el token vencido y reescribe la cookie. Sin esta llamada, la
  // sesión se muere sola en cuanto expira el access token.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user === null && isPrivatePath(request.nextUrl.pathname)) {
    const login = request.nextUrl.clone()
    login.pathname = '/login'
    login.search = ''
    login.searchParams.set('next', request.nextUrl.pathname)

    // Las cookies que `setAll` acaba de escribir viven en `response`, no en la
    // request: si se devuelve un redirect nuevo y pelado, se pierden. Acá casi
    // siempre no hay ninguna —sin usuario no hubo refresco— pero un refresh
    // token vencido SÍ deja cookies de limpieza, y perderlas deja al navegador
    // reintentando con una sesión muerta en cada navegación.
    const redirect = NextResponse.redirect(login)
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie)
    return redirect
  }

  // REQ-NR-5: PnP-1000 tiene bookmarkeada `/torneo/{id}/fechas/{n}` (sin
  // disciplina, PR 10). Se resuelve ACÁ y no en un `page.tsx` de esa ruta:
  // así el archivo viejo deja de existir del todo (en vez de reemplazarse
  // por un stub) y la mudanza de `fechas/[n]/` a `[disciplina]/fechas/[n]/`
  // es un rename de árbol limpio. Siempre después del gate de login: para
  // este patrón `isPrivatePath` ya da `true`, así que sin sesión ya se
  // volvió arriba.
  //
  // `NextResponse.redirect(url, 308)` es explícito: el segundo argumento
  // ES el status code (no un objeto `init` con otra cosa) — verificado en
  // `node_modules/next/dist/server/web/spec-extension/response.js`, cuyo
  // default sin el segundo argumento es 307, no 308.
  // W15 (verify-report ronda 5): `legacyFechaRedirectTarget` tira `EdgeError`
  // cuando la temporada no resuelve (RLS sin fila) — antes ese throw salía
  // del middleware entero y reemplazaba `app/error.tsx` por el 500 pelado de
  // Next. El propio módulo ya trata "no hay a dónde redirigir" como `null`
  // sin drama (línea de arriba); una excepción es el mismo caso — mejor
  // esfuerzo, sin bloquear el resto del request si falla.
  const legacy = parseLegacyFechaPath(request.nextUrl.pathname)
  if (legacy !== null) {
    try {
      const target = await legacyFechaRedirectTarget(supabase as unknown as Client, legacy)
      if (target !== null) {
        const redirectUrl = request.nextUrl.clone()
        redirectUrl.pathname = target
        return NextResponse.redirect(redirectUrl, 308)
      }
    } catch {
      // best-effort: cae a la resolución normal (404/error.tsx del render).
    }
  }

  return response
}

/**
 * Las pantallas del torneo son privadas y las frena RLS, que sin sesión no
 * devuelve una fila y deja a `seasonHeader` tirando `EdgeError`. Eso, sin nadie
 * que lo agarre, es la página blanca de Next en inglés — y el link del torneo
 * es justo el que alguien pega en el grupo.
 *
 * La excepción es Reglas, que es pública a propósito (`ui-screens.md` §11): se
 * comparte por link y se lee sin cuenta. Va por `season_public_rules`, que no
 * necesita sesión.
 *
 * **`/torneos` también entra.** Acá decía que no, que "ya resuelve el caso sin
 * sesión con su estado vacío", y era cierto cuando se escribió: sin sesión RLS
 * devolvía cero filas y la pantalla dibujaba su estado vacío. Lo cambió
 * `0009_anon_surface.sql` al revocarle a `anon` los privilegios sobre las
 * tablas: ahora `mySeasons` no recibe una lista vacía, recibe `permission
 * denied for table seasons` y tira. Se ve apretando "atrás" después de cerrar
 * sesión, que es un gesto a un toque del menú de la cuenta.
 */
function isPrivatePath(pathname: string): boolean {
  // Sin la barra final: un link pegado como `/torneo/{id}/reglas/` es el mismo
  // link, y mandar al login una página pública por un caracter sería peor que
  // no haber hecho nada.
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if (path === '/torneos') return true
  return path.startsWith('/torneo/') && !path.endsWith('/reglas')
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
