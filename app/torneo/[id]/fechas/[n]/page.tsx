import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  computeAwards,
  computeStandings,
  previousContext,
  samePair,
  snapshotForMatchday,
  type MatchResult,
  type Pair,
  type PairStanding,
  type SeasonConfig,
} from '@/core'
import { entriesOf, matchdayDetail, matchdaysOf, seasonHeader } from '@/db/read'
import { awardsBefore, closedHistory } from '@/db/season'
import { serverClient } from '@/db/server'
import { EdgeError } from '@/db/errors'
import { matchdayFull } from '@/app/format'
import { Rondas, type RoundMatchVM, type RoundVM } from './rondas'

interface PageProps {
  params: Promise<{ id: string; n: string }>
}

function pairKey(pair: Pair): string {
  return [pair.a, pair.b].sort().join('~')
}

function totalGames(match: MatchResult): [number, number] {
  let a = 0
  let b = 0
  for (const set of match.sets) {
    a += set.gamesA
    b += set.gamesB
  }
  return [a, b]
}

/** Ganador del partido por sets, la misma cuenta que usa `computeStandings`. `null` sin resultado. */
function matchWinner(match: MatchResult): 'A' | 'B' | null {
  if (match.sets.length === 0) return null
  let setsA = 0
  let setsB = 0
  for (const set of match.sets) {
    if (set.gamesA > set.gamesB) setsA++
    else if (set.gamesB > set.gamesA) setsB++
  }
  if (setsA === setsB) return null
  return setsA > setsB ? 'A' : 'B'
}

/**
 * Si la tabla se resolvió por desempate, arma la frase con el criterio real que
 * cortó, mirando `PairStanding` (posición, partidos ganados, diferencia de
 * games) de a pares consecutivos: el patrón del handoff describe exactamente el
 * caso de "empataron en partidos ganados, cortó la diferencia de games".
 */
function tiebreakNote(standings: PairStanding[], config: SeasonConfig, nameOf: Map<string, string>): string | null {
  const label = (pair: Pair) => `${nameOf.get(pair.a) ?? '?'} & ${nameOf.get(pair.b) ?? '?'}`
  const usesSetsDiff = config.matchFormat.setsToWin > 1

  for (let i = 1; i < standings.length; i++) {
    const better = standings[i - 1]
    const worse = standings[i]
    if (better === undefined || worse === undefined) continue
    if (better.won !== worse.won) continue
    if (usesSetsDiff && better.setsDiff !== worse.setsDiff) continue

    if (better.gamesDiff !== worse.gamesDiff) {
      return `${label(worse.pair)} quedaron ${worse.position}° por diferencia de games: empataron en partidos ganados con ${label(better.pair)}.`
    }

    // ponytail: con todo empatado (partidos ganados y diferencia de games) el
    // corte real pasa por el resultado directo o, en un triple empate, por el
    // snapshot — ambos viven adentro de `computeStandings` y no se reexponen.
    // No hay copy contractual para ese caso puntual y no ocurre con el formato
    // a un set por defecto (sin empates posibles); si hiciera falta, se
    // exporta el criterio exacto desde `core/standings.ts`.
    return `${label(worse.pair)} quedaron ${worse.position}° por el desempate de la fecha: empataron en partidos ganados y en diferencia de games con ${label(better.pair)}.`
  }
  return null
}

/**
 * Fecha `[n]` — Task 8, Plan 3. Sólo lectura: dibuja lo que ya pasó (parejas,
 * fixture con los resultados que existan, tabla de la fecha). No arma el
 * wizard de DRAFT, no carga resultados, no cierra ni reabre — todo eso es
 * Plan 4.
 */
