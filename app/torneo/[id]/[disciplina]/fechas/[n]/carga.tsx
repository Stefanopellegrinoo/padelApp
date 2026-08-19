'use client'

import { useState, useTransition } from 'react'
import type { MatchFormat, SetScore } from '@/core'
import {
  MAX_GOAL_DIGITS,
  chooseLoserGames,
  chooseWinner,
  goalsError,
  goalsRejected,
  isComplete,
  loserGamesOptions,
  openScoreSet,
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
  /** El slug de la URL desde la que se abrió esta fecha — lo necesita `BorrarFecha` para volver a la lista correcta. */
  disciplina: string
  matchdayNumber: number
  format: MatchFormat
}

const TAP = 'rounded-field bg-chip px-3 py-2.5 text-[13.5px] font-extrabold'
const ERROR_NOTE = 'rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live'
const PROMPT = 'text-[11.5px] font-extrabold uppercase tracking-[.14em] text-muted'

/**
 * Un lado del marcador abierto.
 *
 * `type="text"` con `inputMode="numeric"`, y no `type="number"`: el numérico
 * deja tipear `e`, `-` y `.` igual, se le puede mover el valor con la rueda del
 * mouse sin querer, y `maxLength` no le aplica. Lo que sale de acá es un string
 * que `openScoreSet` decide si ya es un número o todavía no — que es
 * exactamente lo que hace falta mientras alguien está escribiendo.
 */
function Goles({
  side,
  value,
  disabled,
  invalid,
  onChange,
}: {
  side: string
  value: string
  disabled: boolean
  /** Lo escrito ya no puede ser un marcador. Lo decide `goalsRejected`. */
  invalid: boolean
  onChange: (next: string) => void
}) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className={`truncate ${PROMPT}`}>{side}</span>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={MAX_GOAL_DIGITS}
        value={value}
        disabled={disabled}
        aria-label={`Goles de ${side}`}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
        //El `focus-visible:ring` es S72: el
        // `outline-none` dejaba el panel 100% operable por teclado y sin que se
        // viera dónde estabas (medido: `outlineStyle: none`, `boxShadow:
        // none`). Va SÓLO acá: `outline-none` está en 19 inputs de 11 archivos
        // y ninguno tiene reemplazo — eso es deuda de a11y previa, y arreglarla
        // entera es otra tarea, no un renglón de ésta.
        className={`h-[52px] w-full rounded-field bg-chip px-3 text-center text-[20px] font-extrabold outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-accent-link disabled:opacity-45 ${
          invalid ? 'ring-1 ring-live' : ''
        }`}
      />
    </label>
  )
}

/**
 * El panel del marcador abierto: dos números y un botón de guardar.
 *
 * Exportado y afuera de `Carga` para poder RENDERIZARLO en la suite: el panel
 * vive detrás del estado que abre "Cargar resultado", así que sin clicks no se
 * llega. Las dos cosas que la ronda 21 encontró abriéndolo en un navegador —el
 * botón que se apaga sin decir por qué y el foco invisible— son atributos y
 * clases del DOM que ninguna función pura puede ver.
 *
 * No opina sobre si el par es LEGAL para la disciplina: un `0-0` donde no se
 * admiten empates lo rechaza `matchError` del lado del servidor y el mensaje
 * vuelve por el `WriteResult`. Lo que explica este panel es lo otro: lo que ni
 * siquiera es un marcador.
 */
