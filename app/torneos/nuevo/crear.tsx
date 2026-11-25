'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from 'react'
import { Volver } from '@/app/torneo/[id]/volver'
import { Reglamento } from '@/app/torneo/[id]/reglas/reglamento-vista'
import { IconoDeporte } from '@/app/torneos/inicio/iconos'
import { button } from '@/app/ui/button'
import { Sheet } from '@/app/ui/sheet'
import {
  TOURNAMENT_SPORTS,
  modalityShape,
  reglamento,
  sportLabel,
  type Modality,
  type ReglamentoInput,
  type TournamentSport,
} from '@/core'
import { PersonalizarReglas } from '@/app/deporte/personalizar-reglas'
import { rulesErrors, type DisciplineRules } from '@/app/deporte/personalizar-reglas-state'
import { TarjetaDeporte } from '@/app/deporte/tarjeta'
import type { PrimeraFecha } from '@/app/deporte/tarjeta-state'
import { tocarJugador } from '@/app/rapido/armar-state'
import { createTournament } from './actions'
import {
  cambiarModalidad,
  cambiarParejas,
  cambiarPrimeraFecha,
  cambiarReglas,
  crearPayload,
  elegirDeporte,
  errorDeModalidades,
  moverEnOrden,
  opcionesPrimeraFecha,
  ordenInicial,
  parejasCompletas,
  plantelCambio,
  reglasDeFicha,
  sorteaLaApp,
  subpasos,
  tocarSortear,
  type DeporteElegido,
  type Subpaso,
} from './crear-state'
import { ArmarParejas, OrdenarPorNivel } from './subpasos'
import {
  addBlankSeat,
  addMySeat,
  effectiveFloor,
  filledCount,
  namesAfterEdit,
  removeSeatAt,
  squadWarning,
  submitSeats,
  type Squad,
} from './wizard-state'

const TITLES = ['Nuevo torneo', '¿Quiénes juegan?', '¿Cómo se juega?', 'Así queda']
/** El nombre corto de cada pantalla, el que dice "Volver" en la que sigue. */
const CORTOS: Record<Pantalla, string> = {
  0: 'Nuevo torneo',
  1: 'Jugadores',
  2: 'Cómo se juega',
  PAREJAS: 'Parejas',
  NIVEL: 'Orden',
  3: 'Así queda',
}
const PREGUNTA = 'text-[17px] font-bold'
const AYUDA = 'text-pretty text-[15px] text-muted'

/** Una pantalla del wizard: los 4 pasos (0..3) y, entre el 3 y "Así queda", los subpasos que hagan falta. */
type Pantalla = 0 | 1 | 2 | Subpaso | 3

const SUBPASO: Record<Subpaso, { titulo: string; motivo: string }> = {
  PAREJAS: { titulo: 'Armá las parejas', motivo: 'Porque elegiste parejas fijas' },
  NIVEL: { titulo: 'Ordená por nivel', motivo: 'Porque elegiste por nivel' },
}

/**
 * El número, el título y qué paso marcan los puntitos (los subpasos son parte del 3). Un subpaso
 * dice por qué aparece (`motivo`), aparte del número: sólo aparece si hace falta.
 */
export function encabezado(pantalla: Pantalla): { paso: number; rotulo: string; titulo: string; motivo: string | null } {
  const paso = typeof pantalla === 'string' ? 2 : pantalla
  const rotulo = `Paso ${paso + 1} de ${TITLES.length}`
  if (typeof pantalla === 'string') return { paso, rotulo, ...SUBPASO[pantalla] }
  return { paso, rotulo, titulo: TITLES[pantalla]!, motivo: null }
}

/** Adónde lleva "Volver": el nombre corto de la pantalla de antes, o `null` en la primera (ahí se vuelve a Inicio). */
export function volverA(secuencia: readonly Pantalla[], pantalla: Pantalla): string | null {
  const antes = secuencia[secuencia.indexOf(pantalla) - 1]
  return antes === undefined ? null : CORTOS[antes]
}

