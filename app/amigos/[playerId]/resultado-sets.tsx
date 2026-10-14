'use client'

import type { MatchFormat, SetsSport } from '@/core'
import {
  chooseLoserGames,
  chooseWinner,
  isComplete,
  loserGamesOptions,
  startLoad,
  type LoadState,
} from '@/app/torneo/[id]/[disciplina]/fechas/[n]/carga-state'
import { Stepper } from '@/app/torneos/nuevo/wizard'
import { chooseDeuce, deuceOptions, setsField } from './cargar-state'
import { LABEL, LEGEND } from './estilos'

type FormatKey = 'setsToWin' | 'gamesPerSet'

/**
 * El resultado de un deporte de sets (pádel, ping pong): el formato con un
 * `Stepper` por eje que el deporte deja elegir (`min < max`; lo fijo no se
 * muestra) y los sets con la máquina de dos toques de la carga de fechas
 * (`carga-state.ts`, A = mi lado). Sin estado propio: todo vive en `CasualForm`.
 */
export function ResultadoSets({
  sport,
  format,
  load,
  otherSide,
  onFormat,
  onLoad,
}: {
  sport: SetsSport
  format: MatchFormat
  load: LoadState
  /** Cómo se llama el otro lado en los botones ("el otro lado" o el nombre del amigo). */
  otherSide: string
  onFormat: (key: FormatKey, value: number) => void
  onLoad: (next: LoadState) => void
}) {
  const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
  const labels: Record<FormatKey, string> = {
    setsToWin: 'Sets por partido',
    gamesPerSet: `${cap(sport.unit)} por set`,
  }
  const steppers = (['setsToWin', 'gamesPerSet'] as const).filter((key) => sport[key].min < sport[key].max)
  return (
    <div className="flex flex-col gap-3">
      <span className={LEGEND}>Resultado</span>
      <input type="hidden" name="setsToWin" value={format.setsToWin} />
      <input type="hidden" name="gamesPerSet" value={format.gamesPerSet} />
      <input type="hidden" name="sets" value={setsField(load)} />
      {steppers.length > 0 && (
        <div className="flex flex-col divide-y divide-line rounded-field border border-line bg-bg px-3">
          {steppers.map((key) => (
            <div key={key} data-stepper={key} className="flex items-center justify-between gap-3 py-2">
              <span className="text-[13.5px] font-bold">{labels[key]}</span>
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
      <SetsTaps unit={sport.unit} load={load} format={format} otherSide={otherSide} onChange={onLoad} />
    </div>
  )
}

const TAP = 'min-h-[44px] flex-1 rounded-field bg-chip px-3 text-[14px] font-extrabold'

/**
 * Los sets ya cargados y los dos toques del set en curso (A = mi lado).
 *
 * Cada set es una pastilla como las marcas de fecha de la ficha del jugador:
 * verde llena si lo ganó tu lado, gris si no. El marcador se lee de un vistazo
 * sin tener que parsear "6-3 · 4-6".
 */
function SetsTaps({
  unit,
  load,
  format,
  otherSide,
  onChange,
}: {
  unit: string
  load: LoadState
  format: MatchFormat
  otherSide: string
  onChange: (next: LoadState) => void
}) {
  const complete = isComplete(load, format)
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-1.5" aria-live="polite">
        {load.sets.length === 0 ? (
          <p className="text-[13px] font-semibold text-muted">Todavía no cargaste ninguno.</p>
        ) : (
          load.sets.map((set, index) => (
            <span
              key={index}
              aria-label={`Set ${index + 1}: ${set.gamesA} a ${set.gamesB}`}
              className={`flex h-[38px] min-w-[52px] items-center justify-center rounded-[9px] px-2.5 text-[15px] font-extrabold tabular-nums ${
                set.gamesA > set.gamesB ? 'bg-accent text-accent-text' : 'bg-chip text-muted'
              }`}
            >
              {set.gamesA}-{set.gamesB}
            </span>
          ))
        )}
        {complete && <span className="text-[12px] font-extrabold text-up">Partido cerrado ✓</span>}
      </div>
      {!complete && load.pendingWinner === null && (
        <>
          <span className={LABEL}>¿Quién ganó el set {load.sets.length + 1}?</span>
          <div className="flex gap-2">
            <button type="button" className={TAP} onClick={() => onChange(chooseWinner(load, 'A'))}>
              Ganó mi lado
            </button>
            <button type="button" className={TAP} onClick={() => onChange(chooseWinner(load, 'B'))}>
              Ganó {otherSide}
            </button>
          </div>
        </>
      )}
      {!complete && load.pendingWinner !== null && (
        <>
          <span className={LABEL}>{`¿Cuántos ${unit} hizo el que perdió?`}</span>
          <div className="flex flex-wrap gap-2">
            {loserGamesOptions(format).map((games) => (
              <button
                key={games}
                type="button"
                className={`${TAP} min-w-[52px] tabular-nums`}
                onClick={() => onChange(chooseLoserGames(load, games, format))}
              >
                {games}
              </button>
            ))}
            {deuceOptions(format).map((loser) => (
              <button
                key={`deuce-${loser}`}
                type="button"
                className={`${TAP} min-w-[52px] tabular-nums`}
                onClick={() => onChange(chooseDeuce(load, loser, format))}
              >
                {loser + 2}-{loser}
              </button>
            ))}
          </div>
        </>
      )}
      {(load.sets.length > 0 || load.pendingWinner !== null) && (
        <button
          type="button"
          className="-my-1 flex min-h-[40px] items-center self-start text-[12.5px] font-extrabold text-accent-link"
          onClick={() => onChange(startLoad())}
        >
          Volver a cargar
        </button>
      )}
    </div>
  )
}
