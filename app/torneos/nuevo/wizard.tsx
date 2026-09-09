'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import type { MatchdayFormat, SeasonConfig, SideSize } from '@/core'
import { matchdayFormatLabel } from '@/app/format'
import { createTournament } from './actions'
import {
  DISCIPLINE_KINDS,
  DISCIPLINE_LABELS,
  FORMATO_DEFAULT_OPTIONS,
  type DisciplineKind,
  type Squad,
  addMySeat,
  addToOrders,
  automaticHasMasters,
  disciplinesWarning,
  effectiveFloor,
  filledCount,
  formatErrors,
  formatoDefaultKey,
  freshDisciplineConfig,
  isSameFormatoDefault,
  moveInOrder,
  moveSeat,
  namesAfterEdit,
  newTournamentPayload,
  removeFromOrders,
  removeSeatAt,
  resizeConfigs,
  squadWarning,
  steppersFor,
  summaryOf,
  swapInOrders,
  toggleDiscipline,
  toggleOwnOrder,
  withoutTrailingBlanks,
} from './wizard-state'

const SIDE_SIZES: { value: SideSize; label: string }[] = [
  { value: 2, label: 'Parejas' },
  { value: 1, label: 'Individual' },
]

/**
 * "Parejas" o "Individual" — `pairSize`, elegido al crear la disciplina y
 * nunca editable después (`0015_disciplines.sql` revoca su UPDATE a
 * propósito). Comparten este selector el paso 1 del wizard (W76/decisión
 * #4017 lo bajó ahí, ver el docblock de `PasoDisciplinas` más abajo) y "+
 * Agregar disciplina" de Ajustes (`disciplinas.tsx`): los mismos dos caminos que ya
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

// Swap de "Orden inicial" y "Formato" (esta tarea, plan de multi-disciplina):
// el checkbox "orden propio" vive en Formato (paso 2) y hace falta ANTES de
// llegar a Orden inicial (paso 3), que es donde ese checkbox se traduce en
// una lista editable -- por eso Formato pasó a preguntarse primero.
const TITLES = ['Nombre y disciplinas', 'El plantel', 'Formato', 'Orden inicial', 'Listo']
const HELP = [
  'Como lo llaman en el grupo. Se puede cambiar después.',
  // El plantel (índice 1, `step === 1` en `Wizard`) ya NO tiene una frase
  // fija acá: "de 8 a 12" mentía apenas el piso derivado bajaba de 8 (FIFA
  // sola arranca en 2). La arma `Wizard`, con el piso EN VIVO (`floor`).
  '',
  'Todos tienen un valor que ya funciona. Si no te importa, seguí de largo.',
  'Ordenalos del mejor al peor. Es el criterio que corta los empates hasta que haya fechas jugadas, y de ahí salen las primeras parejas.',
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
 * El formato de UNA disciplina: los puntos por posición y los steppers que le
 * corresponden (`steppersFor`, la MISMA función que usa Ajustes) — y, con
 * `label` puesto, Masters y el formato por defecto de las fechas.
 *
 * `label === null` — UNA sola disciplina elegida, el 100% de los torneos que
 * existen hoy (§5 del diseño) — es EXACTAMENTE el JSX de antes de la Task 5
 * (docs/plan-arquitectura-de-paginas.md): nada envuelve el bloque, ningún
 * título, y Masters/"Formato de las fechas" NO se dibujan — esa disciplina
 * sigue naciendo con el automático de siempre (decisión #4029) y el default
 * de columna (ROUND_ROBIN, 0074), como hoy. `label` puesto — 2+ marcadas,
 * que es la queja original ("estás poniendo las mismas reglas para el
 * FIFA")— envuelve el bloque en su propia tarjeta con el nombre de la
 * disciplina y agrega esos dos controles: ahí es donde el aplanado dejaba de
 * tener sentido (§2.4).
 *
 * `steppersFor([config.matchFormat])` — un array de UNO, no el de todas las
 * marcadas — es la diferencia de fondo con la versión pre-Task 5: cada
 * disciplina ya tiene su PROPIA config (`configs` en `Wizard`), así que ya
 * no hace falta preguntar "¿alguna de las marcadas usa sets?" — alcanza con
 * preguntarle a ÉSTA. Es el mismo criterio que ya usaba Ajustes
 * (`formato.tsx`), no uno nuevo.
 */
