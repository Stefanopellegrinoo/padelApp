import { disciplineSlugs } from '@/core'
import type { Client } from './client'
import { seasonHeader, seasonMatchdaysOf } from './read'

const LEGACY_FECHA_PATH = /^\/torneo\/([^/]+)\/fechas\/([^/]+)\/?$/

export interface LegacyFechaPath {
  seasonId: string
  n: string
}

/**
 * REQ-NR-5: `/torneo/{id}/fechas/{n}` — la URL vieja de una fecha puntual,
 * sin disciplina. `null` para cualquier otra cosa: la ruta nueva
 * (`/{id}/{disciplina}/fechas/{n}`), la lista (`/{id}/fechas`, sin número) o
 * cualquier otra pantalla del torneo — todas siguen de largo sin tocar la
 * base. Pura a propósito: la resuelve `middleware.ts` en el edge, antes de
 * cualquier consulta, así que el 99% de los requests no paga ni un regex de
 * más costoso que esto.
 */
export function parseLegacyFechaPath(pathname: string): LegacyFechaPath | null {
  const match = LEGACY_FECHA_PATH.exec(pathname)
  if (match === null) return null
  const [, seasonId, n] = match
  if (seasonId === undefined || n === undefined) return null
  return { seasonId, n }
}

/**
 * A dónde redirigir esa URL vieja — la disciplina de ESA fecha puntual,
 * derivada con el mismo `disciplineSlugs` que ya usa la lista de fechas
 * (`app/torneo/[id]/fechas/page.tsx`) y la ruta nueva. `null` cuando la
 * fecha no existe: no hay nada armado todavía que redirigir, y dejarla
 * seguir de largo (sin redirigir) deja que el resto de la app decida qué
 * mostrar — no es responsabilidad de este redirect inventar un destino.
 */
export async function legacyFechaRedirectTarget(
  supabase: Client,
  legacy: LegacyFechaPath,
): Promise<string | null> {
  const matchdayNumber = Number(legacy.n)
  const [header, matchdays] = await Promise.all([
    seasonHeader(supabase, legacy.seasonId),
    seasonMatchdaysOf(supabase, legacy.seasonId),
  ])
  const matchday = matchdays.find((candidate) => candidate.number === matchdayNumber)
  if (matchday === undefined) return null

  const slug = disciplineSlugs(header.disciplines).get(matchday.disciplineId)
  if (slug === undefined) return null

  return `/torneo/${legacy.seasonId}/${slug}/fechas/${legacy.n}`
}
