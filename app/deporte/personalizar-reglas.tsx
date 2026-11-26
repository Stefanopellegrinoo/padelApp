'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  isSportId,
  modalityLabel,
  modalityShape,
  reglamento,
  maxMatchesOf,
  sportLabel,
  sportOf,
  type MatchFormat,
  type Modality,
  type SeasonConfig,
  type SideSize,
} from '@/core'
import { Stepper } from '@/app/stepper'
import { button } from '@/app/ui/button'
import {
  GROUP_COUNTS,
  formatoChoice,
  partidoHints,
  rulesErrors,
  rulesHints,
  setsSportOf,
  ventajaHint,
  withFormatoChoice,
  withGroups,
  withVentaja,
  type DisciplineRules,
  type FormatoChoice,
} from './personalizar-reglas-state'

const TITULO_BLOQUE = 'mb-2 text-[17px] font-bold'
const TITULO_FILA = 'text-[16px] font-semibold'
const AYUDA = 'text-pretty text-[14px] leading-snug text-muted'
const FILA = 'flex items-center justify-between gap-3 py-3.5'

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/**
 * Un bloque de la hoja: título + grupo de filas divididas por `line`. El grupo es un `<fieldset>`
 * a propósito: `disabled` traba de una vez todos los botones de adentro (steppers, mosaicos, switch).
 */
function Bloque({ titulo, disabled, children }: { titulo: string; disabled: boolean; children: ReactNode }) {
  const id = useId()
  return (
    <div>
      <h3 id={id} className={TITULO_BLOQUE}>
        {titulo}
      </h3>
      <fieldset disabled={disabled} aria-labelledby={id} className="min-w-0 divide-y divide-line rounded-tile bg-surface px-4">
        {children}
      </fieldset>
    </div>
  )
}

/** Una fila con su consecuencia debajo del título y el control a la derecha. */
function Fila({
  titulo,
  hint,
  stepper,
  fixed,
  children,
}: {
  titulo: string
  hint: string
  /** Marca la fila con su perilla (para el test y el navegador). */
  stepper?: string
  fixed?: string
  children: ReactNode
}) {
  // El título al lado de la perilla y la ayuda abajo, a todo el ancho: al lado de un stepper de
  // 140 px, en 320 px la ayuda quedaba en una columna de ~100 px ("A 4 con / ventaja de / 2: 4-2…").
  return (
    <div data-stepper={stepper} data-fixed={fixed} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-3.5">
      <p className={TITULO_FILA}>{titulo}</p>
      {children}
      <p className={`${AYUDA} col-span-2`}>{hint}</p>
    </div>
  )
}

function FilaStepper(props: {
  stepper: string
  titulo: string
  hint: string
  value: number
  min: number
  max: number
  onChange: (next: number) => void
}) {
  const { value, min, max, onChange, ...fila } = props
  return (
    <Fila {...fila}>
      <Stepper value={value} min={min} max={max} onChange={onChange} />
    </Fila>
  )
}

/**
 * "El partido": un `Stepper` por eje que el deporte deja tocar (`min < max`); lo que la ficha fija
 * (los 11 puntos del ping pong) se muestra en un chip, sin botones. Un deporte de goles, un marcador
 * abierto o un deporte fuera del registro no tienen perillas de partido: el bloque no se dibuja.
 *
 * La usan la hoja "Personalizar reglas" y el armado de una fecha (docs/torneos-deportes.md §7).
 */
export function BloquePartido({
  kind,
  format,
  disabled,
  conVentaja = false,
  onChange,
}: {
  kind: string
  format: MatchFormat
  disabled: boolean
  /**
   * El switch del set real (S6), sólo en los deportes que lo juegan (`setReal`). Lo pone
   * "Personalizar reglas"; el armado de una fecha no, porque la fecha sólo cambia sets y games.
   */
  conVentaja?: boolean
  onChange: (next: MatchFormat) => void
}) {
  const sport = setsSportOf(kind)
  if (sport === null || format.openScore) return null
  const hints = partidoHints(kind, format)
  const ejes = [
    { key: 'setsToWin', titulo: 'Sets para ganar' },
    { key: 'gamesPerSet', titulo: `${cap(sport.unit)} por set` },
  ] as const
  return (
    <Bloque titulo="El partido" disabled={disabled}>
      {ejes.map(({ key, titulo }) => {
        const { min, max } = sport[key]
        return min < max ? (
          <FilaStepper
            key={key}
            stepper={key}
            titulo={titulo}
            hint={hints[key]}
            value={format[key]}
            min={min}
            max={max}
            onChange={(next) => onChange({ ...format, [key]: next })}
          />
        ) : (
          <Fila key={key} fixed={key} titulo={titulo} hint={hints[key]}>
            <span className="flex h-11 min-w-11 shrink-0 items-center justify-center rounded-btn bg-chip px-2.5 font-cond text-[28px] text-muted">
              {format[key]}
            </span>
          </Fila>
        )
      })}
      {conVentaja && sport.setReal && (
        <FilaSwitch
          titulo="Ventaja de 2 y tie-break"
          checked={format.ventaja === true}
          hint={ventajaHint(format)}
          onChange={(ventaja) => onChange(withVentaja(format, ventaja))}
        />
      )}
    </Bloque>
  )
}

