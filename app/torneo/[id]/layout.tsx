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
 * verdad se sube un nivel, con el componente `Volver`: la Tabla (`page.tsx`,
 * la global; `tabla-view.tsx`, la de cada disciplina) y Ajustes
 * (`ajustes/page.tsx`, el contenedor; y desde Task 4,
 * `[disciplina]/ajustes/page.tsx`, de vuelta al contenedor).
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
  // Tabla, Fechas y Stats necesitan un destino con disciplina
  // (`nav-state.ts`; las tres comparten el mismo fallback, Reglas no).
  // Ésta es la disciplina [0] — el mismo fallback que ya usa
  // `defaultDisciplineId`/`primaryDiscipline` — para cuando la pantalla
  // actual no trae ninguna en su URL: el contenedor, Ajustes y Reglas son
  // los únicos que no la tienen (Stats se mudó bajo `[disciplina]` en la
  // Task 1 del plan de arquitectura de páginas). El `throw` es el mismo
  // supuesto sin efecto práctico que `disciplineOf`/`primaryDiscipline`:
  // garantizado por REQ-NR-4.
  const defaultDisciplineSlug = disciplineSlugs(header.disciplines).get(primaryDiscipline(header).id)
  if (defaultDisciplineSlug === undefined) throw new EdgeError('La disciplina de la temporada no existe.')

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-text">
      <main className="flex-1 px-5 pb-6">{children}</main>
      <TorneoNav seasonId={id} defaultDisciplineSlug={defaultDisciplineSlug} />
    </div>
  )
}
