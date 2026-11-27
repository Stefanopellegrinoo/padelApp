import { genteDeTusTorneos } from '@/db/friends'
import { serverClient } from '@/db/server'
import { GenteTodas } from './todas'

/**
 * `/amigos/gente`: "Ver todas" de "Gente de tus torneos" (odd/tasks/amigos-faciles.md,
 * S10). Llegan desde "Ver todas (N)" en Amigos y "Ver más gente" en Inicio.
 *
 * Es un segmento fijo, así que gana sobre `/amigos/[playerId]`; y está bajo
 * `/amigos`, que `middleware.ts` ya cierra sin sesión. Lee la lista entera
 * con los mismos techos que Amigos (`genteDeTusTorneos` pagina y parte las
 * IN); el filtro y el "de a 20" van en el cliente (`todas.tsx`). `?torneo=`
 * es el filtro elegido; repetido, vale el primero.
 */
export default async function GenteDeTusTorneosPage({
  searchParams,
}: {
  searchParams: Promise<{ torneo?: string | string[] }>
}) {
  const [supabase, { torneo }] = await Promise.all([serverClient(), searchParams])
  const gente = await genteDeTusTorneos(supabase)
  const elegido = Array.isArray(torneo) ? (torneo[0] ?? null) : (torneo ?? null)

  return <GenteTodas gente={gente} torneo={elegido} />
}
