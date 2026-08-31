'use client'

import { useState } from 'react'

/**
 * Tu ID, para pasárselo a un amigo. `ponytail`: no hay buscador de jugadores
 * por nombre -- el diseño lo deja fuera de este plan (§7, "No fusiona nada
 * automáticamente" es el pariente cercano) -- así que el ID a mano es la
 * única forma de decir "este sos vos" sin adivinar. Subir a un buscador el
 * día que copiar un uuid a mano moleste de verdad.
 *
 * Sólo `playerId`, nunca un import de `db/server` ni de `@/db/friends`: un
 * componente `'use client'` que se arrastre `next/headers` rompe el build de
 * producción sin que `tsc` ni los tests lo vean (`db/server.ts`, comentario
 * de arriba del todo) -- exactamente la trampa que este handoff nombra.
 */
export function MiId({ playerId }: { playerId: string }) {
  const [copied, setCopied] = useState(false)
  if (playerId === '') return null

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(playerId)
        setCopied(true)
      }}
      className="flex items-center justify-between gap-3 rounded-field border-[1.5px] border-line p-[13px] text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[11.5px] font-extrabold text-muted">Tu ID</span>
        <span className="block truncate text-[12.5px] font-[600] text-muted">{playerId}</span>
      </span>
      <span className="shrink-0 text-[12.5px] font-[750] text-accent-link">
        {copied ? 'Copiado ✓' : 'Copiar'}
      </span>
    </button>
  )
}
