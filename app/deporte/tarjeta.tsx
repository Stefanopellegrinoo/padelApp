'use client'

import { useId, type ReactNode } from 'react'
import { fichaLine, isRankingSport, isSportId, modalityLabel, sportLabel, sportOf, type Modality, type SideSize } from '@/core'
import type { DisciplineRules } from './personalizar-reglas-state'
import { modalityHint, offeredModalities, primeraFechaKey, type PrimeraFecha } from './tarjeta-state'

const PREGUNTA = 'text-[17px] font-bold'
const AYUDA = 'mt-2 text-pretty text-[15px] text-muted'

/**
 * Un botón de una elección excluyente: un bloque en el tinte del deporte que se llena con su color
 * al elegirlo (`data-deporte` de la tarjeta). Con `sub`, una segunda línea más chica que dice qué es.
 */
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
      className={`min-h-[56px] flex-1 rounded-btn px-1.5 py-2.5 text-center text-[15px] font-bold leading-tight ${
        elegido ? 'bg-sport text-on-sport' : 'bg-sport-tint text-text dark:shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--color-sport)_40%,transparent)]'
      }`}
    >
      {children}
      {sub != null && (
        <span className={`mt-0.5 block text-[13px] font-medium ${elegido ? '' : 'text-muted'}`}>{sub}</span>
      )}
    </button>
  )
}

/**
 * La tarjeta de UN deporte en el paso 3 del wizard y en "Agregar un deporte" de Ajustes
 * (docs/torneos-deportes.md §4 y §5): modalidad, primera fecha, la ficha como datos y el link
 * a "Personalizar reglas". Controlada: no guarda nada, cada toque llama a su `on…`.
 *
 * Va en el color de su deporte (`data-deporte`): la franja de arriba con el nombre y las
 * elecciones elegidas. Cada pregunta es una pregunta de verdad, y la elección vigente se explica
 * en una línea debajo de los botones (los botones dicen sólo el nombre: Ajustes los lee así).
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
  // La ficha en datos sueltos: `fichaLine` los junta con "·" para una línea; acá van uno por chip.
  const ficha = fichaLine({
    kind,
    pairSize,
    fixedTeams,
    hasMasters: rules.hasMasters,
    allowsDraw: isSportId(kind) && sportOf(kind).allowsDraw,
    formatoDefault: rules.formatoDefault,
    config: rules.config,
  }).split(' · ')

  return (
    <section data-deporte={kind} aria-labelledby={nombreId} className="overflow-hidden rounded-tile bg-surface">
      <div className="flex min-h-[56px] items-center justify-between gap-3 bg-sport px-4 py-2 text-on-sport">
        <h3 id={nombreId} className="min-w-0 font-titulo text-[26px]">
          {sportLabel(kind)}
        </h3>
        <span className="shrink-0 rounded-full bg-chip px-3 py-1 text-[14px] font-semibold text-text">
          {`${squadSize} jugadores`}
        </span>
      </div>

      <div className="flex flex-col gap-5 px-4 pt-4 pb-2">
        {onModality === null ? (
          <div>
            <p className={PREGUNTA}>{modalityLabel(kind, modality)}</p>
            <p className="text-[15px] text-muted">Se elige al crear el torneo</p>
          </div>
        ) : (
          <div>
            <p id={modalidadId} className={`${PREGUNTA} mb-2`}>
              ¿Cómo juegan?
            </p>
            <div role="group" aria-labelledby={modalidadId} className="flex gap-2">
              {offeredModalities(kind).map((option) => (
                <Opcion key={option} elegido={option === modality} onClick={() => onModality(option)}>
                  {modalityLabel(kind, option)}
                </Opcion>
              ))}
            </div>
            <p className={AYUDA}>{modalityHint(modality)}</p>
          </div>
        )}

        {warning !== null && (
          <p className="rounded-btn bg-live-bg px-3.5 py-3 text-[15px] font-semibold text-live">{warning}</p>
        )}

        {/* Bowling (S4): cada fecha es un ranking por pinos, no hay parejas ni cruces que armar. */}
        {!isRankingSport(kind) && (
          <div>
            <p id={fechaId} className={`${PREGUNTA} mb-2`}>
              ¿Cómo se arma la primera fecha?
            </p>
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
            <p className={AYUDA}>Después, manda la tabla.</p>
          </div>
        )}

        <div>
          <p className={`${PREGUNTA} mb-2`}>Reglas</p>
          <ul className="flex flex-wrap gap-2">
            {ficha.map((dato) => (
              <li key={dato} className="rounded-full bg-chip px-3 py-1.5 text-[15px] font-semibold">
                {dato}
              </li>
            ))}
          </ul>
          <button
            type="button"
            aria-label={`Personalizar reglas de ${sportLabel(kind)}`}
            onClick={onPersonalizar}
            className="mt-1 min-h-[44px] text-left text-[16px] font-extrabold text-sport"
          >
            Personalizar reglas ›
          </button>
        </div>
      </div>
    </section>
  )
}
