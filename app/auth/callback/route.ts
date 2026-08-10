import { NextResponse, type NextRequest } from 'next/server'
import { serverClient } from '@/db/client'

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

  // `next` viene de la query, así que sólo se acepta una ruta relativa: un
  // `next=https://otro-sitio` lo convertiría en un redirector abierto.
  const target = next.startsWith('/') && !next.startsWith('//') ? next : '/'
  return NextResponse.redirect(`${origin}${target}`)
}
