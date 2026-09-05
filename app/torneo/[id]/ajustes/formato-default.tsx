'use client'

import { useOptimistic, useState, useTransition } from 'react'
import type { DisciplineId, MatchdayFormat } from '@/core'
import { matchdayFormatLabel } from '@/app/format'
import {
  FORMATO_DEFAULT_OPTIONS as OPCIONES,
  formatoDefaultKey as formatoKey,
  isSameFormatoDefault as esElMismo,
} from '@/app/torneos/nuevo/wizard-state'
import { saveFormatoDefault } from './actions'

// Las tres opciones, la comparación por kind+groups y el key estable viven
// en `wizard-state.ts` (Fix round 1 de la Task 5, docs/plan-arquitectura-de-
// paginas.md): esta pantalla y el paso 4 del wizard tienen que ofrecer
// EXACTAMENTE las mismas -- es un CRITERIO (cuáles opciones son legales,
// respaldado por `disciplines_formato_default_kind`, 0074), no un layout, y
// copiar el criterio en vez de compartirlo es lo que ya produjo W63 una vez
// (`steppersFor`, `formato.tsx`). Los alias (`OPCIONES`/`formatoKey`/
// `esElMismo`) son sólo para no tocar el resto de este archivo.

/**
 * El formato con el que nace cada fecha nueva de esta disciplina (§2.5): un
 * default en `disciplines.formato_default`, del que `createMatchday`
 * (`db/matchday.ts`) hereda al crear. La fecha lo sigue pudiendo pisar
 * después, en su propio armado (`setMatchdayFormat` no cambia).
 *
 * NO filtra por ofrecible: `offerableFormats(sides, maxMatches)`
 * (`core/knockout.ts:528`) necesita `sides` -- cuántos lados confirman
 * asistencia -- y ese dato no existe a nivel disciplina, sólo a nivel
 * fecha. El filtro real sigue viviendo en `setMatchdayFormat`
 * (`db/matchday.ts:337`), que rechaza un valor no ofrecible nombrando la
 * cantidad de lados. Por eso la nota de abajo, en vez de un menú recortado.
 *
 * `matchdayFormatLabel` (`app/format.ts`) se importa y no se copia -- son
 * las mismas palabras que ya usa `SelectorDeFormato`
 * (`fechas/[n]/armado.tsx`) para el mismo `MatchdayFormat.kind`, y las dos
 * pantallas TIENEN que decir lo mismo (mismo criterio que `steppersFor` en
 * `formato.tsx`, docblock de esa función).
 *
 * `data-formato-default={disciplineId}` en la `<section>`, mismo patrón que
 * `data-formato={disciplineId}` en `Formato` (`ajustes/formato.tsx`): es lo
 * que le permite a `cableado-de-formato.unit.test.ts` cortar el HTML de la
 * página entera en un panel por disciplina y comprobar que cada uno lee la
 * SUYA -- C36 corrido acá.
 *
 * `useOptimistic` (mismo patrón que `armado.tsx`, `tickAttendance`): el
 * `<input type="radio">` está controlado por `checked`, y a diferencia de
 * `SelectorDeFormato`/`Formato` (que usan `<button>`, sin estado propio que
 * pelear) un radio SÍ tiene estado propio del navegador -- sin esto, tocar
 * una opción hacía que el radio saltara al toque y volviera solo a la
 * opción vieja hasta que el RSC recargara con el resultado real.
 */
export function FormatoDefault({
  seasonId,
  disciplineId,
  formatoDefault,
  disciplineLabel,
}: {
  seasonId: string
  disciplineId: DisciplineId
  formatoDefault: MatchdayFormat
  /** `null` con una sola disciplina -- mismo contrato que `Formato.disciplineLabel`/`Reglas.disciplineLabel`. */
  disciplineLabel: string | null
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [optimisticFormato, setOptimisticFormato] = useOptimistic(
    formatoDefault,
    (_current: MatchdayFormat, next: MatchdayFormat) => next,
  )

  const save = (next: MatchdayFormat) => {
    setError(null)
    startTransition(async () => {
      setOptimisticFormato(next)
      const result = await saveFormatoDefault(seasonId, disciplineId, next)
      if (!result.ok) setError(result.error)
    })
  }

  const title = disciplineLabel === null ? 'Formato de las fechas' : `Formato de las fechas · ${disciplineLabel}`
  const legendId = `formato-default-legend-${disciplineId}`

  return (
    <section data-formato-default={disciplineId} className="flex flex-col gap-2">
      <h2 id={legendId} className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">
        {title}
      </h2>

      {/* `aria-labelledby` en vez de un `<legend>` propio: el `<h2>` de
          arriba YA es el nombre visible de este grupo, y un `<legend>`
          repitiendo el mismo texto lo duplicaría para quien lee con mouse.
          Sin esto el `<fieldset>` no tenía nombre accesible -- mismo hueco
          que `SelectorDeFormato` (`armado.tsx`) ya cerró con
          `role="radiogroup" aria-label="Formato de la fecha"` (S81/W77). */}
      <fieldset aria-labelledby={legendId} className="flex flex-col gap-2">
        {OPCIONES.map((candidato) => (
          <label
            key={formatoKey(candidato)}
            className="flex min-h-[44px] items-center gap-2.5 rounded-field border border-line p-2.5 text-[13.5px] font-[700]"
          >
            <input
              type="radio"
              name={`formato-default-${disciplineId}`}
              disabled={pending}
              checked={esElMismo(optimisticFormato, candidato)}
              onChange={() => save(candidato)}
              className="h-5 w-5 shrink-0 accent-accent"
            />
            {matchdayFormatLabel(candidato)}
          </label>
        ))}
      </fieldset>

      <p className="text-[11.5px] font-[600] text-muted">
        Cada fecha nueva nace con este formato. Si el día no da la cantidad de lados que hace falta, se puede
        elegir otro al armar esa fecha.
      </p>

      {error !== null && (
        <p className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">{error}</p>
      )}
    </section>
  )
}
