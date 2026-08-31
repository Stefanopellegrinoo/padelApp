import Link from 'next/link'
import { initials } from '@/app/format'
import { friendsOf } from '@/db/friends'
import { serverClient } from '@/db/server'
import { accept, sendFriendRequest } from './actions'
import { MiId } from './mi-id'

interface PageProps {
  searchParams: Promise<{ error?: string }>
}

const ROW = 'flex items-center gap-3 p-3'

/**
 * Amigos — la lista, y el único lugar para pedir/aceptar una amistad.
 *
 * No hay buscador de jugadores (ver `mi-id.tsx`): agregar a alguien pide su
 * ID, que esa persona copia desde acá mismo y te pasa por fuera de la app.
 * Es la vía que el diseño deja abierta para "agregar a alguien que ya tiene
 * cuenta" sin abrir ninguna superficie de lectura nueva (§5.5).
 */
export default async function AmigosPage({ searchParams }: PageProps) {
  const { error } = await searchParams
  const supabase = await serverClient()

  const [amigos, { data: myPlayerId }] = await Promise.all([
    friendsOf(supabase),
    supabase.rpc('my_player_id'),
  ])

  const aceptados = amigos.filter((amigo) => amigo.accepted)
  const recibidas = amigos.filter((amigo) => !amigo.accepted && amigo.theyAsked)
  const enviadas = amigos.filter((amigo) => !amigo.accepted && !amigo.theyAsked)

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-4 bg-bg px-5 pb-6 text-text">
      <header className="flex flex-col gap-[3px] pt-4">
        <h1 className="text-[26px] font-extrabold tracking-[-.03em]">Amigos</h1>
        <p className="text-pretty text-[13.5px] leading-[1.5] font-[550] text-muted">
          El historial de torneo con cada uno.
        </p>
      </header>

      {recibidas.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">
            Te pidieron ser amigos
          </h2>
          <div className="overflow-hidden rounded-[14px] border border-line bg-surface">
            {recibidas.map((amigo, index) => (
              <div key={amigo.friendshipId} className={`${ROW} ${index > 0 ? 'border-t border-line' : ''}`}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-chip text-[11px] font-extrabold text-muted">
                  {initials(amigo.displayName)}
                </span>
                <span className="flex-1 truncate text-[14px] font-bold">{amigo.displayName}</span>
                <form action={accept}>
                  <input type="hidden" name="friendshipId" value={amigo.friendshipId} />
                  <button
                    type="submit"
                    className="shrink-0 rounded-field bg-accent px-3 py-2 text-[12.5px] font-extrabold text-accent-text"
                  >
                    Aceptar
                  </button>
                </form>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">Tus amigos</h2>
        {aceptados.length === 0 ? (
          <p className="text-pretty text-[13.5px] leading-[1.5] font-[550] text-muted">
            Todavía no tenés amigos agregados.
          </p>
        ) : (
          <div className="overflow-hidden rounded-[14px] border border-line bg-surface">
            {aceptados.map((amigo, index) => (
              <Link
                key={amigo.friendshipId}
                href={`/amigos/${amigo.playerId}`}
                className={`${ROW} ${index > 0 ? 'border-t border-line' : ''}`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-chip text-[11px] font-extrabold text-muted">
                  {initials(amigo.displayName)}
                </span>
                <span className="flex-1 truncate text-[14px] font-bold">{amigo.displayName}</span>
                <span className="shrink-0 text-[13px] font-bold text-muted">›</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {enviadas.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">
            Solicitudes enviadas
          </h2>
          <div className="overflow-hidden rounded-[14px] border border-line bg-surface">
            {enviadas.map((amigo, index) => (
              <div key={amigo.friendshipId} className={`${ROW} ${index > 0 ? 'border-t border-line' : ''}`}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-chip text-[11px] font-extrabold text-muted">
                  {initials(amigo.displayName)}
                </span>
                <span className="flex-1 truncate text-[14px] font-bold">{amigo.displayName}</span>
                <span className="shrink-0 text-[12px] font-bold text-muted">Pendiente</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">
          Agregar un amigo
        </h2>
        <MiId playerId={myPlayerId ?? ''} />
        <form action={sendFriendRequest} className="flex flex-col gap-2">
          <input
            name="friendPlayerId"
            placeholder="El ID de tu amigo"
            required
            className={`min-w-0 rounded-field border-[1.5px] bg-surface p-[13px] text-[16px] font-[750] outline-none ${
              error === undefined ? 'border-line' : 'border-live'
            }`}
          />
          <button
            type="submit"
            className="rounded-field bg-accent p-3.5 text-center text-[14.5px] font-extrabold text-accent-text"
          >
            Pedir amistad
          </button>
        </form>
        {error !== undefined && (
          <p className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">{error}</p>
        )}
      </section>
    </main>
  )
}
