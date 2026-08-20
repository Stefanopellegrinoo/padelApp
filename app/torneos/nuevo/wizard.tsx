'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { MAX_PLAYERS, MIN_PLAYERS, type SeasonConfig, type SideSize } from '@/core'
import { createTournament } from './actions'
import {
  DISCIPLINE_KINDS,
  DISCIPLINE_LABELS,
  type DisciplineKind,
  type Squad,
  addMySeat,
  buildDisciplines,
  configFor,
  disciplinesWarning,
  filledCount,
  formatErrors,
  moveSeat,
  removeSeatAt,
  resizeConfig,
  squadWarning,
  steppersFor,
  submitSeats,
  summaryOf,
  toggleDiscipline,
} from './wizard-state'

const SIDE_SIZES: { value: SideSize; label: string }[] = [
  { value: 2, label: 'Parejas' },
  { value: 1, label: 'Individual' },
]

/**
 * "Parejas" o "Individual" — `pairSize`, elegido al crear la disciplina y
 * nunca editable después (`0015_disciplines.sql` revoca su UPDATE a
 * propósito). Comparten este selector el paso 4 del wizard y "+ Agregar
 * disciplina" de Ajustes (`disciplinas.tsx`): los mismos dos caminos que ya
 * comparten `disciplineProfile`/`DISCIPLINE_LABELS`, y por la misma razón
 * (`buildDisciplines`/`newDisciplineSpec`, Rebanada E) — los dos tienen que
 * ofrecer lo mismo o el torneo depende de por dónde entraste.
 *
 * Exportado y separado de `Disciplinas`/`Wizard` por lo mismo que
 * `SelectorDeFormato` (`armado.tsx`, PR21 D2): los dos guardan su estado en
 * un `useState` que arranca cerrado/en default, y sin clicks (este repo no
 * tiene runner E2E) la suite nunca vería el radio si viviera sólo adentro.
 * Acá entra con el valor que quiera el test.
 *
 * Nace en "Parejas" (`pairSize=2`) en las dos pantallas: ningún torneo de
 * pádel existente cambia si nadie toca este control.
 */
export function SelectorDeLados({
  pairSize,
  onChange,
  disabled = false,
}: {
  pairSize: SideSize
  onChange: (next: SideSize) => void
  disabled?: boolean
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-[11.5px] font-extrabold uppercase tracking-[.14em] text-muted">
        Lados
      </legend>
      {SIDE_SIZES.map(({ value, label }) => (
        <label
          key={value}
          className="flex min-h-[44px] items-center gap-2.5 rounded-field border border-line p-2.5 text-[13.5px] font-[700]"
        >
          <input
            type="radio"
            name="pairSize"
            disabled={disabled}
            checked={pairSize === value}
            onChange={() => onChange(value)}
            className="h-5 w-5 shrink-0 accent-accent"
          />
          {label}
        </label>
      ))}
    </fieldset>
  )
}

const TITLES = ['Nombre y disciplinas', 'El plantel', 'Orden inicial', 'Formato', 'Listo']
const HELP = [
  'Como lo llaman en el grupo. Se puede cambiar después.',
  'Tipeá los nombres del grupo, de 8 a 12. Después compartís un link y cada uno elige el suyo. No hace falta que vayan todos a todas las fechas.',
  'Ordenalos del mejor al peor. Es el criterio que corta los empates hasta que haya fechas jugadas, y de ahí salen las primeras parejas.',
  'Todos tienen un valor que ya funciona. Si no te importa, seguí de largo.',
  '',
]

function Progress({ step }: { step: number }) {
  return (
    <div className="flex gap-1.5">
      {[0, 1, 2, 3, 4].map((index) => (
        <span
          key={index}
          className={`h-1 flex-1 rounded-full ${index <= step ? 'bg-accent' : 'bg-line'}`}
        />
      ))}
    </div>
  )
}

function Aviso({ children }: { children: string }) {
  return (
    <p className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">
      {children}
    </p>
  )
}

/** La marca del asiento propio. Es lo único que distingue una fila de la otra. */
function Vos() {
  return (
    <span className="shrink-0 rounded-full bg-accent px-2 py-[3px] text-[10px] font-extrabold text-accent-text">
      vos
    </span>
  )
}

