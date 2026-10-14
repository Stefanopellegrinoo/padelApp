'use client'

import type { GoalsSport } from '@/core'
import { INPUT, LABEL, LEGEND, OPTION } from './estilos'

export interface GoalsFields {
  outcome: '' | 'won' | 'lost' | 'drew'
  scoreMine: string
  scoreTheirs: string
  teamMine: string
  teamTheirs: string
}

/**
 * El resultado de un deporte de goles (FIFA, fútbol, básquet): el "quién
 * ganó" es un radio obligatorio (ruling del plan, docs/plan-amigos-deporte-y-2v2.md)
 * -- con "Empataron" sólo si el deporte admite empate --, el marcador opcional
 * en la unidad del deporte y los equipos sólo si el deporte los tiene. Sin
 * estado propio: todo vive en `CasualForm`.
 */
export function ResultadoGoles({
  sport,
  uid,
  otherSide,
  rival1Name,
  outcome,
  scoreMine,
  scoreTheirs,
  teamMine,
  teamTheirs,
  onChange,
}: GoalsFields & {
  sport: GoalsSport
  uid: string
  otherSide: string
  rival1Name: string | undefined
  onChange: (patch: Partial<GoalsFields>) => void
}) {
  const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
  const unit = cap(sport.unit)
  const outcomes = (
    [
      ['won', 'Ganó tu lado'],
      ['lost', `Ganó ${otherSide}`],
      ['drew', 'Empataron'],
    ] as const
  ).filter(([value]) => value !== 'drew' || sport.allowsDraw)
  return (
    <>
      <div className="flex flex-col gap-3">
        <fieldset className="flex flex-col gap-2">
          <legend className={`${LEGEND} pb-2`}>¿Quién ganó?</legend>
          {outcomes.map(([value, label]) => (
            <label key={value} className={OPTION}>
              <input
                type="radio"
                name="outcome"
                value={value}
                required
                checked={outcome === value}
                onChange={() => onChange({ outcome: value })}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </fieldset>

        <div className="flex items-end gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor={`${uid}-scoreMine`} className={`truncate ${LABEL}`}>
              {`${unit} de tu lado`}
            </label>
            <input
              id={`${uid}-scoreMine`}
              name="scoreMine"
              type="number"
              value={scoreMine}
              onChange={(e) => onChange({ scoreMine: e.target.value })}
              className={`${INPUT} h-[52px] text-center text-[20px] font-extrabold tabular-nums`}
            />
          </div>
          <span aria-hidden className="pb-3 text-[20px] font-extrabold text-muted">
            –
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor={`${uid}-scoreTheirs`} className={`truncate ${LABEL}`}>
              {rival1Name !== undefined ? `${unit} de ${rival1Name}` : `${unit} del otro lado`}
            </label>
            <input
              id={`${uid}-scoreTheirs`}
              name="scoreTheirs"
              type="number"
              value={scoreTheirs}
              onChange={(e) => onChange({ scoreTheirs: e.target.value })}
              className={`${INPUT} h-[52px] text-center text-[20px] font-extrabold tabular-nums`}
            />
          </div>
        </div>
      </div>

      {sport.teams && (
        <div className="flex gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor={`${uid}-teamMine`} className={LABEL}>
              Tu equipo
            </label>
            <input
              id={`${uid}-teamMine`}
              name="teamMine"
              value={teamMine}
              onChange={(e) => onChange({ teamMine: e.target.value })}
              className={INPUT}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor={`${uid}-teamTheirs`} className={LABEL}>
              Equipo del otro lado
            </label>
            <input
              id={`${uid}-teamTheirs`}
              name="teamTheirs"
              value={teamTheirs}
              onChange={(e) => onChange({ teamTheirs: e.target.value })}
              className={INPUT}
            />
          </div>
        </div>
      )}
    </>
  )
}
