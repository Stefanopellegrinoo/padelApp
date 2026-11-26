'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { hayAnterior, registrar } from './historial'

/**
 * La flecha de volver, arriba a la izquierda en toda la app: una flecha y el
 * destino ("‹ Mis torneos"), como en el prototipo. No tiene color propio:
 * toma el del texto de alrededor, así que sobre el bloque de `Hero` sale
 * blanca y sobre el fondo, tinta. Al apretarla se tiñe de ese mismo color.
 *
 * Sin `label` desanda (`history.back()`, que el router de Next atiende como
 * cualquier atrás): vuelve a la pantalla de la que viniste (al jugador
 * desde Stats, Volver te deja en Stats, no en la Tabla). Si no viniste de
 * ninguna —abriste el link directo— va a `href`, que es subir un nivel.
 *
 * Con `label` va siempre a `href`: es salir de la sección (la Tabla a Mis
 * torneos), donde lo que haya atrás en el historial son pestañas hermanas y
 * desandarlas te pasearía por ellas. Ahí el destino es fijo y se nombra.
 *
 * Con `label` y `desanda` nombra el destino y desanda igual (si hay algo
 * atrás; si no, `href`): para cuando todo lo que puede haber atrás tiene el
 * mismo nombre (el torneo rápido: se llega desde Inicio o desde la portada).
 *
 * El `<Link>` es la caja de 44 aunque el texto mida menos: achicar el dibujo
 * no tiene por qué achicar el blanco al que hay que apuntar. El `-my-1.5` se
 * come el aire que sobra, y el `-ml-1` alinea la flecha con el margen.
 */
export function Volver({ href, label, desanda = label === undefined }: { href: string; label?: string; desanda?: boolean }) {
  return (
    <Link
      href={href}
      onClick={(event) => {
        if (!desanda || !hayAnterior()) return
        event.preventDefault()
        history.back()
      }}
      className="press -my-1.5 -ml-1 flex min-h-[44px] w-fit items-center gap-1 rounded-[12px] pr-3 pl-0.5 text-[16px] font-semibold active:bg-current/15"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-6 w-6 shrink-0 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
      >
        <path d="M15 5l-7 7 7 7" />
      </svg>
      {label ?? 'Volver'}
    </Link>
  )
}

/** Anota cada pantalla en `historial.ts`. Va una sola vez, en el layout raíz. */
export function Historial() {
  const pathname = usePathname()
  useEffect(() => registrar(pathname), [pathname])
  return null
}
