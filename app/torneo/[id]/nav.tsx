'use client'

import Link, { useLinkStatus } from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { currentDisciplineSlug, navTabs } from './nav-state'

interface TorneoNavProps {
  seasonId: string
  /** Disciplina [0] de la temporada — a dónde apuntan Tabla, Fechas y Stats cuando la URL actual no trae ninguna (contenedor, Ajustes, Reglas) y todavía no se pasó por ningún deporte. */
  defaultDisciplineSlug: string
}

export function TorneoNav({ seasonId, defaultDisciplineSlug }: TorneoNavProps) {
  const pathname = usePathname()
  // El último deporte que se miró. Reglas y Ajustes no llevan deporte en la
  // URL; sin esto, pasar por ahí te devolvía al primero. Vive en el layout del
  // torneo, que no se desmonta al navegar entre sus pantallas.
  const current = currentDisciplineSlug(`/torneo/${seasonId}`, pathname)
  const [lastSlug, setLastSlug] = useState(defaultDisciplineSlug)
  if (current !== null && current !== lastSlug) setLastSlug(current)
  // Lo mismo con "Mías" de Stats: se recuerda la última pestaña que se miró ahí.
  const searchParams = useSearchParams()
  const [statsQuery, setStatsQuery] = useState('')
  const statsNow = searchParams.get('tab') === 'mias' ? '?tab=mias' : ''
  if (pathname.endsWith('/stats') && statsNow !== statsQuery) setStatsQuery(statsNow)
  const tabs = navTabs(seasonId, current ?? lastSlug, pathname, statsQuery)

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
          replace={tab.replace}
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
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="h-[22px] w-[22px]"
        fill="none"
        stroke="currentColor"
        strokeWidth={lit ? 2.4 : 2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {ICONS[label]}
      </svg>
      <span className="text-[12px] font-extrabold">{label}</span>
    </span>
  )
}

/** Trazos de Lucide (ISC), copiados a mano: cuatro íconos no justifican una dependencia. */
const ICONS: Record<string, ReactNode> = {
  Tabla: (
    <>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </>
  ),
  Fechas: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </>
  ),
  Stats: <path d="M3 3v18h18M18 17V9M13 17V5M8 17v-3" />,
  Reglas: (
    <>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </>
  ),
}
