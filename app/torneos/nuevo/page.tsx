import { redirect } from 'next/navigation'
import { playerNames } from '@/db/read'
import { serverClient } from '@/db/server'
import { Crear } from './crear'

/**
 * El shell del wizard de 4 pasos (`Crear`). Del lado del servidor hace dos cosas: la guarda de sesión
 * —`createSeason` necesita un `auth.uid()` y la política `seasons_insert` no
 * deja pasar a nadie más— y buscar el nombre del que crea, con el que el paso 2
 * (Jugadores) arranca anotándolo en el plantel.
 *
 * El nombre sale vía `playerNames` (S3): `players` ya no se lee directo, el
 * mapeo usuario → jugador lo resuelve `my_player_id()` (security definer) y el
 * nombre lo resuelve `player_display_names` (security definer, 0103).
 */
export default async function NuevoTorneoPage() {
  const supabase = await serverClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user === null) redirect('/login?next=/torneos/nuevo')

  const { data: playerId } = await supabase.rpc('my_player_id')
  const myName =
    playerId === null ? '' : (await playerNames(supabase, [playerId])).get(playerId) ?? ''

  return <Crear myName={myName} />
}
