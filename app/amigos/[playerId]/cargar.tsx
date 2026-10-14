'use client'

import { useActionState, useId, useState, useTransition, type ReactNode } from 'react'
import type { CasualMatch } from '@/db/friends'
import { DISCIPLINE_KINDS, DISCIPLINE_LABELS, type DisciplineKind } from '@/app/torneos/nuevo/wizard-state'
import { editCasualMatch, removeCasualMatch, type CasualFormState } from '../actions'
import { playersFrom, slotsError, slotsFor, type Mode, type Slot, type SlotKey } from './cargar-state'

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
const SLOT_LABELS: Record<SlotKey, string> = { partner: 'Tu compañero', rival1: 'Rival 1', rival2: 'Rival 2' }

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
 * El "quién ganó" es SIEMPRE un radio obligatorio con las tres opciones
 * (ruling del orquestador, task-4-brief.md).
 *
 * Pádel sigue con el pegamento de la Tarea 2 (dos números → un set, ver
 * `casualInputFrom`); los sets de verdad son la Tarea 4b.
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

  const slotValues = {
    partner: slotOf(slots.partner),
    rival1: slotOf(slots.rival1),
    rival2: slotOf(slots.rival2),
  }
  const problem = initial === undefined ? slotsError(mode, slotValues) : null
  const setSlot = (key: SlotKey, next: Partial<SlotChoice>) =>
    setSlots((current) => ({ ...current, [key]: { ...current[key], ...next } }))

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

      <fieldset className="flex flex-col gap-1.5">
        <legend className={LEGEND}>¿Quién ganó?</legend>
        {(
          [
            ['won', 'Ganó tu lado'],
            ['lost', 'Ganó el otro lado'],
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

      <div className="flex gap-2">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor={`${uid}-scoreMine`} className={LABEL}>
            {sport === 'FIFA' ? 'Goles de tu lado' : 'Games de tu lado'}
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
            {sport === 'FIFA' ? 'Goles del otro lado' : 'Games del otro lado'}
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
 * Borrar NO pide confirmación (task-4-brief.md, "Editar y borrar" -- "no
 * construyas ninguna protección"): un botón de menos es la fricción que el
 * diseño pide sacar, no agregar.
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
  const marcador = partido.score ?? partido.sets?.[0] ?? null

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
          // Pegamento hasta la Tarea 4b: en PADEL el formulario viejo edita el
          // primer set como si fuera el marcador (ver `casualInputFrom`).
          scoreMine: marcador !== null ? String(marcador.mine) : '',
          scoreTheirs: marcador !== null ? String(marcador.theirs) : '',
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
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-[12px] font-extrabold text-accent-link"
        >
          Editar
        </button>
        <form action={removeCasualMatch}>
          <input type="hidden" name="friendPlayerId" value={friendPlayerId} />
          <input type="hidden" name="matchId" value={partido.matchId} />
          <button type="submit" className="text-[12px] font-extrabold text-live">
            Borrar
          </button>
        </form>
      </div>
    </div>
  )
}