/** Copia el link de invitación; false si no hay portapapeles o lo rechaza (y entonces se muestra el link). */
export async function copiarLink(url: string, clipboard: Pick<Clipboard, 'writeText'> | undefined): Promise<boolean> {
  if (clipboard === undefined) return false
  try {
    await clipboard.writeText(url)
    return true
  } catch {
    return false
  }
}

/**
 * El encabezado en bloque de `app/ui/hero.tsx`, con lo que el wizard necesita y `Hero` no tiene:
 * un "Volver" que es un botón (desanda un paso, no navega) y los puntitos del paso. "Volver" nombra
 * siempre adónde lleva: Inicio en el primer paso, el paso de antes en los demás.
 */
function Encabezado({
  rotulo,
  paso,
  titulo,
  motivo,
  back,
}: {
  rotulo: string
  paso: number
  titulo: string
  motivo: string | null
  back: ReactNode
}) {
  return (
    <header className="rounded-b-block bg-block px-4 pt-[calc(6px+env(safe-area-inset-top))] pb-5 text-on-block [--color-focus:var(--color-on-block)]">
      {back}
      <div className="mt-2 flex items-center justify-between gap-3 text-[15px] font-semibold text-on-block-soft">
        <span>{rotulo}</span>
        <span aria-hidden="true" className="flex gap-1.5">
          {TITLES.map((title, index) => (
            <span
              key={title}
              data-pip={index <= paso ? 'hecho' : 'falta'}
              className={`h-2 w-7 rounded-full ${
                index <= paso ? 'bg-on-block' : 'shadow-[inset_0_0_0_1.5px_var(--color-on-block-soft)]'
              }`}
            />
          ))}
        </span>
      </div>
      <h1 className="mt-1 font-titulo text-[34px] text-balance">{titulo}</h1>
      {motivo !== null && <p className="mt-1.5 text-[15px] text-on-block-soft">{motivo}</p>}
    </header>
  )
}

/** "Volver" a la pantalla de antes del wizard: la cara de `Volver`, pero desanda un paso en vez de navegar. */
function VolverPaso({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="-my-1.5 -ml-1 flex min-h-[44px] w-fit items-center gap-1 rounded-[12px] pr-3 pl-0.5 text-[16px] font-semibold active:bg-current/15"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-6 w-6 shrink-0 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
      >
        <path d="M15 5l-7 7 7 7" />
      </svg>
      {label}
    </button>
  )
}

/** La barra de abajo con la acción principal del paso: fija, al alcance del pulgar, como "Cargar partido" de Inicio. */
function BarraAbajo({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-lg flex-col gap-1 border-t border-line bg-surface px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
      {children}
    </div>
  )
}

function Aviso({ children }: { children: string }) {
  return <p className="rounded-btn bg-live-bg px-3.5 py-3 text-[15px] font-semibold text-live">{children}</p>
}

/** La única confirmación del wizard: explica qué significa la cruz de la fila propia (organizar sin jugar). */
function SalirDelPlantel({ open, onConfirm, onCancel }: { open: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Sheet open={open} onClose={onCancel} title="¿No jugás el torneo?">
      <p className="mt-2 text-pretty text-[16px] leading-snug">
        Seguís organizando: abrís las fechas, armás las parejas y cargás los resultados. No aparecés en la tabla.
      </p>
      <div className="mt-5 flex flex-col gap-2">
        <button type="button" onClick={onConfirm} className={button('danger', { size: 'lg', full: true })}>
          Sacame del plantel
        </button>
        <button type="button" onClick={onCancel} className={button('secondary', { size: 'lg', full: true })}>
          Me quedo
        </button>
      </div>
    </Sheet>
  )
}

/** La tilde del deporte elegido. */
function Tilde() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-6 w-6 shrink-0 fill-none stroke-current stroke-[2.5] [stroke-linecap:round] [stroke-linejoin:round]"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}

/**
 * Paso 1: el nombre y los deportes. Cada deporte es un bloque en su color (`data-deporte`): en su
 * tinte sin elegir, lleno al elegirlo, con su ícono y la tilde. Se puede elegir más de uno.
 */
