import { redirect } from 'next/navigation'
import { disciplineSlugs } from '@/core'
import { EdgeError } from '@/db/errors'
import { primaryDiscipline, seasonHeader } from '@/db/read'
import { serverClient } from '@/db/server'

interface PageProps {
  params: Promise<{ id: string }>
}

/**
 * `/torneo/{id}/fechas` sin disciplina — la ruta que esta pantalla tenía
 *Hasta que C12 la movió bajo `[disciplina]/fechas`
 *(REQ-D3-1/2): contaba las fechas de la disciplina por DEFECTO nada más, y
 * con 2+ disciplinas mentía ("10 FECHAS · 1 JUGADAS" medido, 1 disciplina
 * jugada de 2).
 *
 *Se deja un redirect, no un 404: a diferencia de `/fechas/{n}` (REQ-NR-5,
 * bookmark real de PnP-1000, resuelto en `middleware.ts` con 308), esta URL
 * sin número no tiene un requisito de no-regresión que la respalde, así que
 * no hace falta el mismo mecanismo — pero `cancelTheMatchday`
 * (`[disciplina]/fechas/[n]/actions.ts`) y algún script de `scripts/` todavía
 * la nombran, y un 404 ahí corta el flujo de borrar una fecha a la mitad.
 *
 * A la disciplina [0] (`position, created_at`), no a una "adivinada": es el
 * mismo criterio que ya usa `defaultDisciplineId`/`primaryDiscipline` en el
 * resto del código para "sin más contexto, la primera".
 */
export default async function FechasRedirectPage({ params }: PageProps) {
  const { id: seasonId } = await params
  const supabase = await serverClient()
  const header = await seasonHeader(supabase, seasonId)
  const slug = disciplineSlugs(header.disciplines).get(primaryDiscipline(header).id)
  if (slug === undefined) throw new EdgeError('La disciplina de la temporada no existe.')
  redirect(`/torneo/${seasonId}/${slug}/fechas`)
}
