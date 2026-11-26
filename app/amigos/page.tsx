import Link from 'next/link'
import { SubmitButton } from '@/app/submit-button'
import { ultimoResultado } from '@/app/torneos/inicio/estado'
import { Icono } from '@/app/torneos/inicio/iconos'
import { Avatar } from '@/app/ui/avatar'
import { button } from '@/app/ui/button'
import { Hero } from '@/app/ui/hero'
import { row, rowPress } from '@/app/ui/row'
import { Section } from '@/app/ui/section'
import { friendsOf, historyWith } from '@/db/friends'
import { ordenarAmigos, resumenAmigo, type AmigoInicio } from '@/db/inicio'
import { serverClient } from '@/db/server'
import { accept, sendFriendRequest } from './actions'
import { MiId } from './mi-id'

interface PageProps {
  searchParams: Promise<{ error?: string }>
}

/**
 * Amigos — la lista, y el único lugar para pedir/aceptar una amistad.
 *
 * Arriba lo que espera algo de vos (te pidieron ser amigos); después tus
 * amigos como en Inicio (último resultado y cara a cara, con el mismo
 * `resumenAmigo` de `db/inicio.ts`, así las dos pantallas no cuentan
 * distinto); las solicitudes que mandaste; y al final cómo sumar a alguien.
 *
 * No hay buscador de jugadores (ver `mi-id.tsx`): agregar a alguien pide su
 * ID, que esa persona copia desde acá mismo y te pasa por fuera de la app.
 * Es la vía que el diseño deja abierta para "agregar a alguien que ya tiene
 * cuenta" sin abrir ninguna superficie de lectura nueva (§5.5).
 */
