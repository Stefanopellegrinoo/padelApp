import { NextResponse, type NextRequest } from 'next/server'
import { serverClient } from '@/db/server'
import { safeNextPath } from '../next-path'

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

  return NextResponse.redirect(`${origin}${safeNextPath(next)}`)
}
