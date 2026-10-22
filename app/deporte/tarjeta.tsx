'use client'

import { useId, type ReactNode } from 'react'
import { fichaLine, isSportId, modalityLabel, sportLabel, sportOf, type Modality, type SideSize } from '@/core'
import type { DisciplineRules } from './personalizar-reglas-state'
import { offeredModalities, primeraFechaKey, type PrimeraFecha } from './tarjeta-state'

const ROTULO = 'text-[12px] font-extrabold uppercase tracking-[.14em] text-muted'

/** Un botón de una elección excluyente, como los de /rapido; con `sub`, una segunda línea más chica. */
function Opcion({
  elegido,
  sub,
  onClick,
  children,
}: {
  elegido: boolean
  sub?: string | null
  onClick: () => void
  children: ReactNode
}) {
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
      {sub != null && <span className="mt-0.5 block text-[12px] font-semibold opacity-80">{sub}</span>}
    </button>
  )
}

/**
 * La tarjeta de UN deporte en el paso 3 del wizard y en "Agregar un deporte" de Ajustes
 * (docs/torneos-deportes.md §4 y §5): modalidad, primera fecha, la ficha en una línea y el link
 * a "Personalizar reglas". Controlada: no guarda nada, cada toque llama a su `on…`.
 *
 * `onModality: null` = la modalidad ya está elegida y no se cambia (Ajustes): se lee como texto.
 */
export function TarjetaDeporte({
  kind,
  squadSize,
  modality,
  onModality,
  primeraFecha,
  primeraFechaOptions,
  onPrimeraFecha,
  rules,
  pairSize,
  fixedTeams,
  warning,
  onPersonalizar,
}: {
  kind: string
  squadSize: number
  modality: Modality
  /** `null`: la modalidad ya está elegida y no se cambia (Ajustes, §5). */
  onModality: ((next: Modality) => void) | null
  primeraFecha: PrimeraFecha
  primeraFechaOptions: readonly { value: PrimeraFecha; label: string; sub: string | null }[]
  onPrimeraFecha: (next: PrimeraFecha) => void
  rules: DisciplineRules
  pairSize: SideSize
  fixedTeams: boolean
  warning: string | null
  onPersonalizar: () => void
}) {
  const nombreId = useId()
  const modalidadId = useId()
  const fechaId = useId()
  const ficha = fichaLine({
    kind,
    pairSize,
    fixedTeams,
    hasMasters: rules.hasMasters,
    allowsDraw: isSportId(kind) && sportOf(kind).allowsDraw,
    formatoDefault: rules.formatoDefault,
    config: rules.config,
  })

  return (
    <section aria-labelledby={nombreId} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 id={nombreId} className="min-w-0 text-[17px] font-extrabold">
          {sportLabel(kind)}
        </h3>
        <span className="shrink-0 rounded-full bg-chip px-2.5 py-1 text-[12px] font-extrabold text-muted">
          {`${squadSize} jugadores`}
        </span>
      </div>

      {onModality === null ? (
        <p className="text-[14px] font-extrabold">{`${modalityLabel(kind, modality)} · se elige al crear el torneo`}</p>
      ) : (
        <>
          <span id={modalidadId} className="sr-only">
            Modalidad
          </span>
          <div role="group" aria-labelledby={modalidadId} className="flex gap-2">
            {offeredModalities(kind).map((option) => (
              <Opcion key={option} elegido={option === modality} onClick={() => onModality(option)}>
                {modalityLabel(kind, option)}
              </Opcion>
            ))}
          </div>
        </>
      )}

      {warning !== null && (
        <p className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">{warning}</p>
      )}

      <div className="flex flex-col gap-1.5">
        <span id={fechaId} className={ROTULO}>
          Primera fecha
        </span>
        {/* Con tres deportes son cuatro opciones, y a 390px no entran en una fila: dos columnas. */}
        <div
          role="group"
          aria-labelledby={fechaId}
          className={primeraFechaOptions.length > 3 ? 'grid grid-cols-2 gap-2' : 'flex gap-2'}
        >
          {primeraFechaOptions.map(({ value, label, sub }) => (
            <Opcion
              key={primeraFechaKey(value)}
              elegido={primeraFechaKey(value) === primeraFechaKey(primeraFecha)}
              sub={sub}
              onClick={() => onPrimeraFecha(value)}
            >
              {label}
            </Opcion>
          ))}
        </div>
      </div>

      <p className="text-pretty text-[12.5px] font-semibold leading-snug text-muted">{ficha}</p>

      <button
        type="button"
        aria-label={`Personalizar reglas de ${sportLabel(kind)}`}
        onClick={onPersonalizar}
        className="-mb-2 min-h-[44px] self-start text-left text-[14px] font-extrabold text-accent-link"
      >
        Personalizar reglas ›
      </button>
    </section>
  )
}
