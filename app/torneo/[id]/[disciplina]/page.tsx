import { notFound } from 'next/navigation'
import { resolveDisciplineBySlug } from '@/core'
import { entriesOf, seasonAwardsOf, seasonHeader, seasonMatchdaysOf } from '@/db/read'
import { serverClient } from '@/db/server'
import { TablaView } from '../tabla-view'

interface PageProps {
  params: Promise<{ id: string; disciplina: string }>
}

/**
 *Tabla de UNA disciplina (PR12b, slice 1/2 de REQ-D9). Hasta esta PR la
 * Tabla vivía sólo en la raíz de la temporada (`/torneo/[id]`), atada a la
 * disciplina por defecto; esta ruta le da a cada disciplina su propia URL
 * estable, dejando la raíz libre para que slice 2 la convierta en la tabla
 * global. Mismo patrón de resolución que `fechas/[n]/page.tsx`: slug
 * desconocido o de otra temporada -> notFound().
 */
export default async function DisciplinaTablaPage({ params }: PageProps) {
  const { id: seasonId, disciplina } = await params
  const supabase = await serverClient()

  const [header, seasonMatchdays] = await Promise.all([
    seasonHeader(supabase, seasonId),
    seasonMatchdaysOf(supabase, seasonId),
  ])

  const discipline = resolveDisciplineBySlug(header.disciplines, disciplina)
  if (discipline === undefined) notFound()

  const [entries, awardsByDiscipline] = await Promise.all([
    entriesOf(supabase, seasonId, discipline.id),
    seasonAwardsOf(supabase, seasonMatchdays),
  ])

  return (
    <TablaView
      header={header}
      discipline={discipline}
      entries={entries}
      matchdays={seasonMatchdays.filter((matchday) => matchday.disciplineId === discipline.id)}
      awardsByMatchday={awardsByDiscipline.get(discipline.id) ?? new Map()}
    />
  )
}
