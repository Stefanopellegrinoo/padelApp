'use client'

import Link from 'next/link'
import { Volver } from '@/app/torneo/[id]/volver'
import { useEffect, useId, useState, useTransition } from 'react'
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

const ROTULO = 'text-[12px] font-extrabold uppercase tracking-[.14em] text-muted'
const AYUDA = 'text-pretty text-[13.5px] font-[550] leading-[1.5] text-muted'
const TITLES = ['Nuevo torneo', 'Jugadores', 'Cómo se juega', 'Listo, así se juega']
const LINK = 'min-h-[44px] text-center text-[14px] font-extrabold text-accent-link'

/** Una pantalla del wizard: los 4 pasos (0..3) y, entre el 3 y "Listo", los subpasos que hagan falta. */
type Pantalla = 0 | 1 | 2 | Subpaso | 3

const SUBPASO: Record<Subpaso, { rotulo: string; titulo: string }> = {
  PAREJAS: { rotulo: 'Paso 3 de 4 · Sólo si elegiste "parejas fijas"', titulo: 'Armá las parejas' },
  NIVEL: { rotulo: 'Paso 3 de 4 · Sólo si elegiste "por nivel"', titulo: 'Ordená por nivel' },
}

/** El rótulo y el título de una pantalla, y qué paso marca la barra (los subpasos son parte del 3). */
export function encabezado(pantalla: Pantalla): { paso: number; rotulo: string; titulo: string } {
  if (typeof pantalla === 'string') return { paso: 2, ...SUBPASO[pantalla] }
  return { paso: pantalla, rotulo: `Paso ${pantalla + 1} de ${TITLES.length}`, titulo: TITLES[pantalla]! }
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

function Progress({ step }: { step: number }) {
  return (
    <div className="flex gap-1.5">
      {TITLES.map((title, index) => (
        <span key={title} className={`h-1 flex-1 rounded-full ${index <= step ? 'bg-accent' : 'bg-line'}`} />
      ))}
    </div>
  )
}

function Aviso({ children }: { children: string }) {
  return <p className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">{children}</p>
}

/** La marca del asiento propio. Es lo único que distingue una fila de la otra. */
function Vos() {
  return (
    <span className="shrink-0 rounded-full bg-accent px-2 py-[3px] text-[12px] font-extrabold text-accent-text">
      vos
    </span>
  )
}

/**
 * La única confirmación del wizard: explica qué significa la cruz de la fila propia (organizar sin jugar).
 * Copiada de `wizard.tsx`, que se borra entero en la Tarea 16.
 */
function SalirDelPlantel({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim px-6 pb-[26px]">
      <div className="w-full max-w-lg rounded-card border border-line bg-surface p-5">
        <h2 className="text-[19px] font-extrabold tracking-[-.02em]">¿No jugás el torneo?</h2>
        <p className="mt-2 text-pretty text-[13.5px] font-[550] leading-[1.5] text-muted">
          Te saco del plantel. Vas a seguir organizando —abrís las fechas, armás las parejas y cargás los
          resultados— pero no vas a estar en la tabla.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-field bg-chip p-3.5 text-center text-[14.5px] font-extrabold"
          >
            Sacame del plantel
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-field bg-accent p-3.5 text-center text-[14.5px] font-extrabold text-accent-text"
          >
            Me quedo
          </button>
        </div>
      </div>
    </div>
  )
}

/** Paso 1: el nombre y los deportes, chips grandes como los de /rapido (se puede elegir más de uno). */
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
      <div className="flex flex-col gap-1.5">
        <label htmlFor={nombreId} className={ROTULO}>
          Nombre
        </label>
        <input
          id={nombreId}
          value={name}
          onChange={(event) => onName(event.target.value)}
          placeholder="Los Jueves 2026"
          className="rounded-field border-[1.5px] border-accent bg-surface p-[15px] text-[17px] font-[750] outline-none placeholder:font-medium placeholder:text-muted"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span id={deportesId} className={ROTULO}>
          ¿Qué deportes?
        </span>
        <div role="group" aria-labelledby={deportesId} className="grid grid-cols-3 gap-2">
          {TOURNAMENT_SPORTS.map((kind) => {
            const elegido = picked.includes(kind)
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={elegido}
                onClick={() => onToggle(kind)}
                className={`min-h-[44px] rounded-field p-3 text-center text-[14px] font-extrabold ${
                  elegido ? 'bg-accent text-accent-text' : 'bg-chip text-text'
                }`}
              >
                {sportLabel(kind)}
              </button>
            )
          })}
        </div>
        <p className={AYUDA}>Podés elegir más de uno. Cada deporte tiene su tabla, y además hay una tabla general.</p>
      </div>
      {warning !== null && <Aviso>{warning}</Aviso>}
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
 * Paso 4: el reglamento de cada deporte, contado desde lo que se manda a crear (`crearPayload`):
 * así la primera fecha dice la que eligió el usuario, no la de la ficha.
 */