function FormatoDeUnaDisciplina({
  kind,
  config,
  pairSize,
  hasMasters,
  formatoDefault,
  fixedTeams,
  ownOrder,
  errors,
  label,
  onChangeConfig,
  onChangeHasMasters,
  onChangeFormatoDefault,
  onChangeFixedTeams,
  onChangeOwnOrder,
}: {
  kind: DisciplineKind
  config: SeasonConfig
  pairSize: SideSize
  hasMasters: boolean
  formatoDefault: MatchdayFormat
  fixedTeams: boolean
  /** ¿Esta disciplina arranca con SU propio orden inicial, en vez del orden general del plantel? Paso "Orden inicial" (más abajo en `Wizard`). */
  ownOrder: boolean
  errors: string[]
  /** `null` con una sola disciplina elegida — mismo contrato que `Formato.disciplineLabel` en Ajustes. */
  label: string | null
  onChangeConfig: (next: SeasonConfig) => void
  onChangeHasMasters: (next: boolean) => void
  onChangeFormatoDefault: (next: MatchdayFormat) => void
  onChangeFixedTeams: (next: boolean) => void
  onChangeOwnOrder: (next: boolean) => void
}) {
  const steppers = steppersFor([config.matchFormat])

  const cuerpo = (
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
                onChangeConfig({ ...config, points })
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
                onChangeConfig(
                  stepper.key === 'setsToWin' || stepper.key === 'gamesPerSet'
                    ? { ...config, matchFormat: { ...config.matchFormat, [stepper.key]: next } }
                    : { ...config, [stepper.key]: next },
                )
              }
            />
          </div>
        ))}
      </div>

      {/* A diferencia de Masters/"Formato de las fechas" (más abajo), este
          checkbox vive DENTRO de `cuerpo`: se dibuja con una disciplina
          marcada o con dos (docs/tipos-de-torneo.md §1) — no hay "antes de
          esta Task" que preservar para `fixed_teams`, es un control nuevo en
          los dos casos. Con una sola disciplina, el paso 4 queda igual que
          hoy salvo por este control nuevo. */}
      <div className="overflow-hidden rounded-[14px] border border-line">
        <div className="flex min-h-[56px] items-center justify-between gap-2 px-3 py-2">
          <div className="min-w-0">
            <p className="text-[14px] font-bold">Equipos fijos</p>
            <p className="text-pretty text-[11.5px] font-semibold text-muted">
              {pairSize === 1
                ? 'Sólo tiene sentido con parejas.'
                : 'La pareja no rota nunca: siempre juega junta, sin sorteo.'}
            </p>
          </div>
          <input
            type="checkbox"
            checked={pairSize === 1 ? false : fixedTeams}
            disabled={pairSize === 1}
            onChange={(event) => onChangeFixedTeams(event.target.checked)}
            className="h-6 w-6 shrink-0 accent-accent disabled:opacity-40"
          />
        </div>
      </div>

      {errors.map((message) => (
        <Aviso key={message}>{label === null ? message : `${label}: ${message}`}</Aviso>
      ))}
    </>
  )

  if (label === null) return cuerpo

  return (
    <div className="flex flex-col gap-3 rounded-field border-[1.5px] border-line bg-surface p-3.5">
      <h3 className="text-[11.5px] font-extrabold uppercase tracking-[.14em] text-muted">{label}</h3>
      {cuerpo}

      {/* Masters y "Formato de las fechas" sólo existen en este bloque —o
          sea, sólo con 2+ disciplinas marcadas. Con una sola no se dibujan
          (`label === null` arriba retorna antes de llegar acá): esa
          disciplina sigue con el automático de siempre y el default de
          columna, exactamente como antes de la Task 5. Las PALABRAS son las
          mismas que ya usa Ajustes (`formato.tsx`/`formato-default.tsx`) —
          no se inventa copy nuevo, aunque el control en sí sea nuevo acá. */}
      <div className="overflow-hidden rounded-[14px] border border-line">
        <div className="flex min-h-[56px] items-center justify-between gap-2 px-3 py-2">
          <div className="min-w-0">
            <p className="text-[14px] font-bold">Masters</p>
            <p className="text-pretty text-[11.5px] font-semibold text-muted">
              {pairSize === 1
                ? 'Una disciplina de a uno no juega Masters: termina con su última fecha regular.'
                : 'La fecha extra que corona la temporada, al final del año.'}
            </p>
          </div>
          <input
            type="checkbox"
            checked={pairSize === 1 ? false : hasMasters}
            disabled={pairSize === 1}
            onChange={(event) => onChangeHasMasters(event.target.checked)}
            className="h-6 w-6 shrink-0 accent-accent disabled:opacity-40"
          />
        </div>
      </div>

      {/* "Orden propio" -- gatea IGUAL que Masters/"Formato de las fechas":
          sólo en este bloque, o sea sólo con 2+ disciplinas marcadas. Con
          una sola, "el orden global del plantel" y "el orden de ESTA
          disciplina" son EL MISMO dato -- el control preguntaría algo que ya
          no tiene dos respuestas posibles, la misma razón por la que
          Masters/Formato de las fechas tampoco se dibujan ahí (§5 del
          diseño). A diferencia de Masters, no depende de `pairSize`: no hay
          ningún CHECK de la base que exija parejas para tener un orden
          propio -- `seed_position` es una columna por disciplina desde
          antes de esta tarea (`db/season.ts`, `squadSeedOrder`), ajena a
          `pair_size`. */}
      <div className="overflow-hidden rounded-[14px] border border-line">
        <div className="flex min-h-[56px] items-center justify-between gap-2 px-3 py-2">
          <div className="min-w-0">
            <p className="text-[14px] font-bold">Orden propio</p>
            <p className="text-pretty text-[11.5px] font-semibold text-muted">
              Esta disciplina arranca con su propio orden inicial, en vez del orden general del
              plantel (paso "Orden inicial").
            </p>
          </div>
          <input
            type="checkbox"
            checked={ownOrder}
            onChange={(event) => onChangeOwnOrder(event.target.checked)}
            className="h-6 w-6 shrink-0 accent-accent"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-[14px] border border-line">
        <h4
          id={`formato-default-legend-${kind}`}
          className="px-3 pt-2.5 text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted"
        >
          Formato de las fechas
        </h4>
        <fieldset aria-labelledby={`formato-default-legend-${kind}`} className="flex flex-col gap-2 p-3 pt-2">
          {FORMATO_DEFAULT_OPTIONS.map((option) => (
            <label
              key={formatoDefaultKey(option)}
              className="flex min-h-[44px] items-center gap-2.5 rounded-field border border-line p-2.5 text-[13.5px] font-[700]"
            >
              <input
                type="radio"
                name={`formato-default-${kind}`}
                checked={isSameFormatoDefault(formatoDefault, option)}
                onChange={() => onChangeFormatoDefault(option)}
                className="h-5 w-5 shrink-0 accent-accent"
              />
              {matchdayFormatLabel(option)}
            </label>
          ))}
        </fieldset>
        <p className="px-3 pb-2.5 text-[11.5px] font-[600] text-muted">
          Cada fecha nueva nace con este formato. Si el día no da la cantidad de lados que hace
          falta, se puede elegir otro al armar esa fecha.
        </p>
      </div>
    </div>
  )
}

