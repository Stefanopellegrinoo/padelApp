'use client'

import { useState, useTransition } from 'react'
import { savePlayersCanScore } from './actions'
import { Aviso, FILA_CAJA } from './piezas'

/**
 * La fila "Los jugadores cargan resultados", con su interruptor. Es su propio
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
    <div className="border-t border-line">
      <label className={`${FILA_CAJA} cursor-pointer`}>
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] font-semibold">Los jugadores cargan resultados</span>
          <span className="block text-[14px] text-muted">En las fechas en juego</span>
        </span>
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
            HTML y no aplicaría nunca; su color lo pone el riel (`*:`).
            Apagado es un riel hueco con el pulgar gris y prendido, lleno del
            color del deporte con el pulgar en `on-sport`: se distinguen por forma, no
            sólo por color, y el borde `muted` pasa 3:1 en los dos temas. */}
        <span className="flex h-[31px] w-[51px] shrink-0 items-center rounded-full border-2 border-muted p-[2px] transition-colors *:bg-muted peer-checked:justify-end peer-checked:border-sport peer-checked:bg-sport peer-checked:*:bg-on-sport peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus peer-disabled:opacity-40">
          <span className="h-[23px] w-[23px] rounded-full" />
        </span>
      </label>
      {error !== null && (
        <Aviso alerta className="mx-4 mb-3">
          {error}
        </Aviso>
      )}
    </div>
  )
}