export function PasoListo({
  disciplines,
  created,
  pending,
  error,
  onCreate,
}: {
  disciplines: readonly ReglamentoInput[]
  created: { inviteUrl: string; href: string } | null
  pending: boolean
  error: string | null
  onCreate: () => void
}) {
  const [copia, setCopia] = useState<'nada' | 'copiado' | 'fallo'>('nada')
  return (
    <>
      {disciplines.map((discipline) => (
        <section key={discipline.kind} className="rounded-card border border-line bg-surface p-4">
          <h2 className="text-[17px] font-extrabold">{sportLabel(discipline.kind)}</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {reglamento(discipline).map((line) => (
              <li key={line.key} className="flex gap-2 text-pretty text-[14px] font-semibold leading-snug">
                <span aria-hidden="true" className="font-extrabold text-up">
                  ✓
                </span>
                <span>{line.text}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {error !== null && <Aviso>{error}</Aviso>}
      <div className="mt-auto flex flex-col gap-1 pt-1">
        {created === null ? (
          <button
            type="button"
            disabled={pending}
            onClick={onCreate}
            className="rounded-field bg-accent p-4 text-center text-[15px] font-extrabold text-accent-text"
          >
            {pending ? 'Creando…' : 'Crear torneo'}
          </button>
        ) : (
          <>
            <Link
              href={created.href}
              className="rounded-field bg-accent p-4 text-center text-[15px] font-extrabold text-accent-text"
            >
              Ir al torneo
            </Link>
            <button
              type="button"
              onClick={async () => {
                // `navigator.clipboard` no existe fuera de https/localhost: el tipo dice que sí.
                const clipboard = (navigator as { clipboard?: Clipboard }).clipboard
                setCopia((await copiarLink(created.inviteUrl, clipboard)) ? 'copiado' : 'fallo')
              }}
              className={LINK}
            >
              {copia === 'copiado' ? 'Copiado ✓' : 'Copiar link de invitación'}
            </button>
            {copia === 'fallo' && (
              <p className="flex flex-col gap-1 text-[12.5px] font-bold text-muted">
                No se pudo copiar. Copialo de acá:
                <span className="select-all break-all rounded-field bg-surface p-3 text-[13.5px] text-text">
                  {created.inviteUrl}
                </span>
              </p>
            )}
          </>
        )}
      </div>
    </>
  )
}

const sideSizeOf = (card: DeporteElegido) => modalityShape(card.modality).pairSize

/**
 * El wizard de 4 pasos (docs/torneos-deportes.md §4): cada deporte arranca con su ficha y el usuario
 * cambia sólo lo que quiere. No escribe nada hasta "Crear torneo" (`createTournament`, todo o nada).
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
  // La hoja abierta y lo que se va tocando: "Listo" lo pasa a la tarjeta; la cruz o Escape lo tiran.
  const [hoja, setHoja] = useState<{ kind: TournamentSport; rules: DisciplineRules } | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ inviteUrl: string; href: string } | null>(null)
  // Sólo en "Armá las parejas": quién espera su pareja, y de qué deporte.
  const [pendiente, setPendiente] = useState<{ kind: TournamentSport; at: number } | null>(null)

  // Cada pantalla arranca de arriba: el botón de seguir queda abajo de todo y la siguiente se leería por la mitad.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pantalla])

  const { paso, rotulo, titulo } = encabezado(pantalla)
  // "← Volver" desanda esta misma secuencia: los subpasos aparecen sólo si hacen falta.
  const secuencia: Pantalla[] = [0, 1, 2, ...subpasos(cards), 3]
  const go = (next: Pantalla | undefined) => {
    if (next === undefined) return
    setPantalla(next)
    setPendiente(null)
  }
  const { names, mySeat } = squad
  const { squadNames } = submitSeats(squad)
  const filled = filledCount(names)
  const sideSizes = cards.map(sideSizeOf)
  const floor = effectiveFloor(sideSizes)
  const plantelWarning = squadWarning(names, floor, sideSizes.includes(2))
  const modalidadesError = errorDeModalidades(cards, names)
  const hojaCard = hoja === null ? undefined : cards.find((card) => card.kind === hoja.kind)

  // Todo cambio del plantel pasa por acá: las tarjetas ponen sus puntos al tamaño nuevo (`plantelCambio`).
  const setSquad = (next: Squad) => {
    setSquadState(next)
    setCards((current) => plantelCambio(current, filledCount(next.names)))
  }
  const removeSeat = (index: number) => setSquad(removeSeatAt(squad, index))

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

  const help =
    pantalla === 1
      ? mySeat !== null
        ? 'Ya estás anotado en el plantel: agregá al resto del grupo. Después compartís un link y cada uno elige el suyo.'
        : `Tipeá los nombres del grupo, al menos ${floor}. Después compartís un link y cada uno elige el suyo. No hace falta que vayan todos a todas las fechas.`
      : null

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-4 bg-bg px-6 pt-4 pb-[26px] text-text">
      <div className="flex items-center justify-between">
        {pantalla === 0 ? (
          <Volver href="/torneos" label="Volver" />
        ) : created === null ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => go(secuencia[secuencia.indexOf(pantalla) - 1])}
            className="relative rounded-full bg-chip px-[14px] py-2 text-[12.5px] font-bold after:absolute after:inset-x-0 after:-inset-y-[5px] disabled:opacity-40"
          >
            ← Volver
          </button>
        ) : (
          <span />
        )}
      </div>

      <Progress step={paso} />

      <header className="flex flex-col gap-[3px]">
        <p className={ROTULO}>{rotulo}</p>
        <h1 className="text-[30px] font-extrabold tracking-[-.03em]">{titulo}</h1>
      </header>

      <div className="flex flex-1 flex-col gap-3">
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
          <>
            <div className="flex items-center justify-between">
              <p className="text-[12px] font-extrabold uppercase tracking-[.14em] text-muted">El plantel</p>
              <p className="text-[12px] font-extrabold text-muted">{`${filled} jugadores`}</p>
            </div>
            {/* Tipear en la última fila agrega la que sigue (`namesAfterEdit`): la lista se estira sola. */}
            {names.map((seat, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-[13px] font-extrabold text-muted">{index + 1}</span>
                <input
                  value={seat}
                  onChange={(event) => setSquad({ ...squad, names: namesAfterEdit(names, index, event.target.value) })}
                  placeholder="Nombre"
                  className={`min-w-0 flex-1 rounded-field border-[1.5px] bg-surface p-[15px] text-[16px] font-[700] outline-none placeholder:font-medium placeholder:text-muted ${
                    seat.trim().length === 0 ? 'border-accent' : 'border-line'
                  }`}
                />
                {index === mySeat && <Vos />}
                {/* La cruz propia está siempre: sacarse no es achicar el plantel, es organizar sin jugar. */}
                {(index === mySeat || names.length > floor) && (
                  <button
                    type="button"
                    aria-label={index === mySeat ? 'Sacarme del plantel' : `Sacar al jugador ${index + 1}`}
                    onClick={() => (index === mySeat ? setLeaving(true) : removeSeat(index))}
                    className="flex h-11 w-11 shrink-0 items-center justify-center"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-chip text-[13px] font-extrabold text-muted">
                      ✕
                    </span>
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setSquad(addBlankSeat(squad))}
              className="rounded-field border-[1.5px] border-line p-[13px] text-[14px] font-[750] text-muted"
            >
              + Agregar jugador
            </button>
            {mySeat === null && myName.trim().length > 0 && (
              <button
                type="button"
                onClick={() => setSquad(addMySeat(squad, myName))}
                className="rounded-field border-[1.5px] border-accent p-[13px] text-[14px] font-extrabold text-accent-link"
              >
                Participar en el torneo
              </button>
            )}
            {plantelWarning !== null && <Aviso>{plantelWarning}</Aviso>}
          </>
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

        {pantalla === 'NIVEL' &&
          cards
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

        {pantalla === 3 && (
          <PasoListo
            disciplines={crearPayload(name, squad, cards).disciplines}
            created={created}
            pending={pending}
            error={error}
            onCreate={submit}
          />
        )}

        {help !== null && <p className={AYUDA}>{help}</p>}
      </div>

      {pantalla !== 3 && (
        <button
          type="button"
          disabled={blocked}
          onClick={advance}
          className={`rounded-field p-4 text-center text-[15px] font-extrabold ${
            blocked ? 'bg-chip text-muted' : 'bg-accent text-accent-text'
          }`}
        >
          Continuar
        </button>
      )}

      {pantalla === 'NIVEL' && (
        <button
          type="button"
          onClick={() => {
            setCards(sorteaLaApp(cards))
            go(3)
          }}
          className={`${LINK} -mt-2`}
        >
          Mejor que lo sortee la app
        </button>
      )}

      {leaving && (
        <SalirDelPlantel
          onCancel={() => setLeaving(false)}
          onConfirm={() => {
            if (mySeat !== null) removeSeat(mySeat)
            setLeaving(false)
          }}
        />
      )}

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
    </main>
  )
}
