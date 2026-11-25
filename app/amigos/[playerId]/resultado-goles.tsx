'use client'

import { useRef } from 'react'
import type { GoalsSport } from '@/core'
import { INPUT, LABEL, OPTION, PREGUNTA } from './estilos'

export interface GoalsFields {
  outcome: '' | 'won' | 'lost' | 'drew'
  scoreMine: string
  scoreTheirs: string
  teamMine: string
  teamTheirs: string
}

/**
 * El resultado de un deporte de goles (FIFA, fútbol, básquet), marcador
 * primero como en la hoja de la fecha (S8e): los dos números en la cara
 * condensada, el primero enfocado al abrir (`scoreMineRef`, que `CasualForm`
 * le pasa a la hoja), Enter pasa al segundo y Enter en el segundo guarda.
 *
 * Debajo, "quién ganó": obligatorio (ruling del plan,
 * docs/plan-amigos-deporte-y-2v2.md), con "Empate" sólo si el deporte lo
 * admite. Lo elige el marcador cuando lo dice (`outcomeDelMarcador`, en
 * `CasualForm`); con el marcador empatado o vacío lo elegís vos, porque puede
 * haber penales. Los equipos, sólo si el deporte los tiene. Sin estado propio.
 */
export function ResultadoGoles({
  sport,
  uid,
  mineLabel,
  otherLabel,
  outcomes,
  outcome,
  scoreMine,
  scoreTheirs,
  teamMine,
  teamTheirs,
  scoreMineRef,
  onChange,
  onScore,
  onEnter,
}: GoalsFields & {
  sport: GoalsSport
  uid: string
  /** "Tus goles" y "Goles de Fede" (o de ellos, en 2v2). */
  mineLabel: string
  otherLabel: string
  /** Los textos de cada resultado: "Ganaste", "Ganó Fede", "Empate". */
  outcomes: Record<'won' | 'lost' | 'drew', string>
  scoreMineRef: (el: HTMLInputElement | null) => void
  onChange: (patch: Partial<GoalsFields>) => void
  onScore: (side: 'scoreMine' | 'scoreTheirs', value: string) => void
  /** Enter en el segundo número: guardar. */
  onEnter: () => void
}) {
  const segundo = useRef<HTMLInputElement>(null)
  const opciones = (['won', 'lost', 'drew'] as const).filter((value) => value !== 'drew' || sport.allowsDraw)
  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <CampoNumero
          id={`${uid}-scoreMine`}
          name="scoreMine"
          label={mineLabel}
          value={scoreMine}
          inputRef={scoreMineRef}
          enterKeyHint="next"
          onChange={(next) => {
            onScore('scoreMine', next)
            // Los goles casi nunca llegan a dos dígitos: el segundo es "ya
            // terminé" (como en la fecha). Puntos de básquet, sí: ahí no salta.
            if (sport.unit === 'goles' && /^\d{2,}$/.test(next.trim())) segundo.current?.focus()
          }}
          onEnter={() => segundo.current?.focus()}
        />
        <span aria-hidden="true" className="font-cond pt-[52px] text-[32px] text-muted">
          –
        </span>
        <CampoNumero
          id={`${uid}-scoreTheirs`}
          name="scoreTheirs"
          label={otherLabel}
          value={scoreTheirs}
          inputRef={(el) => {
            segundo.current = el
          }}
          enterKeyHint="done"
          onChange={(next) => onScore('scoreTheirs', next)}
          onEnter={onEnter}
        />
      </div>

      <fieldset className="flex flex-col">
        <legend className={`${PREGUNTA} mb-2.5`}>Ganó</legend>
        <div className="flex gap-2">
          {opciones.map((value) => (
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
              {outcomes[value]}
            </label>
          ))}
        </div>
      </fieldset>

      {sport.teams && (
        <div className="flex gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <label htmlFor={`${uid}-teamMine`} className={LABEL}>
              Tu equipo
            </label>
            <input
              id={`${uid}-teamMine`}
              name="teamMine"
              autoComplete="off"
              value={teamMine}
              onChange={(e) => onChange({ teamMine: e.target.value })}
              className={INPUT}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <label htmlFor={`${uid}-teamTheirs`} className={LABEL}>
              El otro equipo
            </label>
            <input
              id={`${uid}-teamTheirs`}
              name="teamTheirs"
              autoComplete="off"
              value={teamTheirs}
              onChange={(e) => onChange({ teamTheirs: e.target.value })}
              className={INPUT}
            />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Un lado del marcador. `type="text"` con `inputMode="numeric"`, como en la
 * hoja de la fecha (`CampoGoles`, `carga.tsx`): el numérico deja tipear `e`,
 * `-` y `.`, la rueda del mouse lo mueve sin querer y `maxLength` no le aplica.
 * Lo que no sea un número lo rechaza `parseCasualResult` con su mensaje.
 */
function CampoNumero({
  id,
  name,
  label,
  value,
  inputRef,
  enterKeyHint,
  onChange,
  onEnter,
}: {
  id: string
  name: string
  label: string
  value: string
  inputRef: (el: HTMLInputElement | null) => void
  enterKeyHint: 'next' | 'done'
  onChange: (next: string) => void
  onEnter: () => void
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <label htmlFor={id} className={`truncate ${LABEL}`}>
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        enterKeyHint={enterKeyHint}
        autoComplete="off"
        maxLength={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          onEnter()
        }}
        className="font-cond h-[72px] w-full rounded-btn border-[1.5px] border-line bg-surface-2 px-3 text-center text-[44px] text-text"
      />
    </div>
  )
}
