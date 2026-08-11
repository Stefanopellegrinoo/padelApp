import { redirect } from 'next/navigation'
import { serverClient } from '@/db/server'
import { Wizard } from './wizard'

/**
 * El shell del wizard. Del lado del servidor hace dos cosas: la guarda de sesión
 * —`createSeason` necesita un `auth.uid()` y la política `seasons_insert` no
 * deja pasar a nadie más— y buscar el nombre del que crea, con el que el paso 2
 * arranca anotándolo en el plantel.
 *
 * El nombre sale de `players` en dos consultas porque `players.user_id` no tiene
 * SELECT otorgado a `authenticated` a propósito (0002_rls.sql): el mapeo
 * usuario → jugador sólo lo resuelve `my_player_id()`, que es security definer.
 */
export default async function NuevoTorneoPage() {
  const supabase = await serverClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user === null) redirect('/login?next=/torneos/nuevo')

  const { data: playerId } = await supabase.rpc('my_player_id')
  const { data: me } =
    playerId === null
      ? { data: null }
      : await supabase.from('players').select('display_name').eq('id', playerId).maybeSingle()

  return <Wizard myName={me?.display_name ?? ''} />
}
