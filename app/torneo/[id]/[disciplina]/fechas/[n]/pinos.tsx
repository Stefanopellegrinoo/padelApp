'use client'

import { useOptimistic, useRef, useState, useTransition, type RefObject } from 'react'
import { Avatar } from '@/app/ui/avatar'
import { button } from '@/app/ui/button'
import { Vos } from '@/app/torneo/[id]/[disciplina]/jugador/piezas'
import { confirmMatchday, saveMatchdayScore, toggleAttendance, type WriteResult } from './actions'
import { Asiento, type SeatVM } from './armado'
import { applySeatTick } from './armado-state'
import { BorrarFecha } from './borrar'
import { leerPinos, type FilaPinos, type JugadorPinosVM } from './pinos-state'
import { mensajeDeFalla } from './sin-conexion'

/**
 * Una fecha por ranking (bowling, S4): sin partidos. En el armado sólo se dice
 * quién viene (`ArmadoPinos`); en juego cada presente carga su total en su
 * fila (`CargaDePinos`) y el ranking se arma solo (`TablaDePinos`).
 */

const ALERTA = 'rounded-btn bg-live-bg px-3 py-2.5 text-[15px] font-semibold text-live'
/** Un botón principal apagado: se lee (no se atenúa), con la razón arriba. Igual que en el armado. */
const APAGADO =
  'flex min-h-[56px] w-full items-center justify-center rounded-btn bg-chip px-5 text-[17px] font-bold text-muted disabled:opacity-100'

/** Lo que una fila necesita para guardar: la fecha, no el partido. */
export interface PinosContext {
  seasonId: string
  matchdayId: string
  matchdayNumber: number
}

/**
 * El armado de una fecha por pinos: quién viene, y abrirla. Sin sorteo, sin
 * invitados ni formato: cada presente juega su línea. El tilde es optimista
 * con el mismo reducer que el armado de partidos (`applySeatTick`).
 */
export function ArmadoPinos({
  seasonId,
  matchdayId,
  disciplina,
  matchdayNumber,
  seats,
  loadedScores,
}: {
  seasonId: string
  matchdayId: string
  disciplina: string
  matchdayNumber: number
  seats: SeatVM[]
  /** Pinos ya cargados (una vuelta al armado los conserva): los cuenta "Borrar fecha". */
  loadedScores: number
}) {
  const [optimisticSeats, tickSeat] = useOptimistic(seats, applySeatTick)
  const [, startSeatTransition] = useTransition()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const tick = (seat: SeatVM) => {
    const playing = !seat.playing
    setError(null)
    startSeatTransition(async () => {
      tickSeat({ entryId: seat.entryId, playing })
      const result: WriteResult = await toggleAttendance(
        seasonId,
        matchdayId,
        matchdayNumber,
        seat.entryId,
        playing ? 'PLAYING' : 'ABSENT',
      ).catch((falla: unknown) => ({ ok: false as const, error: mensajeDeFalla(falla) }))
      if (!result.ok) setError(result.error)
    })
  }

  const confirmed = optimisticSeats.filter((seat) => seat.playing).length
  const canOpen = confirmed >= 2 && !pending

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-block bg-surface p-5">
        <p className="flex items-baseline justify-center gap-2">
          <span className="font-cond text-[64px]">{confirmed}</span>
          <span className="text-[19px] font-bold">confirmados</span>
        </p>
        <p className="mt-2 text-center text-[15px] text-muted">
          {confirmed >= 2
            ? 'Cada uno carga su total de pinos y gana el que más hizo.'
            : 'Hacen falta al menos dos para abrir la fecha.'}
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-titulo text-[22px]">Quién viene</h2>
          <span className="font-cond text-[24px] text-muted">
            {confirmed}/{seats.length}
          </span>
        </div>
        {optimisticSeats.map((seat) => (
          <Asiento key={seat.entryId} seat={seat} onTick={() => tick(seat)} />
        ))}
      </section>

      {error !== null && (
        <p role="alert" className={ALERTA}>
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={!canOpen}
        onClick={() => {
          setError(null)
          startTransition(async () => {
            const result: WriteResult = await confirmMatchday(seasonId, matchdayId, matchdayNumber).catch(
              (falla: unknown) => ({ ok: false as const, error: mensajeDeFalla(falla) }),
            )
            if (!result.ok) setError(result.error)
          })
        }}
        className={canOpen ? button('primary', { size: 'lg', full: true }) : APAGADO}
      >
        Abrir la fecha
      </button>

      <BorrarFecha seasonId={seasonId} matchdayId={matchdayId} disciplina={disciplina} loadedResults={loadedScores} />
    </div>
  )
}

type Estado = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string }

/**
 * La carga: una fila por presente con su campo de pinos. Tocar cualquier parte
 * de la fila enfoca el campo (la fila es su `<label>`); Enter guarda y pasa al
 * siguiente, y salir de un campo cambiado también guarda. Cada fila guarda
 * sola —`saveScore` reemplaza—, así que un error es de esa fila y no de la
 * planilla entera.
 *
 * Sin red la action tira en vez de volver: `mensajeDeFalla` lo convierte en
 * el aviso de la fila y lo escrito queda en el campo (T17, el mismo criterio
 * que la hoja de `carga.tsx`). Volver a Enter reintenta.
 */
export function CargaDePinos({ context, jugadores }: { context: PinosContext; jugadores: readonly JugadorPinosVM[] }) {
  const campos = useRef<Array<HTMLInputElement | null>>([])
  return (
    <ul className="flex flex-col">
      {jugadores.map((jugador, index) => (
        <FilaDePinos
          key={jugador.entryId}
          context={context}
          jugador={jugador}
          ultima={index === jugadores.length - 1}
          campos={campos}
          index={index}
        />
      ))}
    </ul>
  )
}

