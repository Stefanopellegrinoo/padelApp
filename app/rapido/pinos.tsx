'use client'

import { useRef, useState } from 'react'
import { parseRankingScore } from '@/core'
import type { FilaPinos } from './rapido-state'

/**
 * Bowling en el torneo rápido (S4): una fila por jugador con su total, y el
 * ranking. Todo es local (localStorage), así que guardar es instantáneo: Enter
 * o salir del campo guarda, y Enter además pasa al siguiente — la misma
 * planilla que la fecha de un torneo (`fechas/[n]/pinos.tsx`), sin red.
 */
export function CargaPinos({
  filas,
  onCargar,
}: {
  /** En el orden en que se anotaron, para que la planilla no salte mientras se carga. */
  filas: ReadonlyArray<{ indice: number; nombre: string; pinos: number | null }>
  onCargar: (indice: number, pinos: number | null) => void
}) {
  const campos = useRef<Array<HTMLInputElement | null>>([])
  return (
    <ul className="flex flex-col px-4">
      {filas.map((fila, posicion) => (
        <FilaCarga
          key={fila.indice}
          fila={fila}
          ultima={posicion === filas.length - 1}
          inputRef={(element) => {
            campos.current[posicion] = element
          }}
          onCargar={onCargar}
          onSiguiente={(actual) => {
            const siguiente = campos.current[posicion + 1]
            if (siguiente) siguiente.focus()
            else actual.blur()
          }}
        />
      ))}
    </ul>
  )
}

function FilaCarga({
  fila,
  ultima,
  inputRef,
  onCargar,
  onSiguiente,
}: {
  fila: { indice: number; nombre: string; pinos: number | null }
  ultima: boolean
  inputRef: (element: HTMLInputElement | null) => void
  onCargar: (indice: number, pinos: number | null) => void
  onSiguiente: (actual: HTMLInputElement) => void
}) {
  const [value, setValue] = useState(fila.pinos === null ? '' : String(fila.pinos))
  const [error, setError] = useState<string | null>(null)

  /** Vacío borra lo cargado; un total lo guarda; lo demás se explica y no se guarda. */
  const guardar = (): boolean => {
    const draft = parseRankingScore(value)
    if (draft !== null && 'error' in draft) {
      setError(draft.error)
      return false
    }
    const pinos = draft === null ? null : draft.score
    if (pinos !== fila.pinos) onCargar(fila.indice, pinos)
    return true
  }

  return (
    <li className="border-t border-line first:border-t-0">
      <label className="flex min-h-[64px] items-center gap-3 py-2">
        <span className="min-w-0 flex-1 truncate text-[17px] font-semibold">{fila.nombre}</span>
        {/* Como el resto de los números de la app: texto con teclado numérico, no `type="number"`. */}
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          enterKeyHint={ultima ? 'done' : 'next'}
          autoComplete="off"
          maxLength={4}
          value={value}
          placeholder="—"
          aria-label={`Pinos de ${fila.nombre}`}
          aria-invalid={error !== null || undefined}
          onChange={(event) => {
            setValue(event.target.value)
            setError(null)
          }}
          onBlur={() => {
            guardar()
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            if (guardar()) onSiguiente(event.currentTarget)
          }}
          className={`font-cond h-[56px] w-[112px] shrink-0 rounded-btn border-[1.5px] bg-surface-2 px-3 text-right text-[32px] text-text placeholder:text-muted ${
            error !== null ? 'border-live' : 'border-line'
          }`}
        />
      </label>
      {error !== null && (
        <p role="alert" className="mb-2 rounded-btn bg-live-bg px-3 py-2.5 text-[15px] font-semibold text-live">
          {error}
        </p>
      )}
    </li>
  )
}

const COLS = 'grid-cols-[36px_minmax(0,1fr)_64px]'

/**
 * El ranking: puesto compartido en el empate, nombre y pinos. Quien todavía
 * no cargó va al fondo con una raya en vez de puesto. Misma cara que `Tabla`.
 */
export function TablaPinos({ filas }: { filas: readonly FilaPinos[] }) {
  if (filas.length === 0) return null
  return (
    <div>
      <div aria-hidden="true" className={`grid ${COLS} h-9 items-center gap-1 px-4 text-[13px] font-semibold text-muted`}>
        <span />
        <span />
        <span className="text-right">Pinos</span>
      </div>
      <ol>
        {filas.map((fila) => (
          <li
            key={fila.clave}
            data-fila-pinos=""
            className={`grid ${COLS} min-h-[48px] items-center gap-1 border-t border-line px-4`}
          >
            {fila.posicion === null ? (
              <span className="text-[20px] font-bold text-muted">
                –<span className="sr-only"> sin puesto</span>
              </span>
            ) : (
              <span className={`font-cond text-[26px] ${fila.posicion === 1 ? 'text-sport' : ''}`}>
                {fila.posicion}
                <span className="sr-only">°</span>
              </span>
            )}
            <span className="min-w-0 py-1 text-[16px] leading-tight font-semibold [overflow-wrap:anywhere]">{` ${fila.nombre} `}</span>
            <span className="font-cond text-right text-[26px]">
              {fila.pinos ?? '–'}
              <span className="sr-only"> pinos</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
