'use client'

import { useState, useTransition } from 'react'
import { savePlayersCanScore } from './actions'

/**
 * El valor de la fila "Los jugadores cargan los resultados". Es su propio
 * componente por lo mismo que `CopiarLink`: la fila necesita estado del
 * navegador —el switch se mueve en el toque, no cuando vuelve el servidor— y
 * eso no es un Server Component.
 *
 * Si la escritura falla, el switch VUELVE a donde estaba y el error queda en
 * la fila: un toggle que se queda prendido mintiendo es peor que no tenerlo,
 * porque el admin se va creyendo que el permiso está dado.
 */
export function CargaDeJugadores({ seasonId, enabled }: { seasonId: string; enabled: boolean }) {
  const [on, setOn] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const toggle = (next: boolean) => {
    setOn(next)
    setError(null)
    startTransition(async () => {
      const result = await savePlayersCanScore(seasonId, next)
      if (!result.ok) {
        setOn(!next)
        setError(result.error)
      }
    })
  }

  return (
    <span className="-my-3 flex min-h-[44px] shrink-0 items-center gap-2 pl-3">
      {error !== null && <span className="text-[11.5px] font-bold text-live">{error}</span>}
      <label className="flex min-h-[44px] cursor-pointer items-center">
        <input
          type="checkbox"
          checked={on}
          disabled={pending}
          onChange={(event) => toggle(event.target.checked)}
          className="peer sr-only"
        />
        {/* El pulgar se mueve con `justify-end`, no con un `translate` sobre
            él: `peer-checked:` compila a `.peer:checked ~ .x`, un combinador de
            HERMANOS, y el pulgar es NIETO del input — la clase existiría en el
            HTML y no aplicaría nunca. */}
        <span className="flex h-[28px] w-[48px] items-center rounded-full bg-chip p-[3px] transition-colors peer-checked:justify-end peer-checked:bg-accent peer-disabled:opacity-40">
          <span className="h-[22px] w-[22px] rounded-full bg-surface shadow" />
        </span>
      </label>
    </span>
  )
}
