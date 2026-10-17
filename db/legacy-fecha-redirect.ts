import { disciplineSlugs } from '@/core'
import type { Client } from './client'
import { seasonHeader, seasonMatchdaysOf } from './read'

//`n` sólo dígitos. `/fechas/reglas` matcheaba
// antes ("reglas" cumple `[^/]+`) y colaba una fecha vieja pública al camino
// legacy con el cliente anon — acá es donde corresponde cortarlo: es la
// definición de qué ES una fecha vieja, no un caso aparte en el parse.
const LEGACY_FECHA_PATH = /^\/torneo\/([^/]+)\/fechas\/([0-9]+)\/?$/

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
  //`number` es único por disciplina, no por
  //Temporada (REQ-D3-2) — dos disciplinas pueden compartir "fecha 2", y ese
  // empate es un estado LEGÍTIMO, no un agujero de integridad. Buscar sólo
  // por número sin desempate deja el destino sin definir, y el 308 es
  // PERMANENTE (cacheado por el browser, RFC 7538): la disciplina equivocada
  // queda pegada. El bookmark legacy es, por construcción, anterior a
  // cualquier segunda disciplina — recorrer `header.disciplines` EN ORDEN
  // (ya llega `position, created_at`) y quedarse con la primera que tenga
  // esa fecha reproduce la intención del link viejo de forma determinística.
  const matchday = header.disciplines
    .map((discipline) =>
      matchdays.find(
        (candidate) => candidate.number === matchdayNumber && candidate.disciplineId === discipline.id,
      ),
    )
    .find((candidate) => candidate !== undefined)
  if (matchday === undefined) return null

  const slug = disciplineSlugs(header.disciplines).get(matchday.disciplineId)
  if (slug === undefined) return null

  return `/torneo/${legacy.seasonId}/${slug}/fechas/${legacy.n}`
}
