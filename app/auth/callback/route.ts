import { NextResponse, type NextRequest } from 'next/server'
import { serverClient } from '@/db/server'
import { afterLogin } from '../next-path'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (code === null) {
    return NextResponse.redirect(`${origin}/login?error=google`)
  }

  const supabase = await serverClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error !== null) {
    return NextResponse.redirect(`${origin}/login?error=google`)
  }

  // `afterLogin` y no `safeNextPath`: sin esto, entrar con Google desde
  // `/login` te dejaba en la landing, que es la pantalla del que NO tiene
  // cuenta. Es la misma regla que ya usaba el login con contraseña.
  return NextResponse.redirect(`${origin}${afterLogin(next)}`)
}