function FilaDePinos({
  context,
  jugador,
  ultima,
  campos,
  index,
}: {
  context: PinosContext
  jugador: JugadorPinosVM
  ultima: boolean
  campos: RefObject<Array<HTMLInputElement | null>>
  index: number
}) {
  const [value, setValue] = useState(jugador.score === null ? '' : String(jugador.score))
  // El último total que la base confirmó: salir sin cambiar nada no escribe.
  const [saved, setSaved] = useState<number | null>(jugador.score)
  const [estado, setEstado] = useState<Estado>({ kind: 'idle' })
  // El total que se está mandando: Enter guarda y mueve el foco, y ese blur
  // no tiene que mandar lo mismo otra vez.
  const enVuelo = useRef<number | null>(null)
  const draft = leerPinos(value)
  const invalid = draft !== null && 'error' in draft

  const guardar = () => {
    if (draft === null) return
    if ('error' in draft) {
      setEstado({ kind: 'error', message: draft.error })
      return
    }
    if ((draft.score === saved && estado.kind !== 'error') || draft.score === enVuelo.current) return
    const score = draft.score
    enVuelo.current = score
    setEstado({ kind: 'saving' })
    void saveMatchdayScore(context.seasonId, context.matchdayNumber, context.matchdayId, jugador.entryId, score)
      .catch((falla: unknown): WriteResult => ({ ok: false, error: mensajeDeFalla(falla) }))
      .then((result) => {
        enVuelo.current = null
        if (!result.ok) {
          setEstado({ kind: 'error', message: result.error })
          return
        }
        setSaved(score)
        setEstado({ kind: 'saved' })
      })
  }

  const errorId = `pinos-error-${jugador.entryId}`
  return (
    <li className="border-t border-line first:border-t-0">
      <label
        className={`flex min-h-[64px] items-center gap-3 py-2 ${
          jugador.vos ? '-mx-4 bg-vos-fila px-4 shadow-[inset_4px_0_0_var(--color-vos-borde)]' : ''
        }`}
      >
        <Avatar name={jugador.name} />
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[17px] font-semibold">
          <span className="truncate">{jugador.name}</span>
          {jugador.vos && <Vos />}
        </span>
        <span aria-live="polite" className="shrink-0 text-[13px] font-semibold text-muted">
          {estado.kind === 'saving' ? 'Guardando…' : estado.kind === 'saved' ? 'Guardado' : ''}
        </span>
        {/* `type="text"` + `inputMode="numeric"`, como el marcador abierto de
            `carga.tsx`: el numérico deja tipear `e` y `-` y se mueve con la
            rueda. Nunca `disabled` mientras guarda: le sacaría el foco y
            cerraría el teclado. */}
        <input
          ref={(element) => {
            campos.current[index] = element
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          enterKeyHint={ultima ? 'done' : 'next'}
          autoComplete="off"
          maxLength={4}
          value={value}
          placeholder="—"
          aria-label={`Pinos de ${jugador.name}`}
          aria-invalid={invalid || estado.kind === 'error' || undefined}
          aria-describedby={estado.kind === 'error' ? errorId : undefined}
          onChange={(event) => {
            setValue(event.target.value)
            if (estado.kind === 'error') setEstado({ kind: 'idle' })
          }}
          onBlur={guardar}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            guardar()
            const siguiente = campos.current[index + 1]
            if (siguiente) siguiente.focus()
            else event.currentTarget.blur()
          }}
          className={`font-cond h-[56px] w-[112px] shrink-0 rounded-btn border-[1.5px] bg-surface-2 px-3 text-right text-[32px] text-text placeholder:text-muted ${
            invalid || estado.kind === 'error' ? 'border-live' : 'border-line'
          }`}
        />
      </label>
      {estado.kind === 'error' && (
        <p id={errorId} role="alert" className={`mb-2 ${ALERTA}`}>
          {estado.message}
        </p>
      )}
    </li>
  )
}

/**
 * El ranking del día: puesto (compartido en el empate), jugador, pinos y los
 * puntos del campeonato —un guión hasta que se cierra—. Las filas llegan
 * escritas (`tablaDePinos`); acá sólo se dibuja, como `TablaDelDia`.
 */
export function TablaDePinos({ filas }: { filas: readonly (FilaPinos & { pts: string })[] }) {
  const grid = 'grid-cols-[56px_1fr_64px_44px]'
  return (
    <div className="-mx-4">
      <div className={`grid ${grid} h-9 items-center gap-2 px-4 text-[13px] font-semibold text-muted`}>
        <span>Puesto</span>
        <span>Jugador</span>
        <span className="text-right">Pinos</span>
        <span className="text-right">Pts</span>
      </div>
      {filas.map((fila, index) => (
        <div
          key={fila.key}
          className={`grid ${grid} min-h-[46px] items-center gap-2 px-4 py-2 text-[16px] tabular-nums ${
            fila.esVos
              ? 'bg-vos-fila shadow-[inset_4px_0_0_var(--color-vos-borde)]'
              : index > 0 && !filas[index - 1]?.esVos
                ? 'border-t border-line'
                : ''
          }`}
        >
          <span className="font-cond text-[24px]">{fila.puesto}</span>
          <span className="flex min-w-0 items-center gap-1.5 font-semibold">
            <span className="truncate">{fila.nombre}</span>
            {fila.esVos && <Vos />}
          </span>
          <span className={`text-right ${fila.esVos ? '' : 'text-muted'}`}>{fila.pinos}</span>
          <span className="font-cond text-right text-[26px]">{fila.pts}</span>
        </div>
      ))}
    </div>
  )
}
