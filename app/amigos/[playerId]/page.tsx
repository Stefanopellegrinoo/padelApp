import { notFound } from 'next/navigation'
import { initials } from '@/app/format'
import { Volver } from '@/app/torneo/[id]/volver'
import { friendsOf, historyWith } from '@/db/friends'
import { playerNames } from '@/db/read'
import { serverClient } from '@/db/server'
import { loadCasualMatch } from '../actions'
import { Historial, resumenDe, type Registro } from '../historial'
import { CasualForm } from './cargar'

/**
 * Una tarjeta del cara a cara: el mismo `StatCard` de Stats y de la ficha del
 * jugador (9.5px de rótulo, número grande), con el número en verde o en
 * naranja según de qué lado quedó la cuenta -- los colores de la Tabla.
 */
function Cuenta({ label, registro }: { label: string; registro: Registro }) {
  const tono = registro.won > registro.lost ? 'text-up' : registro.lost > registro.won ? 'text-down' : ''
  return (
    <div className="rounded-[14px] border border-line bg-surface p-[14px]">
      <span className="block text-[12px] font-extrabold uppercase tracking-[.13em] text-muted">{label}</span>
      <span className={`mt-1 block text-[24px] leading-[1.1] font-extrabold tabular-nums ${tono}`}>
        {registro.won} – {registro.lost}
      </span>
      <span className="block text-[12px] font-semibold text-muted">ganados – perdidos</span>
      {registro.drew > 0 && (
        <span className="block text-[12px] font-semibold text-muted">
          y {registro.drew} {registro.drew === 1 ? 'empate' : 'empates'}
        </span>
      )}
    </div>
  )
}

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

  const resumen = resumenDe(partidos)

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-5 bg-bg px-5 pb-8 text-text">
      <header className="flex flex-col gap-3 pt-4">
        <Volver href="/amigos" label="Amigos" />
        <div className="flex items-center gap-3.5">
          <span className="flex h-[56px] w-[56px] shrink-0 items-center justify-center rounded-full bg-accent text-[20px] font-extrabold text-accent-text">
            {initials(nombre)}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[26px] leading-[1.1] font-extrabold tracking-[-.03em]">{nombre}</h1>
            <span className="block text-[12.5px] font-semibold text-muted">
              {resumen.total === 0
                ? 'Todavía sin partidos'
                : resumen.total === 1
                  ? '1 partido entre los dos'
                  : `${resumen.total} partidos entre los dos`}
            </span>
          </div>
        </div>
      </header>

      {error !== undefined && (
        <p className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">{error}</p>
      )}

      {/* El cara a cara sale de la MISMA lista de abajo (`resumenDe`): cero
          consultas nuevas, y nunca la reemplaza (plan 2a, §4.4). */}
      {resumen.total > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <Cuenta label="Juntos" registro={resumen.juntos} />
          <Cuenta label="En contra" registro={resumen.enContra} />
        </div>
      )}

      {/* `<details>` nativo: cero estado de React. `open` lo maneja el DOM y el
          formulario no se desmonta cuando la action vuelve con error.
          `key`: al cargar bien, la action redirige a esta misma URL y React
          conserva el DOM y el estado de los componentes -- el formulario
          seguiría abierto y lleno, listo para reenviar un duplicado. Cambia la
          cantidad de partidos, cambia la key, se remonta cerrado y vacío.
          Abierto, el botón pasa a gris: el formulario de abajo es lo
          principal y el resumen queda como "cerrar". */}
      <details key={partidos.length} className="group">
        <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-center gap-2 rounded-field bg-accent p-4 text-center text-[15px] font-extrabold text-accent-text outline-none focus-visible:ring-2 focus-visible:ring-accent-link focus-visible:ring-offset-2 focus-visible:ring-offset-bg group-open:bg-chip group-open:text-text [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="text-[20px] leading-none transition-transform group-open:rotate-45">
            +
          </span>
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

      <section className="flex flex-col gap-3">
        <h2 className="text-[15px] font-extrabold tracking-[-.02em]">Historial</h2>
        <Historial nombre={nombre} friendPlayerId={playerId} partidos={partidos} />
      </section>
    </main>
  )
}