export default async function FechaDetailPage({ params }: PageProps) {
  const { id: seasonId, n } = await params
  const matchdayNumber = Number(n)
  const supabase = await serverClient()

  const [header, entries, matchdays] = await Promise.all([
    seasonHeader(supabase, seasonId),
    entriesOf(supabase, seasonId),
    matchdaysOf(supabase, seasonId),
  ])

  const matchday = matchdays.find((candidate) => candidate.number === matchdayNumber)
  if (matchday === undefined) throw new EdgeError('La fecha no existe.')

  const nameOf = new Map(entries.map((entry) => [entry.id, entry.displayName]))
  const pairName = (pair: Pair) => `${nameOf.get(pair.a) ?? '?'} & ${nameOf.get(pair.b) ?? '?'}`

  const kicker =
    matchday.status === 'DRAFT'
      ? 'Armando · sólo vos la ves'
      : matchday.status === 'OPEN'
        ? `En juego${matchday.playedOn !== null ? ` · ${matchdayFull(matchday.playedOn)}` : ''}`
        : `Cerrada${matchday.playedOn !== null ? ` · ${matchdayFull(matchday.playedOn)}` : ''}`

  let body: ReactNode = (
    <div className="rounded-card bg-chip p-4 text-center text-[13px] font-[550] text-muted">
      Se está armando. Todavía no hay parejas ni partidos para mostrar.
    </div>
  )

  if (matchday.status !== 'DRAFT') {
    const status = matchday.status
    const config = header.config
    const seedOrder = entries
      .filter((entry) => entry.kind === 'SQUAD')
      .sort((a, b) => a.seedPosition - b.seedPosition)
      .map((entry) => entry.id)

    const [detail, awardsByMatchday, lastHistory, beforeLastHistory] = await Promise.all([
      matchdayDetail(supabase, matchday.id),
      awardsBefore(supabase, seasonId, matchdayNumber),
      closedHistory(supabase, seasonId, matchdayNumber - 1),
      closedHistory(supabase, seasonId, matchdayNumber - 2),
    ])

    const snapshot = snapshotForMatchday(matchdayNumber, seedOrder, awardsByMatchday, config)
    const standings = computeStandings(detail.pairs, detail.matches, config, snapshot)

    const { defenders, defendersAlreadyRepeated } = previousContext(lastHistory, beforeLastHistory)
    const effectiveDefenders = defenders !== null && !defendersAlreadyRepeated ? defenders : null
    const isDefendingPair = (pair: Pair) => effectiveDefenders !== null && samePair(pair, effectiveDefenders)

    const pointsByEntry =
      status === 'CLOSED'
        ? new Map(computeAwards(standings, config, detail.guestIds).map((award) => [award.entryId, award.points]))
        : new Map<string, number>()

    const roundNumbers = [...new Set(detail.matches.map((match) => match.round))].sort((a, b) => a - b)
    const totalRounds = roundNumbers.length
    const rounds: RoundVM[] = roundNumbers.map((roundNumber) => {
      const roundMatches = detail.matches.filter((match) => match.round === roundNumber)
      const playingKeys = new Set<string>()
      for (const match of roundMatches) {
        playingKeys.add(pairKey(match.pairA))
        playingKeys.add(pairKey(match.pairB))
      }
      const restingPair = detail.pairs.find((pair) => !playingKeys.has(pairKey(pair)))
      const loadedCount = roundMatches.filter((match) => match.sets.length > 0).length

      const matches: RoundMatchVM[] = roundMatches.map((match, index) => {
        const [gamesA, gamesB] = totalGames(match)
        const winner = matchWinner(match)
        return {
          key: `${roundNumber}-${index}`,
          pairAName: pairName(match.pairA),
          pairBName: pairName(match.pairB),
          scoreA: match.sets.length === 0 ? '–' : String(gamesA),
          scoreB: match.sets.length === 0 ? '–' : String(gamesB),
          winner,
        }
      })

      return {
        number: roundNumber,
        totalCount: roundMatches.length,
        loadedCount,
        complete: roundMatches.length > 0 && loadedCount === roundMatches.length,
        restingPairName: restingPair !== undefined ? pairName(restingPair) : null,
        matches,
      }
    })

    const hasGuest = (pair: Pair) => detail.guestIds.includes(pair.a) || detail.guestIds.includes(pair.b)
    const anyGuestInTable = status === 'CLOSED' && standings.some((row) => hasGuest(row.pair))
    const note = status === 'CLOSED' ? tiebreakNote(standings, config, nameOf) : null

    body = (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-1.5">
          {detail.pairs.map((pair) => {
            const defending = isDefendingPair(pair)
            return (
              <span
                key={pairKey(pair)}
                className={`rounded-full px-3 py-1.5 text-[11.5px] font-[750] ${
                  defending ? 'bg-ok-bg text-up' : 'bg-chip text-muted'
                }`}
              >
                {pairName(pair)}
                {defending ? ' · Defensora' : ''}
              </span>
            )
          })}
        </div>

        {totalRounds > 0 && <Rondas rounds={rounds} totalRounds={totalRounds} />}

        <div className="flex flex-col gap-2">
          <p className="text-[15px] font-extrabold tracking-[-.02em]">Tabla de la fecha</p>
          <div className="overflow-hidden rounded-[14px] border border-line">
            <div className="grid grid-cols-[1fr_34px_44px_44px] gap-2 bg-chip px-3 py-2 text-[9.5px] font-extrabold uppercase tracking-[.13em] text-muted">
              <span>Pareja</span>
              <span className="text-right">PG</span>
              <span className="text-right">Dif</span>
              <span className="text-right">Pts</span>
            </div>
            {standings.map((row, index) => {
              const guestInRow = status === 'CLOSED' && hasGuest(row.pair)
              const pts =
                status === 'OPEN'
                  ? '—'
                  : guestInRow
                    ? '0'
                    : String(pointsByEntry.get(row.pair.a) ?? pointsByEntry.get(row.pair.b) ?? 0)
              const diff = row.gamesDiff
              return (
                <div
                  key={pairKey(row.pair)}
                  className={`grid grid-cols-[1fr_34px_44px_44px] items-center gap-2 px-3 py-2 text-[13.5px] ${
                    index > 0 ? 'border-t border-line' : ''
                  }`}
                >
                  <span className="flex items-center gap-1.5 font-bold">
                    {pairName(row.pair)}
                    {guestInRow && (
                      <span className="shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[9px] font-extrabold text-muted">
                        Invitado
                      </span>
                    )}
                  </span>
                  <span className="text-right font-bold text-muted">{row.won}</span>
                  <span className="text-right font-bold text-muted">
                    {diff >= 0 ? '+' : ''}
                    {diff}
                  </span>
                  <span className="text-right text-[17px] font-extrabold">{pts}</span>
                </div>
              )
            })}
          </div>

          {status === 'OPEN' && (
            <p className="text-[12.5px] font-[550] text-muted">
              Se actualiza a medida que se cargan los resultados. Los puntos se reparten al cerrar la fecha.
            </p>
          )}

          {anyGuestInTable && (
            <p className="text-[11.5px] font-[600] text-muted">
              El invitado no suma para el campeonato; su compañero sí.
            </p>
          )}

          {note !== null && <p className="text-[12.5px] font-[550] text-muted">{note}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 pt-3">
      <header className="flex flex-col gap-[3px]">
        <Link href={`/torneo/${seasonId}/fechas`} className="mb-1 text-[12.5px] font-bold text-accent-link">
          ← Volver
        </Link>
        <p className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">{kicker}</p>
        <h1 className="text-[26px] font-extrabold tracking-[-.03em]">Fecha {matchday.number}</h1>
      </header>

      {body}
    </div>
  )
}
