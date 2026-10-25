'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { hayAnterior, registrar } from './historial'

/**
 * La flecha de volver, el mismo chip arriba a la izquierda en toda la app.
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
 * El chip se dibuja chico y el área de toque igual mide 44: el `<Link>` es la
 * caja de 44 y el `<span>` es lo que se ve. Es el mismo patrón que las cruces
 * del plantel — achicar el dibujo no tiene por qué achicar el blanco al que hay
 * que apuntar. El `-mt-1.5` se come el aire que sobra arriba, así que ocupa lo
 * que ocupa un chip chico aunque se pueda tocar como uno grande.
 */
export function Volver({ href, label }: { href: string; label?: string }) {
  return (
    <Link
      href={href}
      onClick={(event) => {
        if (label !== undefined || !hayAnterior()) return
        event.preventDefault()
        history.back()
      }}
      className="-mt-1.5 -mb-1.5 flex min-h-[44px] w-fit items-center"
    >
      <span className="rounded-full bg-chip px-3 py-1.5 text-[12px] font-bold">← {label ?? 'Volver'}</span>
    </Link>
  )
}

/** Anota cada pantalla en `historial.ts`. Va una sola vez, en el layout raíz. */
export function Historial() {
  const pathname = usePathname()
  useEffect(() => registrar(pathname), [pathname])
  return null
}
