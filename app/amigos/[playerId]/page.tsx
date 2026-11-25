import { notFound } from 'next/navigation'
import { matchdayDay } from '@/app/format'
import { Hero } from '@/app/ui/hero'
import { Section } from '@/app/ui/section'
import { sportLabel } from '@/core'
import { friendsOf, historyWith, type SharedMatch } from '@/db/friends'
import { playerNames } from '@/db/read'
import { serverClient } from '@/db/server'
import { Historial, resumenDe, type Registro } from '../historial'
import { CargarConAmigo } from './cargar-con-amigo'

interface PageProps {
  params: Promise<{ playerId: string }>
  /**
   * `?error=...` de un `removeCasualMatch` (`../actions.ts`) que falló --
   * Borrar es un `<form>` sin JS, así que el error vuelve por la query, mismo
   * canal que `/amigos` (`../page.tsx`). Review final de 2b, Minor 4: esta
   * pantalla declaraba sólo `params`, así que un Borrar fallido redirigía
   * ACÁ con el error en la URL y nadie lo leía -- fallaba en silencio.
   *
   * `?desde=amigos`: se llegó desde la lista de Amigos, y Volver lleva ahí.
   * Sin él (desde Inicio, o un link compartido) Volver va a Inicio.
   */
  searchParams: Promise<{ error?: string; desde?: string }>
}

/** Cuántos resultados entran en la racha del bloque, como en el prototipo. */
const RACHA = 12

const cuantos = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

/**
 * Los deportes que jugaron, del más jugado al menos, para el subtítulo:
 * "pádel", "pádel y FIFA" (FIFA es un nombre y va como se escribe).
 */
function deportesDe(partidos: readonly SharedMatch[]): { kinds: string[]; texto: string } {
  const veces = new Map<string, number>()
  for (const partido of partidos) veces.set(partido.sport, (veces.get(partido.sport) ?? 0) + 1)
  const kinds = [...veces.entries()].sort((a, b) => b[1] - a[1]).map(([kind]) => kind)
  const labels = kinds.map((kind) => (kind === 'FIFA' ? 'FIFA' : sportLabel(kind).toLocaleLowerCase('es')))
  const texto = labels.length <= 1 ? (labels[0] ?? '') : `${labels.slice(0, -1).join(', ')} y ${labels.at(-1)}`
  return { kinds, texto }
}

/**
 * El perfil de un amigo, la pantalla de Nico del prototipo: en el bloque, el
 * nombre, cuántos partidos y de qué, y el cara a cara grande con lo tuyo en
 * amarillo (lo único amarillo de la app es lo tuyo) y la racha de los últimos
 * resultados. Abajo, los partidos: enfrentados y, si hay, de compañeros. Fijo
 * abajo, "Cargar partido con Nico" (`CargarConAmigo`), a un toque.
 *
 * `historyWith` no chequea que sean amigos (comentario en `db/friends.ts`):
 * del lado de torneo, la RLS de `matches` ya acota esto a las temporadas
 * donde el caller participa; del lado casual, la RLS (0090) acota igual a los
 * partidos que el caller jugó, y la puerta de amistad ACEPTADA (diseño §4.5)
 * sólo corre al insertar, no al leer. Cualquier `playerId` es entonces seguro
 * de pedir -- en el peor caso, cero partidos compartidos.
 *
 * `notFound()` cuando `playerId` no es un jugador real: `players_read` está
 * abierta (diseño §5.5), así que no encontrar el nombre es un link roto, no
 * un problema de permisos.
 */
export default async function AmigoPage({ params, searchParams }: PageProps) {
  const { playerId } = await params
  const { error, desde } = await searchParams
  const supabase = await serverClient()

  const [nombres, partidos, amigos, { data: yo }] = await Promise.all([
    playerNames(supabase, [playerId]),
    historyWith(supabase, playerId),
    friendsOf(supabase),
    supabase.rpc('my_player_id'),
  ])

  const nombre = nombres.get(playerId)
  if (nombre === undefined) notFound()

  const corto = nombre.trim().split(/\s+/)[0] ?? nombre
  const resumen = resumenDe(partidos)
  const deportes = deportesDe(partidos)
  const enContra = partidos.filter((partido) => !partido.together)
  const juntos = partidos.filter((partido) => partido.together)
  const desdeAmigos = desde === 'amigos'

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-bg pb-[calc(104px+env(safe-area-inset-bottom))] text-text">
      <Hero
        back={desdeAmigos ? { href: '/amigos', label: 'Amigos' } : { href: '/torneos', label: 'Inicio' }}
        // Un solo deporte pinta el bloque con su color; con varios, azul cancha.
        sport={deportes.kinds.length === 1 ? deportes.kinds[0] : undefined}
        title={nombre}
        subtitle={
          resumen.total === 0
            ? 'Sin partidos todavía'
            : `${cuantos(resumen.total, 'partido', 'partidos')} de ${deportes.texto}`
        }
      >
        <CaraACara partidos={partidos} registro={resumen.enContra} juntos={resumen.juntos} nombre={corto} />
      </Hero>

      {error !== undefined && (
        <p role="alert" className="mx-4 mt-4 rounded-btn bg-live-bg px-3 py-2.5 text-[15px] font-semibold text-live">
          {error}
        </p>
      )}

      {resumen.total === 0 && (
        <p className="px-4 pt-5 text-[16px] text-muted">El primero que carguen queda acá.</p>
      )}

      {enContra.length > 0 && (
        <Section title="Últimos partidos" className="[&>div]:mb-1">
          <div className="-mx-4">
            <Historial nombre={nombre} friendPlayerId={playerId} partidos={enContra} desde={desde} yo={yo ?? undefined} />
          </div>
        </Section>
      )}

      {juntos.length > 0 && (
        <Section
          title="Juntos"
          className="pt-7 [&>div]:mb-1"
          // Sin enfrentados, el bloque de arriba ya es este número: no se repite.
          action={
            enContra.length > 0 ? (
              <Marcador
                registro={resumen.juntos}
                etiqueta={`Juntos: ganaron ${resumen.juntos.won}, perdieron ${resumen.juntos.lost}`}
              />
            ) : undefined
          }
        >
          <div className="-mx-4">
            <Historial nombre={nombre} friendPlayerId={playerId} partidos={juntos} desde={desde} yo={yo ?? undefined} />
          </div>
        </Section>
      )}

      <CargarConAmigo
        friendPlayerId={playerId}
        nombre={nombre}
        friends={amigos
          .filter((amigo) => amigo.accepted)
          .map((amigo) => ({ playerId: amigo.playerId, displayName: amigo.displayName }))}
      />
    </main>
  )
}

