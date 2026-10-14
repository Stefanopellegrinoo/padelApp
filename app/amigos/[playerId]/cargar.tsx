'use client'

import { useActionState, useId, useState, useTransition, type ReactNode } from 'react'
import { defaultConfig, type MatchFormat } from '@/core'
import type { CasualMatch } from '@/db/friends'
import {
  chooseLoserGames,
  chooseWinner,
  isComplete,
  loserGamesOptions,
  startLoad,
  type LoadState,
} from '@/app/torneo/[id]/[disciplina]/fechas/[n]/carga-state'
import { Stepper } from '@/app/torneos/nuevo/wizard'
import { DISCIPLINE_KINDS, DISCIPLINE_LABELS, STEPPERS, type DisciplineKind } from '@/app/torneos/nuevo/wizard-state'
import { SubmitButton } from '@/app/submit-button'
import { editCasualMatch, removeCasualMatch, type CasualFormState } from '../actions'
import {
  formatFromSets,
  playersFrom,
  setsField,
  slotsError,
  slotsFor,
  type Mode,
  type Slot,
  type SlotKey,
} from './cargar-state'

const INITIAL_STATE: CasualFormState = { error: null }

const INPUT =
  'rounded-field border-[1.5px] border-line bg-surface p-[13px] text-[16px] font-bold text-text outline-none'