/**
 * El paso 4: un bloque de formato por disciplina MARCADA — Task 5
 * (docs/plan-arquitectura-de-paginas.md §2.4, §6), la queja que originó todo
 * el plan: *"cuando creo el torneo tengo que configurar cada disciplina, no
 * después [...] estás poniendo las mismas reglas para el FIFA"*.
 *
 * Vive afuera de `Wizard` —y exportado— para poder RENDERIZARLO en la suite
 * unitaria: `step` es estado interno del wizard y sin clicks no se llega hasta
 * acá. W63 fue una mentira de este paso que ningún test podía ver, en un
 * proyecto que ya se comió cinco problemas de pantalla.
 *
 * Con UNA disciplina esto es un solo `<FormatoDeUnaDisciplina>` con
 * `label={null}` — el mismo JSX de siempre, byte a byte (verificado
 * renderizando la versión commiteada de `PasoFormato` contra ésta con los
 * mismos datos). Con 2+, una tarjeta por cada una, en el orden en que se
 * marcaron.
 */
export function PasoFormato({
  configs,
  picked,
  pairSizes,
  hasMasters,
  formatoDefault,
  fixedTeams,
  ownOrder,
  errors,
  onChangeConfig,
  onChangeHasMasters,
  onChangeFormatoDefault,
  onChangeFixedTeams,
  onChangeOwnOrder,
}: {
  configs: Record<DisciplineKind, SeasonConfig>
  picked: readonly DisciplineKind[]
  pairSizes: Record<DisciplineKind, SideSize>
  hasMasters: Record<DisciplineKind, boolean>
  formatoDefault: Record<DisciplineKind, MatchdayFormat>
  fixedTeams: Record<DisciplineKind, boolean>
  /** ¿Cada disciplina arranca con SU propio orden inicial? Paso "Orden inicial" (`PasoOrdenInicial`, más abajo). */
  ownOrder: Record<DisciplineKind, boolean>
  errors: Record<DisciplineKind, string[]>
  onChangeConfig: (kind: DisciplineKind, next: SeasonConfig) => void
  onChangeHasMasters: (kind: DisciplineKind, next: boolean) => void
  onChangeFormatoDefault: (kind: DisciplineKind, next: MatchdayFormat) => void
  onChangeFixedTeams: (kind: DisciplineKind, next: boolean) => void
  onChangeOwnOrder: (kind: DisciplineKind, next: boolean) => void
}) {
  return (
    <>
      {picked.map((kind) => (
        <FormatoDeUnaDisciplina
          key={kind}
          kind={kind}
          config={configs[kind]}
          pairSize={pairSizes[kind]}
          hasMasters={hasMasters[kind]}
          formatoDefault={formatoDefault[kind]}
          fixedTeams={fixedTeams[kind]}
          ownOrder={ownOrder[kind]}
          errors={errors[kind] ?? []}
          label={picked.length > 1 ? DISCIPLINE_LABELS[kind] : null}
          onChangeConfig={(next) => onChangeConfig(kind, next)}
          onChangeHasMasters={(next) => onChangeHasMasters(kind, next)}
          onChangeFormatoDefault={(next) => onChangeFormatoDefault(kind, next)}
          onChangeFixedTeams={(next) => onChangeFixedTeams(kind, next)}
          onChangeOwnOrder={(next) => onChangeOwnOrder(kind, next)}
        />
      ))}
    </>
  )
}

