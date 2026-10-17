import { NextResponse, type NextRequest } from 'next/server'
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
  const { searchParams, origin } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const expired = NextResponse.redirect(`${origin}/login/recuperar?error=link`)

  // Por ahora el único mail con link es el de recuperar contraseña.
  if (tokenHash === null || searchParams.get('type') !== 'recovery') return expired

  const supabase = await serverClient()
  const { error } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash })
  if (error !== null) return expired

  return NextResponse.redirect(`${origin}/login/nueva-clave`)
}
