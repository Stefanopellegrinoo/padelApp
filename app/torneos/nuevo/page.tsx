import { redirect } from 'next/navigation'
import { serverClient } from '@/db/server'
import { Wizard } from './wizard'

/**
 * El shell del wizard. Lo único que hace del lado del servidor es la guarda de
 * sesión: `createSeason` necesita un `auth.uid()` y la política
 * `seasons_insert` no deja pasar a nadie más.
 */
export default async function NuevoTorneoPage() {
  const supabase = await serverClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user === null) redirect('/login?next=/torneos/nuevo')

  return <Wizard />
}
