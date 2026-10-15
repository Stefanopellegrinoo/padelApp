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
import {
  GROUP_COUNTS,
  formatoChoice,
  partidoHints,
  rulesErrors,
  rulesHints,
  setsSportOf,
  withFormatoChoice,
  withGroups,
  type DisciplineRules,
  type FormatoChoice,
} from './personalizar-reglas-state'

const ROTULO = 'text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted'
const TITULO_FILA = 'text-[15px] font-extrabold'
const AYUDA = 'text-pretty text-[12.5px] font-semibold leading-snug text-muted'
const FILA = 'flex items-center justify-between gap-3 py-3'

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/**
 * Un bloque de la hoja: rótulo + tarjeta de filas con `border-t`. La tarjeta es un `<fieldset>`
 * a propósito: `disabled` traba de una vez todos los botones de adentro (steppers, mosaicos, switch).
 */
function Bloque({ titulo, disabled, children }: { titulo: string; disabled: boolean; children: ReactNode }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <h3 id={id} className={ROTULO}>
        {titulo}
      </h3>
      <fieldset
        disabled={disabled}
        aria-labelledby={id}
        className="min-w-0 divide-y divide-line rounded-card border border-line bg-surface px-4"
      >
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
  return (
    <div data-stepper={stepper} data-fixed={fixed} className={FILA}>
      <div className="min-w-0">
        <p className={TITULO_FILA}>{titulo}</p>
        <p className={AYUDA}>{hint}</p>
      </div>
      {children}
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
  onChange,
}: {
  kind: string
  format: MatchFormat
  disabled: boolean
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
            <span className="flex h-9 min-w-11 shrink-0 items-center justify-center rounded-[9px] bg-chip px-2.5 text-[14px] font-extrabold text-muted">
              {format[key]}
            </span>
          </Fila>
        )
      })}
    </Bloque>
  )
}

