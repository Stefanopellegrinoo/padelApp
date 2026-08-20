'use client'

import { useState, useTransition } from 'react'
import type { Phase } from '@/core'
import { closePhase } from './actions'
import { Carga, type CargaContext } from './carga'

export interface LlaveMatchVM {
  key: string
  /** El id de la fila de `matches`, que es lo que `saveResult` necesita para cargarlo. */
  matchId: string
  fase: Phase
  /** Sólo significa algo en `GRUPO` — `matches_group_only_in_groups` (0039) lo fija en 1 en cualquier otra fase. */
  grupo: number
  sideAName: string
  sideBName: string
  scoreA: string
  scoreB: string
  winner: 'A' | 'B' | null
}

const FASE_LABEL: Record<Phase, string> = {
  GRUPO: 'Fase de grupos',
  OCTAVOS: 'Octavos de final',
  CUARTOS: 'Cuartos de final',
  SEMI: 'Semifinal',
  TERCER_PUESTO: 'Tercer puesto',
  FINAL: 'Final',
}

function sectionTitle(fase: Phase, grupo: number): string {
  return fase === 'GRUPO' ? `Grupo ${grupo}` : FASE_LABEL[fase]
}

function MatchRow({ name, score, isWinner, isLoser }: { name: string; score: string; isWinner: boolean; isLoser: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 py-[3px]">
      <span className={`text-[14.5px] ${isWinner ? 'font-extrabold' : 'font-[650]'} ${isLoser ? 'text-muted' : ''}`}>
        {name}
      </span>
      <span className="min-w-[32px] shrink-0 rounded-[8px] bg-chip px-2 py-1 text-center text-[16px] font-extrabold">
        {score}
      </span>
    </div>
  )
}

function MatchCard({ match, carga }: { match: LlaveMatchVM; carga: CargaContext | null }) {
  return (
    <div className="rounded-[14px] border border-line bg-surface p-[13px]">
      <MatchRow name={match.sideAName} score={match.scoreA} isWinner={match.winner === 'A'} isLoser={match.winner === 'B'} />
      <MatchRow name={match.sideBName} score={match.scoreB} isWinner={match.winner === 'B'} isLoser={match.winner === 'A'} />
      {carga !== null && (
        <Carga context={carga} matchId={match.matchId} pairAName={match.sideAName} pairBName={match.sideBName} />
      )}
    </div>
  )
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
 * sólo se agrupa por sección, preservando ese orden.
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
    <div className="flex flex-col gap-4">
      {phase !== null && (
        <p className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">
          Fase actual: {FASE_LABEL[phase]}
        </p>
      )}

      {sections.map((section) => (
        <div key={section.title} className="flex flex-col gap-2">
          <p className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">{section.title}</p>
          <div className="flex flex-col gap-2">
            {section.matches.map((match) => (
              <MatchCard key={match.key} match={match} carga={carga} />
            ))}
          </div>
        </div>
      ))}

      {canClosePhase && (
        <button
          type="button"
          disabled={pending}
          onClick={cerrarFase}
          className="rounded-field bg-accent p-4 text-center text-[15px] font-extrabold text-accent-text transition-opacity disabled:opacity-45"
        >
          Cerrar fase
        </button>
      )}
      {error !== null && (
        <p className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">{error}</p>
      )}
    </div>
  )
}