/**
 * La única confirmación de todo el wizard, y no está para evitar un accidente:
 * está para explicar qué significa la cruz de la fila propia.
 *
 * Sacarse del plantel no es borrar una fila, es decidir que organizás sin
 * jugar — una distinción que ningún gesto puede contar solo. El resto de las
 * cruces sacan a otro y no preguntan nada: eso sí se entiende sin ayuda.
 */
function SalirDelPlantel({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 px-6 pb-[26px]">
      <div className="w-full max-w-lg rounded-card border border-line bg-surface p-5">
        <h2 className="text-[19px] font-extrabold tracking-[-.02em]">¿No jugás el torneo?</h2>
        <p className="mt-2 text-pretty text-[13.5px] font-[550] leading-[1.5] text-muted">
          Te saco del plantel. Vas a seguir organizando —abrís las fechas, armás las parejas y
          cargás los resultados— pero no vas a estar en la tabla.
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

function Stepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number
  min: number
  max: number
  onChange: (next: number) => void
}) {
  const button = 'h-[44px] w-[44px] shrink-0 rounded-[9px] bg-chip text-[16px] font-extrabold disabled:opacity-40'
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button type="button" className={button} disabled={value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <span className="w-9 text-center text-[20px] font-extrabold tracking-[-.02em]">{value}</span>
      <button type="button" className={button} disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  )
}

/**
 * El paso 4: los puntos por posición y los steppers del formato.
 *
 * Vive afuera de `Wizard` —y exportado— para poder RENDERIZARLO en la suite
 * unitaria: `step` es estado interno del wizard y sin clicks no se llega hasta
 * acá. W63 fue una mentira de este paso que ningún
 * test podía ver, en un proyecto que ya se comió cinco problemas de pantalla.
 *
 * Cuáles steppers dibuja lo decide `steppersFor`, la MISMA función que usa
 * Ajustes. Lo que cambia es qué se le pregunta: acá la config es de la
 * TEMPORADA y la comparten todas las disciplinas marcadas, así que se le pasan
 * los formatos de todas — con Pádel y FIFA marcados, "Sets por partido" y
 * "Games por set" siguen gobernando la mitad de pádel y tienen que estar.
 *
 * `pairSize`/`onChangePairSize` dibujan acá el radio "Lados" (Rebanada F):
 * va antes de los puntos porque la curva que se ve depende de él (decisión
 * #3963) — elegir Lados primero es lo que hace que esos puntos tengan sentido.
 */