export function PasoNuevo({
  name,
  picked,
  warning,
  onName,
  onToggle,
}: {
  name: string
  picked: readonly TournamentSport[]
  warning: string | null
  onName: (value: string) => void
  onToggle: (kind: TournamentSport) => void
}) {
  const nombreId = useId()
  const deportesId = useId()
  return (
    <>
      <div>
        <label htmlFor={nombreId} className={`${PREGUNTA} mb-2 block`}>
          Nombre
        </label>
        <input
          id={nombreId}
          value={name}
          onChange={(event) => onName(event.target.value)}
          placeholder="Los Jueves 2026"
          autoComplete="off"
          className="block min-h-[56px] w-full rounded-btn border-[1.5px] border-line bg-bg px-4 text-[18px] font-semibold text-text outline-none placeholder:font-normal placeholder:text-muted focus:border-sport"
        />
      </div>
      <div>
        <p id={deportesId} className={`${PREGUNTA} mb-2`}>
          ¿A qué juegan?
        </p>
        <div role="group" aria-labelledby={deportesId} className="grid grid-cols-3 gap-2">
          {TOURNAMENT_SPORTS.map((kind) => {
            const elegido = picked.includes(kind)
            return (
              <button
                key={kind}
                type="button"
                data-deporte={kind}
                aria-pressed={elegido}
                onClick={() => onToggle(kind)}
                className={`flex min-h-[104px] flex-col justify-between rounded-tile p-3 text-left ${
                  elegido ? 'bg-sport text-on-sport' : 'bg-sport-tint text-sport dark:shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--color-sport)_40%,transparent)]'
                }`}
              >
                <span className="flex w-full items-start justify-between">
                  <IconoDeporte kind={kind} className="h-7 w-7" />
                  {elegido && <Tilde />}
                </span>
                <span className="text-[17px] font-bold leading-tight">{sportLabel(kind)}</span>
              </button>
            )
          })}
        </div>
        <p className={`${AYUDA} mt-2`}>Podés elegir más de uno: cada uno tiene su tabla y hay una general.</p>
      </div>
      {warning !== null && <Aviso>{warning}</Aviso>}
    </>
  )
}

/**
 * Paso 2: el plantel, para cargarlo de corrido. Enter (el "siguiente" del teclado del teléfono)
 * pasa al renglón que sigue y, en el último con un nombre, abre uno nuevo; tipear en el último
 * también lo abre (`namesAfterEdit`). Controlada: cada cambio llama a `onChange` con el plantel nuevo.
 */