export function PanelGoles({
  pairAName,
  pairBName,
  goals,
  pending,
  onChange,
  onSave,
}: {
  pairAName: string
  pairBName: string
  goals: { a: string; b: string }
  pending: boolean
  onChange: (next: { a: string; b: string }) => void
  onSave: (set: SetScore) => void
}) {
  const draft = openScoreSet(goals.a, goals.b)
  const problem = goalsError(goals.a, goals.b)

  return (
    <div className="flex flex-col gap-2">
      <p className={PROMPT}>{pending ? 'Guardando…' : 'Goles'}</p>
      <div className="flex items-start gap-2">
        <Goles
          side={pairAName}
          value={goals.a}
          disabled={pending}
          invalid={goalsRejected(goals.a)}
          onChange={(next) => onChange({ ...goals, a: next })}
        />
        <Goles
          side={pairBName}
          value={goals.b}
          disabled={pending}
          invalid={goalsRejected(goals.b)}
          onChange={(next) => onChange({ ...goals, b: next })}
        />
      </div>
      {problem !== null && <p className={ERROR_NOTE}>{problem}</p>}
      {/* Deshabilitado sólo mientras falte un número. Si el par no es legal
          para la disciplina —un `0-0` sin empates— el botón deja guardar y el
          mensaje lo escribe `matchError`, que es donde vive esa regla: una
          segunda copia acá serían dos verdades para sincronizar. */}
      <button
        type="button"
        disabled={pending || draft === null}
        onClick={() => {
          if (draft !== null) onSave(draft)
        }}
        className="flex min-h-[44px] w-full items-center justify-center rounded-field bg-accent px-3 text-[13.5px] font-extrabold text-accent-text transition-opacity disabled:opacity-45"
      >
        Guardar resultado
      </button>
    </div>
  )
}

/**
 * La carga de un partido, con una máquina por forma de marcador.
 *
 * **Pádel** (el default, `openScore: false`): dos toques y sin teclado — quién
 * ganó, y con cuántos games se quedó el que perdió. Con `setsToWin > 1` los dos
 * toques se repiten por set y los sets se acumulan acá: `saveResult` reemplaza
 * los sets del partido, así que guardar de a uno borraría el anterior. Se
 * guarda una sola vez, cuando el partido cierra. **Esta mitad no cambió una
 * línea de COMPORTAMIENTO** en PR20 rebanada D2, y sus tests son el pin.
 *
 * La frase decía "no cambió una línea" a secas, y eso era literalmente falso
 *Los dos `<p>` de acá abajo sí se reescribieron
 * para usar la constante `PROMPT`. La sustancia se sostiene y está medida —el
 * HTML servido es byte a byte idéntico contra `f43d626`, porque la cadena de
 * clases de `PROMPT` es la misma que estaba inline—, pero una frase de más es
 * cómo se pierde la confianza en las otras.
 *
 * **Marcador abierto** (`openScore: true`, FIFA): dos números y un botón de
 * guardar. La máquina de dos toques no sirve acá y no es cuestión de estirarla:
 * por construcción le da al ganador `format.gamesPerSet` y al perdedor menos,
 * así que no puede producir ni un `3-1` ni un `0-0`. Un marcador abierto además
 * es UN resultado, no una serie de sets, así que no hay nada que acumular.
 *
 * El botón es su propio cancelar: volver a tocarlo cierra el panel y tira lo
 * que estaba a medio cargar.
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
  // Los dos lados del marcador abierto, como strings: mientras se tipea,
  // "" y "1" son estados válidos del campo y ninguno de los dos es un cero.
  const [goals, setGoals] = useState({ a: '', b: '' })
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const { seasonId, matchdayNumber, format } = context

  const saveOpenScore = (draft: SetScore) => {
    setError(null)
    startTransition(async () => {
      const result = await saveMatchResult(seasonId, matchdayNumber, matchId, [draft])
      if (!result.ok) {
        // A diferencia de los dos toques, acá lo tipeado NO se tira: el rebote
        // esperable es el de una regla del marcador —"esta disciplina no admite
        // empates"— y se arregla cambiando un dígito, no volviendo a escribir
        // el resultado entero.
        setError(result.error)
        return
      }
      setState(null)
      setGoals({ a: '', b: '' })
    })
  }

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
          setGoals({ a: '', b: '' })
          setState(state === null ? startLoad() : null)
        }}
        className="flex min-h-[44px] w-full items-center justify-center rounded-field bg-chip px-3 text-[12.5px] font-extrabold text-muted transition-opacity disabled:opacity-45"
      >
        Cargar resultado
      </button>

      {state !== null && format.openScore && (
        <PanelGoles
          pairAName={pairAName}
          pairBName={pairBName}
          goals={goals}
          pending={pending}
          onChange={setGoals}
          onSave={saveOpenScore}
        />
      )}

      {state !== null && !format.openScore && (
        <div className="flex flex-col gap-2">
          {state.pendingWinner === null ? (
            <>
              <p className={PROMPT}>¿Quién ganó?</p>
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
              <p className={PROMPT}>{pending ? 'Guardando…' : 'Games del perdedor'}</p>
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
