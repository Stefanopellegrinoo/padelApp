'use client'

import { useActionState, useId, useState, useTransition, type ReactNode } from 'react'
import { SPORTS, SPORT_IDS, isSportId, sportLabel, sportOf, type MatchFormat, type SportId } from '@/core'
import type { CasualMatch } from '@/db/friends'
import { isComplete, startLoad, type LoadState } from '@/app/torneo/[id]/[disciplina]/fechas/[n]/carga-state'
import { SubmitButton } from '@/app/submit-button'
import { editCasualMatch, removeCasualMatch, type CasualFormState } from '../actions'
import {
  formatForSport,
  playersFrom,
  slotsError,
  slotsFor,
  type Mode,
  type Slot,
  type SlotKey,
} from './cargar-state'
import { INPUT, LABEL, LEGEND, OPTION } from './estilos'
import { ResultadoGoles, type GoalsFields } from './resultado-goles'
import { ResultadoSets } from './resultado-sets'

const INITIAL_STATE: CasualFormState = { error: null }

const ERROR_NOTE = 'rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live'
const GUEST = '__guest__'

const MODES: { value: Mode; label: string }[] = [
  { value: '1v1', label: '1 vs 1' },
  { value: '2v2', label: '2 vs 2' },
]
const SLOT_LABELS: Record<SlotKey, string> = {
  partner: 'Tu compañero',
  rival1: 'Rival 1',
  rival2: 'Rival 2',
}

/**
 * Los campos de texto plano con los que se prellena el formulario al editar
 * -- `CasualMatch` (`db/friends.ts`) no alcanza tal cual porque sus campos
 * vienen tipados (`score: {mine,theirs}|null`), no como el string vacío que un
 * `<input>` sin valor necesita. `roster` es el plantel ya como texto: es fijo
 * después de crear, así que al editar no se elige, se muestra.
 */
export interface CasualFormInitial {
  matchId: string
  sport: string
  playedOn: string
  outcome: 'won' | 'lost' | 'drew'
  scoreMine: string
  scoreTheirs: string
  teamMine: string
  teamTheirs: string
  roster: string
  /** Sólo deportes de sets: los sets guardados, en mi orientación. */
  sets?: ReadonlyArray<{ mine: number; theirs: number }>
}

export interface CasualFormFriend {
  playerId: string
  displayName: string
}

/** Lo que el `<select>` de un lugar tiene elegido: '' (nada), GUEST o un playerId. */
interface SlotChoice {
  choice: string
  name: string
}

function slotOf({ choice, name }: SlotChoice): Slot | null {
  if (choice === '') return null
  return choice === GUEST ? { kind: 'guest', name } : { kind: 'friend', playerId: choice }
}

/**
 * El formulario de cargar/editar un partido casual (diseño §4), compartido
 * por las dos operaciones -- lo único que cambia entre cargar y editar es
 * `action` (qué server action llamar) e `initial` (si hay algo que
 * prellenar). Al editar no hay sección de jugadores: el plantel es fijo.
 *
 * `useActionState`, no el patrón `<form action={fn}>` sin estado de
 * `app/amigos/actions.ts`: acá hay una validación real (`parseCasualResult`,
 * `db/friends.ts`) que puede fallar y hay que mostrarla en la misma pantalla.
 *
 * Todos los campos son CONTROLADOS -- cada uno con su propio `useState`,
 * seedeado desde `initial` --, NO por lo que arma el hook de arriba. Toda
 * action de un `<form action={fn}>` -- también una que TERMINA en error --
 * dispara un `HTMLFormElement.reset()` nativo (verificado en React 19:
 * `startHostTransition` → `requestFormReset$1` → `fiber.stateNode.reset()`).
 * Los inputs de TEXTO controlados lo sobreviven (React mantiene su valor por
 * defecto sincronizado con el estado), pero los radios y los `<select>`
 * controlados NO: el reset los deja visualmente en su primer valor aunque el
 * estado siga bien (lo prueba `cargar.unit.test.ts`). Por eso el envío es
 * `onSubmit` + `startTransition(() => formAction(data))` y no `<form
 * action>`: la action corre igual, pero React nunca pide el reset. Mismo
 * criterio que `app/torneo/[id]/ajustes/disciplinas.tsx` (líneas 177 y 224),
 * que dispara su escritura desde un `startTransition` y no desde `<form
 * action>`. Sólo el `players` oculto viaja en el FormData, armado del estado.
 *
 * El resultado lo dibuja la familia del deporte (`core/sports.ts`):
 * `ResultadoSets` (formato + sets en dos toques; el ganador sale de los sets,
 * `parseCasualResult`) o `ResultadoGoles` ("quién ganó" + marcador). Los dos
 * son controlados desde acá. Cambiar un stepper vacía los sets: pueden dejar
 * de ser válidos y es más simple que revalidarlos.
 */
