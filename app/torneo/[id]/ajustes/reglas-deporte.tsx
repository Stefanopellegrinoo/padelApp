'use client'

import { useId, useState, useTransition } from 'react'
import {
  fichaSeed,
  isSportId,
  modalityLabel,
  modalityOf,
  reglamento,
  sportLabel,
  type DisciplineId,
  type Modality,
  type SideSize,
} from '@/core'
import { PersonalizarReglas } from '@/app/deporte/personalizar-reglas'
import { rulesFromSeed, type DisciplineRules } from '@/app/deporte/personalizar-reglas-state'
import { offeredModalities } from '@/app/deporte/tarjeta-state'
import { saveDisciplineRules } from './actions'

/** Verdad por el congelado de la fecha: una fecha toma su formato al confirmarse (docs/torneos-deportes.md §7). */
const NOTE = 'Los cambios valen desde la próxima fecha. Las fechas ya jugadas quedan como se jugaron.'

/** "Volver a las reglas de X": la ficha del deporte, sólo si la tiene y ofrece esta modalidad. Nunca abre la hoja: es un toque explícito. */
function fichaOf(kind: string, squadSize: number, modality: Modality): DisciplineRules | null {
  if (!isSportId(kind) || !offeredModalities(kind).includes(modality)) return null
  return rulesFromSeed(fichaSeed(kind, squadSize, modality))
}

/**
 * Las reglas de UN deporte de un torneo ya creado (docs/torneos-deportes.md §5): lo guardado en
 * criollo y la misma hoja "Personalizar reglas" que el wizard para cambiarlo. Reemplaza a los
 * paneles "Formato" y "Formato de las fechas".
 *
 * La hoja abre con `rules`, lo GUARDADO: la ficha no se lee para llenarla (una config guardada
 * nunca se recalcula), sólo para el botón "Volver a las reglas de X". La modalidad no se cambia
 * una vez creado el torneo: es texto.
 *
 * "Listo" sin haber tocado nada sólo cierra. Con cambios manda lo guardado y lo nuevo a
 * `saveDisciplineRules`, que escribe sólo la diferencia: si sale bien la hoja se cierra; si no,
 * sigue abierta con el error.
 *
 * `id="formato"` (el ancla de la fila "Formato" de Ajustes) lo pone el contenedor, no esta tarjeta.
 */
export function ReglasDeporte({
  seasonId,
  disciplineId,
  kind,
  pairSize,
  fixedTeams,
  allowsDraw,
  rules,
}: {
  seasonId: string
  disciplineId: DisciplineId
  kind: string
  pairSize: SideSize
  fixedTeams: boolean
  allowsDraw: boolean
  rules: DisciplineRules
}) {
  const titleId = useId()
  // La hoja está montada mientras haya borrador: se abre al montarse y se desmonta al cerrar.
  const [draft, setDraft] = useState<DisciplineRules | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const modality = modalityOf(pairSize, fixedTeams)

  const lines = reglamento({
    kind,
    pairSize,
    fixedTeams,
    hasMasters: rules.hasMasters,
    allowsDraw,
    formatoDefault: rules.formatoDefault,
    config: rules.config,
  }).filter((line) => line.key !== 'modalidad') // la modalidad ya está arriba, como texto

  const open = () => {
    setError(null)
    setDraft(rules)
  }
  const close = () => {
    setError(null)
    setDraft(null)
  }
  const done = (next: DisciplineRules) => {
    // ponytail: JSON, no una comparación profunda. `next` sale de `rules` por spreads, así que las
    // claves vienen en el mismo orden; si alguna vez no, sólo cuesta un viaje que no escribe nada
    // (`writeDisciplineRules` compara a fondo).
    if (JSON.stringify(next) === JSON.stringify(rules)) return close()
    setError(null)
    startTransition(async () => {
      const result = await saveDisciplineRules(seasonId, disciplineId, rules, next)
      if (result.ok) close()
      else setError(result.error)
    })
  }

  return (
    <section
      data-reglas-deporte={disciplineId}
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4"
    >
      <h2 id={titleId} className="text-[17px] font-extrabold">
        {`Reglas de ${sportLabel(kind)}`}
      </h2>
      <p className="text-[14px] font-extrabold">{`${modalityLabel(kind, modality)} · se elige al crear el torneo`}</p>
      <ul className="flex flex-col gap-2">
        {lines.map((line) => (
          <li key={line.key} className="flex gap-2 text-pretty text-[14px] font-semibold leading-snug">
            <span aria-hidden="true" className="font-extrabold text-up">
              ✓
            </span>
            <span>{line.text}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={open}
        className="min-h-[44px] rounded-field bg-chip p-3 text-center text-[14px] font-extrabold text-text"
      >
        Personalizar reglas
      </button>

      {draft !== null && (
        <PersonalizarReglas
          kind={kind}
          modality={modality}
          pairSize={pairSize}
          rules={draft}
          ficha={fichaOf(kind, rules.config.squadSize, modality)}
          note={NOTE}
          pending={pending}
          error={error}
          onChange={setDraft}
          onDone={() => done(draft)}
          onClose={close}
        />
      )}
    </section>
  )
}
