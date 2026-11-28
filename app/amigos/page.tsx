import Link from 'next/link'
import { ultimoResultado } from '@/app/torneos/inicio/estado'
import { Icono } from '@/app/torneos/inicio/iconos'
import { Avatar } from '@/app/ui/avatar'
import { Hero } from '@/app/ui/hero'
import { rowPress } from '@/app/ui/row'
import { Section } from '@/app/ui/section'
import { friendsOf, genteDeTusTorneos, historyWith, myFriendInvite } from '@/db/friends'
import { ordenarAmigos, pedidosRecibidos, resumenAmigo, type AmigoInicio } from '@/db/inicio'
import { serverClient } from '@/db/server'
import { BuscarPorUsuario } from './buscar'
import { GenteDeTusTorneos } from './gente'
import { CompartirMiLink } from './link'
import { PedidosEnviados, TePidieron } from './pedidos'
import { metaEnviado } from './pedidos-texto'

/**
 * Amigos — la lista, y el único lugar para pedir/aceptar una amistad.
 *
 * Arriba lo que espera algo de vos (te pidieron ser amigos, con de dónde lo
 * conocés, `pedidos.tsx`); después tus
 * amigos como en Inicio (último resultado y cara a cara, con el mismo
 * `resumenAmigo` de `db/inicio.ts`, así las dos pantallas no cuentan
 * distinto); la gente de tus torneos que todavía no agregaste (`gente.tsx`);
 * las solicitudes que mandaste, con cuánto hace y "Cancelar".
 *
 * Para sumar a alguien que no está en tus torneos: "Compartir mi link", en
 * la línea del título (odd/tasks/amigos-faciles.md, S5), y abajo el buscador
 * por @usuario (`buscar.tsx`, S8). Quien abre el link queda como tu amigo
 * (`/amigo/[token]`). El buscador no lista a todos los jugadores (0103 los
 * cerró a propósito): sólo por el comienzo de un @usuario, desde 3 letras y
 * hasta 10 (0124). Mientras hay búsqueda, los resultados reemplazan a las
 * secciones de abajo.
 */
export default async function AmigosPage() {
  const supabase = await serverClient()

  const [amigos, gente, token] = await Promise.all([
    friendsOf(supabase),
    genteDeTusTorneos(supabase),
    myFriendInvite(supabase),
  ])

  const ahora = new Date()
  const enviadas = amigos
    .filter((amigo) => !amigo.accepted && !amigo.theyAsked)
    .map((amigo) => ({ playerId: amigo.playerId, displayName: amigo.displayName, meta: metaEnviado(amigo.createdAt, ahora) }))
  // Un `historyWith` por amigo, en paralelo: lo mismo que Inicio (`amigosDeInicio`).
  const [recibidas, resumenes] = await Promise.all([
    pedidosRecibidos(supabase, amigos),
    Promise.all(
      amigos
        .filter((amigo) => amigo.accepted)
        .map(async (amigo) => resumenAmigo(amigo, await historyWith(supabase, amigo.playerId))),
    ),
  ])
  const aceptados = ordenarAmigos(resumenes)

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-bg pb-[calc(24px+env(safe-area-inset-bottom))] text-text">
      <Hero
        back={{ href: '/torneos', label: 'Inicio' }}
        title="Amigos"
        titleAction={<CompartirMiLink token={token} />}
        subtitle={
          aceptados.length === 0
            ? 'Sin amigos todavía'
            : aceptados.length === 1
              ? '1 amigo'
              : `${aceptados.length} amigos`
        }
      />

      <BuscarPorUsuario token={token}>
        <TePidieron pedidos={recibidas} />

        <Section title="Tus amigos">
          {aceptados.length === 0 ? (
            <div className="flex items-center gap-3 rounded-tile bg-sport-tint px-4 py-4 text-sport">
              <Icono name="amigos" className="h-8 w-8" />
              <p className="min-w-0 flex-1">
                <span className="block text-[17px] font-bold text-text">Sumá al primero</span>
                <span className="block text-[15px] text-muted">Compartí tu link, acá arriba</span>
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

        <GenteDeTusTorneos gente={gente} />

        <PedidosEnviados enviados={enviadas} />
      </BuscarPorUsuario>
    </main>
  )
}

/**
 * Un amigo, como la fila de Inicio (`FilaAmigo`, `app/torneos/page.tsx`): su
 * último resultado (verbo, marcador y día) y el cara a cara. El número es el
 * de enfrentados, lo tuyo contra él; si sólo jugaron de compañeros, el de la
 * pareja, con "juntos" abajo para que no se confunda. Lleva al perfil con
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
          {/* En 360, con el cara a cara al lado, baja a un segundo renglón antes que cortarse. */}
          <span className="line-clamp-2 block text-[17px] leading-tight font-bold break-words">{amigo.displayName}</span>
          <span className="mt-0.5 line-clamp-2 block text-[14px] leading-snug text-muted">
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
          // "juntos" va abajo del número y no al lado: así no le saca ancho al nombre.
          <span role="img" aria-label={aria} className="flex shrink-0 flex-col items-end">
            <span className="flex items-baseline gap-[5px]">
              <span className="font-cond text-[34px]">{registro.won}</span>
              <small className="text-[15px] font-semibold text-muted">a</small>
              <span className="font-cond text-[34px]">{registro.lost}</span>
            </span>
            {!enContra && <small className="-mt-1 text-[13px] leading-none font-semibold text-muted">juntos</small>}
          </span>
        )}
        <Icono name="chev" className="h-5 w-5 text-muted" />
      </Link>
    </li>
  )
}