/** "3 a 1" chico, para el título de la sección de compañeros. */
function Marcador({ registro, etiqueta }: { registro: Registro; etiqueta: string }) {
  return (
    <span role="img" aria-label={etiqueta} className="flex items-baseline gap-[5px]">
      <span className="font-cond text-[30px]">{registro.won}</span>
      <small className="text-[15px] font-semibold text-muted">a</small>
      <span className="font-cond text-[30px]">{registro.lost}</span>
    </span>
  )
}

/**
 * El cara a cara del prototipo, adentro del bloque: tus ganados (en
 * amarillo: son tuyos) "a" los suyos, en 120 px, y la racha de los últimos
 * resultados, del más viejo al más nuevo: llena si ganaste, hueca si
 * perdiste, baja si empataron. Sale de la MISMA lista de abajo (`resumenDe`,
 * plan 2a §4.4): cero consultas nuevas.
 *
 * Es el de enfrentados. Si sólo jugaron de compañeros, es el de la pareja, y
 * va en blanco: ganaron los dos, no sólo vos.
 */
function CaraACara({
  partidos,
  registro,
  juntos,
  nombre,
}: {
  partidos: readonly SharedMatch[]
  registro: Registro
  juntos: Registro
  nombre: string
}) {
  const hayContra = registro.won + registro.lost + registro.drew > 0
  const hayJuntos = juntos.won + juntos.lost + juntos.drew > 0
  if (!hayContra && !hayJuntos) return null
  const cuenta = hayContra ? registro : juntos
  const racha = partidos
    .filter((partido) => partido.outcome !== null && partido.together === !hayContra)
    .slice(0, RACHA)
    .reverse()
  const primero = racha[0]?.playedOn ?? null
  const ultimo = racha.at(-1)?.playedOn ?? null
  const empates = cuenta.drew > 0 ? `, ${cuantos(cuenta.drew, 'empate', 'empates')}` : ''
  const etiqueta = hayContra
    ? `Cara a cara: ganaste ${cuenta.won}, ganó ${nombre} ${cuenta.lost}${empates}. Últimos ${racha.length} resultados.`
    : `Juntos: ganaron ${cuenta.won}, perdieron ${cuenta.lost}${empates}. Últimos ${racha.length} resultados.`
  return (
    <div role="img" aria-label={etiqueta} className="mt-5">
      <div aria-hidden="true" className="grid grid-cols-[1fr_auto_1fr] items-end">
        <span className={`font-cond text-[120px] leading-[.8] ${hayContra ? 'text-vos' : ''}`}>{cuenta.won}</span>
        <span className="pb-2 text-[22px] font-bold text-on-block-soft">a</span>
        <span className="font-cond text-right text-[120px] leading-[.8]">{cuenta.lost}</span>
      </div>
      <div aria-hidden="true" className="mt-2.5 flex justify-between gap-3 text-[16px] font-bold">
        <span className={hayContra ? 'text-vos' : ''}>{hayContra ? 'Ganaste vos' : 'Ganaron juntos'}</span>
        {cuenta.drew > 0 && <span className="text-on-block-soft">{cuantos(cuenta.drew, 'empate', 'empates')}</span>}
        <span className="text-on-block-soft">{hayContra ? `Ganó ${nombre}` : 'Perdieron'}</span>
      </div>
      {racha.length > 1 && (
        <>
          <div aria-hidden="true" className="mt-5 flex items-center gap-[5px]">
            {racha.map((partido, index) => (
              <i
                key={index}
                className={`max-w-[28px] flex-1 rounded-[5px] ${
                  partido.outcome === 'won'
                    ? `h-[22px] ${hayContra ? 'bg-vos' : 'bg-on-block'}`
                    : partido.outcome === 'lost'
                      ? 'h-[22px] shadow-[inset_0_0_0_2px_var(--color-on-block-soft)]'
                      : 'h-[8px] bg-on-block-soft'
                }`}
              />
            ))}
          </div>
          {primero !== null && ultimo !== null && (
            <div aria-hidden="true" className="mt-1.5 flex justify-between text-[14px] text-on-block-soft">
              <span>{matchdayDay(primero)}</span>
              <span>{matchdayDay(ultimo)}</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
