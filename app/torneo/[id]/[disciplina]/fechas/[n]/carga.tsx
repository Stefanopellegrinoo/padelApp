'use client'

import { useState, useTransition } from 'react'
import type { MatchFormat } from '@/core'
import {
  chooseLoserGames,
  chooseWinner,
  isComplete,
  loserGamesOptions,
  startLoad,
  type LoadState,
} from './carga-state'
import {
  closeTheMatchday,
  redraftTheMatchday,
  reopenTheMatchday,
  saveMatchResult,
  type WriteResult,
} from './actions'
import { BorrarFecha } from './borrar'

/** Lo que la carga necesita saber de la fecha, igual para todos sus partidos. */
export interface CargaContext {
  seasonId: string
  matchdayId: string
  /** El slug de la URL desde la que se abrió esta fecha (W28) — lo necesita `BorrarFecha` para volver a la lista correcta. */
  disciplina: string
  matchdayNumber: number
  format: MatchFormat
}

const TAP = 'rounded-field bg-chip px-3 py-2.5 text-[13.5px] font-extrabold'
const ERROR_NOTE = 'rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live'

/**
 * La carga de un partido, en dos toques y sin teclado: quién ganó, y con
 * cuántos games se quedó el que perdió.
 *
 * Con `setsToWin > 1` los dos toques se repiten por set y los sets se acumulan
 * acá: `saveResult` reemplaza los sets del partido, así que guardar de a uno
 * borraría el anterior. Se guarda una sola vez, cuando el partido cierra.
 *
 * El botón es su propio cancelar: volver a tocarlo cierra el panel y tira el
 * set a medio armar.
 */