/** Un botón de una elección excluyente, como los de /rapido. */
function Opcion({ elegido, onClick, children }: { elegido: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={elegido}
      onClick={onClick}
      className={`min-h-[44px] flex-1 rounded-field px-1.5 py-3 text-center text-[14px] font-extrabold leading-tight ${
        elegido ? 'bg-accent text-accent-text' : 'bg-chip text-text'
      }`}
    >
      {children}
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
    <div className="py-3">
      <p id={tituloId} className={TITULO_FILA}>
        Cómo se arma
      </p>
      <p className={AYUDA}>{hint}</p>
      <div role="group" aria-labelledby={tituloId} className="mt-3 flex gap-2">
        {FORMATO_BOTONES.map(({ choice, label, sub }) => (
          <Opcion
            key={choice}
            elegido={formatoChoice(formatoDefault) === choice}
            onClick={() => onChange(withFormatoChoice(rules, choice))}
          >
            {label}
            {sub !== undefined && <span className="mt-0.5 block text-[11px] font-semibold opacity-80">{sub}</span>}
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

/** Un mosaico por puesto de la fecha; el elegido se edita con el `Stepper` de abajo (0–99). */
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
    <div className="py-3">
      <p id={tituloId} className={TITULO_FILA}>
        Puntos por posición
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
            className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-field border-2 bg-bg ${
              i === index ? 'border-accent' : 'border-line'
            }`}
          >
            <span className="text-[20px] font-extrabold leading-none tracking-[-.02em]">{value}</span>
            <span className="text-[11px] font-bold text-muted">{`${i + 1}°`}</span>
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-[13.5px] font-bold">{`Puntos del ${index + 1}° puesto`}</span>
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

function FilaMasters({ checked, hint, onChange }: { checked: boolean; hint: string; onChange: (next: boolean) => void }) {
  const id = useId()
  return (
    <div className={FILA}>
      <div className="min-w-0">
        <p id={id} className={TITULO_FILA}>
          Masters al final
        </p>
        <p className={AYUDA}>{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        onClick={() => onChange(!checked)}
        className="flex h-11 w-14 shrink-0 items-center justify-center"
      >
        <span className={`relative h-7 w-12 rounded-full ${checked ? 'bg-accent' : 'bg-chip'}`}>
          <span
            className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full transition-transform motion-reduce:transition-none ${
              checked ? 'translate-x-5 bg-accent-text' : 'bg-muted'
            }`}
          />
        </span>
      </button>
    </div>
  )
}

function Aviso({ children }: { children: string }) {
  return <p className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">{children}</p>
}

/**
 * La hoja "Personalizar reglas" de UN deporte (docs/torneos-deportes.md §5): la MISMA en el wizard
 * y en Ajustes. Controlada: `rules` viene de afuera y cada toque llama `onChange` con las reglas nuevas.
 *
 * Es un `<dialog>` nativo abierto con `showModal()` (como `ConfirmarNuevo` de /rapido): el foco, el
 * trap, el fondo inerte y el Escape los pone la plataforma. `onClose` cubre el Escape, la cruz y
 * tocar el fondo, y quien la monta la DESMONTA ahí: se abre sólo al montarse, así que una hoja
 * cerrada que sigue montada no vuelve a abrir.
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

  return (
    <dialog
      ref={dialogo}
      role="dialog"
      aria-modal="true"
      aria-labelledby={tituloId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      className="m-0 mt-auto w-full max-w-none border-0 bg-transparent p-0 text-text backdrop:bg-scrim sm:m-auto sm:max-w-lg"
    >
      <div className="max-h-[92dvh] overflow-y-auto rounded-t-card bg-bg sm:rounded-card">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 bg-bg px-5 pb-3 pt-5">
          <div className="min-w-0">
            <h2 id={tituloId} className="text-[22px] font-extrabold tracking-[-.02em]">
              {`Reglas de ${sportLabel(kind)}`}
            </h2>
            <p className="text-[13.5px] font-semibold text-muted">
              {`${modalityLabel(kind, modality)} · ${config.squadSize} jugadores`}
            </p>
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-chip text-[20px] font-extrabold"
          >
            ×
          </button>
        </div>

        <div className="flex flex-col gap-4 px-5 pb-6">
          <BloquePartido
            kind={kind}
            format={config.matchFormat}
            disabled={pending}
            onChange={(matchFormat) => setConfig({ matchFormat })}
          />

          <Bloque titulo="La fecha" disabled={pending}>
            <ComoSeArma rules={rules} hint={hints.formato} onChange={onChange} />
            <PuntosPorPosicion points={config.points} hint={hints.points} onChange={(points) => setConfig({ points })} />
            <FilaStepper
              stepper="maxMatches"
              titulo="Partidos por fecha"
              hint={hints.maxMatches}
              value={maxMatchesOf(config, pairSize)}
              min={1}
              max={66}
              onChange={(maxMatches) => setConfig({ maxMatches })}
            />
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
              <FilaMasters
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

          <p className="text-pretty rounded-card bg-surface p-4 text-[14px] font-semibold leading-snug">
            <span className="font-extrabold">Así queda:</span>{' '}
            {lines.map((line) => (
              <span key={line.key}>{line.text} </span>
            ))}
          </p>

          {errors.map((message) => (
            <Aviso key={message}>{message}</Aviso>
          ))}
          {error !== null && <Aviso>{error}</Aviso>}
          {note !== null && <p className={AYUDA}>{note}</p>}

          <div className="flex flex-col gap-1">
            <button
              type="button"
              disabled={pending || errors.length > 0}
              onClick={onDone}
              className="min-h-[44px] rounded-field bg-accent p-3.5 text-center text-[14.5px] font-extrabold text-accent-text disabled:opacity-40"
            >
              Listo
            </button>
            {ficha !== null && (
              <button
                type="button"
                disabled={pending}
                onClick={() => onChange(ficha)}
                className="min-h-[44px] text-center text-[14px] font-extrabold text-accent-link disabled:opacity-40"
              >
                {`Volver a las reglas de ${sportLabel(kind)}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </dialog>
  )
}
