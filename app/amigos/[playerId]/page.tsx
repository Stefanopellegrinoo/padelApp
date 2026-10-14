import Link from 'next/link'
import { notFound } from 'next/navigation'
import { initials } from '@/app/format'
import { friendsOf, historyWith } from '@/db/friends'
import { playerNames } from '@/db/read'
import { serverClient } from '@/db/server'
import { loadCasualMatch } from '../actions'
import { Historial } from '../historial'
import { CasualForm } from './cargar'

interface PageProps {
  params: Promise<{ playerId: string }>
  /**
   * `?error=...` de un `removeCasualMatch` (`../actions.ts`) que falló --
   * Borrar es un `<form>` sin JS, así que el error vuelve por la query, mismo
   * canal que `/amigos` (`../page.tsx`). Review final de 2b, Minor 4: esta
   * pantalla declaraba sólo `params`, así que un Borrar fallido redirigía
   * ACÁ con el error en la URL y nadie lo leía -- fallaba en silencio.
   */
  searchParams: Promise<{ error?: string }>
}

/**
 * El historial (torneo + casual) con un amigo. `historyWith` no chequea que
 * sean amigos (comentario en `db/friends.ts`): del lado de torneo, la RLS de
 * `matches` ya acota esto a las temporadas donde el caller participa; del
 * lado casual, la RLS (0090) acota igual a los partidos que el caller jugó,
 * y la puerta de amistad ACEPTADA (diseño §4.5) sólo corre al insertar, no al
 * leer. Cualquier `playerId` es entonces seguro de
 * pedir -- en el peor caso, cero partidos compartidos.
 *
 * `notFound()` cuando `playerId` no es un jugador real: `players_read` está
 * abierta (diseño §5.5), así que no encontrar el nombre es un link roto, no
 * un problema de permisos.
 */
export default async function AmigoPage({ params, searchParams }: PageProps) {
  const { playerId } = await params
  const { error } = await searchParams
  const supabase = await serverClient()

  const [nombres, partidos, amigos] = await Promise.all([
    playerNames(supabase, [playerId]),
    historyWith(supabase, playerId),
    friendsOf(supabase),
  ])

  const nombre = nombres.get(playerId)
  if (nombre === undefined) notFound()

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-4 bg-bg px-5 pb-6 text-text">
      {error !== undefined && (
        <p className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">{error}</p>
      )}
      <header className="flex flex-col gap-3 pt-4">
        <Link href="/amigos" className="text-[12.5px] font-extrabold text-accent-link">
          ← Amigos
        </Link>
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-chip text-[11px] font-extrabold text-muted">
            {initials(nombre)}
          </span>
          <h1 className="min-w-0 truncate text-[26px] font-extrabold tracking-[-.03em]">{nombre}</h1>
        </div>
      </header>
      {/* `<details>` nativo: cero estado de React. `open` lo maneja el DOM y el
          formulario no se desmonta cuando la action vuelve con error.
          `key`: al cargar bien, la action redirige a esta misma URL y React
          conserva el DOM y el estado de los componentes -- el formulario
          seguiría abierto y lleno, listo para reenviar un duplicado. Cambia la
          cantidad de partidos, cambia la key, se remonta cerrado y vacío. */}
      <details key={partidos.length} className="flex flex-col gap-3">
        <summary className="cursor-pointer rounded-field bg-accent p-3 text-center text-[14px] font-extrabold text-accent-text">
          Cargar partido
        </summary>
        <div className="pt-3">
          <CasualForm
            friendPlayerId={playerId}
            friends={amigos.filter((amigo) => amigo.accepted)}
            action={loadCasualMatch}
            submitLabel="Cargar partido"
          />
        </div>
      </details>
      <Historial nombre={nombre} friendPlayerId={playerId} partidos={partidos} />
    </main>
  )
}
