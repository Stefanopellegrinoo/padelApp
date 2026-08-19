'use client'

import { useState, useTransition } from 'react'
import type { DisciplineId, SeasonConfig } from '@/core'
import { STEPPERS } from '@/app/torneos/nuevo/wizard-state'
import { saveConfig } from './actions'

/**
 * El formato del torneo, con el mismo layout del paso 4 del wizard: los puntos
 * por posición en filas —seis valores no entran a lo ancho de un teléfono— y
 * los cinco steppers debajo.
 *
 * El layout está duplicado a propósito. El plan lo dice: son dos usos, el
 * segundo recién existe ahora, y el disparador para extraer el componente
 * compartido es un tercero o un cambio que haya que hacer en los dos.
 *
 * `STEPPERS` sí se importa en vez de copiarse: son los labels, las ayudas y los
 * topes, y las dos pantallas TIENEN que decir lo mismo.
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
}: {
  seasonId: string
  disciplineId: DisciplineId
  config: SeasonConfig
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
    <section id="formato" className="flex flex-col gap-2 scroll-mt-4">
      <h2 className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">Formato</h2>

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
        {/* Con marcador abierto, "Sets por partido" y "Games por set" no
            gobiernan nada: `setError` los ignora y `matchError` no los exige
            (`db/validate.ts`). Dejarlos dibujados es la misma clase de mentira
            que el copy que decía "1 set a 4 games" en una liga de goles — y
            encima uno de los dos se anuncia con "A 4 games el resultado se
            carga en dos toques", que es justo la máquina que esta disciplina
            NO usa. Se van de la pantalla, no de la config: el jsonb los sigue
            teniendo porque `MatchFormat` los declara obligatorios. */}
        {STEPPERS.filter(
          (row) =>
            !config.matchFormat.openScore ||
            (row.key !== 'setsToWin' && row.key !== 'gamesPerSet'),
        ).map((row, index) => (
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

      {error !== null && (
        <p className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">{error}</p>
      )}
    </section>
  )
}
