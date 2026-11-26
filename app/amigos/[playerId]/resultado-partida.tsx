'use client'

import { PREGUNTA } from './estilos'

export type OutcomePartida = 'won' | 'lost' | 'drew'

/**
 * La partida (ajedrez, odd/tasks/mas-deportes.md S3): "Ganaste", "Tablas",
 * "Ganó Fede", con la cara de los "Ganó" de la hoja de la fecha. El toque
 * guarda (`onElegir`); si a ese toque le falta algo, `CasualForm` lo dice y
 * queda "Guardar". Lo elegido queda marcado, y al corregir viene marcado lo
 * cargado. Sin estado propio.
 */
export function ResultadoPartida({
  outcome,
  textos,
  pending,
  onElegir,
}: {
  outcome: OutcomePartida | ''
  /** "Ganaste", "Tablas", "Ganó Fede". */
  textos: Record<OutcomePartida, string>
  pending: boolean
  onElegir: (outcome: OutcomePartida) => void
}) {
  return (
    <div className="mt-4 flex flex-col">
      <p className={`${PREGUNTA} mb-2.5`}>¿Cómo terminó?</p>
      <div className="flex flex-col gap-2.5">
        {(['won', 'drew', 'lost'] as const).map((valor) => (
          <button
            key={valor}
            type="button"
            aria-pressed={outcome === valor}
            disabled={pending}
            onClick={() => onElegir(valor)}
            className={`flex min-h-[64px] items-center justify-between gap-3 rounded-btn px-[18px] text-left text-[19px] font-bold ${
              outcome === valor
                ? 'bg-block text-on-block'
                : 'bg-opcion text-text shadow-[inset_0_0_0_1.5px_var(--color-opcion-borde)]'
            }`}
          >
            <span className="min-w-0">{textos[valor]}</span>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className={`h-6 w-6 shrink-0 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round] ${
                outcome === valor ? '' : 'invisible'
              }`}
            >
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  )
}
