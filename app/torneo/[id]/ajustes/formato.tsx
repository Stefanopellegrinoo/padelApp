'use client'

import { useState, useTransition } from 'react'
import type { DisciplineId, SeasonConfig, SideSize } from '@/core'
import { steppersFor } from '@/app/torneos/nuevo/wizard-state'
import { saveConfig, saveHasMasters } from './actions'

/**
 * El formato del torneo, con el mismo layout del paso 4 del wizard: los puntos
 * por posición en filas —seis valores no entran a lo ancho de un teléfono— y
 * los cinco steppers debajo.
 *
 * El layout está duplicado a propósito. El plan lo dice: son dos usos, el
 * segundo recién existe ahora, y el disparador para extraer el componente
 * compartido es un tercero o un cambio que haya que hacer en los dos.
 *
 * `steppersFor` sí se importa en vez de copiarse: son los labels, las ayudas,
 * los topes Y cuáles corresponden, y las dos pantallas TIENEN que decir lo
 * mismo. Copiar el criterio en vez de compartirlo es lo que produjo W63.
 *
 * Guarda a cada toque. `updateDisciplineConfig` corre `assertValidConfig`
 * antes de escribir, así que un estado intermedio inválido —bajar las fechas
 * por debajo de las que cuentan, por ejemplo— vuelve como error en línea y no
 * se guarda.
 *
 * Escribe por `disciplineId`, no por `seasonId` (PR 5/6): `disciplines.config`
 * es la fuente real desde que `seasonHeader` dejó de leer `seasons.config`.
 */
export function Formato({
  seasonId,
  disciplineId,
  config,
  pairSize,
  hasMasters,
  disciplineLabel,
}: {
  seasonId: string
  disciplineId: DisciplineId
  config: SeasonConfig
  /** `disciplines.pair_size` real (decisión #4029, parte 3): el guard del check de Masters lo necesita. */
  pairSize: SideSize
  /** `disciplines.has_masters` real (decisión #4029, parte 2). */
  hasMasters: boolean
  /**
   * De qué disciplina es el formato que este panel edita, o `null` cuando el
   * torneo tiene una sola y no hay nada que desambiguar.
   *
   * W65: la fila de arriba nombra el formato de TODAS las disciplinas desde
   * que se cerró W64, y este panel siempre editó la [0]. La fila decía la
   * verdad del torneo y el control no decía cuál era su alcance, que es W64
   * corrido una capa para abajo. No abre camino a la segunda disciplina —eso
   * es superficie nueva, y sigue sin existir—: sólo deja de disfrazarlo.
   */
  disciplineLabel: string | null
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const save = (next: SeasonConfig) => {
    setError(null)
    startTransition(async () => {
      const result = await saveConfig(seasonId, disciplineId, next)
      if (!result.ok) setError(result.error)
    })
  }

  const saveMasters = (next: boolean) => {
    setError(null)
    startTransition(async () => {
      const result = await saveHasMasters(seasonId, disciplineId, next)
      if (!result.ok) setError(result.error)
    })
  }

  const button =
    'h-[44px] w-[44px] shrink-0 rounded-[9px] bg-chip text-[16px] font-extrabold disabled:opacity-40'
  const stepper = (value: number, min: number, max: number, onChange: (next: number) => void) => (
    <div className="flex shrink-0 items-center gap-2">
      <button type="button" className={button} disabled={pending || value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <span className="w-7 text-center text-[16px] font-extrabold">{value}</span>
      <button type="button" className={button} disabled={pending || value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  )

  return (
    // El `id="formato"` (el ancla de la fila de arriba) NO vive acá: con
    // más de una disciplina habría un `id` repetido y HTML inválido. Lo
    // pone el contenedor que mapea las disciplinas, en `ajustes/page.tsx`.
    <section data-formato={disciplineId} className="flex flex-col gap-2">
      {/* Una sola interpolación y no `Formato{sufijo}`: con una sola disciplina
          el título tiene que salir como el mismo nodo de texto de siempre. */}
      <h2 className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">
        {disciplineLabel === null ? 'Formato' : `Formato · ${disciplineLabel}`}
      </h2>

      <div className="overflow-hidden rounded-[14px] border border-line bg-surface">
        {config.points.map((value, index) => (
          <div
            key={index}
            className={`flex h-[56px] items-center justify-between gap-2 px-3 ${index > 0 ? 'border-t border-line' : ''}`}
          >
            <span className="w-7 shrink-0 text-[13px] font-extrabold text-muted">{index + 1}°</span>
            {/* Desde 0: el torneo puede decidir que el último no sume. */}
            {stepper(value, 0, 99, (next) => {
              const points = [...config.points]
              points[index] = next
              save({ ...config, points })
            })}
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-[14px] border border-line bg-surface">
        {/* Cuáles se dibujan lo decide `steppersFor`, no un filtro escrito acá:
            esta pantalla filtraba y el paso 4 del wizard no, y ésa es
            exactamente la grieta por la que una liga de solo FIFA seguía
            leyendo "A 4 games el resultado se carga en dos toques" (W63,
            ). Acá la config es de UNA disciplina, así que
            la lista de formatos tiene un solo elemento. Se van de la pantalla,
            no de la config: el jsonb los sigue teniendo porque `MatchFormat`
            los declara obligatorios. */}
        {steppersFor([config.matchFormat]).map((row, index) => (
          <div
            key={row.key}
            className={`flex min-h-[56px] items-center justify-between gap-2 px-3 py-2 ${index > 0 ? 'border-t border-line' : ''}`}
          >
            <div className="min-w-0">
              <p className="text-[14px] font-bold">{row.label}</p>
              <p className="text-pretty text-[11.5px] font-semibold text-muted">{row.hint}</p>
            </div>
            {stepper(
              row.key === 'setsToWin' || row.key === 'gamesPerSet'
                ? config.matchFormat[row.key]
                : config[row.key],
              row.min,
              row.max,
              (next) =>
                save(
                  row.key === 'setsToWin' || row.key === 'gamesPerSet'
                    ? { ...config, matchFormat: { ...config.matchFormat, [row.key]: next } }
                    : { ...config, [row.key]: next },
                ),
            )}
          </div>
        ))}
      </div>

      {/* Decisión #4029: editable acá (parte 2), pero deshabilitado -- no sólo
          apagado -- en una disciplina de a uno (parte 3). `openMatchday`
          (`db/matchday.ts:985`) rechaza siempre una fecha MASTERS con
          `pair_size=1`; ofrecer el check encendido ahí sería ofrecer algo
          que la app ya rechaza. */}
      <div className="overflow-hidden rounded-[14px] border border-line bg-surface">
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
            checked={hasMasters}
            disabled={pending || pairSize === 1}
            onChange={(event) => saveMasters(event.target.checked)}
            className="h-6 w-6 shrink-0 accent-accent disabled:opacity-40"
          />
        </div>
      </div>

      {error !== null && (
        <p className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">{error}</p>
      )}
    </section>
  )
}