export function PasoJugadores({
  squad,
  myName,
  floor,
  warning,
  onChange,
  onLeave,
}: {
  squad: Squad
  myName: string
  floor: number
  warning: string | null
  onChange: (next: Squad) => void
  /** La cruz del asiento propio: pregunta antes de sacarte. */
  onLeave: () => void
}) {
  const { names, mySeat } = squad
  const filled = filledCount(names)
  const campos = useRef<Array<HTMLInputElement | null>>([])
  // El renglón que Enter acaba de abrir: se enfoca cuando ya está dibujado.
  const [enfocar, setEnfocar] = useState<number | null>(null)
  useEffect(() => {
    if (enfocar === null) return
    campos.current[enfocar]?.focus()
    setEnfocar(null)
  }, [enfocar])

  const siguiente = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    if (index + 1 < names.length) campos.current[index + 1]?.focus()
    else if (names[index]!.trim().length > 0) {
      onChange(addBlankSeat(squad))
      setEnfocar(index + 1)
    }
  }

  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <p className="flex items-baseline gap-2 text-[17px] font-semibold">
          <span className="font-cond text-[44px]">{filled}</span>
          {filled === 1 ? 'jugador' : 'jugadores'}
        </p>
        <p className="text-[15px] text-muted">{`Mínimo ${floor}`}</p>
      </div>
      <ol className="flex flex-col gap-2">
        {names.map((seat, index) => (
          <li key={index} className="flex items-center gap-2">
            <span aria-hidden="true" className="w-7 shrink-0 text-center font-cond text-[24px] text-muted">
              {index + 1}
            </span>
            <div className="relative min-w-0 flex-1">
              <input
                ref={(input) => {
                  campos.current[index] = input
                }}
                aria-label={`Jugador ${index + 1}`}
                value={seat}
                onChange={(event) => onChange({ ...squad, names: namesAfterEdit(names, index, event.target.value) })}
                onKeyDown={(event) => siguiente(index, event)}
                enterKeyHint="next"
                autoComplete="off"
                autoCapitalize="words"
                placeholder="Nombre"
                className={`block min-h-[52px] w-full rounded-btn border-[1.5px] border-line bg-bg px-3.5 text-[17px] font-semibold text-text outline-none placeholder:font-normal placeholder:text-muted focus:border-sport ${
                  index === mySeat ? 'pr-14' : ''
                }`}
              />
              {index === mySeat && (
                <span className="marca-vos pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[14px] font-bold">
                  vos
                </span>
              )}
            </div>
            {/* La cruz propia está siempre: sacarse no es achicar el plantel, es organizar sin jugar. */}
            {index === mySeat || names.length > floor ? (
              <button
                type="button"
                aria-label={index === mySeat ? 'Sacarme del plantel' : `Sacar al jugador ${index + 1}`}
                onClick={() => (index === mySeat ? onLeave() : onChange(removeSeatAt(squad, index)))}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-btn text-muted active:bg-chip"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-5 w-5 fill-none stroke-current stroke-2 [stroke-linecap:round]"
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            ) : (
              <span aria-hidden="true" className="w-11 shrink-0" />
            )}
          </li>
        ))}
      </ol>
      <button type="button" onClick={() => onChange(addBlankSeat(squad))} className={button('secondary', { full: true })}>
        + Agregar jugador
      </button>
      {mySeat === null && myName.trim().length > 0 && (
        <button type="button" onClick={() => onChange(addMySeat(squad, myName))} className={button('ghost', { full: true })}>
          Participar en el torneo
        </button>
      )}
      {warning !== null && <Aviso>{warning}</Aviso>}
      <p className={AYUDA}>Después cada uno se suma con el link de invitación.</p>
    </>
  )
}
/** Paso 3: una tarjeta por deporte elegido. El aviso de modalidades va en las de parejas, que son las que lo causan. */
export function PasoComoSeJuega({
  cards,
  squadSize,
  error,
  onModality,
  onPrimeraFecha,
  onPersonalizar,
}: {
  cards: readonly DeporteElegido[]
  squadSize: number
  error: string | null
  onModality: (kind: TournamentSport, next: Modality) => void
  onPrimeraFecha: (kind: TournamentSport, next: PrimeraFecha) => void
  onPersonalizar: (kind: TournamentSport) => void
}) {
  return (
    <>
      {cards.map((card) => {
        const { pairSize, fixedTeams } = modalityShape(card.modality)
        return (
          <TarjetaDeporte
            key={card.kind}
            kind={card.kind}
            squadSize={squadSize}
            modality={card.modality}
            onModality={(next) => onModality(card.kind, next)}
            primeraFecha={card.primeraFecha}
            primeraFechaOptions={opcionesPrimeraFecha(cards, card.kind)}
            onPrimeraFecha={(next) => onPrimeraFecha(card.kind, next)}
            rules={card.rules}
            pairSize={pairSize}
            fixedTeams={fixedTeams}
            warning={pairSize === 2 ? error : null}
            onPersonalizar={() => onPersonalizar(card.kind)}
          />
        )
      })}
    </>
  )
}

/**
 * Paso 4: todo lo que se va a crear, como datos, antes de "Crear torneo": el nombre, quiénes juegan
 * (el tuyo marcado) y el reglamento de cada deporte en su color, contado desde lo que se manda a crear
 * (`crearPayload`): así la primera fecha dice la que eligió el usuario, no la de la ficha. El
 * reglamento se dibuja con `Reglamento`, el mismo de la pantalla Reglas (los puntos en casilleros).
 */
