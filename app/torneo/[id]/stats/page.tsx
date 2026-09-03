import { redirect } from 'next/navigation'
import { disciplineSlugs } from '@/core'
import { EdgeError } from '@/db/errors'
import { primaryDiscipline, seasonHeader } from '@/db/read'
import { serverClient } from '@/db/server'

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}

/**
 * `/torneo/{id}/stats` sin disciplina — la ruta que esta pantalla tenía hasta
 * que Task 1 (`docs/plan-arquitectura-de-paginas.md`) la movió bajo
 * `[disciplina]/stats`: leía `entriesOf`/`closedHistoryAll`/`awardsOf` sin
 * disciplina, cayendo en `defaultDisciplineId`, y el título nunca decía de
 * qué disciplina eran los números (§2.1 de `docs/arquitectura-de-paginas.md`).
 *
 * NO es sólo compatibilidad para un link viejo guardado: `nav.tsx:66` todavía
 * apunta el `href` de la pestaña Stats acá (Task 3 es quien lo va a scopear a
 * la disciplina actual). Hasta que eso pase, TODO toque de esa pestaña pasa
 * por este redirect — borrarlo por "compat muerta" rompe la pestaña, no un
 * bookmark.
 *
 * Se deja un redirect, no un 404 — mismo criterio y misma forma que
 * `app/torneo/[id]/fechas/page.tsx:29-36`, que ya resolvió este problema para
 * la lista de fechas: a la disciplina `[0]` (`position, created_at`), no a
 * una "adivinada". El `?tab=mias` de la URL vieja se preserva en el redirect.
 */
export default async function StatsRedirectPage({ params, searchParams }: PageProps) {
  const { id: seasonId } = await params
  const { tab } = await searchParams
  const supabase = await serverClient()
  const header = await seasonHeader(supabase, seasonId)
  const slug = disciplineSlugs(header.disciplines).get(primaryDiscipline(header).id)
  if (slug === undefined) throw new EdgeError('La disciplina de la temporada no existe.')
  redirect(`/torneo/${seasonId}/${slug}/stats${tab === 'mias' ? '?tab=mias' : ''}`)
}
