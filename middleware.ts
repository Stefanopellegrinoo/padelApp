import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { fetchWithFreshTokenRetry, sessionCookieOptions, type Client } from './db/client'
import { legacyFechaRedirectTarget, parseLegacyFechaPath } from './db/legacy-fecha-redirect'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      global: { fetch: fetchWithFreshTokenRetry },
      cookieOptions: sessionCookieOptions,
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

  // La puerta del @usuario (odd/tasks/amigos-faciles.md, S7): quien tiene
  // sesión y todavía no lo eligió va una sola vez a `/elegir-usuario`, y de
  // ahí vuelve a donde iba. Sólo en las privadas —la propia pantalla, el
  // login, el registro, Privacidad y borrar la cuenta no lo son— y sólo en
  // GET: un POST es una server action (cerrar sesión, por ejemplo) y no tiene
  // que rebotar.
  if (user !== null && request.method === 'GET' && isPrivatePath(request.nextUrl.pathname)) {
    const elegir = await usernameGate(supabase as unknown as Client, request, response, user.id)
    if (elegir !== null) return elegir
  }

  // REQ-NR-5: PnP-1000 tiene bookmarkeada `/torneo/{id}/fechas/{n}` (sin
  // disciplina, PR 10). Se resuelve ACÁ y no en un `page.tsx` de esa ruta:
  // así la mudanza de `fechas/[n]/` a `[disciplina]/fechas/[n]/` sigue siendo
  // un rename de árbol limpio. Siempre después del gate de login: para este
  // patrón `isPrivatePath` ya da `true`, así que sin sesión ya se volvió arriba.
  //
  // El contract (ff85c40) lo había retirado pensando en un deploy por etapas,
  // con el redirect viviendo un tiempo en producción antes de irse. La rama va
  // entera de una: sin esto, el link guardado da 404 el mismo día del deploy.
  // ponytail: retirarlo cuando los links viejos dejen de llegar (logs).
  //
  // `NextResponse.redirect(url, 308)`: el segundo argumento ES el status (el
  // default es 307). Mejor esfuerzo: si la temporada no resuelve (RLS sin fila)
  // `legacyFechaRedirectTarget` tira y se cae a la resolución normal (404).
  // Las cookies de un refresco viajan igual que en el redirect al login.
  const legacy = parseLegacyFechaPath(request.nextUrl.pathname)
  if (legacy !== null) {
    try {
      const target = await legacyFechaRedirectTarget(supabase as unknown as Client, legacy)
      if (target !== null) {
        const redirectUrl = request.nextUrl.clone()
        redirectUrl.pathname = target
        const redirect = NextResponse.redirect(redirectUrl, 308)
        for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie)
        return redirect
      }
    } catch {
      // best-effort: cae a la resolución normal (404 o error.tsx del render).
    }
  }

  return response
}

/**
 * La cookie que recuerda que ESTE usuario ya eligió su @usuario, para no
 * preguntarle a la base en cada pedido. Guarda el id del usuario y no un
 * "sí": una cookie de otra sesión en el mismo navegador no sirve. Falsificarla
 * sólo saltea la pantalla para uno mismo, que no gana nada: el @usuario lo
 * pide la base al buscar y nadie escribe `players` directo (0118).
 */
const USERNAME_COOKIE = 'padel-usuario'
const USERNAME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/**
 * Una RPC (`my_username`, 0122) si la cookie no dice ya que sí. Devuelve el
 * redirect a `/elegir-usuario?next=<adonde iba>` o `null` para seguir. Si la
 * pregunta falla, deja pasar: la puerta es para que todos elijan uno, no una
 * defensa, y frenar la app entera por eso sería peor.
 */
async function usernameGate(
  supabase: Client,
  request: NextRequest,
  response: NextResponse,
  userId: string,
): Promise<NextResponse | null> {
  if (request.cookies.get(USERNAME_COOKIE)?.value === userId) return null

  const { data, error } = await supabase.rpc('my_username')
  if (error !== null) return null

  if (data !== null) {
    response.cookies.set(USERNAME_COOKIE, userId, {
      ...sessionCookieOptions,
      sameSite: 'lax',
      path: '/',
      maxAge: USERNAME_COOKIE_MAX_AGE,
    })
    return null
  }

  const elegir = request.nextUrl.clone()
  elegir.pathname = '/elegir-usuario'
  elegir.search = ''
  elegir.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search)
  // Las cookies de un refresco viajan igual que en el redirect al login.
  const redirect = NextResponse.redirect(elegir)
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie)
  return redirect
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
  // `/amigos` entero: sin sesión, `friendsOf`/`historyWith` tiran `EdgeError`
  // ("Entrá con tu cuenta...") y sin nadie que lo agarre es la misma página
  // blanca en inglés que motivó agregar `/torneos` acá arriba.
  if (path === '/amigos' || path.startsWith('/amigos/')) return true
  // El perfil, el tuyo y el de otro (odd/tasks/amigos-faciles.md, S9): sin
  // sesión no hay a quién mostrárselo, y `player_profile` no responde a `anon`.
  if (path === '/perfil' || path.startsWith('/perfil/')) return true
  return path.startsWith('/torneo/') && !path.endsWith('/reglas')
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
