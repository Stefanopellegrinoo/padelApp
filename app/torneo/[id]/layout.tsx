import type { ReactNode } from 'react'
import { seasonHeader } from '@/db/read'
import { serverClient } from '@/db/server'
import { TorneoNav } from './nav'

interface TorneoLayoutProps {
  children: ReactNode
  params: Promise<{ id: string }>
}

/**
 * El shell de todas las pantallas del torneo (Tasks 6 a 11): guarda de acceso
 * vía RLS —`seasonHeader` tira `EdgeError` si la temporada no existe o el
 * caller no tiene lugar en ella—, contenedor con el padding común y la nav
 * fija de 4. El header de cada pantalla (kicker, título, botón) es contenido
 * de cada `page.tsx`, no de este layout.
 */
export default async function TorneoLayout({ children, params }: TorneoLayoutProps) {
  const { id } = await params
  const supabase = await serverClient()
  await seasonHeader(supabase, id)

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <main className="flex-1 px-5 pb-6">{children}</main>
      <TorneoNav seasonId={id} />
    </div>
  )
}
