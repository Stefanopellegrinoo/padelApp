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
import { Reglamento } from '@/app/torneo/[id]/reglas/reglamento-vista'
import { button } from '@/app/ui/button'
import { saveDisciplineRules } from './actions'

/** Verdad por el congelado de la fecha: una fecha toma su formato al confirmarse (docs/torneos-deportes.md §7). */
const NOTE = 'Los cambios valen desde la próxima fecha. Las fechas ya jugadas quedan como se jugaron.'

/**
 * "Volver a las reglas de X": la ficha del deporte, sólo si la tiene y ofrece esta modalidad. Nunca abre la hoja: es un toque explícito.
 * La primera fecha queda la GUARDADA (la hoja no la muestra, y ya se jugó): sin `firstFecha` guardada, no se inventa.
 */
function fichaOf(kind: string, saved: DisciplineRules['config'], modality: Modality): DisciplineRules | null {
  if (!isSportId(kind) || !offeredModalities(kind).includes(modality)) return null
  const ficha = rulesFromSeed(fichaSeed(kind, saved.squadSize, modality))
  const { firstFecha: _ficha, ...config } = ficha.config
  return {
    ...ficha,
    config: saved.firstFecha === undefined ? config : { ...config, firstFecha: saved.firstFecha },
  }
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
 * Es una sección de la pantalla (título y márgenes de `Section`), no una tarjeta adentro de otra:
 * el reglamento se dibuja igual que en Reglas (`Reglamento`), con el borde del color del deporte
 * (`data-deporte`). Abajo, "Cambiar el formato con fechas ya jugadas no recalcula la tabla vieja":
 * es la ayuda que hace falta antes de tocar "Personalizar reglas".
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
    <section data-reglas-deporte={disciplineId} data-deporte={kind} aria-labelledby={titleId} className="px-4 pt-5">
      <h2 id={titleId} className="font-titulo text-[26px]">
        {`Reglas de ${sportLabel(kind)}`}
      </h2>
      <p className="mt-2 mb-4 text-[16px]">
        <span className="font-bold">{modalityLabel(kind, modality)}</span>
        <span className="block text-[14px] text-muted">La modalidad se elige al crear el torneo</span>
      </p>
      <Reglamento lines={lines} points={rules.config.points} />
      <button type="button" onClick={open} className={`${button('secondary', { full: true })} mt-5`}>
        Personalizar reglas
      </button>
      <p className="mt-2 text-[14px] text-muted">Cambiar el formato con fechas ya jugadas no recalcula la tabla vieja</p>

      {draft !== null && (
        <PersonalizarReglas
          kind={kind}
          modality={modality}
          pairSize={pairSize}
          rules={draft}
          ficha={fichaOf(kind, rules.config, modality)}
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