export function PasoListo({
  name,
  squadNames,
  mySeatIndex,
  disciplines,
  created,
  pending,
  error,
  onCreate,
}: {
  name: string
  squadNames: readonly string[]
  mySeatIndex: number | null
  disciplines: readonly ReglamentoInput[]
  created: { inviteUrl: string; href: string } | null
  pending: boolean
  error: string | null
  onCreate: () => void
}) {
  const [copia, setCopia] = useState<'nada' | 'copiado' | 'fallo'>('nada')
  return (
    <>
      {created !== null && (
        <p role="status" className="rounded-tile bg-sport-tint p-4 text-[17px] font-semibold">
          Compartí el link: cada uno entra y elige su nombre.
        </p>
      )}
      <div className="rounded-tile bg-surface p-4">
        <p className="font-titulo text-[30px] text-balance">{name}</p>
        <p className="mt-3 flex items-baseline gap-2 text-[17px] font-semibold">
          <span className="font-cond text-[40px]">{squadNames.length}</span>
          {squadNames.length === 1 ? 'jugador' : 'jugadores'}
        </p>
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5 text-[16px]">
          {squadNames.map((player, index) =>
            index === mySeatIndex ? (
              <li key={index}>
                <span className="marca-vos font-semibold">{player}</span>
              </li>
            ) : (
              <li key={index}>{player}</li>
            ),
          )}
        </ul>
      </div>
      {disciplines.map((discipline) => (
        <section key={discipline.kind} data-deporte={discipline.kind} className="pt-1">
          <h2 className="mb-3 font-titulo text-[26px] text-sport">{sportLabel(discipline.kind)}</h2>
          <Reglamento lines={reglamento(discipline)} points={discipline.config.points} />
        </section>
      ))}
      {error !== null && <Aviso>{error}</Aviso>}
      <BarraAbajo>
        {created === null ? (
          <button
            type="button"
            disabled={pending}
            onClick={onCreate}
            className={button('primary', { size: 'lg', full: true })}
          >
            {pending ? 'Creando…' : 'Crear torneo'}
          </button>
        ) : (
          <>
            <Link href={created.href} className={button('primary', { size: 'lg', full: true })}>
              Ir al torneo
            </Link>
            <button
              type="button"
              onClick={async () => {
                // `navigator.clipboard` no existe fuera de https/localhost: el tipo dice que sí.
                const clipboard = (navigator as { clipboard?: Clipboard }).clipboard
                setCopia((await copiarLink(created.inviteUrl, clipboard)) ? 'copiado' : 'fallo')
              }}
              className={button('ghost', { full: true })}
            >
              {copia === 'copiado' ? 'Link copiado' : 'Copiar link de invitación'}
            </button>
            {copia === 'fallo' && (
              <p className="flex flex-col gap-1 text-[14px] text-muted">
                No se pudo copiar. Copialo de acá:
                <span className="select-all break-all rounded-btn bg-bg p-3 text-[15px] text-text">
                  {created.inviteUrl}
                </span>
              </p>
            )}
          </>
        )}
      </BarraAbajo>
    </>
  )
}

const sideSizeOf = (card: DeporteElegido) => modalityShape(card.modality).pairSize

/**
 * El wizard de 4 pasos (docs/torneos-deportes.md §4): cada deporte arranca con su ficha y el usuario
 * cambia sólo lo que quiere. No escribe nada hasta "Crear torneo" (`createTournament`, todo o nada).
 *
 * Una pregunta por pantalla, con el encabezado en bloque (el número del paso, los puntitos y "Volver"
 * con su destino) y una sola acción principal, fija abajo.
 */