/**
 * El paso "Orden inicial" -- swap de posición con "Formato" (esta tarea, plan
 * de multi-disciplina): antes vivía en el índice 2, ahora en el 3, último
 * paso configurable antes de "Listo". La lista GLOBAL (arriba) es
 * EXACTAMENTE la de siempre —el criterio de desempate hasta que haya fechas
 * jugadas, y de ahí las primeras parejas— y sigue siendo la que usa
 * cualquier disciplina cuyo checkbox "orden propio" (paso Formato,
 * `FormatoDeUnaDisciplina`) esté apagado.
 *
 * Debajo, una tarjeta por disciplina que SÍ prendió ese checkbox
 * (`ownOrder[kind]`), con su PROPIA lista (`orders[kind]`) y las mismas
 * flechas subir/bajar -- editable de forma independiente de la global y de
 * las demás disciplinas. `orders[kind]` es una lista de ÍNDICES sobre
 * `orderedNames` (F1, `wizard-state.ts`) que `Wizard` ya mantiene al día en
 * el sitio exacto de cada operación del plantel (`editSeatName`/
 * `joinSquad`/`removeSeat`/`moveGlobalSeat`) — este componente sólo
 * traduce cada índice a su nombre (`orderedNames[at]`) y dibuja lo que le
 * pasan, no reconcilia nada por su cuenta.
 *
 * F3 (dos jueces ciegos, `37b225b..d33377a`): la tarjeta por disciplina sólo
 * se dibuja con 2+ marcadas (`disciplines.length > 1`), MISMO gate que el
 * checkbox que la prende (`FormatoDeUnaDisciplina`, `label !== null`). Sin
 * este gate, destildar una disciplina en el paso 1 dejaba su tarjeta
 * dibujándose acá con el checkbox que la apagaría ya invisible -- "un
 * control que ya no se ve no puede seguir mandando" (mismo criterio que
 * `hasMasters`/`formatoDefault` en `newTournamentPayload`).
 *
 * Exportado y separado de `Wizard`, mismo motivo que `PasoDisciplinas`/
 * `PasoFormato`: `step` es estado interno y sin clicks la suite no llega
 * hasta acá.
 */
