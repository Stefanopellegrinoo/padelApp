'use client'

import { useOptimistic, useState, useTransition } from 'react'
import type { DisciplineId, MatchdayFormat } from '@/core'
import { matchdayFormatLabel } from '@/app/format'
import { saveFormatoDefault } from './actions'

/**
 * Las tres opciones (decisión ya tomada, docs/tipos-de-torneo.md §2.5):
 * `ROUND_ROBIN`, y `GROUPS_KNOCKOUT` con 2 o con 4 grupos.
 * `qualifiersPerGroup` es siempre 2 — mismo valor que exige el CHECK
 * `disciplines_formato_default_kind` (`0074`). `groups: 1` no es una opción
 * acá aunque `matchdays_formato_kind` (0040) lo siga aceptando: ese CHECK
 * lo rechaza a propósito (0074, comentario de la migración) porque
 * `offerableFormats` (`core/knockout.ts:531`) nunca lo ofrece para ningún
 * `sides` — "1 grupo + llave" no ahorra nada sobre un round robin liso.
 */
const OPCIONES: MatchdayFormat[] = [
  { kind: 'ROUND_ROBIN' },
  { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 },
  { kind: 'GROUPS_KNOCKOUT', groups: 4, qualifiersPerGroup: 2 },
]

function esElMismo(a: MatchdayFormat, b: MatchdayFormat): boolean {
  if (a.kind !== b.kind) return false
  return a.kind === 'ROUND_ROBIN' || (b.kind === 'GROUPS_KNOCKOUT' && a.groups === b.groups)
}

/**
 * `key` estable, no atada a la copia: `matchdayFormatLabel(candidato)` es
 * texto para HUMANOS y puede cambiar (mismo motivo por el que
 * `SelectorDeFormato`, `fechas/[n]/armado.tsx`, usa `candidato.groups` como
 * `key` y no el label). `OPCIONES` es una lista fija de tres, así que basta
 * con la identidad estructural del `kind`/`groups`.
 */
function formatoKey(formato: MatchdayFormat): string {
  return formato.kind === 'ROUND_ROBIN' ? 'ROUND_ROBIN' : `GROUPS_${formato.groups}`
}

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
