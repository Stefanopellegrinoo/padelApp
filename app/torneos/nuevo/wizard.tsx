'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import type { SeasonConfig, SideSize } from '@/core'
import { createTournament } from './actions'
import {
  DISCIPLINE_KINDS,
  DISCIPLINE_LABELS,
  type DisciplineKind,
  type Squad,
  addMySeat,
  buildDisciplines,
  configFor,
  configForPairSizeChange,
  configSideSize,
  disciplinesWarning,
  effectiveFloor,
  filledCount,
  formatErrors,
  moveSeat,
  namesAfterEdit,
  newTournamentPayload,
  removeSeatAt,
  resizeConfig,
  squadWarning,
  steppersFor,
  summaryOf,
  toggleDiscipline,
  withoutTrailingBlanks,
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
 *
 * `name` es un prop, no un literal fijo (W76/decisión #4017): el wizard
 * ahora monta UNA instancia POR disciplina marcada (`PasoDisciplinas`, más
 * abajo), y dos `<input type="radio">` con el mismo `name` son UN solo grupo
 * para el navegador — marcar "Individual" en FIFA desmarcaría "Parejas" en
 * Pádel sin que ninguna línea de React lo pida. El default preserva a
 * Ajustes (`disciplinas.tsx`), que sigue montando una sola instancia suelta
 * y no pasa `name`.
 */
export function SelectorDeLados({
  pairSize,
  onChange,
  disabled = false,
  name = 'pairSize',
}: {
  pairSize: SideSize
  onChange: (next: SideSize) => void
  disabled?: boolean
  name?: string
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
            name={name}
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

/**
 * El paso 1: nombre del torneo aparte, disciplinas acá — un checkbox por
 * `DisciplineKind` y, si está marcada, SU PROPIO `SelectorDeLados` al lado
 * (W76/decisión #4017, cierra `verify-report-pr21-cierre` #4016).
 *
 * Antes había UN solo radio "Lados" en el paso 4, compartido por todas las
 * marcadas — con dos o más, el dato se ignoraba en silencio mientras la
 * pantalla seguía mostrando la curva de la elegida (la mentira que W76
 * midió: FIFA en "Individual" dibujaba 8 puntos y el torneo nacía con las
 * dos en `pair_size=2`). Con un selector por disciplina no hay ambigüedad
 * que ignorar: cada radio manda sobre su propia fila, y la pantalla nunca
 * promete algo que el dato no vaya a tener.
 *
 * Exportado y separado de `Wizard` por el mismo motivo que `PasoFormato`
 * (Rebanada D2, PR21): `step` es estado interno y sin clicks la suite nunca
 * llega hasta acá — entra con las props que quiera el test.
 */
export function PasoDisciplinas({
  picked,
  pairSizes,
  warning,
  onToggle,
  onChangePairSize,
}: {
  picked: readonly DisciplineKind[]
  pairSizes: Record<DisciplineKind, SideSize>
  warning: string | null
  onToggle: (kind: DisciplineKind) => void
  onChangePairSize: (kind: DisciplineKind, next: SideSize) => void
}) {
  return (
    <>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-[11.5px] font-extrabold uppercase tracking-[.14em] text-muted">
          Disciplinas
        </legend>
        {DISCIPLINE_KINDS.map((kind) => (
          <div
            key={kind}
            className="flex flex-col gap-3 rounded-field border-[1.5px] border-line bg-surface p-3.5"
          >
            <label className="flex items-center gap-2.5 text-[14.5px] font-[700]">
              <input
                type="checkbox"
                checked={picked.includes(kind)}
                onChange={() => onToggle(kind)}
                className="h-5 w-5 shrink-0 accent-accent"
              />
              {DISCIPLINE_LABELS[kind]}
            </label>
            {picked.includes(kind) && (
              <SelectorDeLados
                name={`pairSize-${kind}`}
                pairSize={pairSizes[kind]}
                onChange={(next) => onChangePairSize(kind, next)}
              />
            )}
          </div>
        ))}
      </fieldset>
      {warning !== null && <Aviso>{warning}</Aviso>}
    </>
  )
}

const TITLES = ['Nombre y disciplinas', 'El plantel', 'Orden inicial', 'Formato', 'Listo']
const HELP = [
  'Como lo llaman en el grupo. Se puede cambiar después.',
  // El plantel (índice 1, `step === 1` en `Wizard`) ya NO tiene una frase
  // fija acá: "de 8 a 12" mentía apenas el piso derivado bajaba de 8 (FIFA
  // sola arranca en 2). La arma `Wizard`, con el piso EN VIVO (`floor`).
  '',
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
 * Ya NO dibuja el radio "Lados" (W76/decisión #4017): bajó al paso 1, uno
 * por disciplina (`PasoDisciplinas`, arriba) — con dos disciplinas pudiendo
 * traer un `pairSize` DISTINTO cada una, un solo radio acá ya no tiene un
 * valor único que mostrar. `config.points`, que este paso sigue editando,
 * es siempre la curva de a dos (C29): la disciplina que elija "Individual"
 * arma la suya aparte, sin pasar por acá — no editable a mano en el wizard,
 * mismo límite que ya tenía cualquier disciplina fuera de la marcada `pairSize`
 * en la versión anterior de este mismo mecanismo.
 */
export function PasoFormato({
  config,
  picked,
  errors,
  onChange,
}: {
  config: SeasonConfig
  picked: readonly DisciplineKind[]
  errors: string[]
  onChange: (next: SeasonConfig) => void
}) {
  const steppers = steppersFor(
    buildDisciplines(picked, config).map((row) => row.config.matchFormat),
  )

  return (
    <>
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
  // Pádel marcado de entrada: sin tocar nada, el torneo nace igual que
  // siempre (una sola PADEL) — el checkbox no es una regresión, es el mismo
  // default de antes de PR11 hecho explícito.
  const [disciplines, setDisciplines] = useState<DisciplineKind[]>(['PADEL'])
  // Parejas de entrada para las dos disciplinas (pairSize=2): sin tocar
  // ningún radio "Lados" el torneo nace igual que siempre — no-regresión de
  // la Rebanada F. W76/decisión #4017: UN valor POR disciplina, no uno solo
  // para todas — "Individual" en FIFA ya no puede pisarle el dato a Pádel
  // ni la pantalla puede mostrar un radio que el submit ignora en silencio.
  const [pairSizes, setPairSizes] = useState<Record<DisciplineKind, SideSize>>({ PADEL: 2, FIFA: 2 })
  // El piso EFECTIVO del plantel COMPARTIDO (`effectiveFloor`, wizard-state.ts):
  // el máximo entre los pisos de las disciplinas marcadas, no un plano de 8.
  // Declarado ANTES del plantel y de `config` (mismo criterio que
  // `configSideSize` más abajo, corrección #4030/lección #3994): los dos lo
  // usan sólo al MONTAR (`useState` no vuelve a correr si el admin cambia de
  // disciplina después), así que nacen viendo el piso de la selección
  // inicial — pádel, 4, no el 8 plano de antes. Quien SÍ sigue el piso EN VIVO
  // es el aviso del paso 2 y el botón de sacar fila (`squadWarning` y
  // `names.length > floor`, los dos más abajo): a dos amigos de FIFA les
  // alcanza con llenar 2 de las filas que ya están, sin que el plantel
  // arranque más chico por sí solo.
  const sideSizes = disciplines.map((kind) => pairSizes[kind])
  const floor = effectiveFloor(sideSizes)
  // El que arma el torneo arranca ADENTRO del plantel, con su nombre ya puesto
  // en el primer asiento. Es el caso de casi todos —el que organiza los jueves
  // juega los jueves— y así no hay nada que descubrir para participar: mirás la
  // lista y ya estás. El que sólo organiza se saca, que es el caso raro.
  const [squad, setSquadState] = useState<Squad>(() => ({
    names: [myName, ...Array<string>(floor - 1).fill('')],
    mySeat: myName.trim().length === 0 ? null : 0,
  }))
  // `floor`, no un plano fijo (corrección #4030, lección #3994): el `config`
  // inicial tiene que describir el MISMO plantel que arranca arriba, o su
  // curva de puntos nace con un largo que no corresponde a `squad.names`.
  const [config, setConfig] = useState<SeasonConfig>(() =>
    configFor(floor, configSideSize(disciplines, pairSizes)),
  )
  const [error, setError] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [created, setCreated] = useState<{ seasonId: string; inviteToken: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const { names, mySeat } = squad
  const filled = filledCount(names)
  // Sin la fila en blanco que `namesAfterEdit` deja creciendo sola al final:
  // el paso 3 ordena jugadores, no casilleros (`withoutTrailingBlanks`,
  // wizard-state.ts).
  const orderedNames = withoutTrailingBlanks(names)
  // La paridad sólo corre si alguna disciplina marcada arma parejas
  // (`pairSize === 2`) — un torneo de sólo FIFA no tiene "armar parejas" que
  // pedir (`squadWarning`, wizard-state.ts).
  const warning = squadWarning(names, floor, sideSizes.includes(2))
  const errors = formatErrors(config, configSideSize(disciplines, pairSizes))
  const disciplineWarning = disciplinesWarning(disciplines)

  const setSquad = (next: Squad) => {
    setSquadState(next)
    // `configSideSize` y no un `sideSize` suelto (corrección #4030, lección
    // #3994): agrandar el plantel con la única disciplina en "Individual"
    // dejaba caer la curva de vuelta a parejas en silencio, mismo bug que
    // W83, disparador distinto.
    setConfig((current) => resizeConfig(current, filledCount(next.names), configSideSize(disciplines, pairSizes)))
  }

  // Cada radio "Lados" manda sólo sobre SU disciplina. Con 2+ marcadas, tocar
  // acá no rehace `config`: el paso 4 sigue siendo la curva de a dos siempre
  // (C29), y la disciplina que elija "Individual" arma la suya aparte en
  // `newTournamentPayload`. Pero con UNA sola marcada no hay ambigüedad que
  // cuidar (`configForPairSizeChange`, `wizard-state.ts`) — ahí SÍ rehace
  // `config` para que el paso 4 muestre y deje editar la curva de ESA
  // disciplina, exactamente como antes de `fe44255` (W83, #4026).
  const changePairSize = (kind: DisciplineKind, next: SideSize) => {
    setPairSizes((current) => ({ ...current, [kind]: next }))
    setConfig((current) => configForPairSizeChange(current, filled, disciplines, next))
  }

  const blocked =
    (step === 0 && (name.trim().length === 0 || disciplineWarning !== null)) ||
    (step === 1 && warning !== null) ||
    (step === 3 && errors.length > 0)

  // Ya no hay techo que anunciar (docs/plan-piso-y-techo-del-plantel.md
  // Task 3 lo borró entero): `floor` sigue siendo el piso efectivo de las
  // disciplinas marcadas (2 con sólo FIFA, 4 si hay pádel de por medio), pero
  // el plantel ya no tiene un "hasta cuánto".
  const help =
    step === 1
      ? mySeat !== null
        ? 'Ya estás anotado en el plantel: agregá al resto del grupo. Después compartís un link y cada uno elige el suyo.'
        : `Tipeá los nombres del grupo, al menos ${floor}. Después compartís un link y cada uno elige el suyo. No hace falta que vayan todos a todas las fechas.`
      : (HELP[step] ?? '')

  const inviteUrl =
    created === null
      ? ''
      : `${typeof window === 'undefined' ? '' : window.location.origin}/unirse/${created.inviteToken}`

  const submit = () => {
    setError(null)
    startTransition(async () => {
      const result = await createTournament(
        newTournamentPayload(name, squad, config, disciplines, pairSizes),
      )
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
            <PasoDisciplinas
              picked={disciplines}
              pairSizes={pairSizes}
              warning={disciplineWarning}
              onToggle={(kind) => setDisciplines(toggleDiscipline(disciplines, kind))}
              onChangePairSize={changePairSize}
            />
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
            {/* La fila mostrada se arma con `floor - 1` en blanco (Wizard,
                más arriba) y crece sola: tipear en la ÚLTIMA agrega la que
                sigue (`namesAfterEdit`, wizard-state.ts). No hay "tamaño
                típico" que montar por disciplina — la lista se estira con lo
                que hace falta, para dos personas o para veinticuatro. */}
            {names.map((seat, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-[13px] font-extrabold text-muted">{index + 1}</span>
                <input
                  value={seat}
                  onChange={(event) =>
                    setSquad({ ...squad, names: namesAfterEdit(names, index, event.target.value) })
                  }
                  placeholder="Nombre"
                  className={`min-w-0 flex-1 rounded-field border-[1.5px] bg-surface p-[15px] text-[16px] font-[700] outline-none placeholder:font-medium placeholder:text-muted ${
                    seat.trim().length === 0 ? 'border-accent' : 'border-line'
                  }`}
                />
                {index === mySeat && <Vos />}
                {/* La cruz propia está SIEMPRE, aunque el plantel esté en el
                    mínimo: sacarse no es achicar el plantel, es dejar el lugar
                    para otro. El aviso pide el que falta y eso está bien.
                    Con la fila que crece sola, esta cruz —para el resto de las
                    filas— puede aparecer un tipeo antes que con el piso fijo
                    de antes: `names.length > floor` se cumple apenas se agrega
                    la fila en blanco de la cola, no recién al clickear
                    "+ Agregar jugador". Es aceptado a propósito: la lista ya
                    creció, y la cruz existe para sacar una fila que la lista
                    tiene de más — negarla ahí sería fingir que esa fila extra
                    no está. */}
                {(index === mySeat || names.length > floor) && (
                  <button
                    type="button"
                    aria-label={
                      index === mySeat ? 'Sacarme del plantel' : `Sacar al jugador ${index + 1}`
                    }
                    onClick={() =>
                      index === mySeat ? setLeaving(true) : setSquad(removeSeatAt(squad, index))
                    }
                    // Medido con un tab real (Playwright, sin mouse): apenas la
                    // fila que crece sola cruza el piso, ESTE botón se intercala
                    // entre un input y el siguiente en el orden de tabulación —
                    // tipear de corrido manda la letra siguiente al botón, no al
                    // próximo nombre, y se pierde en silencio (no es un input,
                    // no la guarda). La cruz de "Sacarme" no tiene este problema
                    // en el uso real: nace ya cargada con el propio nombre, así
                    // que nadie necesita tabular DESDE ahí para escribir — el
                    // flujo de tipear arranca en la fila 2. Por eso el `tabIndex`
                    // sólo se saca para las cruces de "sacar a otro": afuera del
                    // tabulado siguen andando con mouse o touch (para eso están),
                    // pero no se cruzan en el camino de quien tipea de corrido.
                    tabIndex={index === mySeat ? undefined : -1}
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
            {/* Sin techo que la apague (docs/plan-piso-y-techo-del-plantel.md
                Task 3): la fila para sumar un jugador más siempre está. */}
            <button
              type="button"
              onClick={() => setSquad({ ...squad, names: [...names, ''] })}
              className="rounded-field border-[1.5px] border-line p-[13px] text-[14px] font-[750] text-muted"
            >
              + Agregar jugador
            </button>
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
            {/* `orderedNames`, no `names`: sin esto, terminar de cargar el
                plantel tipeando de corrido (el caso que `namesAfterEdit`
                existe para arreglar) siempre deja una fila en blanco colgando
                al final, y este paso la dibujaría con flechas de subir/bajar
                sobre un nombre que no existe. `withoutTrailingBlanks` sólo
                corta la COLA, así que el índice de cada fila que se ve acá es
                el mismo que en `names` — `moveSeat(squad, index, ...)` sigue
                apuntando a la fila correcta. */}
            {orderedNames.map((seat, index) => (
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
                  disabled={index === orderedNames.length - 1}
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
          <PasoFormato config={config} picked={disciplines} errors={errors} onChange={setConfig} />
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
            // `configSideSize` (corrección #4030, lección #3994): sin esto,
            // "Usar los defaults" con la única disciplina en "Individual"
            // volvía la curva a parejas en silencio -- mismo bug que W83,
            // en este botón en vez de en "Lados".
            onClick={() => setConfig(configFor(filled, configSideSize(disciplines, pairSizes)))}
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
