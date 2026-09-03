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
 * NO es sólo compatibilidad para un link viejo guardado, y acá es MÁS
 * load-bearing que en `stats/page.tsx`: la Tabla GLOBAL
 * (`app/torneo/[id]/page.tsx:143`, sólo se dibuja con 2+ disciplinas, donde
 * el punto de arriba importa) le pasa a `Desempate` un `base` sin
 * disciplina a propósito -- sus filas suman puntos de TODAS y no hay una
 * sola a la que apuntar (ver el comentario ahí). Cada click de fila de esa
 * tabla cae en `/torneo/{seasonId}/jugador/{entryId}` y pasa por ESTE
 * archivo antes de llegar a algún perfil. Borrarlo por "compat muerta" no
 * rompe un bookmark: rompe la única interacción de la Tabla global.
 */
export default async function JugadorRedirectPage({ params }: PageProps) {
  const { id: seasonId, entryId } = await params
  const supabase = await serverClient()
  const header = await seasonHeader(supabase, seasonId)
  const slug = disciplineSlugs(header.disciplines).get(primaryDiscipline(header).id)
  if (slug === undefined) throw new EdgeError('La disciplina de la temporada no existe.')
  redirect(`/torneo/${seasonId}/${slug}/jugador/${entryId}`)
}