const LABEL = 'text-[11.5px] font-extrabold text-muted'
const LEGEND = 'text-[11.5px] font-extrabold uppercase tracking-[.14em] text-muted'
const CHIP =
  'flex min-h-[44px] flex-1 items-center gap-2.5 rounded-field border border-line p-2.5 text-[13.5px] font-[700]'
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
  /** Sólo PADEL: los sets guardados, en mi orientación. */
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
 * Fuera de pádel, el "quién ganó" es un radio obligatorio con las tres
 * opciones (ruling del plan, docs/plan-amigos-deporte-y-2v2.md).
 *
 * Pádel no tiene "quién ganó" ni marcador de texto: elige su formato con dos
 * `Stepper` y carga N sets con la máquina de dos toques de la carga de fechas
 * (`carga-state.ts`, A = mi lado). El ganador sale de los sets
 * (`parseCasualResult`). Cambiar un stepper vacía los sets: pueden dejar de
 * ser válidos y es más simple que revalidarlos.
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

  const [sport, setSport] = useState<'' | DisciplineKind>(
    DISCIPLINE_KINDS.find((kind) => kind === initial?.sport) ?? (initial === undefined ? 'PADEL' : ''),
  )
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
  const [outcome, setOutcome] = useState<'' | CasualFormInitial['outcome']>(initial?.outcome ?? '')
  const [scoreMine, setScoreMine] = useState(initial?.scoreMine ?? '')
  const [scoreTheirs, setScoreTheirs] = useState(initial?.scoreTheirs ?? '')
  const [teamMine, setTeamMine] = useState(initial?.teamMine ?? '')
  const [teamTheirs, setTeamTheirs] = useState(initial?.teamTheirs ?? '')
  const [format, setFormat] = useState<MatchFormat>(() => ({
    ...defaultConfig(4).matchFormat,
    ...(initial?.sets !== undefined && initial.sets.length > 0 ? formatFromSets(initial.sets) : {}),
  }))
  const [load, setLoad] = useState<LoadState>(() => ({
    sets: (initial?.sets ?? []).map((set) => ({
      gamesA: set.mine,
      gamesB: set.theirs,
    })),
    pendingWinner: null,
  }))
  const isPadel = sport === 'PADEL'
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
    slotProblem ?? (isPadel && !isComplete(load, format) ? 'Cargá los sets hasta cerrar el partido.' : null)
  const setSlot = (key: SlotKey, next: Partial<SlotChoice>) =>
    setSlots((current) => ({
      ...current,
      [key]: { ...current[key], ...next },
    }))

  return (
    <form
      // Ver el JSDoc de arriba: sin `<form action>` para que React no resetee radios ni selects.
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        startTransition(() => formAction(data))
      }}
      className="flex flex-col gap-3 rounded-field border-[1.5px] border-line p-[14px]"
    >
      <input type="hidden" name="friendPlayerId" value={friendPlayerId} />
      {initial !== undefined && <input type="hidden" name="matchId" value={initial.matchId} />}
      {initial === undefined && (
        <input type="hidden" name="players" value={JSON.stringify(playersFrom(mode, slotValues))} />
      )}

      <fieldset className="flex flex-col gap-1.5">
        <legend className={LEGEND}>Deporte</legend>
        <div className="flex gap-2">
          {DISCIPLINE_KINDS.map((kind) => (
            <label key={kind} className={CHIP}>
              <input
                type="radio"
                name="sport"
                value={kind}
                required
                checked={sport === kind}
                onChange={() => setSport(kind)}
                className="h-5 w-5 shrink-0 accent-accent"
              />
              {DISCIPLINE_LABELS[kind]}
            </label>
          ))}
        </div>
      </fieldset>

      {initial === undefined ? (
        <>
          <fieldset className="flex flex-col gap-1.5">
            <legend className={LEGEND}>Formato</legend>
            <div className="flex gap-2">
              {MODES.map((candidate) => (
                <label key={candidate.value} className={CHIP}>
                  <input
                    type="radio"
                    name="mode"
                    value={candidate.value}
                    checked={mode === candidate.value}
                    onChange={() => setMode(candidate.value)}
                    className="h-5 w-5 shrink-0 accent-accent"
                  />
                  {candidate.label}
                </label>
              ))}
            </div>
          </fieldset>

          {slotsFor(mode).map((key) => (
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
          ))}
        </>
      ) : (
        <p className="text-[13.5px] font-[550] text-muted">{initial.roster}</p>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor={`${uid}-fecha`} className={LABEL}>
          Fecha
        </label>
        <input
          id={`${uid}-fecha`}
          name="playedOn"
          type="date"
          value={playedOn}
          onChange={(e) => setPlayedOn(e.target.value)}
          required
          className={INPUT}
        />
      </div>

      {isPadel && (
        <>
          <input type="hidden" name="setsToWin" value={format.setsToWin} />
          <input type="hidden" name="gamesPerSet" value={format.gamesPerSet} />
          <input type="hidden" name="sets" value={setsField(load)} />
          {STEPPERS.filter((stepper) => stepper.key === 'setsToWin' || stepper.key === 'gamesPerSet').map((stepper) => {
            const key = stepper.key as 'setsToWin' | 'gamesPerSet'
            return (
              <div key={key} data-stepper={key} className="flex items-center justify-between gap-3">
                <span className={LABEL}>{stepper.label}</span>
                <Stepper
                  value={format[key]}
                  min={stepper.min}
                  max={stepper.max}
                  onChange={(next) => setFormatKey(key, next)}
                />
              </div>
            )
          })}
          <PadelSets load={load} format={format} otherSide={otherSide} onChange={setLoad} />
        </>
      )}

      {!isPadel && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className={LEGEND}>¿Quién ganó?</legend>
          {(
            [
              ['won', 'Ganó tu lado'],
              ['lost', `Ganó ${otherSide}`],
              ['drew', 'Empataron'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex min-h-[38px] items-center gap-2 text-[13.5px] font-bold">
              <input
                type="radio"
                name="outcome"
                value={value}
                required
                checked={outcome === value}
                onChange={() => setOutcome(value)}
                className="h-4 w-4 shrink-0 accent-accent"
              />
              {label}
            </label>
          ))}
        </fieldset>
      )}

      {!isPadel && (
        <div className="flex gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor={`${uid}-scoreMine`} className={LABEL}>
              Goles de tu lado
            </label>
            <input
              id={`${uid}-scoreMine`}
              name="scoreMine"
              type="number"
              value={scoreMine}
              onChange={(e) => setScoreMine(e.target.value)}
              className={INPUT}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor={`${uid}-scoreTheirs`} className={LABEL}>
              {rival1Name !== undefined ? `Goles de ${rival1Name}` : 'Goles del otro lado'}
            </label>
            <input
              id={`${uid}-scoreTheirs`}
              name="scoreTheirs"
              type="number"
              value={scoreTheirs}
              onChange={(e) => setScoreTheirs(e.target.value)}
              className={INPUT}
            />
          </div>
        </div>
      )}

      {sport === 'FIFA' && (
        <div className="flex gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor={`${uid}-teamMine`} className={LABEL}>
              Tu equipo
            </label>
            <input
              id={`${uid}-teamMine`}
              name="teamMine"
              value={teamMine}
              onChange={(e) => setTeamMine(e.target.value)}
              className={INPUT}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor={`${uid}-teamTheirs`} className={LABEL}>
              Equipo del otro lado
            </label>
            <input
              id={`${uid}-teamTheirs`}
              name="teamTheirs"
              value={teamTheirs}
              onChange={(e) => setTeamTheirs(e.target.value)}
              className={INPUT}
            />
          </div>
        </div>
      )}

      {state.error !== null && <p className="text-[12px] font-bold text-live">{state.error}</p>}
      {problem !== null && state.error === null && <p className="text-[12px] font-bold text-muted">{problem}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending || problem !== null}
          className="flex-1 rounded-field bg-accent p-3 text-center text-[14px] font-extrabold text-accent-text disabled:bg-chip disabled:text-muted"
        >
          {submitLabel}
        </button>
        {onCancel !== undefined && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-field bg-chip px-4 py-3 text-[13px] font-extrabold text-muted"
          >
            Cancelar
          </button>
        )}
      </div>
    </form>
  )
}

