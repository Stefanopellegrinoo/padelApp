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
    // Arriba de todo, en el color del bloque, pegado al encabezado de la
    // pantalla (`Hero`): se lee como parte de él. `overflow-x-auto` en la fila
    // y no en la página: con muchos deportes scrollea el carril de chips, no
    // el body. `shrink-0` + `whitespace-nowrap` en cada chip para que ninguno
    // se parta en dos líneas ni se achique. El encendido es la píldora blanca
    // del bloque (`onBlock`); los otros, el contorno.
    <nav
      aria-label="Deportes"
      className="flex gap-2 overflow-x-auto bg-block px-4 pt-[calc(8px+env(safe-area-inset-top))] pb-1 [--color-focus:var(--color-on-block)]"
    >
      {chips.map((chip) => (
        <Link
          key={chip.href}
          href={chip.href}
          aria-current={chip.isActive ? 'page' : undefined}
          className={`press flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-pill px-4 text-[15px] font-bold ${
            chip.isActive
              ? 'bg-on-block text-block'
              : 'text-on-block ring-[1.5px] ring-on-block-soft ring-inset active:bg-on-block/15'
          }`}
        >
          {chip.label}
        </Link>
      ))}
    </nav>
  )
}
