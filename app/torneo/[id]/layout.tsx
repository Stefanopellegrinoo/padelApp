import Link from 'next/link'
import type { ReactNode } from 'react'
import { seasonHeader } from '@/db/read'
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
 * La vuelta a Mis torneos vive acá y no en cada `page.tsx`, aunque el header de
 * cada pantalla sí sea de cada pantalla: no es contenido, es la salida del
 * shell, el par de la nav de abajo. Entrando a un torneo no había forma de
 * salir sin el botón del navegador, y las cuatro pestañas se mueven entre sí
 * pero ninguna sube. Por eso está en las cuatro y no en una.
 */
export default async function TorneoLayout({ children, params }: TorneoLayoutProps) {
  const { id } = await params
  const supabase = await serverClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user === null) {
    return (
      <div className="flex min-h-screen flex-col bg-bg text-text">
        <main className="flex-1 px-5 pb-6">{children}</main>
      </div>
    )
  }

  await seasonHeader(supabase, id)

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <div className="px-5 pt-4">
        <Link
          href="/torneos"
          className="inline-flex rounded-full bg-chip px-[14px] py-2 text-[12.5px] font-bold"
        >
          ← Mis torneos
        </Link>
      </div>
      <main className="flex-1 px-5 pb-6">{children}</main>
      <TorneoNav seasonId={id} />
    </div>
  )
}
