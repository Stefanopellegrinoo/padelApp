'use client'

import type { MatchFormat, SetsSport } from '@/core'
import {
  chooseLoserGames,
  chooseWinner,
  isComplete,
  type LoadState,
} from '@/app/torneo/[id]/[disciplina]/fechas/[n]/carga-state'
import { BotonesDelPerdedor } from '@/app/torneo/[id]/[disciplina]/fechas/[n]/carga'
import { Stepper } from '@/app/stepper'
import { chooseDeuce, setsField } from './cargar-state'
import { LABEL, PREGUNTA } from './estilos'

type FormatKey = 'setsToWin' | 'gamesPerSet'

/**
 * El resultado de un deporte de sets (pádel, ping pong): el formato con un
 * `Stepper` por eje que el deporte deja elegir (`min < max`; lo fijo no se
 * muestra) y los sets con la misma hoja de dos toques de la fecha
 * (`carga-state.ts`, A = mi lado): quién ganó, y con cuántos se quedó el que
 * perdió. Sin estado propio: todo vive en `CasualForm`, que es quien guarda
 * en el toque que cierra el partido.
 *
 * `load` es lo que se va tocando y `final` lo que se guardaría (al corregir,
 * lo tocado más lo guardado que falta): las pastillas y el campo oculto son
 * de `final`. `elegido` es el número marcado del set en curso al corregir.
 */
export function ResultadoSets({
  sport,
  format,
  load,
  final = load,
  elegido = null,
  mineName,
  otherName,
  pending,
  onFormat,
  onLoad,
  onRestart,
}: {
  sport: SetsSport
  format: MatchFormat
  load: LoadState
  final?: LoadState
  elegido?: { loser: number; deuce: boolean } | null
  /** Los dos lados como se leen en los botones: "Vos" y "Fede", o las parejas. */
  mineName: string
  otherName: string
  pending: boolean
  onFormat: (key: FormatKey, value: number) => void
  onLoad: (next: LoadState) => void
  /** "Volver a cargar": de cero. */
  onRestart: () => void
}) {
  const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
  const labels: Record<FormatKey, string> = {
    setsToWin: 'Sets para ganar',
    gamesPerSet: `${cap(sport.unit)} por set`,
  }
  const steppers = (['setsToWin', 'gamesPerSet'] as const).filter((key) => sport[key].min < sport[key].max)
  return (
    <div className="flex flex-col">
      <input type="hidden" name="setsToWin" value={format.setsToWin} />
      <input type="hidden" name="gamesPerSet" value={format.gamesPerSet} />
      <input type="hidden" name="sets" value={setsField(final)} />
      {steppers.length > 0 && (
        <div className="mt-2 flex flex-col divide-y divide-line">
          {steppers.map((key) => (
            <div key={key} data-stepper={key} className="flex min-h-[56px] items-center justify-between gap-3">
              <span className={LABEL}>{labels[key]}</span>
              <Stepper
                value={format[key]}
                min={sport[key].min}
                max={sport[key].max}
                onChange={(next) => onFormat(key, next)}
              />
            </div>
          ))}
        </div>
      )}
      <SetsTaps
        unit={sport.unit}
        load={load}
        pastillas={final.sets}
        elegido={elegido}
        format={format}
        mineName={mineName}
        otherName={otherName}
        pending={pending}
        onChange={onLoad}
        onRestart={onRestart}
      />
    </div>
  )
}

/**
 * Los sets ya cargados y los dos toques del set en curso (A = mi lado), con
 * la cara de la hoja de la fecha: los dos lados como opciones grandes y los
 * números del perdedor en la cara condensada (`BotonesDelPerdedor`, el mismo
 * componente). Cada set cargado es una pastilla: del color del deporte si lo
 * ganó tu lado, gris si no.
 */
function SetsTaps({
  unit,
  load,
  pastillas,
  elegido,
  format,
  mineName,
  otherName,
  pending,
  onChange,
  onRestart,
}: {
  unit: string
  load: LoadState
  pastillas: LoadState['sets']
  elegido: { loser: number; deuce: boolean } | null
  format: MatchFormat
  mineName: string
  otherName: string
  pending: boolean
  onChange: (next: LoadState) => void
  onRestart: () => void
}) {
  const complete = isComplete(load, format)
  const ganador = load.pendingWinner
  const nombreDe = (lado: 'A' | 'B') => (lado === 'A' ? mineName : otherName)
  const multiSet = format.setsToWin > 1
  return (
    <div className="flex flex-col">
      {(multiSet || pastillas.length > 0) && (
        <div className="mt-4 flex flex-wrap items-center gap-2" aria-live="polite">
          {!complete && <p className="font-titulo text-[20px]">Set {load.sets.length + 1}</p>}
          {pastillas.map((set, index) => (
            <span
              key={index}
              aria-label={`Set ${index + 1}: ${set.gamesA} a ${set.gamesB}`}
              className={`font-cond flex h-[40px] min-w-[56px] items-center justify-center rounded-[10px] px-2.5 text-[26px] ${
                set.gamesA > set.gamesB ? 'bg-sport text-on-sport' : 'bg-chip text-muted'
              }`}
            >
              {set.gamesA}-{set.gamesB}
            </span>
          ))}
        </div>
      )}
      {!complete && (
        <>
          <p className={`${PREGUNTA} mt-4 mb-2.5`}>Ganó</p>
          <div className="grid grid-cols-2 gap-2.5">
            {(['A', 'B'] as const).map((lado) => (
              <button
                key={lado}
                type="button"
                aria-pressed={ganador === lado}
                disabled={pending}
                onClick={() => onChange(chooseWinner(load, lado))}
                className={`flex min-h-[64px] items-center justify-between gap-2 rounded-btn px-4 text-left text-[18px] leading-tight font-bold ${
                  ganador === lado
                    ? 'bg-block text-on-block'
                    : 'bg-opcion text-text shadow-[inset_0_0_0_1.5px_var(--color-opcion-borde)]'
                }`}
              >
                <span className="min-w-0">{nombreDe(lado)}</span>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className={`h-6 w-6 shrink-0 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round] ${
                    ganador === lado ? '' : 'invisible'
                  }`}
                >
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </button>
            ))}
          </div>
          <BotonesDelPerdedor
            format={format}
            unit={unit}
            loserName={ganador === null ? null : nombreDe(ganador === 'A' ? 'B' : 'A')}
            pending={pending}
            elegido={elegido}
            onLoser={(n) => onChange(chooseLoserGames(load, n, format))}
            onDeuce={(loser) => onChange(chooseDeuce(load, loser, format))}
          />
        </>
      )}
      {(load.sets.length > 0 || ganador !== null) && (
        <button
          type="button"
          disabled={pending}
          className="mt-2 flex min-h-[44px] items-center self-start rounded-btn px-1 text-[16px] font-bold text-accent-link"
          onClick={onRestart}
        >
          Volver a cargar
        </button>
      )}
    </div>
  )
}