export function PasoOrdenInicial({
  orderedNames,
  mySeat,
  disciplines,
  ownOrder,
  orders,
  onMoveGlobal,
  onMoveOwn,
}: {
  orderedNames: string[]
  mySeat: number | null
  disciplines: readonly DisciplineKind[]
  ownOrder: Record<DisciplineKind, boolean>
  orders: Partial<Record<DisciplineKind, number[]>>
  onMoveGlobal: (from: number, to: number) => void
  onMoveOwn: (kind: DisciplineKind, from: number, to: number) => void
}) {
  return (
    <>
      <div className="overflow-hidden rounded-[14px] border border-line">
        {/* `orderedNames`, no el plantel crudo: sin esto, terminar de cargar
            el plantel tipeando de corrido deja siempre una fila en blanco
            colgando al final, y este paso la dibujaría con flechas de
            subir/bajar sobre un nombre que no existe (ver
            `withoutTrailingBlanks`, wizard-state.ts). */}
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
              onClick={() => onMoveGlobal(index, index - 1)}
              className="h-[44px] w-[44px] shrink-0 rounded-[9px] bg-chip font-extrabold disabled:opacity-40"
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={`Bajar a ${seat}`}
              disabled={index === orderedNames.length - 1}
              onClick={() => onMoveGlobal(index, index + 1)}
              className="h-[44px] w-[44px] shrink-0 rounded-[9px] bg-chip font-extrabold disabled:opacity-40"
            >
              ↓
            </button>
          </div>
        ))}
      </div>

      {/* Una tarjeta por disciplina con orden PROPIO -- las que se quedaron
          con el checkbox apagado (o nunca lo prendieron) no dibujan nada
          acá, siguen con la lista global de arriba. Sin la marca "vos": esa
          marca es del plantel, y acá cada fila es sólo un nombre reordenado
          -- ninguna disciplina necesita saber cuál asiento es el propio
          para tener su orden de desempate. */}
      {disciplines.length > 1 &&
        disciplines
          .filter((kind) => ownOrder[kind])
          .map((kind) => {
            const order = orders[kind] ?? []
            return (
              <div key={kind} className="flex flex-col gap-2">
                <h3 className="text-[11.5px] font-extrabold uppercase tracking-[.14em] text-muted">
                  {DISCIPLINE_LABELS[kind]}
                </h3>
                <div className="overflow-hidden rounded-[14px] border border-line">
                  {order.map((at, index) => {
                    const seat = orderedNames[at] ?? ''
                    return (
                      <div
                        key={index}
                        className={`flex items-center gap-2 px-3 py-2 ${index > 0 ? 'border-t border-line' : ''}`}
                      >
                        <span className="text-[13px] text-muted">⠿</span>
                        <span className="w-5 shrink-0 text-[13px] font-extrabold text-muted">{index + 1}</span>
                        <span className="min-w-0 flex-1 truncate text-[15px] font-bold">{seat}</span>
                        <button
                          type="button"
                          aria-label={`Subir a ${seat} en ${DISCIPLINE_LABELS[kind]}`}
                          disabled={index === 0}
                          onClick={() => onMoveOwn(kind, index, index - 1)}
                          className="h-[44px] w-[44px] shrink-0 rounded-[9px] bg-chip font-extrabold disabled:opacity-40"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label={`Bajar a ${seat} en ${DISCIPLINE_LABELS[kind]}`}
                          disabled={index === order.length - 1}
                          onClick={() => onMoveOwn(kind, index, index + 1)}
                          className="h-[44px] w-[44px] shrink-0 rounded-[9px] bg-chip font-extrabold disabled:opacity-40"
                        >
                          ↓
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
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
  // Declarado ANTES del plantel y de `configs` (mismo criterio que la
  // corrección #4030/lección #3994 ya fijó): los dos lo usan sólo al MONTAR
  // (`useState` no vuelve a correr si el admin cambia de disciplina
  // después), así que nacen viendo el piso de la selección inicial — pádel,
  // 4, no el 8 plano de antes. Quien SÍ sigue el piso EN VIVO es el aviso
  // del paso 2 y el botón de sacar fila (`squadWarning` y
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
  // `configs` reemplaza al `config` único de antes de la Task 5: una entrada
  // POR DISCIPLINA (las dos, aunque el torneo sólo marque una — mismo
  // criterio que `pairSizes`), cada una con SU PROPIA curva de puntos y SUS
  // PROPIOS steppers. `floor`, no un plano fijo (corrección #4030, lección
  // #3994): la config inicial de cada disciplina tiene que describir el
  // MISMO plantel que arranca arriba, o su curva de puntos nace con un largo
  // que no corresponde a `squad.names`.
  const [configs, setConfigsState] = useState<Record<DisciplineKind, SeasonConfig>>(() => ({
    PADEL: freshDisciplineConfig('PADEL', floor, pairSizes.PADEL),
    FIFA: freshDisciplineConfig('FIFA', floor, pairSizes.FIFA),
  }))
  // Masters y el formato por defecto de las fechas, uno por disciplina —
  // Task 5, §2.4/§2.5 del diseño. Arrancan en el automático de decisión
  // #4029 y en ROUND_ROBIN (el default de columna, 0074): sin tocar ningún
  // control, un torneo de una sola disciplina se crea EXACTAMENTE igual que
  // antes de esta Task (`newTournamentPayload` sólo manda estas dos claves
  // con 2+ marcadas).
  const [hasMasters, setHasMastersState] = useState<Record<DisciplineKind, boolean>>({
    PADEL: automaticHasMasters(pairSizes.PADEL),
    FIFA: automaticHasMasters(pairSizes.FIFA),
  })
  const [formatoDefault, setFormatoDefaultState] = useState<Record<DisciplineKind, MatchdayFormat>>({
    PADEL: { kind: 'ROUND_ROBIN' },
    FIFA: { kind: 'ROUND_ROBIN' },
  })
  // Equipos fijos, uno por disciplina (docs/tipos-de-torneo.md §1). Arranca
  // en `false` para las dos -- el pádel rotativo de siempre -- y, a
  // diferencia de `hasMasters`/`formatoDefault`, su checkbox se dibuja
  // SIEMPRE en el paso 4 (una disciplina marcada o dos), así que no hace
  // falta un automático que dependa de `pairSize`.
  const [fixedTeams, setFixedTeamsState] = useState<Record<DisciplineKind, boolean>>({
    PADEL: false,
    FIFA: false,
  })
  // Orden inicial propio, uno por disciplina -- plan de multi-disciplina.
  // `ownOrder` (el checkbox del paso Formato) modelado EXACTAMENTE como
  // `fixedTeams`, arriba: arranca en `false` para las dos, el orden GLOBAL
  // de siempre. `orders` es la data real detrás del checkbox -- `Partial`,
  // no un `Record` completo como `fixedTeams`: a diferencia de ese
  // checkbox, "esta disciplina no tiene orden propio" no es un booleano que
  // viva siempre con un valor, es la AUSENCIA de una lista entera (por eso
  // el guard de permutación de `db/season.ts` lo trata como "seguí el
  // global", no como "seedNames: []"). Las dos arrancan vacías/en `false`:
  // ningún pádel existente cambia si nadie toca este checkbox.
  const [ownOrder, setOwnOrderState] = useState<Record<DisciplineKind, boolean>>({
    PADEL: false,
    FIFA: false,
  })
  // Por ÍNDICE de asiento, no por nombre (F1, wizard-state.ts): un índice
  // sobrevive a una renombrada, que es justo lo que `setSquad` dispara en
  // CADA tecla de esta pantalla.
  const [orders, setOrdersState] = useState<Partial<Record<DisciplineKind, number[]>>>({})
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
  // Un `formatErrors` POR disciplina marcada, no uno solo sobre una curva
  // compartida (C29/W88/W90, ya cerrado por la Task 5): cada disciplina
  // valida SU PROPIA config contra SU PROPIO `pairSize`.
  const errorsByKind = Object.fromEntries(
    DISCIPLINE_KINDS.map((kind) => [kind, formatErrors(configs[kind], pairSizes[kind])]),
  ) as Record<DisciplineKind, string[]>
  const anyErrors = disciplines.some((kind) => errorsByKind[kind].length > 0)
  const disciplineWarning = disciplinesWarning(disciplines)

  // Sólo plantel + configs -- desde F1 (wizard-state.ts) el orden propio de
  // cada disciplina ya NO se reconcilia acá adentro por un diff de nombres:
  // se ajusta por ÍNDICE, en el sitio EXACTO de cada operación
  // (`editSeatName`/`joinSquad`/`removeSeat`/`moveGlobalSeat`, más abajo),
  // igual que `mySeat` ya se ajusta en `namesAfterEdit`/`addMySeat`/
  // `removeSeatAt`/`moveSeat` -- una renombrada no reordena nada (el índice
  // no se mueve), así que esta función ya no tiene ninguna razón para tocar
  // `orders`.
  const setSquad = (next: Squad) => {
    setSquadState(next)
    // `resizeConfigs`, no un `resizeConfig` suelto (Task 5): agrandar o
    // achicar el plantel tiene que poner al día la curva de CADA
    // disciplina, cada una contra su propio `pairSize` — ya no hay una sola
    // curva compartida que corregir.
    setConfigsState((current) => resizeConfigs(current, filledCount(next.names), pairSizes))
  }

  // La fila `index` del plantel (paso 1) cambia de valor. Si esa fila estaba
  // en blanco y pasa a tener contenido, es un asiento NUEVO -- entra al
  // final de cada orden propio que ya exista (`addToOrders`); si ya tenía
  // nombre, es una renombrada y no hace falta tocar nada (F1: el índice
  // sigue señalando al mismo asiento, se llame como se llame).
  const editSeatName = (index: number, value: string) => {
    const wasBlank = (names[index] ?? '').trim().length === 0
    setSquad({ ...squad, names: namesAfterEdit(names, index, value) })
    if (wasBlank && value.trim().length > 0) setOrdersState((current) => addToOrders(current, index))
  }

  // "Participar en el torneo": el organizador entra al plantel en un asiento
  // NUEVO (`addMySeat`, al final) -- mismo criterio que `editSeatName` de
  // arriba para un asiento que aparece, así que también entra a cada orden
  // propio que ya exista.
  const joinSquad = () => {
    setOrdersState((current) => addToOrders(current, names.length))
    setSquad(addMySeat(squad, myName))
  }

  // Saca la fila `index` del plantel (la cruz de paso 1, o "Sacame del
  // plantel" para la propia): `removeFromOrders` corre la MISMA fórmula que
  // `removeSeatAt` ya aplica a `mySeat`, generalizada a cada orden propio.
  const removeSeat = (index: number) => {
    setSquad(removeSeatAt(squad, index))
    setOrdersState((current) => removeFromOrders(current, index))
  }

  // El swap del orden GLOBAL (paso "Orden inicial", lista de arriba):
  // `swapInOrders` sigue la MISMA fórmula que `moveSeat` ya aplica a
  // `mySeat` -- si un orden propio ya tenía anotado alguno de los dos
  // asientos, tiene que seguir señalando a la MISMA persona después del
  // swap, no a la que quedó parada en ese índice.
  const moveGlobalSeat = (from: number, to: number) => {
    setSquad(moveSeat(squad, from, to))
    setOrdersState((current) => swapInOrders(current, from, to))
  }

  // Cada radio "Lados" manda sólo sobre SU disciplina, y ahora SIEMPRE rehace
  // la config de esa disciplina sola (Task 5): con una config genuinamente
  // por disciplina no hay ambigüedad de 2+ marcadas que cuidar (la que
  // resolvía `configForPairSizeChange`, borrada en esta Task) — tocar
  // "Lados" de FIFA nunca puede mover la curva de Pádel, porque cada una
  // vive en su propia entrada de `configs`.
  const changePairSize = (kind: DisciplineKind, next: SideSize) => {
    setPairSizes((current) => ({ ...current, [kind]: next }))
    setConfigsState((current) => ({ ...current, [kind]: freshDisciplineConfig(kind, filled, next) }))
  }

  // Los tres setters de `PasoFormato`, declarados por nombre (mismo criterio
  // que `changePairSize`, arriba) y no como arrow inline en el JSX: una
  // arrow ahí adentro corta en seco a `app/cableado-de-formato.unit.test.ts`,
  // que pincha el call site con una regexp que no puede cruzar un `=>`.
  const changeConfig = (kind: DisciplineKind, next: SeasonConfig) =>
    setConfigsState((current) => ({ ...current, [kind]: next }))
  const changeHasMasters = (kind: DisciplineKind, next: boolean) =>
    setHasMastersState((current) => ({ ...current, [kind]: next }))
  const changeFormatoDefault = (kind: DisciplineKind, next: MatchdayFormat) =>
    setFormatoDefaultState((current) => ({ ...current, [kind]: next }))
  const changeFixedTeams = (kind: DisciplineKind, next: boolean) =>
    setFixedTeamsState((current) => ({ ...current, [kind]: next }))
  // El checkbox "orden propio" (`FormatoDeUnaDisciplina`, paso Formato):
  // prender copia el orden GLOBAL de ESTE instante (`orderedNames`, no el
  // plantel crudo -- mismo criterio que arriba), apagar borra la entrada
  // entera (`toggleOwnOrder`, wizard-state.ts). Los dos casos actualizan
  // `orders` a la vez que `ownOrder` -- son la misma acción del usuario.
  const changeOwnOrder = (kind: DisciplineKind, next: boolean) => {
    setOwnOrderState((current) => ({ ...current, [kind]: next }))
    setOrdersState((current) => toggleOwnOrder(current, kind, next, orderedNames))
  }
  // Sube o baja una fila de la lista PROPIA de una disciplina
  // (`PasoOrdenInicial`): `moveInOrder` es el `moveSeat` de arriba sin
  // `mySeat` que arrastrar, porque esta lista es de ÍNDICES sueltos (F1),
  // sin ningún asiento propio que seguir.
  const changeOrderAt = (kind: DisciplineKind, from: number, to: number) =>
    setOrdersState((current) => {
      const order = current[kind]
      if (order === undefined) return current
      return { ...current, [kind]: moveInOrder(order, from, to) }
    })

  const blocked =
    (step === 0 && (name.trim().length === 0 || disciplineWarning !== null)) ||
    (step === 1 && warning !== null) ||
    (step === 2 && anyErrors)

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
        newTournamentPayload(
          name,
          squad,
          configs,
          disciplines,
          pairSizes,
          hasMasters,
          formatoDefault,
          fixedTeams,
          orders,
        ),
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
                  onChange={(event) => editSeatName(index, event.target.value)}
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
                    onClick={() => (index === mySeat ? setLeaving(true) : removeSeat(index))}
                    // Sí, esta cruz se intercala entre un input y el siguiente
                    // al tabular, y tipear de corrido manda la letra al botón en
                    // vez de al próximo nombre. Se probó sacarla del tabulado con
                    // `tabIndex={-1}` y se revirtió: dejaba el único camino de
                    // teclado a "sacar a otro" sin alternativa (WCAG 2.1.1), y la
                    // salida que suele proponerse -- `tabIndex` positivos en los
                    // inputs -- es peor, porque un `tabIndex` positivo salta
                    // adelante de TODA la página, no de este paso. Decisión de
                    // Stefano (02/09/2026): se queda el orden estándar. Es lo que
                    // hace cualquier formulario con un botón de borrar por fila,
                    // la letra perdida se ve al instante, y la fila que crece
                    // sola ya resolvió la parte grande del problema. Si el doble
                    // Tab molesta al usarlo, el arreglo honesto es reordenar el
                    // DOM (botones después de todos los inputs, ubicados por
                    // CSS), no un truco de tabIndex.
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
                onClick={joinSquad}
                className="rounded-field border-[1.5px] border-accent p-[13px] text-[14px] font-extrabold text-accent-link"
              >
                Participar en el torneo
              </button>
            )}
            {warning !== null && <Aviso>{warning}</Aviso>}
          </>
        )}

        {/* Swap con "Orden inicial" (esta tarea): Formato ahora es el paso 2,
            porque el checkbox "orden propio" que vive acá adentro es lo que
            decide si una disciplina dibuja su propia lista en el paso 3. */}
        {step === 2 && (
          <PasoFormato
            configs={configs}
            picked={disciplines}
            pairSizes={pairSizes}
            hasMasters={hasMasters}
            formatoDefault={formatoDefault}
            fixedTeams={fixedTeams}
            ownOrder={ownOrder}
            errors={errorsByKind}
            onChangeConfig={changeConfig}
            onChangeHasMasters={changeHasMasters}
            onChangeFormatoDefault={changeFormatoDefault}
            onChangeFixedTeams={changeFixedTeams}
            onChangeOwnOrder={changeOwnOrder}
          />
        )}

        {step === 3 && (
          <PasoOrdenInicial
            orderedNames={orderedNames}
            mySeat={mySeat}
            disciplines={disciplines}
            ownOrder={ownOrder}
            orders={orders}
            onMoveGlobal={moveGlobalSeat}
            onMoveOwn={changeOrderAt}
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
              {summaryOf(name, names, configs, disciplines).map((row, index) => (
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
            if (mySeat !== null) removeSeat(mySeat)
            setLeaving(false)
          }}
        />
      )}

      <div className="flex gap-2">
        {/* Se mueve con Formato (esta tarea): sigue siendo el botón de ESE
            paso, sólo que ahora es el 2 y no el 3. */}
        {step === 2 && (
          <button
            type="button"
            // Rehace la config de CADA disciplina MARCADA a su default fresco
            // (Task 5): ya no hay una sola curva compartida que rehacer
            // (`configSideSize`, borrada en esta Task) -- cada una vuelve a
            // la suya, con su propio `pairSize`.
            onClick={() =>
              setConfigsState((current) => {
                const next = { ...current }
                for (const kind of disciplines) next[kind] = freshDisciplineConfig(kind, filled, pairSizes[kind])
                return next
              })
            }
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
