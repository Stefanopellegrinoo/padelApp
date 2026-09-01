import { notFound } from 'next/navigation'
import { historyWith, sportsUsedBy } from '@/db/friends'
import { playerNames } from '@/db/read'
import { serverClient } from '@/db/server'
import { loadCasualMatch } from '../actions'
import { Historial } from '../historial'
import { CasualForm } from './cargar'

interface PageProps {
  params: Promise<{ playerId: string }>
}

/**
 * El historial (torneo + casual) con un amigo. `historyWith` no chequea que
 * sean amigos (comentario en `db/friends.ts`): del lado de torneo, la RLS de
 * `matches` ya acota esto a las temporadas donde el caller participa; del
 * lado casual, `casual_matches_read` acota igual a ser uno de los dos
 * jugadores de la fila, y la puerta de amistad ACEPTADA (diseño §4.5) sólo
 * corre al insertar, no al leer. Cualquier `playerId` es entonces seguro de
 * pedir -- en el peor caso, cero partidos compartidos.
 *
 * `notFound()` cuando `playerId` no es un jugador real: `players_read` está
 * abierta (diseño §5.5), así que no encontrar el nombre es un link roto, no
 * un problema de permisos.
 *
 * `sportsUsedBy` (Task 4) es del CALLER, no de `playerId` -- las sugerencias
 * del `datalist` de "Cargar partido" son para quien está tipeando, no para el
 * amigo que se está mirando.
 */
export default async function AmigoPage({ params }: PageProps) {
  const { playerId } = await params
  const supabase = await serverClient()

  const [nombres, partidos, sports] = await Promise.all([
    playerNames(supabase, [playerId]),
    historyWith(supabase, playerId),
    sportsUsedBy(supabase),
  ])

  const nombre = nombres.get(playerId)
  if (nombre === undefined) notFound()

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-4 bg-bg px-5 pb-6 text-text">
      <Historial nombre={nombre} friendPlayerId={playerId} partidos={partidos} />
      <CasualForm
        friendPlayerId={playerId}
        friendName={nombre}
        sports={sports}
        action={loadCasualMatch}
        submitLabel="Cargar partido"
      />
    </main>
  )
}
