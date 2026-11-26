'use client'

import { useActionState, useEffect, useId, useRef, useState, useTransition, type ReactNode, type RefObject } from 'react'
import { SPORTS, SPORT_IDS, isRankingSport, isSportId, sportLabel, sportOf, type MatchFormat, type ScoringFamily, type SetScore, type SportId } from '@/core'
import type { CasualMatch } from '@/db/friends'
import { isComplete, startLoad, toqueDelSet, type LoadState } from '@/app/torneo/[id]/[disciplina]/fechas/[n]/carga-state'
import { mensajeDeFalla } from '@/app/torneo/[id]/[disciplina]/fechas/[n]/sin-conexion'
import { SubmitButton } from '@/app/submit-button'
import { IconoDeporte } from '@/app/torneos/inicio/iconos'
import { button } from '@/app/ui/button'
import { CampoFecha } from '@/app/ui/campo-fecha'
import { Sheet } from '@/app/ui/sheet'
import { editCasualMatch, removeCasualMatch, type CasualFormState } from '../actions'
import {
  RECUERDO_KEY,
  formatForSport,
  formatoInicial,
  hoyISO,
  leerRecuerdo,
  outcomeDelMarcador,
  playersFrom,
  resumenPartido,
  setsField,
  slotsError,
  slotsFor,
  type Mode,
  type Recuerdo,
  type Slot,
  type SlotKey,
} from './cargar-state'
import { INPUT, LABEL, OPTION } from './estilos'
import { ResultadoGoles, type GoalsFields } from './resultado-goles'
import { ResultadoPartida, type OutcomePartida } from './resultado-partida'
import { ResultadoSets } from './resultado-sets'

const INITIAL_STATE: CasualFormState = { error: null }

/**
 * Un deporte de la hoja, como los del asistente (`PasoNuevo`): en su tinte sin elegir y lleno de su
 * color al elegirlo, con el ícono al lado del nombre para que once entren en cuatro filas cortas.
 * En oscuro el tinte casi no se separa de la hoja: el borde de su color lo recorta.
 */
// En 320 px el ícono va arriba del nombre: al lado le dejaba ~52 px y "Ajedrez" se partía en "Ajedre / z".
const DEPORTE_BLOQUE =
  'relative flex min-h-[52px] min-w-0 cursor-pointer flex-col items-start justify-center gap-1 rounded-tile min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-start min-[360px]:gap-1.5 bg-sport-tint py-2 pr-1.5 pl-2 text-left text-sport dark:shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--color-sport)_40%,transparent)] has-[:checked]:bg-sport has-[:checked]:text-on-sport has-[:checked]:shadow-none has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus'

/** La tilde del deporte elegido: una pastilla en la esquina, para no robarle ancho al nombre. */
function Tilde() {
  return (
    <span
      data-tilde
      aria-hidden="true"
      className="absolute -top-1.5 -right-1.5 grid h-5 w-5 place-items-center rounded-full bg-on-sport text-sport shadow-[0_0_0_2px_var(--color-sport)]"
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current stroke-[3.5] [stroke-linecap:round] [stroke-linejoin:round]">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </span>
  )
}

const ERROR_NOTE = 'rounded-btn bg-live-bg px-3 py-2.5 text-[15px] font-semibold text-live'
const GUEST = '__guest__'
const SIN_GOLES: GoalsFields = { outcome: '', scoreMine: '', scoreTheirs: '', teamMine: '', teamTheirs: '' }

const MODES: { value: Mode; label: string }[] = [
  { value: '1v1', label: '1 vs 1' },
  { value: '2v2', label: '2 vs 2' },
]
const SLOT_LABELS: Record<SlotKey, string> = {
  partner: 'Tu pareja',
  rival1: 'Rival',
  rival2: 'Otro rival',
}

/** El nombre de pila: en la hoja los lados se leen cortos ("Vos y Lucas"). */
const corto = (name: string) => name.trim().split(/\s+/)[0] ?? name

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
  /** Cómo se jugó y cómo se llaman los lados en los botones; sin dato, 1 vs 1 contra "Rival". */
  mode?: Mode
  otherName?: string
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

/** Lo último que se usó, si hay y sirve. Sin `window` (o con el storage bloqueado), nada. */
function recordado(): Recuerdo | null {
  try {
    return leerRecuerdo(window.localStorage.getItem(RECUERDO_KEY))
  } catch {
    return null
  }
}

