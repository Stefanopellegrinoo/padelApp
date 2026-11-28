import { notFound, redirect } from 'next/navigation'
import { primerNombre, haceCuanto } from '@/app/torneo/[id]/[disciplina]/jugador/amistad-texto'
import { PedidoRecibido } from '@/app/torneo/[id]/[disciplina]/jugador/amistad'
import { IconoDeporte } from '@/app/torneos/inicio/iconos'
import { Hero } from '@/app/ui/hero'
import { Section } from '@/app/ui/section'
import type { Registro } from '@/db/inicio'
import { perfilDe, type Perfil } from '@/db/perfil'
import { serverClient } from '@/db/server'
import { AccionAmistad } from '../amistad'
import { deportesDeTorneo, historialHref, ultimoPartido } from '../perfil-texto'
import { AvatarGrande, FilaLink, Trazo } from '../piezas'

interface PageProps {
  params: Promise<{ playerId: string }>
}

/**
 * El perfil de otro jugador (odd/tasks/amigos-faciles.md, S9, S11;
 * `design/amigos-faciles/06-perfil.html`, láminas 1 y 2): quién es, la
 * amistad en el encabezado, los torneos que comparten (con su deporte, sin
 * fechas) y, sólo entre amigos, el cara a cara y "Ver historial".
 *
 * Quién se ve lo decide la base (`player_profile`, 0127). Si no lo devuelve
 * —no hay contexto y no se lo puede encontrar, o el id no existe— es "no
 * encontrado", sin decir cuál de las dos. El tuyo va a `/perfil`.
 *
 * Se llega desde el buscador, las sugerencias y los pedidos: Volver desanda
 * hasta ahí, y sin nada atrás va a Amigos.
 */
export default async function PerfilDeJugador({ params }: PageProps) {
  const { playerId } = await params
  const supabase = await serverClient()
  const perfil = await perfilDe(supabase, playerId)
  if (perfil === null) notFound()
  if (perfil.esVos) redirect('/perfil')

  const nombre = primerNombre(perfil.displayName)
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-bg pb-[calc(32px+env(safe-area-inset-bottom))] text-text">
      <Hero
        back={{ href: '/amigos' }}
        kicker={<AvatarGrande name={perfil.displayName} />}
        title={perfil.displayName}
        subtitle={perfil.username === null ? undefined : <span className="text-[16px] font-semibold">@{perfil.username}</span>}
      >
        <Amistad perfil={perfil} nombre={nombre} />
      </Hero>

      {perfil.caraACara !== null && (
        <Section title="Cara a cara">
          <CaraACara contra={perfil.caraACara.contra} juntos={perfil.caraACara.juntos} />
          <ul className="-mx-4 mt-2">
            <li>
              <FilaLink
                href={historialHref(perfil.playerId)}
                icono={<Trazo name="reloj" />}
                nombre="Ver historial"
                meta={ultimoPartido(perfil.caraACara.ultimo?.playedOn ?? null, new Date())}
              />
            </li>
          </ul>
        </Section>
      )}

      {perfil.torneos.length > 0 && (
        <Section title="Torneos que comparten" className="pt-6">
          <ul className="-mx-4">
            {perfil.torneos.map((torneo) => (
              // El divisor va en el `<li>`: el `first:` de la fila mira adentro de cada uno.
              <li key={torneo.seasonId} data-deporte={torneo.sports[0]} className="border-t border-line first:border-t-0">
                <FilaLink
                  href={`/torneo/${torneo.seasonId}`}
                  icono={<IconoDeporte kind={torneo.sports[0] ?? ''} className="h-[22px] w-[22px]" />}
                  nombre={torneo.name}
                  meta={deportesDeTorneo(torneo.sports)}
                  alta
                />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </main>
  )
}

/**
 * La amistad en el encabezado, con los estados del perfil del torneo. Quien
 * borró su cuenta (o vos) no tiene: `amistad` llega en `null`.
 */
function Amistad({ perfil, nombre }: { perfil: Perfil; nombre: string }) {
  const amistad = perfil.amistad
  if (amistad === null) return null
  if (amistad.kind === 'received') {
    return <PedidoRecibido playerId={perfil.playerId} nombre={nombre} hace={haceCuanto(amistad.requestedAt, new Date())} />
  }
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2.5">
      <AccionAmistad playerId={perfil.playerId} nombre={nombre} estado={amistad.kind} />
    </div>
  )
}

const total = (registro: Registro) => registro.won + registro.lost + registro.drew

/**
 * Los números grandes y angostos de la app: lo tuyo contra él, o, si sólo
 * jugaron de compañeros, lo de los dos juntos. Mismo conteo que Inicio
 * (`resumenAmigo`).
 */
function CaraACara({ contra, juntos }: { contra: Registro; juntos: Registro }) {
  const enContra = total(contra) > 0
  if (!enContra && total(juntos) === 0) {
    return <p className="text-[16px] text-muted">Todavía no jugaron. El primero que carguen queda acá.</p>
  }
  const registro = enContra ? contra : juntos
  const datos = [
    { valor: registro.won, texto: enContra ? 'Ganaste' : 'Ganaron juntos', gano: true },
    { valor: registro.lost, texto: enContra ? 'Perdiste' : 'Perdieron juntos', gano: false },
    ...(registro.drew > 0 ? [{ valor: registro.drew, texto: 'Empates', gano: false }] : []),
  ]
  return (
    <div className={`grid gap-2.5 ${datos.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
      {datos.map((dato) => (
        <p key={dato.texto} className="rounded-card bg-surface px-3.5 pt-3 pb-3.5">
          <span className={`font-cond block text-[52px] ${dato.gano ? 'text-up' : ''}`}>{dato.valor}</span>
          <span className="mt-1.5 block text-[14px] font-semibold text-muted">{dato.texto}</span>
        </p>
      ))}
    </div>
  )
}