export function CasualForm({
  friendPlayerId,
  friends = [],
  action,
  initial,
  onCancel,
  submitLabel,
}: {
  /** El amigo de la pantalla: viene preseleccionado como rival 1. */
  friendPlayerId: string
  /** Amigos aceptados entre los que se puede elegir. */
  friends?: readonly CasualFormFriend[]
  action: (state: CasualFormState, formData: FormData) => Promise<CasualFormState>
  initial?: CasualFormInitial
  onCancel?: () => void
  submitLabel: string
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE)
  // Un id propio por instancia: dos `CasualForm` pueden convivir en la misma
  // pantalla (el de "cargar nuevo" y uno "editando" en una fila).
  const uid = useId()
  const [, startTransition] = useTransition()

  const initialSport = initial?.sport ?? ''
  const [sport, setSport] = useState<'' | SportId>(
    isSportId(initialSport) ? initialSport : initial === undefined ? 'PADEL' : '',
  )
  const info = sport === '' ? null : sportOf(sport)
  const [mode, setMode] = useState<Mode>('1v1')
  const [slots, setSlots] = useState<Record<SlotKey, SlotChoice>>({
    partner: { choice: '', name: '' },
    rival1: {
      choice: friends.some((friend) => friend.playerId === friendPlayerId) ? friendPlayerId : '',
      name: '',
    },
    rival2: { choice: '', name: '' },
  })
  const [playedOn, setPlayedOn] = useState(initial?.playedOn ?? '')
  const [goals, setGoals] = useState<GoalsFields>({
    outcome: initial?.outcome ?? '',
    scoreMine: initial?.scoreMine ?? '',
    scoreTheirs: initial?.scoreTheirs ?? '',
    teamMine: initial?.teamMine ?? '',
    teamTheirs: initial?.teamTheirs ?? '',
  })
  // `info` todavía es el deporte de `initial`: este inicializador corre una sola vez.
  const [format, setFormat] = useState<MatchFormat>(() =>
    info?.family === 'sets' && initial?.sets !== undefined ? formatForSport(info, initial.sets) : SPORTS.PADEL.format,
  )
  const [load, setLoad] = useState<LoadState>(() => ({
    sets: (initial?.sets ?? []).map((set) => ({
      gamesA: set.mine,
      gamesB: set.theirs,
    })),
    pendingWinner: null,
  }))
  // Cambiar de deporte arranca el resultado de cero: nada del anterior (formato,
  // sets, empate, equipos) viaja escondido en el FormData.
  const chooseSport = (id: SportId) => {
    const next = sportOf(id)
    setSport(id)
    if (next.family === 'sets') setFormat(next.format)
    setLoad(startLoad())
    setGoals({ outcome: '', scoreMine: '', scoreTheirs: '', teamMine: '', teamTheirs: '' })
  }
  const setFormatKey = (key: 'setsToWin' | 'gamesPerSet', value: number) => {
    setFormat((current) => ({ ...current, [key]: value }))
    setLoad(startLoad())
  }

  const slotValues = {
    partner: slotOf(slots.partner),
    rival1: slotOf(slots.rival1),
    rival2: slotOf(slots.rival2),
  }
  // En 1v1 con un amigo de rival, "el otro lado" es ese amigo; en 2v2 es una pareja.
  const rival1Name =
    mode === '1v1' ? friends.find((friend) => friend.playerId === slots.rival1.choice)?.displayName : undefined
  const otherSide = rival1Name ?? 'el otro lado'
  const pageFriend = {
    playerId: friendPlayerId,
    name: friends.find((friend) => friend.playerId === friendPlayerId)?.displayName ?? 'este amigo',
  }
  const slotProblem = initial === undefined ? slotsError(mode, slotValues, pageFriend) : null
  const problem =
    slotProblem ??
    // Sólo al editar un id que salió del registro: no hay chip elegido ni resultado que dibujar.
    (info === null ? 'Elegí el deporte para cargar el resultado.' : null) ??
    (info?.family === 'sets' && !isComplete(load, format) ? 'Cargá los sets hasta cerrar el partido.' : null)
  const setSlot = (key: SlotKey, next: Partial<SlotChoice>) =>
    setSlots((current) => ({
      ...current,
      [key]: { ...current[key], ...next },
    }))

  const slotField = (key: SlotKey) => (
    <div key={key} className="flex flex-col gap-1">
      <label htmlFor={`${uid}-${key}`} className={LABEL}>
        {SLOT_LABELS[key]}
      </label>
      <select
        id={`${uid}-${key}`}
        data-slot={key}
        value={slots[key].choice}
        onChange={(e) => setSlot(key, { choice: e.target.value })}
        className={INPUT}
      >
        <option value="">Elegí…</option>
        {friends.map((friend) => (
          <option key={friend.playerId} value={friend.playerId}>
            {friend.displayName}
          </option>
        ))}
        <option value={GUEST}>Otro (sin cuenta)</option>
      </select>
      {slots[key].choice === GUEST && (
        <input
          data-slot-name={key}
          aria-label={`Nombre de ${SLOT_LABELS[key].toLowerCase()}`}
          placeholder="Nombre"
          value={slots[key].name}
          onChange={(e) => setSlot(key, { name: e.target.value })}
          className={INPUT}
        />
      )}
    </div>
  )
  const slotKeys = slotsFor(mode)

  return (
    <form
      // Ver el JSDoc de arriba: sin `<form action>` para que React no resetee radios ni selects.
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        startTransition(() => formAction(data))
      }}
      className="flex flex-col gap-5 rounded-card border border-line bg-surface p-4"
    >
      <input type="hidden" name="friendPlayerId" value={friendPlayerId} />
      {initial !== undefined && <input type="hidden" name="matchId" value={initial.matchId} />}
      {initial === undefined && (
        <input type="hidden" name="players" value={JSON.stringify(playersFrom(mode, slotValues))} />
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className={`${LEGEND} pb-2`}>Deporte</legend>
        {/* 5 chips en 390px: 3 + 2 (un `flex` los aplasta). */}
        <div className="grid grid-cols-3 gap-2">
          {SPORT_IDS.map((id) => (
            <label key={id} className={OPTION}>
              <input
                type="radio"
                name="sport"
                value={id}
                required
                checked={sport === id}
                onChange={() => chooseSport(id)}
                className="sr-only"
              />
              {sportLabel(id)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <span className={LEGEND}>Quiénes jugaron</span>
        {initial === undefined ? (
          <>
            <fieldset className="flex gap-2">
              <legend className="sr-only">Formato</legend>
              {MODES.map((candidate) => (
                <label key={candidate.value} className={OPTION}>
                  <input
                    type="radio"
                    name="mode"
                    value={candidate.value}
                    checked={mode === candidate.value}
                    onChange={() => setMode(candidate.value)}
                    className="sr-only"
                  />
                  {candidate.label}
                </label>
              ))}
            </fieldset>

            {/* Los dos lados como en un marcador: el tuyo arriba en verde
                (vos siempre estás), el otro abajo, un "vs" en el medio. */}
            <div className="flex flex-col gap-2 rounded-field bg-ok-bg p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-up">Tu lado</span>
                <span className="rounded-full bg-accent px-3 py-1.5 text-[12.5px] font-extrabold text-accent-text">
                  Vos
                </span>
              </div>
              {slotKeys.filter((key) => key === 'partner').map(slotField)}
            </div>
            <div aria-hidden className="flex items-center gap-3">
              <span className="h-px flex-1 bg-line" />
              <span className="text-[11px] font-extrabold uppercase tracking-[.14em] text-muted">vs</span>
              <span className="h-px flex-1 bg-line" />
            </div>
            <div className="flex flex-col gap-2 rounded-field bg-chip p-3">
              <span className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">El otro lado</span>
              {slotKeys.filter((key) => key !== 'partner').map(slotField)}
            </div>
          </>
        ) : (
          <p className="rounded-field bg-chip px-3 py-2.5 text-[13.5px] font-bold">{initial.roster}</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${uid}-fecha`} className={LEGEND}>
          Fecha
        </label>
        <input
          id={`${uid}-fecha`}
          name="playedOn"
          type="date"
          value={playedOn}
          onChange={(e) => setPlayedOn(e.target.value)}
          required
          className={`${INPUT} dark:scheme-dark`}
        />
      </div>

      {info?.family === 'sets' && (
        <ResultadoSets
          sport={info}
          format={format}
          load={load}
          otherSide={otherSide}
          onFormat={setFormatKey}
          onLoad={setLoad}
        />
      )}
      {info?.family === 'goals' && (
        <ResultadoGoles
          sport={info}
          uid={uid}
          otherSide={otherSide}
          rival1Name={rival1Name}
          {...goals}
          onChange={(patch) => setGoals((current) => ({ ...current, ...patch }))}
        />
      )}

      <div className="flex flex-col gap-2">
        {state.error !== null && <p className={ERROR_NOTE}>{state.error}</p>}
        {problem !== null && state.error === null && (
          <p className="text-[12px] font-bold text-muted">{problem}</p>
        )}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending || problem !== null}
            className="flex-1 rounded-field bg-accent p-4 text-center text-[15px] font-extrabold text-accent-text disabled:bg-chip disabled:text-muted disabled:opacity-100"
          >
            {submitLabel}
          </button>
          {onCancel !== undefined && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-field border border-line px-4 text-[14px] font-extrabold text-text"
            >
              Cancelar
            </button>
          )}
        </div>
      </div>
    </form>
  )
}

const ROW_ACTION = 'min-h-[40px] flex-1 rounded-field bg-chip px-4 text-[13px] font-extrabold'

/**
 * Una fila casual de `Historial` (`app/amigos/historial.tsx`), con Editar y
 * Borrar (§3.1, §3.3 -- los dos pueden). `children` es la tarjeta de lectura
 * que `Historial` ya sabe armar (fecha, lados, marcador, autoría); este
 * componente pone el borde y los controles, para no duplicar el copy acá.
 *
 * Los controles viven detrás de un "⋯" (arriba a la derecha): la tarjeta es
 * para leer el partido, y dos botones de colores en cada fila competían con
 * el marcador. Tocarlo despliega Editar / Borrar dentro de la misma tarjeta.
 *
 * Todo el estado es `useState` LOCAL, sin levantarlo a `Historial`: cada
 * fila decide el suyo, y `Historial` sigue siendo la función pura que prueba
 * `historial.unit.test.ts` llamándola directo (sin JSX).
 *
 * Borrar pide confirmación en dos pasos inline (`Borrar` -> `¿Borrar? Sí / No`):
 * el borrado saca el partido para todos los participantes (§3.3) y no se deshace.
 */
export function CasualMatchRow({
  friendPlayerId,
  partido,
  children,
}: {
  friendPlayerId: string
  partido: CasualMatch
  children: ReactNode
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  if (editing) {
    return (
      <CasualForm
        friendPlayerId={friendPlayerId}
        action={editCasualMatch}
        submitLabel="Guardar cambios"
        onCancel={() => {
          setEditing(false)
          setMenuOpen(false)
        }}
        initial={{
          matchId: partido.matchId,
          sport: partido.sport,
          playedOn: partido.playedOn,
          outcome: partido.outcome,
          scoreMine: partido.score !== null ? String(partido.score.mine) : '',
          scoreTheirs: partido.score !== null ? String(partido.score.theirs) : '',
          sets: partido.sets ?? undefined,
          teamMine: partido.teams.mine ?? '',
          teamTheirs: partido.teams.theirs ?? '',
          roster: `${partido.partners.length > 0 ? `con ${partido.partners.join(', ')} · ` : ''}vs ${partido.rivals.join(', ')}`,
        }}
      />
    )
  }

  return (
    <div className="relative flex flex-col gap-2 rounded-[14px] border border-line bg-surface p-[14px]">
      {children}
      <button
        type="button"
        aria-label="Opciones del partido"
        aria-expanded={menuOpen}
        onClick={() => {
          setMenuOpen(!menuOpen)
          setConfirmingDelete(false)
        }}
        className={`absolute top-1.5 right-1.5 flex h-10 w-10 items-center justify-center rounded-full text-[18px] leading-none font-extrabold text-muted ${
          menuOpen ? 'bg-chip text-text' : ''
        }`}
      >
        ⋯
      </button>
      {menuOpen &&
        (confirmingDelete ? (
          <form
            action={removeCasualMatch}
            role="group"
            aria-label="Confirmar borrado"
            className="flex items-center gap-2 rounded-field bg-live-bg py-1 pr-1 pl-3"
          >
            <input type="hidden" name="friendPlayerId" value={friendPlayerId} />
            <input type="hidden" name="matchId" value={partido.matchId} />
            <span className="flex-1 text-[12.5px] font-extrabold text-live">¿Borrar?</span>
            <SubmitButton className="min-h-[40px] rounded-[9px] bg-live px-4 text-[13px] font-extrabold text-bg disabled:opacity-60">
              Sí
            </SubmitButton>
            <button
              type="button"
              autoFocus
              onClick={() => setConfirmingDelete(false)}
              className="min-h-[40px] rounded-[9px] bg-bg px-4 text-[13px] font-extrabold text-text"
            >
              No
            </button>
          </form>
        ) : (
          <div className="flex gap-2">
            <button type="button" onClick={() => setEditing(true)} className={`${ROW_ACTION} text-accent-link`}>
              Editar
            </button>
            <button type="button" onClick={() => setConfirmingDelete(true)} className={`${ROW_ACTION} text-live`}>
              Borrar
            </button>
          </div>
        ))}
    </div>
  )
}