export default async function AmigosPage({ searchParams }: PageProps) {
  const { error } = await searchParams
  const supabase = await serverClient()

  const [amigos, { data: myPlayerId }] = await Promise.all([friendsOf(supabase), supabase.rpc('my_player_id')])

  const recibidas = amigos.filter((amigo) => !amigo.accepted && amigo.theyAsked)
  const enviadas = amigos.filter((amigo) => !amigo.accepted && !amigo.theyAsked)
  // Un `historyWith` por amigo, en paralelo: lo mismo que Inicio (`amigosDeInicio`).
  const aceptados = ordenarAmigos(
    await Promise.all(
      amigos
        .filter((amigo) => amigo.accepted)
        .map(async (amigo) => resumenAmigo(amigo, await historyWith(supabase, amigo.playerId))),
    ),
  )

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-bg pb-[calc(24px+env(safe-area-inset-bottom))] text-text">
      <Hero
        back={{ href: '/torneos', label: 'Inicio' }}
        title="Amigos"
        subtitle={
          aceptados.length === 0
            ? 'Sin amigos todavía'
            : aceptados.length === 1
              ? '1 amigo'
              : `${aceptados.length} amigos`
        }
      />

      {recibidas.length > 0 && (
        <Section title="Te pidieron">
          <ul className="-mx-4">
            {recibidas.map((amigo) => (
              <li key={amigo.friendshipId} className={`${row} min-h-[72px]`}>
                <Avatar name={amigo.displayName} />
                <span className="min-w-0 flex-1 truncate text-[17px] font-bold">{amigo.displayName}</span>
                <form action={accept}>
                  <input type="hidden" name="friendshipId" value={amigo.friendshipId} />
                  <SubmitButton className={button('primary')}>Aceptar</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Tus amigos">
        {aceptados.length === 0 ? (
          <div className="flex items-center gap-3 rounded-tile bg-sport-tint px-4 py-4 text-sport">
            <Icono name="amigos" className="h-8 w-8" />
            <p className="min-w-0 flex-1">
              <span className="block text-[17px] font-bold text-text">Sumá al primero</span>
              <span className="block text-[15px] text-muted">Con su ID, acá abajo</span>
            </p>
          </div>
        ) : (
          <ul className="-mx-4">
            {aceptados.map((amigo) => (
              <FilaAmigo key={amigo.playerId} amigo={amigo} />
            ))}
          </ul>
        )}
      </Section>

      {enviadas.length > 0 && (
        <Section title="Pedidos enviados" className="pt-7">
          <ul className="-mx-4">
            {enviadas.map((amigo) => (
              <li key={amigo.friendshipId} className={`${row} min-h-[64px]`}>
                <Avatar name={amigo.displayName} />
                <span className="min-w-0 flex-1 truncate text-[17px] font-semibold text-muted">{amigo.displayName}</span>
                <span className="shrink-0 rounded-pill bg-chip px-3 py-1.5 text-[14px] font-semibold text-muted">
                  Pendiente
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Sumar un amigo" className="pt-7">
        <div className="flex flex-col gap-4">
          <MiId playerId={myPlayerId ?? ''} />
          <form action={sendFriendRequest} className="flex flex-col gap-2">
            <label htmlFor="friendPlayerId" className="text-[15px] font-semibold text-muted">
              El ID de tu amigo
            </label>
            <div className="flex gap-2">
              <input
                id="friendPlayerId"
                name="friendPlayerId"
                placeholder="Pegalo acá"
                required
                autoComplete="off"
                aria-invalid={error !== undefined || undefined}
                aria-describedby={error === undefined ? undefined : 'amigos-error'}
                className={`min-h-[48px] min-w-0 flex-1 rounded-btn border-[1.5px] bg-surface-2 px-3 text-[16px] font-semibold ${
                  error === undefined ? 'border-line' : 'border-live'
                }`}
              />
              <SubmitButton className={`${button('primary')} min-h-[48px] shrink-0`}>Pedir</SubmitButton>
            </div>
            {error !== undefined && (
              <p id="amigos-error" role="alert" className="rounded-btn bg-live-bg px-3 py-2.5 text-[15px] font-semibold text-live">
                {error}
              </p>
            )}
          </form>
        </div>
      </Section>
    </main>
  )
}

/**
 * Un amigo, como la fila de Inicio (`FilaAmigo`, `app/torneos/page.tsx`): su
 * último resultado (verbo, marcador y día) y el cara a cara. El número es el
 * de enfrentados, lo tuyo contra él; si sólo jugaron de compañeros, el de la
 * pareja, con "juntos" al lado para que no se confunda. Lleva al perfil con
 * `?desde=amigos`, así Volver vuelve acá.
 */
function FilaAmigo({ amigo }: { amigo: AmigoInicio }) {
  const ultimo = amigo.ultimo === null ? null : ultimoResultado(amigo.ultimo)
  const enContra = amigo.contra.won + amigo.contra.lost + amigo.contra.drew > 0
  const deJuntos = amigo.juntos.won + amigo.juntos.lost + amigo.juntos.drew > 0
  const registro = enContra ? amigo.contra : deJuntos ? amigo.juntos : null
  const empates = registro !== null && registro.drew > 0 ? `, ${enContra ? 'empataste' : 'empataron'} ${registro.drew}` : ''
  const aria =
    registro === null
      ? undefined
      : enContra
        ? `Historial: ganaste ${registro.won}, perdiste ${registro.lost}${empates}`
        : `Juntos: ganaron ${registro.won}, perdieron ${registro.lost}${empates}`
  return (
    <li data-deporte={amigo.ultimo?.sport}>
      <Link href={`/amigos/${amigo.playerId}?desde=amigos`} className={`${rowPress} min-h-[72px]`}>
        <Avatar name={amigo.displayName} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[17px] font-bold">{amigo.displayName}</span>
          <span className="block truncate text-[14px] text-muted">
            {ultimo === null ? (
              'Sin partidos todavía'
            ) : (
              <>
                <span className={ultimo.gano ? 'font-semibold text-up' : 'font-semibold text-text'}>
                  {ultimo.verbo}
                  {ultimo.marcador !== null && ` ${ultimo.marcador}`}
                </span>
                {ultimo.dia !== null && `, ${ultimo.dia}`}
              </>
            )}
          </span>
        </span>
        {registro !== null && (
          <span role="img" aria-label={aria} className="flex shrink-0 items-baseline gap-[5px]">
            <span className="font-cond text-[34px]">{registro.won}</span>
            <small className="text-[15px] font-semibold text-muted">a</small>
            <span className="font-cond text-[34px]">{registro.lost}</span>
            {!enContra && <small className="ml-1 text-[13px] font-semibold text-muted">juntos</small>}
          </span>
        )}
        <Icono name="chev" className="h-5 w-5 text-muted" />
      </Link>
    </li>
  )
}