export function Carga({
  context,
  matchId,
  pairAName,
  pairBName,
}: {
  context: CargaContext
  matchId: string
  pairAName: string
  pairBName: string
}) {
  const [state, setState] = useState<LoadState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const { seasonId, matchdayNumber, format } = context

  const tapGames = (loserGames: number) => {
    if (state === null) return
    const next = chooseLoserGames(state, loserGames, format)
    if (!isComplete(next, format)) {
      setState(next)
      return
    }

    setError(null)
    startTransition(async () => {
      const result = await saveMatchResult(seasonId, matchdayNumber, matchId, next.sets)
      if (!result.ok) {
        // El partido se carga de nuevo desde cero. Quedarse con el intento
        // completo en la mano deja el panel pidiendo un set que ya no falta.
        setError(result.error)
        setState(null)
        return
      }
      setState(null)
    })
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null)
          setState(state === null ? startLoad() : null)
        }}
        className="flex min-h-[44px] w-full items-center justify-center rounded-field bg-chip px-3 text-[12.5px] font-extrabold text-muted transition-opacity disabled:opacity-45"
      >
        Cargar resultado
      </button>

      {state !== null && (
        <div className="flex flex-col gap-2">
          {state.pendingWinner === null ? (
            <>
              <p className="text-[11.5px] font-extrabold uppercase tracking-[.14em] text-muted">
                ¿Quién ganó?
              </p>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  disabled={pending}
                  className={TAP}
                  onClick={() => setState(chooseWinner(state, 'A'))}
                >
                  {pairAName}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  className={TAP}
                  onClick={() => setState(chooseWinner(state, 'B'))}
                >
                  {pairBName}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[11.5px] font-extrabold uppercase tracking-[.14em] text-muted">
                {pending ? 'Guardando…' : 'Games del perdedor'}
              </p>
              <div className="flex flex-wrap gap-2">
                {loserGamesOptions(format).map((games) => (
                  <button
                    key={games}
                    type="button"
                    disabled={pending}
                    className={`${TAP} min-w-[44px] text-center`}
                    onClick={() => tapGames(games)}
                  >
                    {games}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {error !== null && <p className={ERROR_NOTE}>{error}</p>}
    </div>
  )
}

/**
 * El pie de la fecha para quien organiza: cerrarla mientras está en juego,
 * reabrir la última cerrada, o volver al armado una fecha en juego.
 *
 * Cerrar congela los puntos; reabrir y volver al armado los borran (el
 * segundo, indirectamente — ver más abajo), así que los dos revelan un bloque
 * de confirmación en línea — nada de `window.confirm`. Las reglas de qué se
 * puede reabrir viven en `reopen_matchday` y no se replican acá: lo que se
 * muestra es su mensaje.
 *
 * `asking` es un solo booleano para las dos confirmaciones, no una máquina de
 * estados: reabrir sólo dibuja bajo `status === 'CLOSED'` y volver al armado
 * sólo bajo `status === 'OPEN'`, y `status` es un solo valor — las dos ramas
 * no pueden coexistir nunca. El día que dos confirmaciones convivan en la
 * misma rama de estado, ahí sí hace falta `asking: 'reopen' | 'redraft' | null`.
 *
 * La tercera confirmación de esta pantalla —borrar la fecha, también bajo
 * `OPEN`— vive en `borrar.tsx` con su propio `asking`. Tener un booleano
 * aparte NO es lo que evita que compitan: es exactamente lo que las deja
 * convivir, y sin nada más el admin terminaba con las dos abiertas a la vez,
 * un primario verde y reversible ("Volver al armado") apoyado justo encima de
 * uno rojo e irreversible ("Borrar"). Lo que las separa es el `!asking` del
 * montaje de `<BorrarFecha>`, el mismo gate que ya usa el botón de volver al
 * armado: mientras una confirmación está abierta, la otra ni se dibuja.
 */
export function CierreFecha({
  context,
  status,
  remaining,
  canReopen,
  loadedResults,
}: {
  context: CargaContext
  status: 'OPEN' | 'CLOSED'
  /** Partidos sin resultado. `close_matchday` lo vuelve a verificar, y esa es la verificación que manda. */
  remaining: number
  canReopen: boolean
  /**
   * Partidos CON resultado cargado. Es un conteo y no un booleano porque las
   * dos confirmaciones destructivas de acá abajo lo usan distinto: "Volver al
   * armado" sólo necesita saber si hay algo, y "Borrar fecha" nombra cuántos
   * se pierden.
   */
  loadedResults: number
}) {
  const [error, setError] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [pending, startTransition] = useTransition()
  const { seasonId, matchdayId, disciplina, matchdayNumber } = context

  const run = (work: () => Promise<WriteResult>) => {
    setError(null)
    startTransition(async () => {
      const result = await work()
      if (!result.ok) {
        setError(result.error)
        return
      }
      setAsking(false)
    })
  }

  const complete = remaining === 0

  return (
    <div className="flex flex-col gap-2">
      {status === 'OPEN' && (
        // `disabled={!complete || pending}` is overloaded: "faltan N partidos"
        // is the only place on the page that shows how many are missing, so
        // it needs to stay readable — the global opacity dim should only
        // apply while a close is actually in flight, not while it's merely
        // incomplete.
        <button
          type="button"
          disabled={!complete || pending}
          onClick={() => run(() => closeTheMatchday(seasonId, matchdayId, matchdayNumber))}
          className={`rounded-field p-4 text-center text-[15px] font-extrabold ${
            complete && !pending ? 'bg-accent text-accent-text' : 'bg-chip text-muted'
          } ${pending ? '' : 'disabled:opacity-100'}`}
        >
          {complete ? 'Cerrar fecha' : `Cerrar fecha · faltan ${remaining} partidos`}
        </button>
      )}

      {status === 'OPEN' && !asking && (
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="rounded-field border-[1.5px] border-line p-4 text-center text-[15px] font-extrabold text-muted"
        >
          Volver al armado
        </button>
      )}

      {status === 'OPEN' && asking && (
        <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
          <p className="text-[12.5px] font-bold">Volvés al armado para corregir quién juega.</p>
          {/* Las parejas no se tocan en esta transición, pero un aviso que lo
              dijera sería una promesa falsa: se caen igual en cuanto se toca
              un tilde de presente (`toggleAttendance` → `syncGuestSeat` →
              `clearPairs`), que es justo lo que se viene a hacer acá. */}
          {loadedResults > 0 && (
            <p className="text-[12.5px] font-bold">
              Ya hay resultados cargados: si cambiás quién juega o volvés a sortear, se borran.
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => redraftTheMatchday(seasonId, matchdayId, matchdayNumber))}
              className="flex-1 rounded-field bg-accent p-3 text-center text-[14px] font-extrabold text-accent-text"
            >
              Volver al armado
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setError(null)
                setAsking(false)
              }}
              className="flex-1 rounded-field bg-chip p-3 text-center text-[14px] font-extrabold text-muted"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {status === 'OPEN' && !asking && (
        <BorrarFecha seasonId={seasonId} matchdayId={matchdayId} disciplina={disciplina} loadedResults={loadedResults} />
      )}

      {status === 'CLOSED' && canReopen && !asking && (
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="rounded-field border-[1.5px] border-line p-4 text-center text-[15px] font-extrabold text-muted"
        >
          Reabrir fecha
        </button>
      )}

      {status === 'CLOSED' && canReopen && asking && (
        <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
          <p className="text-[12.5px] font-bold">
            Se borran los puntos de esta fecha y la tabla se recalcula.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => reopenTheMatchday(seasonId, matchdayId, matchdayNumber))}
              className="flex-1 rounded-field bg-accent p-3 text-center text-[14px] font-extrabold text-accent-text"
            >
              Reabrir
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setError(null)
                setAsking(false)
              }}
              className="flex-1 rounded-field bg-chip p-3 text-center text-[14px] font-extrabold text-muted"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {error !== null && <p className={ERROR_NOTE}>{error}</p>}
    </div>
  )
}
