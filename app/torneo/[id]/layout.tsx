import type { ReactNode } from 'react'
import { disciplineSlugs } from '@/core'
import { EdgeError } from '@/db/errors'
import { primaryDiscipline, seasonHeader } from '@/db/read'
import { serverClient } from '@/db/server'
import { TorneoNav } from './nav'

interface TorneoLayoutProps {
  children: ReactNode
  params: Promise<{ id: string }>
}

/**
 * El shell de todas las pantallas del torneo: guarda de acceso vía RLS
 * —`seasonHeader` tira `EdgeError` si la temporada no existe o el caller no
 * tiene lugar en ella—, contenedor con el padding común y la nav fija de 4. El
 * header de cada pantalla (kicker, título, botón) es contenido de cada
 * `page.tsx`, no de este layout.
 *
 * **Sin sesión el layout no pregunta nada y no dibuja la nav.** Reglas es
 * pública y este layout la estaba frenando antes de que se montara. Las demás
 * pantallas del torneo siguen siendo privadas: lo único que cambia es QUIÉN las
 * frena — antes el layout, ahora la query, que para un anónimo no devuelve nada
 * porque RLS no le otorgó un solo SELECT. La nav tampoco tendría sentido: quien
 * llega por el link no tiene a dónde ir.
 *
 * La vuelta a Mis torneos NO vive acá. Estuvo, en las cuatro pestañas, y era de
 * más: Tabla, Fechas, Stats y Reglas son hermanas y la nav de abajo ya las
 * conecta, así que repetir la salida en las cuatro es ruido. Va sólo donde de
 * verdad se sube un nivel — `page.tsx` (Tabla) y `ajustes/page.tsx` — con el
 * componente `Volver`.
 */
export default async function TorneoLayout({ children, params }: TorneoLayoutProps) {
  const { id } = await params
  const supabase = await serverClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user === null) {
    return (
      <div className="flex min-h-dvh flex-col bg-bg text-text">
        <main className="flex-1 px-5 pb-6">{children}</main>
      </div>
    )
  }

  const header = await seasonHeader(supabase, id)
  // PR13c slice B: la pestaña "Fechas" necesita un destino con disciplina
  // (C12, `[disciplina]/fechas`). Ésta es la disciplina [0] — el mismo
  // fallback que ya usa `defaultDisciplineId`/`primaryDiscipline` — para
  // cuando la pantalla actual no trae ninguna en su URL (Tabla global,
  // Ajustes, Stats, Reglas). El `throw` es el mismo supuesto sin efecto
  // práctico que `disciplineOf`/`primaryDiscipline`: garantizado por REQ-NR-4.
  const defaultDisciplineSlug = disciplineSlugs(header.disciplines).get(primaryDiscipline(header).id)
  if (defaultDisciplineSlug === undefined) throw new EdgeError('La disciplina de la temporada no existe.')

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-text">
      <main className="flex-1 px-5 pb-6">{children}</main>
      <TorneoNav seasonId={id} defaultDisciplineSlug={defaultDisciplineSlug} />
    </div>
  )
}
