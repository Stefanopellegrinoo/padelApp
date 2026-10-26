'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { sportChips } from './nav-state'

interface ChipsDeporteProps {
  seasonId: string
  /** Los deportes de la temporada en orden (`position`), con el slug de URL y el nombre ya resueltos. */
  sports: readonly { slug: string; label: string }[]
}

export function ChipsDeporte({ seasonId, sports }: ChipsDeporteProps) {
  const pathname = usePathname()
  const statsQuery = useSearchParams().get('tab') === 'mias' ? '?tab=mias' : ''
  const chips = sportChips(seasonId, sports, pathname, statsQuery)
  if (chips.length === 0) return null

  return (
    // `overflow-x-auto` en la fila y no en la página: con muchos deportes
    // scrollea el carril de chips, no el body. `shrink-0` + `whitespace-nowrap`
    // en cada chip para que ninguno se parta en dos líneas ni se achique.
    <nav aria-label="Deportes" className="flex gap-2 overflow-x-auto pt-3">
      {chips.map((chip) => (
        // Mismo chip que "Del torneo"/"Mías" de Stats (`[disciplina]/stats/page.tsx`).
        <Link
          key={chip.href}
          href={chip.href}
          aria-current={chip.isActive ? 'page' : undefined}
          className={`flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-full px-[15px] text-[12px] font-extrabold ${
            chip.isActive ? 'bg-accent text-accent-text' : 'bg-chip text-muted'
          }`}
        >
          {chip.label}
        </Link>
      ))}
    </nav>
  )
}
