import Link from 'next/link'
import { initials } from '@/app/format'
import { SubmitButton } from '@/app/submit-button'
import { Volver } from '@/app/torneo/[id]/volver'
import { friendsOf } from '@/db/friends'
import { serverClient } from '@/db/server'
import { accept, sendFriendRequest } from './actions'
import { MiId } from './mi-id'

interface PageProps {
  searchParams: Promise<{ error?: string }>
}

const SECTION_LABEL = 'text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted'
const LIST = 'overflow-hidden rounded-card border border-line bg-surface'
const ROW = 'flex min-h-[64px] items-center gap-3 px-4 py-3'

/** El avatar de iniciales de la app (Tabla, Stats), a 40px para que se lea en una lista. */
function Avatar({ name, tone = 'chip' }: { name: string; tone?: 'chip' | 'ok' }) {
  return (
    <span
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[12px] font-extrabold ${
        tone === 'ok' ? 'bg-ok-bg text-up' : 'bg-chip text-muted'
      }`}
    >
      {initials(name)}
    </span>
  )
}

/** Título de sección con su conteo, como los separadores de Mis torneos. */
function SectionTitle({ children, count }: { children: string; count?: number }) {
  return (
    <h2 className={`flex items-center gap-2 ${SECTION_LABEL}`}>
      {children}
      {count !== undefined && (
        <span className="rounded-full bg-chip px-2 py-0.5 text-[10.5px] tracking-normal">{count}</span>
      )}
    </h2>
  )
}

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
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-6 bg-bg px-5 pb-8 text-text">
      <header className="flex flex-col gap-[3px] pt-4">
        <div className="mb-2">
          <Volver href="/torneos" label="Mis torneos" />
        </div>
        <h1 className="text-[26px] font-extrabold tracking-[-.03em]">Amigos</h1>
        <p className="text-pretty text-[13.5px] leading-[1.5] font-[550] text-muted">
          Torneos y partidos casuales con cada uno.
        </p>
      </header>

      {recibidas.length > 0 && (
        <section className="flex flex-col gap-2">
          <SectionTitle count={recibidas.length}>Te pidieron ser amigos</SectionTitle>
          <div className={LIST}>
            {recibidas.map((amigo, index) => (
              <div key={amigo.friendshipId} className={`${ROW} ${index > 0 ? 'border-t border-line' : ''}`}>
                <Avatar name={amigo.displayName} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold">{amigo.displayName}</span>
                  <span className="block text-[12px] font-semibold text-muted">Quiere sumarte</span>
                </span>
                <form action={accept}>
                  <input type="hidden" name="friendshipId" value={amigo.friendshipId} />
                  <SubmitButton className="min-h-[40px] shrink-0 rounded-field bg-accent px-4 text-[13px] font-extrabold text-accent-text disabled:opacity-60">
                    Aceptar
                  </SubmitButton>
                </form>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <SectionTitle count={aceptados.length > 0 ? aceptados.length : undefined}>Tus amigos</SectionTitle>
        {aceptados.length === 0 ? (
          <div className="flex flex-col gap-1 rounded-card border border-dashed border-line p-5 text-center">
            <p className="text-pretty text-[15px] font-extrabold tracking-[-.02em]">
              Todavía no tenés amigos agregados.
            </p>
            <p className="text-pretty text-[13px] font-[550] text-muted">
              Pasale tu ID a alguien o pedí el suyo, acá abajo.
            </p>
          </div>
        ) : (
          <div className={LIST}>
            {aceptados.map((amigo, index) => (
              <Link
                key={amigo.friendshipId}
                href={`/amigos/${amigo.playerId}`}
                className={`${ROW} ${index > 0 ? 'border-t border-line' : ''} transition-colors active:bg-chip`}
              >
                <Avatar name={amigo.displayName} tone="ok" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold">{amigo.displayName}</span>
                  <span className="block text-[12px] font-semibold text-muted">Ver partidos y cargar uno</span>
                </span>
                <span aria-hidden className="shrink-0 text-[20px] leading-none font-bold text-muted">
                  ›
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {enviadas.length > 0 && (
        <section className="flex flex-col gap-2">
          <SectionTitle count={enviadas.length}>Solicitudes enviadas</SectionTitle>
          <div className={LIST}>
            {enviadas.map((amigo, index) => (
              <div key={amigo.friendshipId} className={`${ROW} ${index > 0 ? 'border-t border-line' : ''}`}>
                <Avatar name={amigo.displayName} />
                <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-muted">{amigo.displayName}</span>
                <span className="shrink-0 rounded-full bg-chip px-2.5 py-1 text-[10.5px] font-extrabold text-muted">
                  Pendiente
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <SectionTitle>Agregar un amigo</SectionTitle>
        <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
          <p className="text-pretty text-[13px] leading-[1.45] font-[550] text-muted">
            No hay buscador: pasale tu ID por mensaje, o pegá el suyo y pedile la amistad.
          </p>
          <MiId playerId={myPlayerId ?? ''} />
          <form action={sendFriendRequest} className="flex flex-col gap-2">
            <label htmlFor="friendPlayerId" className="text-[11.5px] font-extrabold text-muted">
              El ID de tu amigo
            </label>
            <input
              id="friendPlayerId"
              name="friendPlayerId"
              placeholder="Pegalo acá"
              required
              autoComplete="off"
              className={`min-w-0 rounded-field border-[1.5px] bg-bg p-[13px] text-[16px] font-[750] outline-none focus-visible:ring-2 focus-visible:ring-accent-link ${
                error === undefined ? 'border-line' : 'border-live'
              }`}
            />
            <SubmitButton className="rounded-field bg-accent p-4 text-center text-[15px] font-extrabold text-accent-text disabled:opacity-60">
              Pedir amistad
            </SubmitButton>
          </form>
          {error !== undefined && (
            <p className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">{error}</p>
          )}
        </div>
      </section>
    </main>
  )
}