function recordar(recuerdo: Recuerdo): void {
  try {
    window.localStorage.setItem(RECUERDO_KEY, JSON.stringify(recuerdo))
  } catch {
    // Modo privado o storage lleno: la próxima vez arranca con pádel, nada más.
  }
}

/**
 * El formulario de cargar/editar un partido con un amigo (diseño §4),
 * compartido por las dos operaciones -- lo único que cambia entre cargar y
 * editar es `action` (qué server action llamar) e `initial` (si hay algo que
 * prellenar). Al editar no hay jugadores que elegir: el plantel es fijo.
 * Vive adentro de una hoja (`CargarConAmigo`, `CasualMatchRow`) y se monta al
 * abrirla, así que lee `localStorage` y la fecha de hoy sin pelear con el
 * render del servidor.
 *
 * La menor cantidad de pasos (S8e): la fecha viene en hoy; el deporte, el
 * modo y el formato, en los últimos que usaste (`RECUERDO_KEY`); en 1 vs 1 el
 * rival es el amigo de la pantalla y no hay nada que elegir. Con sets, el
 * toque que cierra el partido guarda; con goles, el primer número arranca
 * enfocado, el marcador elige quién ganó y Enter en el segundo guarda. Si a
 * ese toque le falta algo (los jugadores de un 2 vs 2), lo dice y queda
 * "Guardar". Un error deja todo como estaba, con "Guardar" para reintentar.
 *
 * `useActionState`, no el patrón `<form action={fn}>` sin estado de
 * `app/amigos/actions.ts`: acá hay una validación real (`parseCasualResult`,
 * `db/friends.ts`) que puede fallar y hay que mostrarla en la misma hoja. Y
 * todos los campos son CONTROLADOS -- cada uno con su `useState` --, porque
 * toda action de un `<form action={fn}>` -- también una que TERMINA en error
 * -- dispara un `HTMLFormElement.reset()` nativo (verificado en React 19:
 * `startHostTransition` → `requestFormReset$1` → `fiber.stateNode.reset()`)
 * que deja radios y `<select>` en su primer valor aunque el estado siga bien
 * (lo prueba `cargar.unit.test.ts`). Por eso el envío es
 * `startTransition(() => formAction(data))` con el `FormData` armado a mano,
 * y no `<form action>`: la action corre igual, pero React nunca pide el reset.
 *
 * Cuando la action vuelve sin error, avisa con `onSaved` y el resumen de lo
 * que se guardó ("Ganaste 6-4 6-3"): la hoja se cierra y lo dice abajo.
 *
 * Al corregir un partido de sets, como en la hoja de la fecha: cada set
 * arranca con su toque marcado (`toqueDelSet`), así que confirmar lo mismo es
 * un toque y corregir un set, uno o dos. Lo que todavía no se volvió a tocar
 * sigue siendo lo guardado: "Guardar cambios" sin tocar los sets (sólo la
 * fecha) manda los de antes.
 */
