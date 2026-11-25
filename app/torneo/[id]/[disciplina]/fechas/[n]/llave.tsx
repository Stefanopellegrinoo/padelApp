'use client'

import { useState, useTransition } from 'react'
import type { Phase } from '@/core'
import { button } from '@/app/ui/button'
import { closePhase } from './actions'
import { CargaDeLaFecha, TarjetaPartido, type CargaContext, type PartidoVM } from './carga'
import { FASE_LABEL, sectionTitle } from './secciones'

export interface LlaveMatchVM extends PartidoVM {
  fase: Phase
  /** Sólo significa algo en `GRUPO` — `matches_group_only_in_groups` (0039) lo fija en 1 en cualquier otra fase. */
  grupo: number
}

/**
 * La fase y la llave de una fecha `GROUPS_KNOCKOUT` (REQ-D8-1, decisión
 * #3979). Reemplaza a `Rondas` mientras la fecha está en juego: `Rondas`
 * agrupa por `round`, y en una llave `round` vuelve a empezar en cada grupo Y
 * en cada fase (`matchupsAfterKnockout`/`matchupsAfterGroups` siempre
 * insertan `round: 1`) — agruparía la final, el tercer puesto y la primera
 * ronda de cada grupo bajo el mismo título "Ronda 1".
 *
 * `matches` ya viene ordenado por `(fase, grupo, round)` desde `page.tsx`: acá
 * sólo se agrupa por sección, preservando ese orden. La carga es la misma
 * hoja que en `Rondas` (`CargaDeLaFecha`).
 */
export function Llave({
  seasonId,
  matchdayId,
  matchdayNumber,
  phase,
  matches,
  canClosePhase,
  carga,
}: {
  seasonId: string
  matchdayId: string
  matchdayNumber: number
  phase: Phase | null
  matches: LlaveMatchVM[]
  /** `phaseIsComplete` sobre la fase actual, ya sin `FINAL` (ahí se cierra la fecha entera, no se avanza de fase) y ya filtrado por admin. */
  canClosePhase: boolean
  carga: CargaContext | null
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const sections: { title: string; matches: LlaveMatchVM[] }[] = []
  const sectionByKey = new Map<string, { title: string; matches: LlaveMatchVM[] }>()
  for (const match of matches) {
    const key = `${match.fase}-${match.grupo}`
    let section = sectionByKey.get(key)
    if (section === undefined) {
      section = { title: sectionTitle(match.fase, match.grupo), matches: [] }
      sectionByKey.set(key, section)
      sections.push(section)
    }
    section.matches.push(match)
  }

  const cerrarFase = () => {
    setError(null)
    startTransition(async () => {
      const result = await closePhase(seasonId, matchdayId, matchdayNumber)
      if (!result.ok) setError(result.error)
    })
  }

  return (
    <CargaDeLaFecha context={carga} partidos={matches}>
      <div className="flex flex-col gap-5">
        {phase !== null && (
          <p className="text-[15px] font-semibold text-sport">{`Fase actual: ${FASE_LABEL[phase]}`}</p>
        )}

        {sections.map((section) => (
          <section key={section.title} className="flex flex-col gap-2.5">
            <h2 className="font-titulo text-[24px]">{section.title}</h2>
            {section.matches.map((match) => (
              <TarjetaPartido key={match.key} partido={match} />
            ))}
          </section>
        ))}

        {canClosePhase && (
          <button
            type="button"
            disabled={pending}
            onClick={cerrarFase}
            className={button('primary', { size: 'lg', full: true })}
          >
            Cerrar fase
          </button>
        )}
        {error !== null && (
          <p role="alert" className="rounded-btn bg-live-bg px-3 py-2.5 text-[15px] font-semibold text-live">
            {error}
          </p>
        )}
      </div>
    </CargaDeLaFecha>
  )
}