export function Crear({ myName }: { myName: string }) {
  const [pending, startTransition] = useTransition()
  const [pantalla, setPantalla] = useState<Pantalla>(0)
  const [name, setName] = useState('')
  // El que arma el torneo arranca adentro del plantel, en el primer asiento; el que sólo organiza se saca.
  const [squad, setSquadState] = useState<Squad>(() => ({
    names: [myName],
    mySeat: myName.trim().length === 0 ? null : 0,
  }))
  const [cards, setCards] = useState<DeporteElegido[]>([])
  // La hoja abierta y lo que se va tocando: "Listo" lo pasa a la tarjeta; "Cerrar" o Escape lo tiran.
  const [hoja, setHoja] = useState<{ kind: TournamentSport; rules: DisciplineRules } | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ inviteUrl: string; href: string } | null>(null)
  // Sólo en "Armá las parejas": quién espera su pareja, y de qué deporte.
  const [pendiente, setPendiente] = useState<{ kind: TournamentSport; at: number } | null>(null)

  // Cada pantalla arranca de arriba: la anterior pudo quedar scrolleada y la siguiente se leería por la mitad.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pantalla])

  const { paso, rotulo, titulo, motivo } = encabezado(pantalla)
  // "Volver" desanda esta misma secuencia: los subpasos aparecen sólo si hacen falta.
  const secuencia: Pantalla[] = [0, 1, 2, ...subpasos(cards), 3]
  const go = (next: Pantalla | undefined) => {
    if (next === undefined) return
    setPantalla(next)
    setPendiente(null)
  }
  const { names, mySeat } = squad
  const payloadSeats = submitSeats(squad)
  const { squadNames } = payloadSeats
  const filled = filledCount(names)
  const sideSizes = cards.map(sideSizeOf)
  const floor = effectiveFloor(sideSizes)
  const plantelWarning = squadWarning(names, floor, sideSizes.includes(2))
  const modalidadesError = errorDeModalidades(cards, names)
  const hojaCard = hoja === null ? undefined : cards.find((card) => card.kind === hoja.kind)
  const atras = volverA(secuencia, pantalla)

  // Todo cambio del plantel pasa por acá: las tarjetas ponen sus puntos al tamaño nuevo (`plantelCambio`).
  const setSquad = (next: Squad) => {
    setSquadState(next)
    setCards((current) => plantelCambio(current, filledCount(next.names)))
  }

  const blocked =
    (pantalla === 0 && (name.trim().length === 0 || cards.length === 0)) ||
    (pantalla === 1 && plantelWarning !== null) ||
    (pantalla === 2 && (modalidadesError !== null || cards.some((card) => rulesErrors(card.rules, sideSizeOf(card)).length > 0))) ||
    (pantalla === 'PAREJAS' && cards.some((card) => !parejasCompletas(card, squadNames.length)))

  const advance = () => {
    // Al entrar al plantel, tantas filas como pide el piso: se ve cuántos faltan antes de tipear.
    if (pantalla === 0 && names.length < floor) {
      setSquadState({ ...squad, names: [...names, ...Array<string>(floor - names.length).fill('')] })
    }
    go(secuencia[secuencia.indexOf(pantalla) + 1])
  }

  const tocar = (card: DeporteElegido, at: number) => {
    const tocado = tocarJugador(card.pairs, pendiente?.kind === card.kind ? pendiente.at : null, at)
    setCards(cambiarParejas(cards, card.kind, tocado.pares))
    setPendiente(tocado.pendiente === null ? null : { kind: card.kind, at: tocado.pendiente })
  }

  const submit = () => {
    setError(null)
    startTransition(async () => {
      const result = await createTournament(crearPayload(name, squad, cards))
      if (!result.ok) {
        setError(result.error)
        return
      }
      setCreated({
        inviteUrl: `${window.location.origin}/unirse/${result.inviteToken}`,
        href: `/torneo/${result.seasonId}`,
      })
    })
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-bg text-text">
      <Encabezado
        rotulo={rotulo}
        paso={paso}
        titulo={created === null ? titulo : 'Torneo creado'}
        motivo={motivo}
        back={
          atras === null || created !== null ? (
            <Volver href="/torneos" label="Inicio" />
          ) : (
            <VolverPaso label={atras} disabled={pending} onClick={() => go(secuencia[secuencia.indexOf(pantalla) - 1])} />
          )
        }
      />

      <main
        className={`flex flex-1 flex-col gap-5 px-4 pt-5 ${
          pantalla === 3 ? 'pb-[calc(170px+env(safe-area-inset-bottom))]' : 'pb-[calc(104px+env(safe-area-inset-bottom))]'
        }`}
      >
        {pantalla === 0 && (
          <PasoNuevo
            name={name}
            picked={cards.map((card) => card.kind)}
            warning={name.trim().length > 0 && cards.length === 0 ? 'Elegí al menos un deporte.' : null}
            onName={setName}
            onToggle={(kind) => setCards(elegirDeporte(cards, kind, filled))}
          />
        )}

        {pantalla === 1 && (
          <PasoJugadores
            squad={squad}
            myName={myName}
            floor={floor}
            warning={plantelWarning}
            onChange={setSquad}
            onLeave={() => setLeaving(true)}
          />
        )}

        {pantalla === 2 && (
          <PasoComoSeJuega
            cards={cards}
            squadSize={filled}
            error={modalidadesError}
            onModality={(kind, next) =>
              setCards(cards.map((card) => (card.kind === kind ? cambiarModalidad(card, next, filled) : card)))
            }
            onPrimeraFecha={(kind, next) => setCards(cambiarPrimeraFecha(cards, kind, next))}
            onPersonalizar={(kind) => {
              const card = cards.find((candidate) => candidate.kind === kind)
              if (card !== undefined) setHoja({ kind, rules: card.rules })
            }}
          />
        )}

        {pantalla === 'PAREJAS' &&
          cards
            .filter((card) => card.modality === 'FIJAS')
            .map((card) => (
              <ArmarParejas
                key={card.kind}
                card={card}
                names={squadNames}
                pendiente={pendiente?.kind === card.kind ? pendiente.at : null}
                onTocar={(at) => tocar(card, at)}
                onSortear={() => {
                  setCards(cambiarParejas(cards, card.kind, tocarSortear(card.pairs, squadNames.length, Math.random)))
                  setPendiente(null)
                }}
              />
            ))}

        {pantalla === 'NIVEL' && (
          <>
            {cards
              .filter((card) => card.primeraFecha === 'NIVEL')
              .map((card) => (
                <OrdenarPorNivel
                  key={card.kind}
                  card={card}
                  names={squadNames}
                  onMover={(from, to) =>
                    setCards(
                      cards.map((other) =>
                        other === card ? { ...card, order: moverEnOrden(ordenInicial(card, squadNames.length), from, to) } : other,
                      ),
                    )
                  }
                />
              ))}
            <button
              type="button"
              onClick={() => {
                setCards(sorteaLaApp(cards))
                go(3)
              }}
              className={button('ghost', { full: true })}
            >
              Mejor que lo sortee la app
            </button>
          </>
        )}

        {pantalla === 3 && (
          <PasoListo
            {...payloadSeats}
            name={name.trim()}
            disciplines={crearPayload(name, squad, cards).disciplines}
            created={created}
            pending={pending}
            error={error}
            onCreate={submit}
          />
        )}
      </main>

      {pantalla !== 3 && (
        <BarraAbajo>
          <button type="button" disabled={blocked} onClick={advance} className={button('primary', { size: 'lg', full: true })}>
            Continuar
          </button>
        </BarraAbajo>
      )}

      <SalirDelPlantel
        open={leaving}
        onCancel={() => setLeaving(false)}
        onConfirm={() => {
          if (mySeat !== null) setSquad(removeSeatAt(squad, mySeat))
          setLeaving(false)
        }}
      />

      {hoja !== null && hojaCard !== undefined && (
        <PersonalizarReglas
          kind={hojaCard.kind}
          modality={hojaCard.modality}
          pairSize={sideSizeOf(hojaCard)}
          rules={hoja.rules}
          ficha={reglasDeFicha(hojaCard, filled)}
          note={null}
          pending={false}
          error={null}
          onChange={(rules) => setHoja({ kind: hoja.kind, rules })}
          onDone={() => {
            setCards(cambiarReglas(cards, hoja.kind, hoja.rules))
            setHoja(null)
          }}
          onClose={() => setHoja(null)}
        />
      )}
    </div>
  )
}
