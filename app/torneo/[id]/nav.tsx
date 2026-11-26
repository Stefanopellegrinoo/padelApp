'use client'

import Link, { useLinkStatus } from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { currentDisciplineSlug, navTabs, sportKindAt } from './nav-state'

interface TorneoNavProps {
  seasonId: string
  /** Disciplina [0] de la temporada — a dónde apuntan Tabla, Fechas y Stats cuando la URL actual no trae ninguna (contenedor, Ajustes, Reglas) y todavía no se pasó por ningún deporte. */
  defaultDisciplineSlug: string
}

/**
 * El contenedor de las pantallas del torneo, con el color del deporte que se
 * está mirando (`data-deporte`, ver `globals.css`): la barra de abajo, los
 * chips y todo lo que use `sport`/`block` adentro lo toman de acá. El layout
 * es de servidor y no sabe la URL; esto sí. Sin deporte en la URL (la tabla
 * general, Reglas, Ajustes) queda el azul de siempre.
 */
export function ContenedorTorneo({
  seasonId,
  sports,
  children,
}: {
  seasonId: string
  sports: readonly { slug: string; kind: string }[]
  children: ReactNode
}) {
  const kind = sportKindAt(seasonId, sports, usePathname())
  return (
    <div data-deporte={kind ?? undefined} className="flex min-h-dvh flex-col bg-bg text-text">
      {children}
    </div>
  )
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
    // La barra de pestañas del prototipo: cuatro columnas iguales, ícono y
    // nombre, la activa en el color del deporte con la rayita arriba. El
    // fondo llega al borde y paga el área segura de abajo.
    <nav
      aria-label="Torneo"
      className="sticky bottom-0 z-40 grid grid-cols-4 border-t border-line bg-bg pb-[env(safe-area-inset-bottom)] dark:bg-surface"
    >
      {tabs.map((tab) => (
        // 62 de alto: es lo que más se toca de la app, y errarle a una
        // pestaña te manda a otra pantalla.
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
          aria-current={tab.isActive ? 'page' : undefined}
          className="press-fila relative flex min-h-[62px] items-center justify-center"
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
    <span
      className={`flex flex-col items-center gap-[3px] text-[13px] ${
        lit
          ? "font-[750] text-sport before:absolute before:inset-x-[22%] before:top-0 before:h-[3px] before:rounded-b-[3px] before:bg-sport before:content-['']"
          : 'font-semibold text-muted'
      }`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-6 w-6 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
      >
        {ICONS[label]}
      </svg>
      {label}
    </span>
  )
}

/** Los trazos del prototipo (`design/prototipo/fuente.html`, los `symbol` i-table, i-cal, i-chart, i-rules). */
const ICONS: Record<string, ReactNode> = {
  Tabla: (
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <path d="M8 4v16" />
    </>
  ),
  Fechas: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  Stats: <path d="M5 20V11M12 20V5M19 20v-6" />,
  Reglas: (
    <>
      <path d="M6 3.5h9l4 4v13H6z" />
      <path d="M9.5 11.5h6M9.5 15.5h6" />
    </>
  ),
}