export function PasoFormato({
  config,
  picked,
  errors,
  pairSize,
  onChange,
  onChangePairSize,
}: {
  config: SeasonConfig
  picked: readonly DisciplineKind[]
  errors: string[]
  pairSize: SideSize
  onChange: (next: SeasonConfig) => void
  onChangePairSize: (next: SideSize) => void
}) {
  const steppers = steppersFor(
    buildDisciplines(picked, config).map((row) => row.config.matchFormat),
  )

  return (
    <>
      <SelectorDeLados pairSize={pairSize} onChange={onChangePairSize} />

      <p className="text-[13.5px] font-[550] leading-[1.5] text-muted">
        Son los puntos de cada posición de la fecha. Si una fecha la juegan menos parejas, se usan
        los primeros de la lista — ganar siempre suma {config.points[0] ?? 0}.
      </p>
      {/* Filas verticales para soportar planteles grandes con múltiples valores de puntos. */}
      <div className="overflow-hidden rounded-[14px] border border-line">
        {config.points.map((value, index) => (
          <div
            key={index}
            className={`flex h-[56px] items-center justify-between gap-2 px-3 ${index > 0 ? 'border-t border-line' : ''}`}
          >
            <span className="w-7 shrink-0 text-[13px] font-extrabold text-muted">{index + 1}°</span>
            {/* Desde 0: el torneo puede decidir que el último no sume. */}
            <Stepper
              value={value}
              min={0}
              max={99}
              onChange={(next) => {
                const points = [...config.points]
                points[index] = next
                onChange({ ...config, points })
              }}
            />
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-[14px] border border-line">
        {steppers.map((stepper, index) => (
          <div
            key={stepper.key}
            className={`flex min-h-[56px] items-center justify-between gap-2 px-3 py-2 ${index > 0 ? 'border-t border-line' : ''}`}
          >
            <div className="min-w-0">
              <p className="text-[14px] font-bold">{stepper.label}</p>
              <p className="text-pretty text-[11.5px] font-semibold text-muted">{stepper.hint}</p>
            </div>
            <Stepper
              value={
                stepper.key === 'setsToWin' || stepper.key === 'gamesPerSet'
                  ? config.matchFormat[stepper.key]
                  : config[stepper.key]
              }
              min={stepper.min}
              max={stepper.max}
              onChange={(next) =>
                onChange(
                  stepper.key === 'setsToWin' || stepper.key === 'gamesPerSet'
                    ? { ...config, matchFormat: { ...config.matchFormat, [stepper.key]: next } }
                    : { ...config, [stepper.key]: next },
                )
              }
            />
          </div>
        ))}
      </div>

      {errors.map((message) => (
        <Aviso key={message}>{message}</Aviso>
      ))}
    </>
  )
}

/**
 * Crear torneo — §6 del handoff. Los cinco pasos en un solo componente y un
 * solo submit: es un formulario que se usa una vez por año, y partirlo en cinco
 * rutas con estado compartido es pagar routing por nada.
 */
export function Wizard({ myName }: { myName: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  // El que arma el torneo arranca ADENTRO del plantel, con su nombre ya puesto
  // en el primer asiento. Es el caso de casi todos —el que organiza los jueves
  // juega los jueves— y así no hay nada que descubrir para participar: mirás la
  // lista y ya estás. El que sólo organiza se saca, que es el caso raro.
  const [squad, setSquadState] = useState<Squad>(() => ({
    names: [myName, ...Array<string>(MIN_PLAYERS - 1).fill('')],
    mySeat: myName.trim().length === 0 ? null : 0,
  }))
  const [config, setConfig] = useState<SeasonConfig>(() => configFor(MIN_PLAYERS))
  // Parejas de entrada (pairSize=2): sin tocar el radio "Lados" el torneo
  // nace igual que siempre — no-regresión de la Rebanada F.
  const [pairSize, setPairSize] = useState<SideSize>(2)
  // Pádel marcado de entrada: sin tocar nada, el torneo nace igual que
  // siempre (una sola PADEL) — el checkbox no es una regresión, es el mismo
  // default de antes de PR11 hecho explícito.
  const [disciplines, setDisciplines] = useState<DisciplineKind[]>(['PADEL'])
  const [error, setError] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [created, setCreated] = useState<{ seasonId: string; inviteToken: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const { names, mySeat } = squad
  const filled = filledCount(names)
  const warning = squadWarning(names)
  const errors = formatErrors(config)
  const disciplineWarning = disciplinesWarning(disciplines)

  const setSquad = (next: Squad) => {
    setSquadState(next)
    setConfig((current) => resizeConfig(current, filledCount(next.names), pairSize))
  }

  // Tocar "Lados" rehace la config entera con la curva que le corresponde a
  // ESE `sideSize` (misma idea que "Usar los defaults"): a diferencia de un
  // cambio de plantel, acá `resizeConfig` no alcanza sola —su guarda de salida
  // temprana mira `squadSize`, no `sideSize`, así que un plantel sin cambios
  // la dejaría pasar de largo y la curva vieja (de parejas) quedaría pisada.
  const changePairSize = (next: SideSize) => {
    setPairSize(next)
    setConfig(configFor(filled, next))
  }

  const blocked =
    (step === 0 && (name.trim().length === 0 || disciplineWarning !== null)) ||
    (step === 1 && warning !== null) ||
    (step === 3 && errors.length > 0)

  const help =
    step === 1 && mySeat !== null
      ? 'Ya estás anotado en el plantel: agregá al resto del grupo, hasta 12 en total. Después compartís un link y cada uno elige el suyo.'
      : (HELP[step] ?? '')

  const inviteUrl =
    created === null
      ? ''
      : `${typeof window === 'undefined' ? '' : window.location.origin}/unirse/${created.inviteToken}`

  const submit = () => {
    setError(null)
    startTransition(async () => {
      const builtConfig = { ...config, squadSize: filled }
      const result = await createTournament({
        name,
        ...submitSeats(squad),
        config: builtConfig,
        disciplines: buildDisciplines(disciplines, builtConfig, pairSize),
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setCreated({ seasonId: result.seasonId, inviteToken: result.inviteToken })
      setStep(4)
    })
  }

  const advance = () => {
    if (step === 3) {
      submit()
      return
    }
    setStep(step + 1)
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-4 bg-bg px-6 pt-4 pb-[26px] text-text">
      <div className="flex items-center justify-between">
        {step === 0 ? (
          <Link href="/torneos" className="rounded-full bg-chip px-[14px] py-2 text-[12.5px] font-bold">
            ← Volver
          </Link>
        ) : step < 4 ? (
          <button
            type="button"
            onClick={() => setStep(step - 1)}
            className="rounded-full bg-chip px-[14px] py-2 text-[12.5px] font-bold"
          >
            ← Volver
          </button>
        ) : (
          <span />
        )}
      </div>

      <Progress step={step} />

      <header className="flex flex-col gap-[3px]">
        <p className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">
          Paso {step + 1} de 5
        </p>
        <h1 className="text-[30px] font-extrabold tracking-[-.03em]">{TITLES[step]}</h1>
      </header>

      <div className="flex flex-1 flex-col gap-3">
        {step === 0 && (
          <>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Los Jueves 2026"
              className="rounded-field border-[1.5px] border-accent bg-surface p-[15px] text-[17px] font-[750] outline-none placeholder:font-medium placeholder:text-muted"
            />
            <fieldset className="flex flex-col gap-2">
              <legend className="text-[11.5px] font-extrabold uppercase tracking-[.14em] text-muted">
                Disciplinas
              </legend>
              {DISCIPLINE_KINDS.map((kind) => (
                <label
                  key={kind}
                  className="flex items-center gap-2.5 rounded-field border-[1.5px] border-line bg-surface p-3.5 text-[14.5px] font-[700]"
                >
                  <input
                    type="checkbox"
                    checked={disciplines.includes(kind)}
                    onChange={() => setDisciplines(toggleDiscipline(disciplines, kind))}
                    className="h-5 w-5 shrink-0 accent-accent"
                  />
                  {DISCIPLINE_LABELS[kind]}
                </label>
              ))}
            </fieldset>
            {disciplineWarning !== null && <Aviso>{disciplineWarning}</Aviso>}
          </>
        )}

        {step === 1 && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-[11.5px] font-extrabold uppercase tracking-[.14em] text-muted">
                El plantel
              </p>
              <p className="text-[11.5px] font-extrabold text-muted">{filled} jugadores</p>
            </div>
            {names.map((seat, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-[13px] font-extrabold text-muted">{index + 1}</span>
                <input
                  value={seat}
                  onChange={(event) => {
                    const next = [...names]
                    next[index] = event.target.value
                    setSquad({ ...squad, names: next })
                  }}
                  placeholder="Nombre"
                  className={`min-w-0 flex-1 rounded-field border-[1.5px] bg-surface p-[15px] text-[16px] font-[700] outline-none placeholder:font-medium placeholder:text-muted ${
                    seat.trim().length === 0 ? 'border-accent' : 'border-line'
                  }`}
                />
                {index === mySeat && <Vos />}
                {/* La cruz propia está SIEMPRE, aunque el plantel esté en el
                    mínimo: sacarse no es achicar el plantel, es dejar el lugar
                    para otro. El aviso pide el que falta y eso está bien. */}
                {(index === mySeat || names.length > MIN_PLAYERS) && (
                  <button
                    type="button"
                    aria-label={
                      index === mySeat ? 'Sacarme del plantel' : `Sacar al jugador ${index + 1}`
                    }
                    onClick={() =>
                      index === mySeat ? setLeaving(true) : setSquad(removeSeatAt(squad, index))
                    }
                    // El botón mide 44 para el dedo; el círculo sigue midiendo
                    // 28 a la vista. Agrandar el dibujo no hacía falta — lo que
                    // faltaba era área para no errarle.
                    className="flex h-11 w-11 shrink-0 items-center justify-center"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-chip text-[13px] font-extrabold text-muted">
                      ✕
                    </span>
                  </button>
                )}
              </div>
            ))}
            {names.length < MAX_PLAYERS && (
              <button
                type="button"
                onClick={() => setSquad({ ...squad, names: [...names, ''] })}
                className="rounded-field border-[1.5px] border-line p-[13px] text-[14px] font-[750] text-muted"
              >
                + Agregar jugador
              </button>
            )}
            {/* Sólo existe estando afuera: el camino de vuelta tiene que estar a
                la vista, y mientras jugás no es más que ruido. */}
            {mySeat === null && myName.trim().length > 0 && (
              <button
                type="button"
                onClick={() => setSquad(addMySeat(squad, myName))}
                className="rounded-field border-[1.5px] border-accent p-[13px] text-[14px] font-extrabold text-accent-link"
              >
                Participar en el torneo
              </button>
            )}
            {warning !== null && <Aviso>{warning}</Aviso>}
          </>
        )}

        {step === 2 && (
          <div className="overflow-hidden rounded-[14px] border border-line">
            {names.map((seat, index) => (
              <div
                key={index}
                className={`flex items-center gap-2 px-3 py-2 ${index > 0 ? 'border-t border-line' : ''}`}
              >
                <span className="text-[13px] text-muted">⠿</span>
                <span className="w-5 shrink-0 text-[13px] font-extrabold text-muted">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[15px] font-bold">{seat}</span>
                {index === mySeat && <Vos />}
                <button
                  type="button"
                  aria-label={`Subir a ${seat}`}
                  disabled={index === 0}
                  onClick={() => setSquad(moveSeat(squad, index, index - 1))}
                  className="h-[44px] w-[44px] shrink-0 rounded-[9px] bg-chip font-extrabold disabled:opacity-40"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Bajar a ${seat}`}
                  disabled={index === names.length - 1}
                  onClick={() => setSquad(moveSeat(squad, index, index + 1))}
                  className="h-[44px] w-[44px] shrink-0 rounded-[9px] bg-chip font-extrabold disabled:opacity-40"
                >
                  ↓
                </button>
              </div>
            ))}
          </div>
        )}

        {step === 3 && (
          <PasoFormato
            config={config}
            picked={disciplines}
            errors={errors}
            pairSize={pairSize}
            onChange={setConfig}
            onChangePairSize={changePairSize}
          />
        )}

        {step === 4 && created !== null && (
          <>
            <div className="rounded-card bg-accent p-4 text-accent-text">
              <p className="text-[10.5px] font-extrabold uppercase tracking-[.14em] opacity-75">
                Link de invitación
              </p>
              <p className="mt-1 break-all text-[13.5px] font-bold">{inviteUrl}</p>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(inviteUrl)
                  setCopied(true)
                }}
                className="mt-3 w-full rounded-field bg-accent-text p-3 text-[14px] font-extrabold text-accent"
              >
                {copied ? 'Copiado ✓' : 'Copiar link'}
              </button>
              <p className="mt-2 text-[12px] font-semibold opacity-75">
                Pegalo en el grupo. Cada uno elige su nombre de la lista al entrar.
              </p>
            </div>

            <div className="overflow-hidden rounded-[14px] border border-line">
              {summaryOf(name, names, config, disciplines).map((row, index) => (
                <div
                  key={row.key}
                  className={`flex items-center justify-between gap-3 px-3 py-2.5 ${index > 0 ? 'border-t border-line' : ''}`}
                >
                  <span className="text-[13px] font-semibold text-muted">{row.key}</span>
                  <span className="text-right text-[13.5px] font-[750]">{row.value}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Estando adentro del plantel, la ayuda del paso 2 lo dice en palabras:
            el cartelito "vos" marca cuál sos, pero no cuenta que ya estás. */}
        {help !== '' && (
          <p className="text-pretty text-[13.5px] font-[550] leading-[1.5] text-muted">{help}</p>
        )}

        {error !== null && <Aviso>{error}</Aviso>}
      </div>

      {leaving && (
        <SalirDelPlantel
          onCancel={() => setLeaving(false)}
          onConfirm={() => {
            if (mySeat !== null) setSquad(removeSeatAt(squad, mySeat))
            setLeaving(false)
          }}
        />
      )}

      <div className="flex gap-2">
        {step === 3 && (
          <button
            type="button"
            onClick={() => setConfig(configFor(filled, pairSize))}
            className="rounded-field border-[1.5px] border-line px-4 py-4 text-[14px] font-extrabold"
          >
            Usar los defaults
          </button>
        )}
        {step === 4 && created !== null ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => startTransition(() => router.push(`/torneo/${created.seasonId}`))}
            className="flex-1 rounded-field bg-accent p-4 text-center text-[15px] font-extrabold text-accent-text"
          >
            Ir al torneo
          </button>
        ) : (
          <button
            type="button"
            disabled={blocked || pending}
            onClick={advance}
            className={`flex-1 rounded-field p-4 text-center text-[15px] font-extrabold ${
              blocked || pending ? 'bg-chip text-muted' : 'bg-accent text-accent-text'
            }`}
          >
            Continuar
          </button>
        )}
      </div>
    </main>
  )
}