const TAP = 'min-h-[44px] flex-1 rounded-field bg-chip px-3 text-[14px] font-extrabold'

/** Los sets ya cargados y los dos toques del set en curso (A = mi lado). */
function PadelSets({
  load,
  format,
  otherSide,
  onChange,
}: {
  load: LoadState
  format: MatchFormat
  /** Cómo se llama el otro lado en los botones ("el otro lado" o el nombre del amigo). */
  otherSide: string
  onChange: (next: LoadState) => void
}) {
  const complete = isComplete(load, format)
  return (
    <div className="flex flex-col gap-2">
      <span className={LEGEND}>Sets</span>
      <p className="text-[14px] font-bold">
        {load.sets.length === 0
          ? 'Todavía no cargaste ninguno.'
          : load.sets.map((set) => `${set.gamesA}-${set.gamesB}`).join(' · ')}
      </p>
      {!complete && load.pendingWinner === null && (
        <div className="flex gap-2">
          <button type="button" className={TAP} onClick={() => onChange(chooseWinner(load, 'A'))}>
            Ganó mi lado
          </button>
          <button type="button" className={TAP} onClick={() => onChange(chooseWinner(load, 'B'))}>
            Ganó {otherSide}
          </button>
        </div>
      )}
      {!complete && load.pendingWinner !== null && (
        <>
          <span className={LABEL}>¿Cuántos games hizo el que perdió?</span>
          <div className="flex flex-wrap gap-2">
            {loserGamesOptions(format).map((games) => (
              <button
                key={games}
                type="button"
                className={TAP}
                onClick={() => onChange(chooseLoserGames(load, games, format))}
              >
                {games}
              </button>
            ))}
          </div>
        </>
      )}
      {(load.sets.length > 0 || load.pendingWinner !== null) && (
        <button
          type="button"
          className="self-start text-[12px] font-extrabold text-accent-link"
          onClick={() => onChange(startLoad())}
        >
          Volver a cargar
        </button>
      )}
    </div>
  )
}

/**
 * Una fila casual de `Historial` (`app/amigos/historial.tsx`), con Editar y
 * Borrar (§3.1, §3.3 -- los dos pueden). `children` es el contenido de
 * lectura que `Historial` ya sabe armar (fecha, resultado, autoría); este
 * componente sólo agrega el borde de la tarjeta y los dos controles, para no
 * duplicar `resultadoCasualDe`/`autoriaDe` acá.
 *
 * El toggle de edición es un `useState` LOCAL, sin levantarlo a `Historial`:
 * cada fila decide su propio estado, y `Historial` sigue siendo la función
 * pura que ya prueba `historial.unit.test.ts` llamándola directo (sin JSX) --
 * mover el hook a `Historial` mismo rompería esa forma de probarla.
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
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  if (editing) {
    return (
      <CasualForm
        friendPlayerId={friendPlayerId}
        action={editCasualMatch}
        submitLabel="Guardar cambios"
        onCancel={() => setEditing(false)}
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
    <div className="flex flex-col gap-1 rounded-field border-[1.5px] border-line p-[14px]">
      {children}
      <div className="flex gap-3 pt-1">
        <button type="button" onClick={() => setEditing(true)} className="text-[12px] font-extrabold text-accent-link">
          Editar
        </button>
        {confirmingDelete ? (
          <form
            action={removeCasualMatch}
            role="group"
            aria-label="Confirmar borrado"
            className="flex items-center gap-3"
          >
            <input type="hidden" name="friendPlayerId" value={friendPlayerId} />
            <input type="hidden" name="matchId" value={partido.matchId} />
            <span className="text-[12px] font-extrabold text-live">¿Borrar?</span>
            <SubmitButton className="text-[12px] font-extrabold text-live disabled:opacity-60">Sí</SubmitButton>
            <button
              type="button"
              autoFocus
              onClick={() => setConfirmingDelete(false)}
              className="text-[12px] font-extrabold text-muted"
            >
              No
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="text-[12px] font-extrabold text-live"
          >
            Borrar
          </button>
        )}
      </div>
    </div>
  )
}