export function CasualForm({
  friendPlayerId,
  friends = [],
  action,
  initial,
  submitLabel,
  onSaved,
  primerCampo,
}: {
  /** El amigo de la pantalla: viene elegido como rival. */
  friendPlayerId: string
  /** Amigos aceptados entre los que se puede elegir. */
  friends?: readonly CasualFormFriend[]
  action: (state: CasualFormState, formData: FormData) => Promise<CasualFormState>
  initial?: CasualFormInitial
  submitLabel: string
  onSaved?: (resumen: string) => void
  /** El primer número de un deporte de goles: la hoja lo enfoca al abrirse. */
  primerCampo?: RefObject<HTMLInputElement | null>
}) {
  // Sin red la action no vuelve: tira, y sin atraparla la página pasaba a
  // `app/error.tsx` con lo cargado perdido. Así vuelve como un error más, la
  // hoja queda abierta y "Guardar" reintenta (`sin-conexion.ts`).
  const [state, formAction, pending] = useActionState(async (prev: CasualFormState, data: FormData) => {
    try {
      return await action(prev, data)
    } catch (falla) {
      return { error: mensajeDeFalla(falla), saved: prev.saved }
    }
  }, INITIAL_STATE)
  // Un id propio por instancia: dos `CasualForm` pueden convivir en la misma
  // pantalla (el de "cargar nuevo" y uno corrigiendo un partido).
  const uid = useId()
  const [, startTransition] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)
  const scoreMineRef = useRef<HTMLInputElement | null>(null)
  const [recuerdo] = useState(() => (initial === undefined ? recordado() : null))

  const initialSport = initial?.sport ?? ''
  const [sport, setSport] = useState<'' | SportId>(() =>
    initial === undefined ? (recuerdo?.sport ?? 'PADEL') : isSportId(initialSport) ? initialSport : '',
  )
  const info = sport === '' ? null : sportOf(sport)
  const [modoElegido, setMode] = useState<Mode>(initial?.mode ?? recuerdo?.mode ?? '1v1')
  // Una partida de ajedrez es uno contra uno, y el bowling con amigos un mano a mano por pinos: un
  // partido nuevo no ofrece 2 vs 2 (ni lo arrastra de lo recordado). Al corregir, el plantel es el
  // que se guardó.
  const soloUnoContraUno = initial === undefined && (info?.family === 'result' || (sport !== '' && isRankingSport(sport)))
  const mode: Mode = soloUnoContraUno ? '1v1' : modoElegido
  const [slots, setSlots] = useState<Record<SlotKey, SlotChoice>>({
    partner: { choice: '', name: '' },
    rival1: {
      choice: friends.some((friend) => friend.playerId === friendPlayerId) ? friendPlayerId : '',
      name: '',
    },
    rival2: { choice: '', name: '' },
  })
  const [playedOn, setPlayedOn] = useState(() => initial?.playedOn ?? hoyISO())
  const [goals, setGoals] = useState<GoalsFields>({
    outcome: initial?.outcome ?? '',
    scoreMine: initial?.scoreMine ?? '',
    scoreTheirs: initial?.scoreTheirs ?? '',
    teamMine: initial?.teamMine ?? '',
    teamTheirs: initial?.teamTheirs ?? '',
  })
  // `info` todavía es el deporte de arranque: este inicializador corre una sola vez.
  const [format, setFormat] = useState<MatchFormat>(() => {
    if (info?.family !== 'sets' || sport === '') return SPORTS.PADEL.format
    return initial?.sets !== undefined ? formatForSport(info, initial.sets) : formatoInicial(info, sport, recuerdo)
  })
  // Los sets guardados del partido que se corrige (A = mío); vacío en uno nuevo o después de "Volver a cargar".
  const [previos, setPrevios] = useState<SetScore[]>(() =>
    (initial?.sets ?? []).map((set) => ({ gamesA: set.mine, gamesB: set.theirs })),
  )
  // Lo que se va tocando. Al corregir arranca en el primer set, con su ganador elegido.
  const [load, setLoad] = useState<LoadState>(() => ({
    sets: [],
    pendingWinner: previos[0] === undefined ? null : (toqueDelSet(previos[0], format)?.winner ?? null),
  }))
  // Elegir un deporte de goles lleva el foco al primer número (S8e).
  const [enfocar, setEnfocar] = useState(0)
  useEffect(() => {
    if (enfocar > 0) scoreMineRef.current?.focus()
  }, [enfocar])

  // Cambiar de deporte arranca el resultado de cero: nada del anterior (formato,
  // sets, empate, equipos) viaja escondido en el FormData.
  const chooseSport = (id: SportId) => {
    const next = sportOf(id)
    setSport(id)
    if (next.family === 'sets') setFormat(formatoInicial(next, id, recuerdo))
    else if (next.family === 'goals') setEnfocar((n) => n + 1)
    volverACargar()
    setGoals(SIN_GOLES)
  }
  const setFormatKey = (key: 'setsToWin' | 'gamesPerSet', value: number) => {
    setFormat((current) => ({ ...current, [key]: value }))
    volverACargar()
  }
  // De cero: sin sets tocados y sin los guardados (con otro formato ya no valen).
  function volverACargar() {
    setPrevios([])
    setLoad(startLoad())
  }

  // Lo que se guardaría: lo tocado y, detrás, lo guardado que falta volver a tocar.
  const final: LoadState =
    previos.length === 0 || isComplete(load, format)
      ? load
      : { sets: [...load.sets, ...previos.slice(load.sets.length)], pendingWinner: null }
  // El toque marcado del set en curso: el del set guardado, mientras su ganador siga elegido.
  const toqueGuardado = isComplete(load, format) ? null : toqueDeIndice(previos, load.sets.length, format)
  const elegido =
    toqueGuardado !== null && load.pendingWinner === toqueGuardado.winner
      ? { loser: toqueGuardado.loser, deuce: toqueGuardado.deuce }
      : null

  const slotValues = {
    partner: slotOf(slots.partner),
    rival1: slotOf(slots.rival1),
    rival2: slotOf(slots.rival2),
  }
  const nombreDe = (key: SlotKey): string | null => {
    const { choice, name } = slots[key]
    if (choice === GUEST) return name.trim() === '' ? null : corto(name)
    const friend = friends.find((candidate) => candidate.playerId === choice)
    return friend === undefined ? null : corto(friend.displayName)
  }
  // Los dos lados como se leen en la hoja. Al editar, los trae `initial`.
  const otherName =
    initial !== undefined
      ? (initial.otherName ?? (initial.mode === '2v2' ? 'Ellos' : 'Rival'))
      : mode === '1v1'
        ? (nombreDe('rival1') ?? 'Rival')
        : nombreDe('rival1') !== null && nombreDe('rival2') !== null
          ? `${nombreDe('rival1')} y ${nombreDe('rival2')}`
          : 'Ellos'
  const mineName = mode === '1v1' ? 'Vos' : `Vos y ${(initial === undefined ? nombreDe('partner') : null) ?? 'tu pareja'}`

  const pageFriend = {
    playerId: friendPlayerId,
    name: friends.find((friend) => friend.playerId === friendPlayerId)?.displayName ?? 'este amigo',
  }
  // Lo que falta para guardar, sin contar el resultado: si esto es `null`, el
  // toque que cierra los sets guarda.
  const faltaAlgo =
    (initial === undefined ? slotsError(mode, slotValues, pageFriend) : null) ??
    // Sólo al editar un id que salió del registro: no hay chip elegido ni resultado que dibujar.
    (info === null ? 'Elegí el deporte para cargar el resultado.' : null) ??
    (playedOn === '' ? 'Falta la fecha.' : null)
  const setsCompletos = info?.family === 'sets' && isComplete(final, format)
  const problem =
    faltaAlgo ??
    (info?.family === 'sets' && !setsCompletos ? 'Cargá los sets hasta cerrar el partido.' : null) ??
    (info?.family !== 'sets' && goals.outcome === '' ? 'Falta quién ganó.' : null)

  // El resumen se arma al enviar: cuando vuelve la action, el formulario ya
  // pudo cambiar (y el aviso tiene que decir lo que se guardó).
  const resumen = useRef('')
  const ultimoEstado = useRef(state)
  const avisar = useRef(onSaved)
  avisar.current = onSaved
  useEffect(() => {
    if (state === ultimoEstado.current) return
    ultimoEstado.current = state
    if (state.error === null) avisar.current?.(resumen.current)
  }, [state])

  // `outcome` aparte: el toque de la partida guarda en el mismo evento en que elige, antes de que
  // `goals` se actualice.
  const enviar = (carga: LoadState = final, outcome: GoalsFields['outcome'] = goals.outcome) => {
    const form = formRef.current
    if (form === null || pending) return
    const data = new FormData(form)
    if (info?.family === 'sets') data.set('sets', setsField(carga))
    if (info?.family === 'result') data.set('outcome', outcome)
    resumen.current =
      info?.family === 'sets'
        ? resumenPartido(mode, {
            family: 'sets',
            sets: carga.sets.map((set) => ({ mine: set.gamesA, theirs: set.gamesB })),
          })
        : outcome === ''
          ? ''
          : info?.family === 'result'
            ? resumenPartido(mode, { family: 'result', outcome })
            : resumenPartido(mode, { family: 'goals', ...goals, outcome })
    if (initial === undefined && sport !== '') {
      recordar({
        sport,
        mode,
        formats: { ...recuerdo?.formats, ...(info?.family === 'sets' ? { [sport]: format } : {}) },
      })
    }
    startTransition(() => formAction(data))
  }

  const onLoad = (next: LoadState) => {
    // Cerró un set y sigue otro: si se está corrigiendo, el siguiente arranca con su ganador.
    const cerroUnSet = next.sets.length > load.sets.length && !isComplete(next, format)
    setLoad(cerroUnSet ? { ...next, pendingWinner: toqueDeIndice(previos, next.sets.length, format)?.winner ?? null } : next)
    if (faltaAlgo === null && !isComplete(load, format) && isComplete(next, format)) enviar(next)
  }

  // La partida: el toque elige y, si no falta nada más, guarda.
  const onPartida = (outcome: OutcomePartida) => {
    setGoals((current) => ({ ...current, outcome }))
    if (faltaAlgo === null) enviar(final, outcome)
  }

  const onScore = (side: 'scoreMine' | 'scoreTheirs', value: string) => {
    setGoals((current) => {
      const next = { ...current, [side]: value }
      const derived = outcomeDelMarcador(next.scoreMine, next.scoreTheirs)
      if (derived !== null) return { ...next, outcome: derived }
      // Empatado: puede haber penales, no se adivina (salvo que ya dijeras empate).
      const empatado = next.scoreMine.trim() !== '' && next.scoreMine.trim() === next.scoreTheirs.trim()
      return empatado && current.outcome !== 'drew' ? { ...next, outcome: '' } : next
    })
  }

  const setSlot = (key: SlotKey, next: Partial<SlotChoice>) =>
    setSlots((current) => ({
      ...current,
      [key]: { ...current[key], ...next },
    }))

  const slotField = (key: SlotKey) => (
    <div key={key} className="flex min-w-0 flex-1 flex-col gap-1.5">
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
          autoComplete="off"
          value={slots[key].name}
          onChange={(e) => setSlot(key, { name: e.target.value })}
          className={INPUT}
        />
      )}
    </div>
  )
  // En 1 vs 1 el rival es el amigo de la pantalla: sólo hay que elegirlo si
  // no está entre tus amigos (un perfil al que se llegó de otro lado).
  const rivalFijo = mode === '1v1' && slots.rival1.choice === friendPlayerId
  const unit = info === null ? '' : info.unit

  return (
    <form
      ref={formRef}
      // Ver el JSDoc de arriba: sin `<form action>` para que React no resetee radios ni selects.
      onSubmit={(event) => {
        event.preventDefault()
        enviar()
      }}
      data-deporte={sport === '' ? undefined : sport}
      className="flex flex-col pt-3"
    >
      <input type="hidden" name="friendPlayerId" value={friendPlayerId} />
      {initial !== undefined && <input type="hidden" name="matchId" value={initial.matchId} />}
      {initial === undefined && (
        <input type="hidden" name="players" value={JSON.stringify(playersFrom(mode, slotValues))} />
      )}

      <fieldset>
        <legend className="sr-only">Deporte</legend>
        {/* Once deportes, todos a la vista: de a tres en el teléfono, de a cuatro desde 640. Cada uno
            en su color; el elegido, lleno y con la tilde. */}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {SPORT_IDS.map((id) => (
            <label key={id} data-deporte={id} className={DEPORTE_BLOQUE}>
              <input
                type="radio"
                name="sport"
                value={id}
                required
                checked={sport === id}
                onChange={() => chooseSport(id)}
                className="sr-only"
              />
              <IconoDeporte kind={id} className="h-[18px] w-[18px]" />
              <span data-nombre className="line-clamp-2 min-w-0 text-[15px] leading-[1.15] font-bold break-words">
                {sportLabel(id)}
              </span>
              {sport === id && <Tilde />}
            </label>
          ))}
        </div>
      </fieldset>

      {/* "Juegan" y la fecha, uno abajo del otro: el día escrito ("Jueves 26 nov") no entra en
          media pantalla de 320 px. */}
      <div className="mt-3 flex flex-col gap-3">
        {soloUnoContraUno ? (
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className={LABEL}>Juegan</span>
            <p className="flex min-h-[48px] items-center text-[16px] font-bold">1 vs 1</p>
          </div>
        ) : initial === undefined ? (
          <fieldset className="flex min-w-0 flex-col gap-1.5">
            <legend className={`${LABEL} mb-1.5`}>Juegan</legend>
            <div className="flex gap-1.5">
              {MODES.map((candidate) => (
                <label key={candidate.value} className={`${OPTION} px-1`}>
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
            </div>
          </fieldset>
        ) : (
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className={LABEL}>Jugaron</span>
            <p className="flex min-h-[48px] items-center text-[16px] font-bold">{initial.roster}</p>
          </div>
        )}
        <CampoFecha
          id={`${uid}-fecha`}
          name="playedOn"
          value={playedOn}
          onChange={setPlayedOn}
          label="Fecha del partido"
          kicker="Fecha"
          required
        />
      </div>

      {initial === undefined && !rivalFijo && (
        <div className="mt-3 flex flex-col gap-3">
          {mode === '2v2' && slotField('partner')}
          <div className="flex gap-2">{slotsFor(mode).filter((key) => key !== 'partner').map(slotField)}</div>
        </div>
      )}

      {info?.family === 'sets' && (
        <ResultadoSets
          sport={info}
          format={format}
          load={load}
          final={final}
          elegido={elegido}
          mineName={mineName}
          otherName={otherName}
          pending={pending}
          onFormat={setFormatKey}
          onLoad={onLoad}
          onRestart={volverACargar}
        />
      )}
      {info?.family === 'result' && (
        <ResultadoPartida
          outcome={goals.outcome}
          textos={
            mode === '1v1'
              ? { won: 'Ganaste', drew: 'Tablas', lost: `Ganó ${otherName}` }
              : { won: 'Ganaron ustedes', drew: 'Tablas', lost: 'Ganaron ellos' }
          }
          pending={pending}
          onElegir={onPartida}
        />
      )}
      {info?.family === 'goals' && (
        <ResultadoGoles
          sport={info}
          uid={uid}
          mineLabel={mode === '1v1' ? `Tus ${unit}` : `${cap(unit)} de ustedes`}
          otherLabel={`${cap(unit)} de ${mode === '1v1' ? otherName : 'ellos'}`}
          outcomes={
            mode === '1v1'
              ? { won: 'Ganaste', lost: `Ganó ${otherName}`, drew: 'Empate' }
              : { won: 'Ustedes', lost: 'Ellos', drew: 'Empate' }
          }
          {...goals}
          scoreMineRef={(el) => {
            scoreMineRef.current = el
            if (primerCampo !== undefined) primerCampo.current = el
          }}
          onChange={(patch) => setGoals((current) => ({ ...current, ...patch }))}
          onScore={onScore}
          onEnter={() => {
            if (problem === null) enviar()
          }}
        />
      )}

      <div className="mt-4 flex flex-col gap-2.5">
        {state.error !== null && (
          <p role="alert" className={ERROR_NOTE}>
            {state.error}
          </p>
        )}
        <p aria-live="polite" className="min-h-5 text-[15px] text-muted empty:hidden">
          {pending ? 'Guardando…' : state.error === null ? hintDe(problem, faltaAlgo, info?.family, load, format) : ''}
        </p>
        <button
          type="submit"
          disabled={pending || problem !== null}
          className={`${button('primary', { size: 'lg', full: true })} disabled:bg-chip disabled:text-muted disabled:opacity-100`}
        >
          {submitLabel}
        </button>
      </div>
    </form>
  )
}

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** El toque que dio el set guardado número `index`, o `null` si no hay (o ningún botón lo da). */
function toqueDeIndice(previos: readonly SetScore[], index: number, format: MatchFormat) {
  const set = previos[index]
  return set === undefined ? null : toqueDelSet(set, format)
}

/**
 * La línea de abajo, que dice qué falta o qué hace el próximo toque. Con sets
 * en curso y nada más que pedir, avisa que el toque guarda (como en la fecha).
 */
function hintDe(
  problem: string | null,
  faltaAlgo: string | null,
  family: ScoringFamily | undefined,
  load: LoadState,
  format: MatchFormat,
): string {
  if (faltaAlgo !== null) return faltaAlgo
  // La partida guarda en el toque: lo único que puede faltar es tocarlo.
  if (family === 'result') return 'Con un toque se guarda.'
  if (family === 'sets' && !isComplete(load, format)) {
    if (load.pendingWinner === null) return 'Tocá primero quién ganó.'
    return format.setsToWin > 1 ? 'Se guarda cuando se define el partido.' : 'Con este toque se guarda.'
  }
  return problem ?? ''
}

/** "Vos y Cami contra Juan y Beto": el plantel fijo de un partido ya cargado. */
function plantelDe(partido: CasualMatch): string {
  const mios = ['Vos', ...partido.partners.map(corto)]
  return `${mios.join(' y ')} contra ${partido.rivals.map(corto).join(' y ')}`
}

/**
 * Una fila casual de `Historial` (`app/amigos/historial.tsx`): tocarla abre
 * la hoja con el partido precargado para corregirlo, y desde ahí se borra
 * (§3.1, §3.3 -- los dos pueden). `children` es la fila de lectura que
 * `Historial` ya sabe armar (resultado, marcador, deporte, autoría); este
 * componente pone el botón y la hoja, para no duplicar el copy acá.
 *
 * El botón es una capa debajo de la fila (`absolute inset-0`) y no la
 * envuelve: un `<button>` no puede tener `<p>` adentro, y la fila se sigue
 * leyendo como texto. Su nombre es el resumen ("Corregir: Ganaste 6-4").
 *
 * Todo el estado es `useState` LOCAL, sin levantarlo a `Historial`: cada fila
 * decide el suyo, y `Historial` sigue siendo la función pura que prueba
 * `historial.unit.test.ts` llamándola directo.
 *
 * Borrar pide confirmación en dos pasos (`Borrar partido` -> `¿Borrar el
 * partido? Sí, borrar / No`): el borrado saca el partido para todos los
 * participantes (§3.3) y no se deshace.
 */
export function CasualMatchRow({
  friendPlayerId,
  partido,
  resumen,
  desde,
  dataDeporte,
  children,
}: {
  friendPlayerId: string
  partido: CasualMatch
  /** El deporte de la fila (`data-deporte`): su nombre va en su color. */
  dataDeporte?: string
  /** "Perdiste 1-2": el nombre del botón. */
  resumen: string
  /** `'amigos'` si al perfil se llegó desde la lista: Borrar vuelve con el mismo Volver. */
  desde?: string
  children: ReactNode
}) {
  // `vez` cambia en cada apertura: la hoja arranca de lo guardado aunque se
  // reabra después de un intento con error.
  const [hoja, setHoja] = useState({ open: false, vez: 0 })
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const cerrar = () => setHoja((prev) => ({ ...prev, open: false }))
  const dosContraDos = partido.partners.length > 0 || partido.rivals.length > 1

  return (
    <li data-deporte={dataDeporte} className="relative border-t border-line first:border-t-0">
      <button
        type="button"
        aria-label={`Corregir: ${resumen}`}
        onClick={() => {
          setConfirmingDelete(false)
          setHoja((prev) => ({ open: true, vez: prev.vez + 1 }))
        }}
        className="press-fila absolute inset-0 h-full w-full active:scale-100"
      />
      <div className="pointer-events-none relative">{children}</div>
      <Sheet open={hoja.open} onClose={cerrar} title="Corregir partido">
        {hoja.vez > 0 && (
          <div key={hoja.vez}>
            <CasualForm
              friendPlayerId={friendPlayerId}
              action={editCasualMatch}
              submitLabel="Guardar cambios"
              onSaved={cerrar}
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
                roster: plantelDe(partido),
                mode: dosContraDos ? '2v2' : '1v1',
                otherName: dosContraDos ? partido.rivals.map(corto).join(' y ') : corto(partido.rivals[0] ?? 'Rival'),
              }}
            />
            <div className="mt-5 border-t border-line pt-4">
              {confirmingDelete ? (
                <form
                  action={removeCasualMatch}
                  role="group"
                  aria-label="Confirmar borrado"
                  className="flex flex-col gap-3 rounded-tile bg-live-bg p-4"
                >
                  <input type="hidden" name="friendPlayerId" value={friendPlayerId} />
                  <input type="hidden" name="matchId" value={partido.matchId} />
                  {desde !== undefined && <input type="hidden" name="desde" value={desde} />}
                  <p className="text-[17px] font-bold text-live">¿Borrar el partido?</p>
                  <p className="-mt-2 text-[15px] text-text">Se borra para todos los que jugaron.</p>
                  <div className="flex gap-2">
                    <SubmitButton className={`${button('primary')} flex-1 bg-live! text-bg!`}>Sí, borrar</SubmitButton>
                    <button
                      type="button"
                      autoFocus
                      onClick={() => setConfirmingDelete(false)}
                      className={`${button('secondary')} flex-1 bg-surface-2!`}
                    >
                      No
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  className={button('danger', { full: true })}
                >
                  Borrar partido
                </button>
              )}
            </div>
          </div>
        )}
      </Sheet>
    </li>
  )
}
