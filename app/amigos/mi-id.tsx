'use client'

import { useState } from 'react'

/**
 * Tu ID, para pasárselo a un amigo. `ponytail`: no hay buscador de jugadores
 * por nombre -- el diseño lo deja fuera de este plan (§7, "No fusiona nada
 * automáticamente" es el pariente cercano) -- así que el ID a mano es la
 * única forma de decir "este sos vos" sin adivinar. Subir a un buscador el
 * día que copiar un uuid a mano moleste de verdad.
 *
 * Donde el teléfono sabe compartir (`navigator.share`), "Compartir" abre el
 * menú del sistema para mandarlo por WhatsApp de una; si no, lo copia. El
 * estado vuelve por la región viva ("Copiado").
 *
 * Sólo `playerId`, nunca un import de `db/server` ni de `@/db/friends`: un
 * componente `'use client'` que se arrastre `next/headers` rompe el build de
 * producción sin que `tsc` ni los tests lo vean (`db/server.ts`, comentario
 * de arriba del todo) -- exactamente la trampa que este handoff nombra.
 */
export function MiId({ playerId }: { playerId: string }) {
  const [copied, setCopied] = useState(false)
  if (playerId === '') return null

  const compartir = async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text: playerId })
        return
      } catch {
        // Cancelado o sin permiso: queda copiarlo.
      }
    }
    await navigator.clipboard?.writeText(playerId)
    setCopied(true)
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[15px] font-semibold text-muted">Tu ID</span>
      <div className="flex items-center gap-2 rounded-tile bg-surface p-2 pl-3">
        <code className="min-w-0 flex-1 truncate font-mono text-[15px] text-text">{playerId}</code>
        <button
          type="button"
          onClick={() => void compartir()}
          className="min-h-[44px] shrink-0 rounded-btn bg-opcion px-4 text-[16px] font-bold text-accent-link shadow-[inset_0_0_0_1.5px_var(--color-opcion-borde)]"
        >
          Compartir
        </button>
      </div>
      <p aria-live="polite" className="min-h-5 text-[15px] font-semibold text-up empty:hidden">
        {copied ? 'Copiado' : ''}
      </p>
    </div>
  )
}
