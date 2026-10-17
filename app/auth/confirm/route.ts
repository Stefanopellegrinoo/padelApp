import type { NextRequest } from 'next/server'
import { serverClient } from '@/db/server'

/**
 * El link del mail de recuperar contraseña
 * (`supabase/templates/recovery.html`).
 *
 * Se verifica con `token_hash` y no con el `code` de PKCE que usa el callback
 * de Google: el `code` sólo se canjea en el mismo navegador que pidió el mail,
 * y en el celular el mail se abre casi siempre en otro (la app de Gmail tiene
 * su navegador propio). Con `token_hash` el link anda en cualquiera.
 *
 * El destino es fijo y no sale del link: un `next` acá sería un redirector
 * abierto con la sesión recién creada.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')

  // Por ahora el único mail con link es el de recuperar contraseña.
  if (tokenHash === null || searchParams.get('type') !== 'recovery') return redirectTo('/login/recuperar?error=link')

  const supabase = await serverClient()
  const { error } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash })
  if (error !== null) return redirectTo('/login/recuperar?error=link')

  return redirectTo('/login/nueva-clave')
}

/**
 * Redirect con `Location` relativa, que el navegador resuelve contra el host en
 * el que ya está. Con una absoluta armada desde `request.url`, `next dev`
 * contesta `localhost` aunque el link haya entrado por `127.0.0.1` —que es el
 * `site_url` local—, y la cookie de sesión recién puesta queda en el otro host:
 * la pantalla siguiente dice que el link venció. Lo encontró el recorrido
 * entero contra Mailpit; los tests con el cliente mockeado no lo ven.
 */
function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { Location: path } })
}
