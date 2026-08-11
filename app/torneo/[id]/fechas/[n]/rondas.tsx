'use client'

import { useState } from 'react'

export interface RoundMatchVM {
  key: string
  pairAName: string
  pairBName: string
  scoreA: string
  scoreB: string
  /** `null` sin resultado todavía: ninguna de las dos filas se dibuja como ganadora. */
  winner: 'A' | 'B' | null
}

export interface RoundVM {
  number: number
  totalCount: number
  loadedCount: number
  complete: boolean
  matches: RoundMatchVM[]
  /** Nombre de la pareja libre esta ronda (5 parejas), `null` si no aplica. */
  restingPairName: string | null
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

function MatchCard({ match }: { match: RoundMatchVM }) {
  return (
    <div className="rounded-[14px] border border-line bg-surface p-[13px]">
      <MatchRow name={match.pairAName} score={match.scoreA} isWinner={match.winner === 'A'} isLoser={match.winner === 'B'} />
      <MatchRow name={match.pairBName} score={match.scoreB} isWinner={match.winner === 'B'} isLoser={match.winner === 'A'} />
    </div>
  )
}

/**
 * Acordeón de rondas — Task 8, la parte del punto de la tarea. Cada ronda es su
 * propia sección; las que ya cargaron todos los resultados arrancan colapsadas
 * a una fila resumen tocable, las demás arrancan abiertas. Sólo lectura: no hay
 * botón de carga de resultado en ningún lado (eso es Plan 4).
 */
export function Rondas({ rounds, totalRounds }: { rounds: RoundVM[]; totalRounds: number }) {
  const [expanded, setExpanded] = useState<Set<number>>(
    () => new Set(rounds.filter((round) => !round.complete).map((round) => round.number)),
  )

  return (
    <div className="flex flex-col gap-4">
      {rounds.map((round) => {
        const isOpen = expanded.has(round.number)
        return (
          <div key={round.number} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">
                Ronda {round.number} de {totalRounds}
              </p>
              <p className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">
                {round.loadedCount}/{round.totalCount} cargados
              </p>
            </div>

            {isOpen ? (
              <div className="flex flex-col gap-2">
                {round.matches.map((match) => (
                  <MatchCard key={match.key} match={match} />
                ))}
                {round.restingPairName !== null && (
                  <p className="rounded-field bg-chip px-3 py-2 text-[11.5px] font-bold text-muted">
                    Descansa esta ronda: {round.restingPairName}
                  </p>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setExpanded((prev) => new Set(prev).add(round.number))}
                className="flex flex-col gap-1 rounded-[14px] border border-line bg-surface p-[13px] text-left"
              >
                {round.matches.map((match) => (
                  <span key={match.key} className="text-[11.5px] font-[650] text-muted">
                    {match.pairAName} {match.scoreA}–{match.scoreB} {match.pairBName}
                  </span>
                ))}
                {round.restingPairName !== null && (
                  <span className="text-[11.5px] font-[650] text-muted">
                    Descansa esta ronda: {round.restingPairName}
                  </span>
                )}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