/** Un botón de una elección excluyente: el tinte del deporte, lleno con su color al elegirlo (como la tarjeta). */
function Opcion({
  elegido,
  sub,
  onClick,
  children,
}: {
  elegido: boolean
  sub?: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={elegido}
      onClick={onClick}
      className={`min-h-[56px] flex-1 rounded-btn px-1.5 py-2.5 text-center text-[15px] font-bold leading-tight disabled:opacity-40 ${
        elegido ? 'bg-sport text-on-sport' : 'bg-sport-tint text-text dark:shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--color-sport)_40%,transparent)]'
      }`}
    >
      {children}
      {sub !== undefined && (
        <span className={`mt-0.5 block text-[13px] font-medium ${elegido ? '' : 'text-muted'}`}>{sub}</span>
      )}
    </button>
  )
}

const FORMATO_BOTONES: { choice: FormatoChoice; label: string; sub?: string }[] = [
  { choice: 'AUTO', label: 'Automático', sub: 'según cuántos vengan' },
  { choice: 'ROUND_ROBIN', label: 'Todos contra todos' },
  { choice: 'GROUPS_KNOCKOUT', label: 'Grupos + llave' },
]

function ComoSeArma({
  rules,
  hint,
  onChange,
}: {
  rules: DisciplineRules
  hint: string
  onChange: (next: DisciplineRules) => void
}) {
  const tituloId = useId()
  const gruposId = useId()
  const { formatoDefault } = rules
  return (
    <div className="py-3.5">
      <p id={tituloId} className={TITULO_FILA}>
        Cómo se arma
      </p>
      <p className={AYUDA}>{hint}</p>
      <div role="group" aria-labelledby={tituloId} className="mt-3 flex gap-2">
        {FORMATO_BOTONES.map(({ choice, label, sub }) => (
          <Opcion
            key={choice}
            elegido={formatoChoice(formatoDefault) === choice}
            sub={sub}
            onClick={() => onChange(withFormatoChoice(rules, choice))}
          >
            {label}
          </Opcion>
        ))}
      </div>
      {formatoDefault.kind === 'GROUPS_KNOCKOUT' && (
        <>
          <span id={gruposId} className="sr-only">
            Cuántos grupos
          </span>
          <div role="group" aria-labelledby={gruposId} className="mt-2 flex gap-2">
            {GROUP_COUNTS.map((groups) => (
              <Opcion key={groups} elegido={formatoDefault.groups === groups} onClick={() => onChange(withGroups(rules, groups))}>
                {`${groups} grupos`}
              </Opcion>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Un mosaico por puesto de la fecha, con el número en la cara de marcador (como en Reglas); el
 * elegido se edita con el `Stepper` de abajo (0–99).
 */
function PuntosPorPosicion({
  points,
  hint,
  onChange,
}: {
  points: number[]
  hint: string
  onChange: (next: number[]) => void
}) {
  const tituloId = useId()
  const [selected, setSelected] = useState(0)
  const index = Math.min(selected, points.length - 1)
  return (
    <div className="py-3.5">
      <p id={tituloId} className={TITULO_FILA}>
        Puntos por puesto
      </p>
      <p className={AYUDA}>{hint}</p>
      <div role="group" aria-labelledby={tituloId} className="mt-3 grid grid-cols-4 gap-2">
        {points.map((value, i) => (
          <button
            key={i}
            type="button"
            data-tile={i + 1}
            aria-pressed={i === index}
            aria-label={`${i + 1}° puesto: ${value === 1 ? '1 punto' : `${value} puntos`}`}
            onClick={() => setSelected(i)}
            className={`flex min-h-[60px] flex-col items-start justify-center gap-1 rounded-btn px-2.5 disabled:opacity-40 ${
              i === index ? 'bg-sport text-on-sport' : 'bg-sport-tint text-sport dark:shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--color-sport)_40%,transparent)]'
            }`}
          >
            <span className={`text-[13px] font-semibold ${i === index ? '' : 'text-muted'}`}>{`${i + 1}°`}</span>
            <span className="font-cond text-[28px]">{value}</span>
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-[15px] font-semibold">{`Puntos del ${index + 1}° puesto`}</span>
        <Stepper
          value={points[index] ?? 0}
          min={0}
          max={99}
          onChange={(next) => onChange(points.map((value, i) => (i === index ? next : value)))}
        />
      </div>
    </div>
  )
}

function FilaSwitch({
  titulo,
  checked,
  hint,
  onChange,
}: {
  titulo: string
  checked: boolean
  hint: string
  onChange: (next: boolean) => void
}) {
  const id = useId()
  return (
    <div className={FILA}>
      <div className="min-w-0">
        <p id={id} className={TITULO_FILA}>
          {titulo}
        </p>
        <p className={AYUDA}>{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        onClick={() => onChange(!checked)}
        className="flex h-11 w-14 shrink-0 items-center justify-center disabled:opacity-40"
      >
        <span className={`relative h-7 w-12 rounded-full ${checked ? 'bg-sport' : 'bg-line'}`}>
          <span
            className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full transition-transform motion-reduce:transition-none ${
              checked ? 'translate-x-5 bg-on-sport' : 'bg-muted'
            }`}
          />
        </span>
      </button>
    </div>
  )
}

function Aviso({ children }: { children: string }) {
  return <p className="rounded-btn bg-live-bg px-3.5 py-3 text-[15px] font-semibold text-live">{children}</p>
}

/**
 * La hoja "Personalizar reglas" de UN deporte (docs/torneos-deportes.md §5): la MISMA en el wizard
 * y en Ajustes. Controlada: `rules` viene de afuera y cada toque llama `onChange` con las reglas nuevas.
 *
 * Es un `<dialog>` nativo abierto con `showModal()` con la cara de la hoja de abajo de `app/ui`
 * (la clase `.hoja`: sube desde el borde, con su movimiento y el reducido), pero no es `Sheet`:
 * acá tocar el fondo NO cierra (un toque de más tiraría lo tocado) y no se arrastra para cerrar,
 * por lo mismo. El foco, el trap, el fondo inerte y el Escape los pone la plataforma; el foco entra
 * al diálogo y no al primer botón, como en `Sheet`. `onClose` cubre el Escape y "Cerrar", y quien
 * la monta la DESMONTA ahí: se abre sólo al montarse, así que una hoja cerrada que sigue montada no
 * vuelve a abrir.
 *
 * Arriba, fijo, el título con los datos del plantel y "Cerrar"; abajo, fijo y al alcance del
 * pulgar, "Listo". En el medio, los tres bloques y "Así queda", en el color del deporte.
 */
export function PersonalizarReglas({
  kind,
  modality,
  pairSize,
  rules,
  ficha,
  note,
  pending,
  error,
  onChange,
  onDone,
  onClose,
}: {
  kind: string
  modality: Modality
  pairSize: SideSize
  rules: DisciplineRules
  /** "Volver a las reglas de X". `null` = el deporte no tiene ficha: no hay a qué volver. */
  ficha: DisciplineRules | null
  /** Junto a "Listo" (Ajustes pone el aviso de §5). */
  note: string | null
  pending: boolean
  error: string | null
  onChange: (next: DisciplineRules) => void
  onDone: () => void
  onClose: () => void
}) {
  const dialogo = useRef<HTMLDialogElement>(null)
  const tituloId = useId()
  useEffect(() => {
    dialogo.current?.showModal()
    dialogo.current?.focus({ preventScroll: true })
  }, [])

  const { config } = rules
  const hints = rulesHints(kind, rules, pairSize)
  const errors = rulesErrors(rules, pairSize)
  const setConfig = (patch: Partial<SeasonConfig>) => onChange({ ...rules, config: { ...config, ...patch } })
  const lines = reglamento({
    kind,
    pairSize,
    fixedTeams: modalityShape(modality).fixedTeams,
    hasMasters: rules.hasMasters,
    allowsDraw: isSportId(kind) && sportOf(kind).allowsDraw,
    formatoDefault: rules.formatoDefault,
    config,
  }).filter((line) => line.key !== 'modalidad')

  const ranking = rules.formatoDefault.kind === 'RANKING'

  return (
    <dialog
      ref={dialogo}
      role="dialog"
      aria-modal="true"
      aria-labelledby={tituloId}
      tabIndex={-1}
      data-deporte={kind}
      onClose={onClose}
      className="hoja"
    >
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 bg-surface-2 px-4 pt-4 pb-3">
        <div className="min-w-0">
          <h2 id={tituloId} className="font-titulo text-[26px]">
            {`Reglas de ${sportLabel(kind)}`}
          </h2>
          <p className="mt-2 flex flex-wrap gap-2 text-[14px] font-semibold">
            <span className="rounded-full bg-sport-tint px-2.5 py-1 text-sport">{modalityLabel(kind, modality)}</span>
            <span className="rounded-full bg-chip px-2.5 py-1">{`${config.squadSize} jugadores`}</span>
          </p>
        </div>
        <button
          type="button"
          aria-label="Cerrar"
          onClick={onClose}
          className="-mr-1 min-h-[44px] shrink-0 rounded-[12px] px-2 font-semibold text-accent-link"
        >
          Cerrar
        </button>
      </div>

      <div className="flex flex-col gap-6 px-4 pt-2 pb-5">
        <BloquePartido
          kind={kind}
          format={config.matchFormat}
          disabled={pending}
          conVentaja
          onChange={(matchFormat) => setConfig({ matchFormat })}
        />

        <Bloque titulo="La fecha" disabled={pending}>
          {/* Una fecha por ranking (bowling) no tiene partidos: ni formato que
              elegir ni techo de partidos. Lo que queda son los puntos por puesto. */}
          {!ranking && <ComoSeArma rules={rules} hint={hints.formato} onChange={onChange} />}
          <PuntosPorPosicion points={config.points} hint={hints.points} onChange={(points) => setConfig({ points })} />
          {!ranking && (
            <FilaStepper
              stepper="maxMatches"
              titulo="Partidos por fecha"
              hint={hints.maxMatches}
              value={maxMatchesOf(config, pairSize)}
              min={1}
              max={66}
              onChange={(maxMatches) => setConfig({ maxMatches })}
            />
          )}
        </Bloque>

        <Bloque titulo="La temporada" disabled={pending}>
          <FilaStepper
            stepper="regularMatchdays"
            titulo="Fechas"
            hint={hints.regularMatchdays}
            value={config.regularMatchdays}
            min={1}
            max={24}
            onChange={(regularMatchdays) => setConfig({ regularMatchdays })}
          />
          <FilaStepper
            stepper="countBestOf"
            titulo="Cuentan las mejores"
            hint={hints.countBestOf}
            value={config.countBestOf}
            min={1}
            max={Math.max(1, config.regularMatchdays)}
            onChange={(countBestOf) => setConfig({ countBestOf })}
          />
          {pairSize === 2 && (
            <FilaSwitch
              titulo="Masters al final"
              checked={rules.hasMasters}
              hint={hints.masters}
              onChange={(hasMasters) => onChange({ ...rules, hasMasters })}
            />
          )}
          <FilaStepper
            stepper="tiebreakSnapshotEvery"
            titulo="Desempate"
            hint={hints.tiebreak}
            value={config.tiebreakSnapshotEvery}
            min={1}
            max={6}
            onChange={(tiebreakSnapshotEvery) => setConfig({ tiebreakSnapshotEvery })}
          />
        </Bloque>

        <div>
          <h3 className={TITULO_BLOQUE}>Así queda</h3>
          <ul className="flex flex-col gap-2.5">
            {lines.map((line) => (
              <li key={line.key} className="border-l-4 border-sport pl-3 text-pretty text-[16px] leading-snug">
                {line.text}
              </li>
            ))}
          </ul>
        </div>

        {errors.map((message) => (
          <Aviso key={message}>{message}</Aviso>
        ))}
        {error !== null && <Aviso>{error}</Aviso>}
        {note !== null && <p className={AYUDA}>{note}</p>}

        {ficha !== null && (
          <button
            type="button"
            disabled={pending}
            onClick={() => onChange(ficha)}
            className={button('ghost', { full: true })}
          >
            {`Volver a las reglas de ${sportLabel(kind)}`}
          </button>
        )}
      </div>

      <div className="sticky bottom-0 z-10 border-t border-line bg-surface-2 px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
        <button
          type="button"
          disabled={pending || errors.length > 0}
          onClick={onDone}
          className={button('primary', { size: 'lg', full: true })}
        >
          Listo
        </button>
      </div>
    </dialog>
  )
}
