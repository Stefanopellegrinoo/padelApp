'use client'

import {
  createContext,
  useContext,
  useId,
  useRef,
  useState,
  useTransition,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from 'react'
import type { MatchFormat, SetScore } from '@/core'
import { chooseDeuce, deuceOptions } from '@/app/amigos/[playerId]/cargar-state'
import { button } from '@/app/ui/button'
import { Sheet } from '@/app/ui/sheet'
import { Toast } from '@/app/ui/toast'
import {
  MAX_GOAL_DIGITS,
  chooseLoserGames,
  chooseWinner,
  goalsError,
  goalsRejected,
  isComplete,
  loserGamesOptions,
  openScoreSet,
  resumenGuardado,
  retomarUltimoSet,
  siguienteSinCargar,
  toqueDelSet,
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
  /** `unitOf(kind, format)`: 'games', 'puntos', 'goles'. */
  unit: string
}

/** Un nombre de un lado; `vos` marca al que está mirando (el amarillo es sólo suyo). */
export interface ParteVM {
  name: string
  vos: boolean
}

/** Un partido de la fecha, como lo dibujan `Rondas` y `Llave` y lo carga la hoja. */
export interface PartidoVM {
  key: string
  /** El id de la fila de `matches`, que es lo que `saveResult` necesita para cargarlo. */
  matchId: string
  /** El título de la hoja: "Ronda 2", "Grupo 1", "Semifinal". */
  seccion: string
  pairAName: string
  pairBName: string
  pairA: ParteVM[]
  pairB: ParteVM[]
  scoreA: string
  scoreB: string
  /** `null` sin resultado todavía (o empatado): ninguna de las dos filas se dibuja como ganadora. */
  winner: 'A' | 'B' | null
  /** Los sets cargados, para abrir la hoja precargada al corregir. Vacío sin resultado. */
  sets: SetScore[]
}

const ERROR_NOTE = 'rounded-btn bg-live-bg px-3 py-2.5 text-[15px] font-semibold text-live'
const PREGUNTA = 'mt-3.5 mb-2.5 text-[17px] font-bold'
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/**
 * La carga de la fecha (S8e): tocar el partido abre la hoja, y nada más.
 *
 * Envuelve a la lista de partidos (`Rondas`, `Llave`) y es la dueña de la
 * única hoja y del aviso de abajo. Las tarjetas (`TarjetaPartido`) la leen por
 * contexto: con `context` en `null` —quien no puede cargar, o la fecha
 * cerrada— no hay hoja y las tarjetas son de sólo lectura.
 *
 * Después de guardar, la hoja se cierra, el aviso dice qué se guardó y ofrece
 * "Siguiente": el próximo partido sin cargar, a un toque. Es una acción del
 * aviso y no un salto solo: mover la pantalla o el foco sin que nadie lo pida
 * desorienta, y con lector de pantalla el aviso ya se anuncia por su región.
 */
export function CargaDeLaFecha({
  context,
  partidos,
  children,
}: {
  context: CargaContext | null
  /** Todos los partidos de la lista, en el orden de la pantalla: de acá sale "Siguiente". */
  partidos: PartidoVM[]
  children: ReactNode
}) {
  // `vez` cambia en cada apertura: la hoja arranca de cero aunque se reabra el
  // mismo partido. `matchId` se queda al cerrar para que baje con su contenido.
  const [hoja, setHoja] = useState<{ matchId: string; open: boolean; vez: number } | null>(null)
  const [aviso, setAviso] = useState<{ texto: string; guardado: string } | null>(null)
  const primerCampo = useRef<HTMLInputElement>(null)

  const abrir = (matchId: string) => setHoja((prev) => ({ matchId, open: true, vez: (prev?.vez ?? 0) + 1 }))
  const cerrar = () => setHoja((prev) => (prev === null ? null : { ...prev, open: false }))

  const partido = hoja === null ? undefined : partidos.find((candidate) => candidate.matchId === hoja.matchId)
  // Se calcula con la lista de AHORA: cuando se toca "Siguiente" la página ya
  // volvió con el resultado guardado.
  const siguiente =
    aviso === null
      ? null
      : siguienteSinCargar(
          partidos.map((candidate) => ({ matchId: candidate.matchId, loaded: candidate.sets.length > 0 })),
          aviso.guardado,
        )

  const irA = (matchId: string) => {
    // El foco va a la tarjeta antes de abrir: la hoja vuelve ahí al cerrarse,
    // y el aviso que tenía el botón ya no existe.
    const tarjeta = document.getElementById(`partido-${matchId}`)
    tarjeta?.focus({ preventScroll: true })
    tarjeta?.scrollIntoView?.({ block: 'center' })
    abrir(matchId)
  }

  return (
    <CargaCtx.Provider value={context === null ? null : abrir}>
      {children}
      {context !== null && (
        <>
          <Sheet
            open={hoja?.open ?? false}
            onClose={cerrar}
            title={partido?.seccion ?? ''}
            initialFocus={context.format.openScore ? primerCampo : undefined}
          >
            {partido !== undefined && hoja !== null && (
              <HojaDeCarga
                key={hoja.vez}
                context={context}
                partido={partido}
                primerCampo={primerCampo}
                onGuardado={(sets) => {
                  cerrar()
                  setAviso({ texto: `Guardado: ${resumenGuardado(partido.pairAName, partido.pairBName, sets)}`, guardado: partido.matchId })
                }}
              />
            )}
          </Sheet>
          <Toast
            message={aviso?.texto ?? null}
            action={siguiente === null ? undefined : { label: 'Siguiente', onClick: () => irA(siguiente) }}
            onDismiss={() => setAviso(null)}
            // Arriba de la barra de pestañas del torneo, para no tapar nada de abajo.
            className="bottom-[calc(96px+env(safe-area-inset-bottom))]"
          />
        </>
      )}
    </CargaCtx.Provider>
  )
}

/** Abrir la hoja de un partido, o `null` si en esta fecha no se carga. */
const CargaCtx = createContext<((matchId: string) => void) | null>(null)

/** Un lado escrito, con tu nombre marcado si estás. Sin vos es texto plano. */
function Lado({ partes }: { partes: ParteVM[] }) {
  if (!partes.some((parte) => parte.vos)) return partes.map((parte) => parte.name).join(' & ')
  return partes.map((parte, index) => (
    <span key={index}>
      {index > 0 && ' & '}
      {parte.vos ? <span className="marca-vos">{parte.name}</span> : parte.name}
    </span>
  ))
}

/**
 * Un partido de la lista. Sin resultado y con permiso de carga es el bloque
 * tintado con "Cargar": tocarlo entero abre la hoja. Cargado, las dos filas
 * con el ganador en tinta y el perdedor apagado; con permiso también es un
 * botón, y abre la hoja precargada para corregirlo (`saveResult` reemplaza,
 * y un resultado mal cargado de noche no tendría otro arreglo).
 *
 * Cada fila es `nombre</span><span>número`: la suite de la página lee el
 * marcador así, pegado al nombre.
 */
export function TarjetaPartido({ partido }: { partido: PartidoVM }) {
  const abrir = useContext(CargaCtx)
  const cargado = partido.sets.length > 0

  const fila = (lado: 'A' | 'B') => {
    const gano = partido.winner === lado
    const perdio = partido.winner !== null && !gano
    return (
      <span className="flex items-center justify-between gap-2">
        <span className={`min-w-0 text-[17px] ${perdio ? 'font-medium text-muted' : 'font-bold text-text'}`}>
          <Lado partes={lado === 'A' ? partido.pairA : partido.pairB} />
        </span>
        <span className={`font-cond shrink-0 text-[32px] ${perdio ? 'text-muted' : 'text-text'}`}>
          {lado === 'A' ? partido.scoreA : partido.scoreB}
        </span>
      </span>
    )
  }

  if (abrir === null || cargado) {
    const caja = 'flex w-full flex-col gap-1.5 rounded-tile border-[1.5px] border-line px-4 py-3 text-left'
    if (abrir === null) {
      return (
        <div className={caja}>
          {fila('A')}
          {fila('B')}
        </div>
      )
    }
    return (
      <button
        id={`partido-${partido.matchId}`}
        type="button"
        aria-label={`Corregir ${partido.pairAName} ${partido.scoreA}, ${partido.pairBName} ${partido.scoreB}`}
        onClick={() => abrir(partido.matchId)}
        className={`${caja} press-fila min-h-[76px]`}
      >
        {fila('A')}
        {fila('B')}
      </button>
    )
  }

  return (
    <button
      id={`partido-${partido.matchId}`}
      type="button"
      aria-label={`Cargar ${partido.pairAName} contra ${partido.pairBName}`}
      onClick={() => abrir(partido.matchId)}
      className="flex min-h-[84px] w-full items-center gap-3 rounded-tile bg-sport-tint py-3 pr-3.5 pl-4 text-left active:bg-opcion"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-[17px] font-semibold text-text">
          <Lado partes={partido.pairA} />
        </span>
        <span className="text-[13px] leading-none font-semibold text-muted">contra</span>
        <span className="text-[17px] font-semibold text-text">
          <Lado partes={partido.pairB} />
        </span>
      </span>
      <span className="flex h-10 shrink-0 items-center rounded-pill bg-block px-3.5 text-[15px] font-bold text-on-block">
        Cargar
      </span>
    </button>
  )
}

/**
 * El contenido de la hoja de un partido: el marcador abierto (FIFA) o la
 * máquina de dos toques (sets). Va montada con `key` por apertura: cada vez
 * que se abre arranca de lo que dice el partido, no de un intento anterior.
 */
function HojaDeCarga({
  context,
  partido,
  primerCampo,
  onGuardado,
}: {
  context: CargaContext
  partido: PartidoVM
  primerCampo: RefObject<HTMLInputElement | null>
  onGuardado: (sets: SetScore[]) => void
}) {
  const { seasonId, matchdayNumber, format } = context
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const guardar = (sets: SetScore[], siFalla: () => void) => {
    setError(null)
    startTransition(async () => {
      const result = await saveMatchResult(seasonId, matchdayNumber, partido.matchId, sets)
      if (!result.ok) {
        // Lo cargado NO se tira (S8e): el rebote esperable es una regla del
        // marcador o la red, y se arregla con un toque, no cargando todo de nuevo.
        setError(result.error)
        siFalla()
        return
      }
      onGuardado(sets)
    })
  }

  const alerta = error !== null && (
    <p role="alert" className={`mt-3 ${ERROR_NOTE}`}>
      {error}
    </p>
  )

  if (format.openScore) {
    return (
      <Goles
        partido={partido}
        pending={pending}
        primerCampo={primerCampo}
        alerta={alerta}
        onSave={(set) => guardar([set], () => {})}
      />
    )
  }
  return <DosToques context={context} partido={partido} pending={pending} alerta={alerta} guardar={guardar} />
}

/**
 * Sets (pádel, ping pong, cualquier `setsToWin`/`gamesPerSet`/`tieBreak` que
 * sepa `carga-state.ts`): quién ganó, y con cuántos se quedó el que perdió. El
 * toque del perdedor cierra el set; si con eso se define el partido, guarda.
 * Si no, la hoja pasa al set siguiente. Se guarda UNA vez, con el partido
 * entero: `saveResult` reemplaza los sets, y guardar de a uno borraría el
 * anterior.
 *
 * Al corregir, cada set arranca con lo que tenía (`toqueDelSet`): el ganador
 * elegido y su número marcado, así que confirmar lo mismo es un toque.
 */
function DosToques({
  context,
  partido,
  pending,
  alerta,
  guardar,
}: {
  context: CargaContext
  partido: PartidoVM
  pending: boolean
  alerta: ReactNode
  guardar: (sets: SetScore[], siFalla: () => void) => void
}) {
  const { format, unit } = context
  const previo = (index: number) => {
    const set = partido.sets[index]
    return set === undefined ? null : toqueDelSet(set, format)
  }
  const [carga, setCarga] = useState<LoadState>(() => ({ sets: [], pendingWinner: previo(0)?.winner ?? null }))
  // El número marcado del set en curso: el precargado, o el último tocado
  // (después de un error se ve qué se intentó guardar).
  const [elegido, setElegido] = useState<{ loser: number; deuce: boolean } | null>(() => previo(0))

  const ganador = carga.pendingWinner
  const nombreDe = (lado: 'A' | 'B') => (lado === 'A' ? partido.pairAName : partido.pairBName)
  const multiSet = format.setsToWin > 1
  const numeroDeSet = carga.sets.length + 1

  const cerrarSet = (next: LoadState, toque: { loser: number; deuce: boolean }) => {
    setElegido(toque)
    if (isComplete(next, format)) {
      // Mientras guarda (y si rebota) la hoja muestra el toque que se intentó.
      setCarga(retomarUltimoSet(next))
      guardar(next.sets, () => {})
      return
    }
    const siguiente = previo(next.sets.length)
    setCarga({ ...next, pendingWinner: siguiente?.winner ?? null })
    setElegido(siguiente)
  }

  return (
    <div>
      {multiSet && (
        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="font-titulo text-[20px]">Set {numeroDeSet}</p>
          {carga.sets.map((set, index) => (
            <span key={index} className="text-[15px] font-semibold text-muted">
              {`Set ${index + 1}: ${set.gamesA}-${set.gamesB}`}
            </span>
          ))}
        </div>
      )}
      <p className={PREGUNTA}>Ganó</p>
      <div className="flex flex-col gap-2.5">
        {(['A', 'B'] as const).map((lado) => (
          <button
            key={lado}
            type="button"
            aria-pressed={ganador === lado}
            disabled={pending}
            onClick={() => {
              setCarga(chooseWinner(carga, lado))
              if (ganador !== lado) setElegido(null)
            }}
            className={`flex min-h-[64px] items-center justify-between gap-3 rounded-btn px-[18px] text-left text-[19px] font-bold ${
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
        onLoser={(n) => cerrarSet(chooseLoserGames(carga, n, format), { loser: n, deuce: false })}
        onDeuce={(loser) => cerrarSet(chooseDeuce(carga, loser, format), { loser, deuce: true })}
      />
      <p aria-live="polite" className="mt-2.5 min-h-5 text-[15px] text-muted">
        {pending
          ? 'Guardando…'
          : ganador === null
            ? 'Tocá primero quién ganó.'
            : multiSet
              ? 'Se guarda cuando se define el partido.'
              : 'Con este toque se guarda.'}
      </p>
      {alerta}
    </div>
  )
}

/**
 * El segundo toque: con cuántos se quedó el que perdió. Si el set se gana por
 * dos (ping pong, sin tie-break) siguen los de ventaja, "12-10" … "16-14"
 * (`deuceOptions`, los mismos de amigos); con tie-break `deuceOptions` da `[]`
 * y pádel queda como siempre. Sin ganador elegido se ven pero no se tocan: la
 * hoja no salta de alto entre un toque y otro.
 *
 * Exportado para renderizarlo en la suite.
 */
export function BotonesDelPerdedor({
  format,
  unit,
  loserName,
  pending,
  elegido = null,
  onLoser,
  onDeuce,
}: {
  format: MatchFormat
  unit: string
  /** El que perdió, o `null` mientras no se eligió quién ganó. */
  loserName: string | null
  pending: boolean
  /** El botón marcado: el precargado al corregir, o el que se intentó guardar. */
  elegido?: { loser: number; deuce: boolean } | null
  onLoser: (n: number) => void
  onDeuce: (loser: number) => void
}) {
  const apagado = pending || loserName === null
  const numero = (activo: boolean) =>
    `flex min-h-[60px] items-center justify-center rounded-btn border-[1.5px] font-cond ${
      activo ? 'border-block bg-block text-on-block' : 'border-line text-text active:bg-sport-tint'
    }`
  return (
    <>
      <p className={PREGUNTA}>
        {loserName === null ? `${cap(unit)} del que perdió` : `${cap(unit)} de ${loserName}`}
      </p>
      <div className="grid grid-cols-6 gap-2">
        {loserGamesOptions(format).map((games) => {
          const activo = elegido !== null && !elegido.deuce && elegido.loser === games
          return (
            <button
              key={games}
              type="button"
              disabled={apagado}
              aria-pressed={activo}
              className={`${numero(activo)} text-[30px]`}
              onClick={() => onLoser(games)}
            >
              {games}
            </button>
          )
        })}
      </div>
      {deuceOptions(format).length > 0 && (
        <div className="mt-2 grid grid-cols-3 gap-2">
          {deuceOptions(format).map((loser) => {
            const activo = elegido !== null && elegido.deuce && elegido.loser === loser
            return (
              <button
                key={`deuce-${loser}`}
                type="button"
                disabled={apagado}
                aria-pressed={activo}
                aria-label={`${loser + 2} a ${loser}`}
                className={`${numero(activo)} text-[26px]`}
                onClick={() => onDeuce(loser)}
              >
                {`${loser + 2}-${loser}`}
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}

/** Los goles con los que se abre la hoja: los del partido al corregir, vacíos si es nuevo. */
function golesIniciales(sets: SetScore[]): { a: string; b: string } {
  const set = sets.length === 1 ? sets[0] : undefined
  return set === undefined ? { a: '', b: '' } : { a: String(set.gamesA), b: String(set.gamesB) }
}

/** El marcador abierto dentro de la hoja: los dos campos, el error y "Guardar". */
function Goles({
  partido,
  pending,
  primerCampo,
  alerta,
  onSave,
}: {
  partido: PartidoVM
  pending: boolean
  primerCampo: RefObject<HTMLInputElement | null>
  alerta: ReactNode
  onSave: (set: SetScore) => void
}) {
  const [goals, setGoals] = useState(() => golesIniciales(partido.sets))
  return (
    <div className="mt-4">
      <PanelGoles
        pairAName={partido.pairAName}
        pairBName={partido.pairBName}
        goals={goals}
        pending={pending}
        onChange={setGoals}
        onSave={onSave}
        primerCampo={primerCampo}
      />
      {alerta}
    </div>
  )
}

/**
 * Un lado del marcador abierto.
 *
 * `type="text"` con `inputMode="numeric"`, y no `type="number"`: el numérico
 * deja tipear `e`, `-` y `.` igual, se le puede mover el valor con la rueda del
 * mouse sin querer, y `maxLength` no le aplica. Lo que sale de acá es un string
 * que `openScoreSet` decide si ya es un número o todavía no — que es
 * exactamente lo que hace falta mientras alguien está escribiendo.
 *
 * Sin `outline-none`: el anillo de foco global (`globals.css`) es el que dice
 * dónde estás. Mientras guarda queda `readOnly` y no `disabled`: deshabilitarlo
 * le saca el foco y cierra el teclado del celular.
 */
function CampoGoles({
  side,
  value,
  pending,
  invalid,
  inputRef,
  enterKeyHint,
  onChange,
  onEnter,
}: {
  side: string
  value: string
  pending: boolean
  /** Lo escrito ya no puede ser un marcador. Lo decide `goalsRejected`. */
  invalid: boolean
  inputRef?: RefObject<HTMLInputElement | null>
  enterKeyHint: 'next' | 'done'
  onChange: (next: string) => void
  onEnter: () => void
}) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className="truncate text-[15px] font-semibold text-muted">{side}</span>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        enterKeyHint={enterKeyHint}
        autoComplete="off"
        maxLength={MAX_GOAL_DIGITS}
        value={value}
        readOnly={pending}
        aria-label={`Goles de ${side}`}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          onEnter()
        }}
        className={`font-cond h-[72px] w-full rounded-btn border-[1.5px] bg-surface-2 px-3 text-center text-[44px] text-text ${
          invalid ? 'border-live' : 'border-line'
        }`}
      />
    </label>
  )
}

/**
 * El panel del marcador abierto: dos números y un botón de guardar.
 *
 * El primer campo arranca enfocado (`initialFocus` de la hoja). Enter (o
 * "Siguiente" del teclado) pasa al segundo, y también tipear dos dígitos: los
 * goles de un partido casi nunca llegan a dos, así que el segundo dígito es
 * "ya terminé". El tope sigue en tres (`MAX_GOAL_DIGITS`), por si alguna vez.
 * Enter en el segundo guarda.
 *
 * No opina sobre si el par es LEGAL para la disciplina: un `0-0` donde no se
 * admiten empates lo rechaza `matchError` del lado del servidor y el mensaje
 * vuelve por el `WriteResult`. Lo que explica este panel es lo otro: lo que ni
 * siquiera es un marcador.
 *
 * Exportado para RENDERIZARLO en la suite (`carga.unit.test.ts`).
 */
export function PanelGoles({
  pairAName,
  pairBName,
  goals,
  pending,
  onChange,
  onSave,
  primerCampo,
}: {
  pairAName: string
  pairBName: string
  goals: { a: string; b: string }
  pending: boolean
  /**
   * El setter entero, no `(next) => void`: los dos campos se actualizan con la
   * forma FUNCIONAL. Con `onChange({ ...goals, a: next })` el `goals` es el de
   * la clausura de ESTE render, y el día que un `onPaste` toque los dos en el
   * mismo tick el segundo pisa al primero (N50).
   */
  onChange: Dispatch<SetStateAction<{ a: string; b: string }>>
  onSave: (set: SetScore) => void
  primerCampo?: RefObject<HTMLInputElement | null>
}) {
  const segundo = useRef<HTMLInputElement>(null)
  const draft = openScoreSet(goals.a, goals.b)
  const problem = goalsError(goals.a, goals.b)
  const guardar = () => {
    if (draft !== null && !pending) onSave(draft)
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        guardar()
      }}
      className="flex flex-col gap-3"
    >
      <div className="flex items-start gap-3">
        <CampoGoles
          side={pairAName}
          value={goals.a}
          pending={pending}
          invalid={goalsRejected(goals.a)}
          inputRef={primerCampo}
          enterKeyHint="next"
          onChange={(next) => {
            onChange((current) => ({ ...current, a: next }))
            if (/^\d{2,}$/.test(next.trim())) segundo.current?.focus()
          }}
          onEnter={() => segundo.current?.focus()}
        />
        <CampoGoles
          side={pairBName}
          value={goals.b}
          pending={pending}
          invalid={goalsRejected(goals.b)}
          inputRef={segundo}
          enterKeyHint="done"
          onChange={(next) => onChange((current) => ({ ...current, b: next }))}
          onEnter={guardar}
        />
      </div>
      {problem !== null && <p className={ERROR_NOTE}>{problem}</p>}
      {/* Deshabilitado sólo mientras falte un número. Si el par no es legal
          para la disciplina —un `0-0` sin empates— el botón deja guardar y el
          mensaje lo escribe `matchError`, que es donde vive esa regla. */}
      <button
        type="button"
        disabled={pending || draft === null}
        onClick={guardar}
        className={button('primary', { size: 'lg', full: true })}
      >
        {pending ? 'Guardando…' : 'Guardar'}
      </button>
    </form>
  )
}

/** Los partidos que faltan, dichos: "Faltan 3 partidos", "Falta 1 partido". */
export function faltanPartidos(remaining: number): string {
  if (remaining === 0) return 'Todos los partidos cargados'
  return remaining === 1 ? 'Falta 1 partido' : `Faltan ${remaining} partidos`
}

/**
 * Una rayita por partido, llena si está cargado. Hasta 12: con más ya no se
 * cuentan de un vistazo y el número dice lo mismo.
 */
export function Rayitas({
  total,
  remaining,
  className = 'bg-sport',
  vacia = 'bg-line',
  alinear = 'end',
}: {
  total: number
  remaining: number
  /** La llena y la vacía: sobre el bloque de color van claras. */
  className?: string
  vacia?: string
  alinear?: 'start' | 'end'
}) {
  if (total === 0 || total > 12) return null
  return (
    // Se achican (nunca más de 22) antes que empujar el texto de al lado.
    <span aria-hidden="true" className={`flex min-w-0 flex-1 gap-1 ${alinear === 'end' ? 'justify-end' : 'justify-start'}`}>
      {Array.from({ length: total }, (_, index) => (
        <i key={index} className={`h-2 max-w-[22px] min-w-1.5 flex-1 rounded-full ${index < total - remaining ? className : vacia}`} />
      ))}
    </span>
  )
}

/**
 * El pie de la fecha para quien organiza: cerrarla mientras está en juego,
 * reabrir la última cerrada, o volver al armado una fecha en juego.
 *
 * "Cerrar la fecha" se ve siempre y está apagado hasta que no falte nada, con
 * la razón pegada arriba ("Faltan 3 partidos", que además lo describe para el
 * lector de pantalla). Cerrar congela los puntos; reabrir y volver al armado
 * los borran (el segundo, indirectamente), así que los dos revelan un bloque
 * de confirmación en línea — nada de `window.confirm`. Las reglas de qué se
 * puede reabrir viven en `reopen_matchday` y no se replican acá: lo que se
 * muestra es su mensaje.
 *
 * `asking` es un solo booleano para las dos confirmaciones: reabrir sólo
 * dibuja bajo `status === 'CLOSED'` y volver al armado sólo bajo `OPEN`, y
 * `status` es un solo valor. La tercera —borrar la fecha— vive en
 * `borrar.tsx` con su propio `asking`, y lo que evita que compitan es el
 * `!asking` con el que se monta `<BorrarFecha>`: mientras una confirmación
 * está abierta, la otra ni se dibuja.
 */
export function CierreFecha({
  context,
  status,
  remaining,
  total,
  canReopen,
  loadedResults,
}: {
  context: CargaContext
  status: 'OPEN' | 'CLOSED'
  /** Partidos sin resultado. `close_matchday` lo vuelve a verificar, y esa es la verificación que manda. */
  remaining: number
  /** Partidos de la fecha que cuentan para cerrarla: las rayitas. */
  total: number
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
  const faltanId = useId()
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
  const confirmacion = 'flex flex-col gap-3 rounded-tile bg-surface p-4'

  return (
    <div className="flex flex-col gap-3">
      {status === 'OPEN' && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-3">
            <b id={faltanId} className="shrink-0 text-[17px] font-[750]">
              {faltanPartidos(remaining)}
            </b>
            <Rayitas total={total} remaining={remaining} />
          </div>
          {/* Incompleta no se atenúa (la opacidad global de `:disabled` es
              "el sistema está trabajando"): se apaga con color, legible, y la
              razón queda arriba. Mientras cierra, sí. */}
          <button
            type="button"
            disabled={!complete || pending}
            aria-describedby={faltanId}
            onClick={() => run(() => closeTheMatchday(seasonId, matchdayId, matchdayNumber))}
            className={
              complete
                ? button('primary', { size: 'lg', full: true })
                : 'flex min-h-[56px] w-full items-center justify-center rounded-btn bg-chip px-5 text-[17px] font-bold text-muted disabled:opacity-100'
            }
          >
            Cerrar la fecha
          </button>
        </div>
      )}

      {status === 'OPEN' && !asking && (
        <button type="button" onClick={() => setAsking(true)} className={button('secondary', { full: true })}>
          Volver al armado
        </button>
      )}

      {status === 'OPEN' && asking && (
        <div className={confirmacion}>
          <p className="text-[15px] font-semibold">Volvés al armado para corregir quién juega.</p>
          {/* Las parejas no se tocan en esta transición, pero un aviso que lo
              dijera sería una promesa falsa: se caen igual en cuanto se toca
              un tilde de presente (`toggleAttendance` → `syncGuestSeat` →
              `clearPairs`), que es justo lo que se viene a hacer acá. */}
          {loadedResults > 0 && (
            <p className="text-[15px] font-semibold">
              Ya hay resultados cargados: si cambiás quién juega o volvés a sortear, se borran.
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => redraftTheMatchday(seasonId, matchdayId, matchdayNumber))}
              className={`${button('primary')} flex-1`}
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
              className={`${button('secondary')} flex-1`}
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
        <button type="button" onClick={() => setAsking(true)} className={button('secondary', { full: true })}>
          Reabrir fecha
        </button>
      )}

      {status === 'CLOSED' && canReopen && asking && (
        <div className={confirmacion}>
          <p className="text-[15px] font-semibold">Se borran los puntos de esta fecha y la tabla se recalcula.</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => reopenTheMatchday(seasonId, matchdayId, matchdayNumber))}
              className={`${button('primary')} flex-1`}
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
              className={`${button('secondary')} flex-1`}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {error !== null && (
        <p role="alert" className={ERROR_NOTE}>
          {error}
        </p>
      )}
    </div>
  )
}
