import { redirect } from 'next/navigation'
import { disciplineSlugs } from '@/core'
import { EdgeError } from '@/db/errors'
import { primaryDiscipline, seasonHeader } from '@/db/read'
import { serverClient } from '@/db/server'

interface PageProps {
  params: Promise<{ id: string; entryId: string }>
}

/**
 * `/torneo/{id}/jugador/{entryId}` sin disciplina — la ruta que esta pantalla
 * tenía hasta que Task 2 (`docs/plan-arquitectura-de-paginas.md`) la movió
 * bajo `[disciplina]/jugador/{entryId}`: leía `entriesOf`/`closedHistoryAll`/
 * `awardsOf` sin disciplina, cayendo en la disciplina por defecto vía
 * `primaryDiscipline(header)`, y las estadísticas mostradas eran siempre las
 * de esa disciplina sin importar cuál jugara el jugador (§2.1 de
 * `docs/arquitectura-de-paginas.md`).
 *
 * Se deja un redirect, no un 404 — mismo criterio y misma forma que
 * `app/torneo/[id]/stats/page.tsx`, que ya resolvió este problema para
 * Estadísticas: a la disciplina `[0]` (`position, created_at`), no a una
 * "adivinada".
 *
 * La Tabla GLOBAL (`app/torneo/[id]/page.tsx`) YA NO pasa por acá: sus
 * filas no son clickeables (`base: null` en `Desempate`, decisión del
 * dueño — no hay un perfil de UNA disciplina al que apuntar). Este redirect
 * queda como compatibilidad para bookmarks y links viejos a esta ruta,
 * compartidos antes de la migración de rutas de Task 2. No es un camino
 * muerto: sigue siendo el único destino de esos links.
 */
export default async function JugadorRedirectPage({ params }: PageProps) {
  const { id: seasonId, entryId } = await params
  const supabase = await serverClient()
  const header = await seasonHeader(supabase, seasonId)
  const slug = disciplineSlugs(header.disciplines).get(primaryDiscipline(header).id)
  if (slug === undefined) throw new EdgeError('La disciplina de la temporada no existe.')
  redirect(`/torneo/${seasonId}/${slug}/jugador/${entryId}`)
}
