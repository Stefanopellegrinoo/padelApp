'use client'

import Link, { useLinkStatus } from 'next/link'
import { usePathname } from 'next/navigation'
import { navTabs } from './nav-state'

interface TorneoNavProps {
  seasonId: string
  /** Disciplina [0] de la temporada — a dónde apuntan Tabla, Fechas y Stats cuando la URL actual no trae ninguna (contenedor, Ajustes, Reglas). */
  defaultDisciplineSlug: string
}

export function TorneoNav({ seasonId, defaultDisciplineSlug }: TorneoNavProps) {
  const pathname = usePathname()
  const tabs = navTabs(seasonId, defaultDisciplineSlug, pathname)

  return (
    <nav className="sticky bottom-0 flex border-t border-line bg-bg px-[22px] pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      {tabs.map((tab) => (
        // `min-h-[44px]` y no un alto fijo: 44 es el mínimo de la guía de
        // Apple y esto medía 37. Es lo que más se toca de la app, y errarle a
        // una pestaña te manda a otra pantalla.
        // `prefetch`: con un `loading.tsx` presente, Next precarga por defecto
        // sólo el esqueleto de una ruta dinámica y deja los datos para el
        // toque. Estas cuatro están siempre a la vista y son las que más se
        // tocan, así que conviene traerlas antes. Medido: la pantalla lista
        // pasó de 375ms a menos de la mitad, y el esqueleto sigue apareciendo
        // al instante para las veces que la precarga no llegó a tiempo.
        <Link
          key={tab.label}
          href={tab.href}
          prefetch
          className="flex min-h-[44px] flex-1 items-center justify-center"
        >
          <Pestana label={tab.label} active={tab.isActive} />
        </Link>
      ))}
    </nav>
  )
}

/**
 * Reads the parent `<Link>`'s navigation status. Must be its own component
 * rendered INSIDE the `<Link>`: `useLinkStatus` reads the nearest `<Link>`
 * ancestor, and calling it from `TorneoNav` (which renders the `<Link>`
 * itself) would always return `pending: false`.
 *
 * `active || pending`, not a separate "loading" look: on an already
 * prefetched tab this avoids a flicker (pending lights it up, then active
 * takes over — same paint either way).
 */
function Pestana({ label, active }: { label: string; active: boolean }) {
  const { pending } = useLinkStatus()
  const lit = active || pending
  return (
    <span className={`flex flex-col items-center gap-1 ${lit ? 'text-accent-link' : 'text-muted'}`}>
      <span className={`h-[19px] w-[19px] border-2 border-current ${lit ? 'bg-current' : ''}`} />
      <span className="text-[9.5px] font-extrabold">{label}</span>
    </span>
  )
}
