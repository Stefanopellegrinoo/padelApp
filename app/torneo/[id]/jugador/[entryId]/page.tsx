import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  partnerRecords,
  rankingWithMovement,
  snapshotForMatchday,
  tallyPlayers,
  titleStreaks,
  type Award,
  type EntryId,
} from '@/core'
import { awardsOf, closedHistoryAll, entriesOf, seasonHeader } from '@/db/read'
import { serverClient } from '@/db/server'

interface PageProps {
  params: Promise<{ id: string; entryId: string }>
}

interface MatchdayMark {
  number: number
  status: 'counted' | 'discarded' | 'absent'
  points: number | null
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase()
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : `${value}`
}

/**
 * Marca cada fecha cerrada como contada, descartada o ausencia — sin
 * recalcular la regla de las mejores N. `RankingRow.counted`/`discarded` ya la
 * resolvieron; esto sólo empareja el puntaje de cada fecha contra esos dos
 * arrays (por valor, tipo multiset: un empate exacto en el corte cae en
 * cualquiera de las fechas empatadas, da lo mismo cuál, porque valen lo mismo).
 */
function markMatchdays(
  matchdayNumbers: number[],
  awardsByMatchday: Map<number, Award[]>,
  entryId: EntryId,
  counted: readonly number[],
  discarded: readonly number[],
): MatchdayMark[] {
  const countedPool = [...counted]
  const discardedPool = [...discarded]

  return matchdayNumbers.map((number): MatchdayMark => {
    const award = (awardsByMatchday.get(number) ?? []).find((candidate) => candidate.entryId === entryId)
    if (award === undefined) return { number, status: 'absent', points: null }

    const countedIndex = countedPool.indexOf(award.points)
    if (countedIndex !== -1) {
      countedPool.splice(countedIndex, 1)
      return { number, status: 'counted', points: award.points }
    }
    const discardedIndex = discardedPool.indexOf(award.points)
    if (discardedIndex !== -1) discardedPool.splice(discardedIndex, 1)
    return { number, status: 'discarded', points: award.points }
  })
}

/**
 * Perfil de jugador — handoff §11. Se llega tocando una fila de la Tabla; no
 * está en la nav. No implementa editar el nombre propio (Plan 4): el asiento
 * reclamado, el sin dueño y el propio se ven exactamente igual, porque las
 * estadísticas son del asiento (`entryId`), nunca de quién está logueado.
 */
export default async function JugadorPage({ params }: PageProps) {
  const { id: seasonId, entryId } = await params
  const supabase = await serverClient()

  const [header, entries, history, awardsByMatchday] = await Promise.all([
    seasonHeader(supabase, seasonId),
    entriesOf(supabase, seasonId),
    closedHistoryAll(supabase, seasonId),
    awardsOf(supabase, seasonId),
  ])

  const entry = entries.find((candidate) => candidate.id === entryId)
  if (entry === undefined) notFound()
  if (entry.kind !== 'SQUAD') notFound()

  const squadEntries = entries
    .filter((candidate) => candidate.kind === 'SQUAD')
    .sort((a, b) => a.seedPosition - b.seedPosition)
  const seedOrder: EntryId[] = squadEntries.map((squadEntry) => squadEntry.id)
  const nameById = new Map(entries.map((candidate) => [candidate.id, candidate.displayName]))

  const activeMatchdayNumber = Math.min(history.length + 1, header.regularMatchdays)
  const snapshot = snapshotForMatchday(activeMatchdayNumber, seedOrder, awardsByMatchday, header.config)
  const ranking = rankingWithMovement(awardsByMatchday, seedOrder, header.config, snapshot)
  const row = ranking.find((candidate) => candidate.entryId === entryId)
  if (row === undefined) {
    throw new Error(`unreachable: ${entryId} está en el plantel, computeRanking siempre le arma una fila`)
  }

  const tallies = tallyPlayers(history, seedOrder)
  const tally = tallies.find((candidate) => candidate.entryId === entryId)
  if (tally === undefined) {
    throw new Error(`unreachable: tallyPlayers siembra una fila por cada jugador del plantel`)
  }

  const streaks = titleStreaks(awardsByMatchday, seedOrder)
  const longestStreak = streaks.find((candidate) => candidate.entryId === entryId)?.longest ?? 0

  const fechasGanadas = history.filter((matchday) =>
    (awardsByMatchday.get(matchday.number) ?? []).some(
      (award) => award.entryId === entryId && award.position === 1,
    ),
  ).length

  const efectividad =
    tally.matchesPlayed === 0 ? 0 : Math.round((tally.matchesWon / tally.matchesPlayed) * 100)
  const difGames = tally.gamesFor - tally.gamesAgainst
  const matchesLost = tally.matchesPlayed - tally.matchesWon

  const marks = markMatchdays(
    history.map((matchday) => matchday.number),
    awardsByMatchday,
    entryId,
    row.counted,
    row.discarded,
  )

  const myRecords = partnerRecords(history)
    .filter((record) => record.entryId === entryId)
    .sort((a, b) => b.won - b.lost - (a.won - a.lost) || b.together - a.together)

  return (
    <div className="flex flex-col gap-3 pt-4">
      <div className="flex justify-end">
        <Link
          href={`/torneo/${seasonId}`}
          className="flex h-9 shrink-0 items-center rounded-full bg-chip px-[14px] text-[13px] font-bold"
        >
          ← Volver
        </Link>
      </div>

      <div className="flex items-center gap-3 rounded-card border border-line bg-surface p-4">
        <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-accent text-[19px] font-extrabold text-accent-text">
          {initials(entry.displayName)}
        </span>
        <div>
          <p className="text-[19px] font-extrabold">{entry.displayName}</p>
          <p className="text-[12.5px] font-semibold text-muted">
            {row.position}° de {squadEntries.length} · {row.points} puntos · {tally.matchdaysPlayed} fechas
            jugadas
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-[14px] border border-line bg-surface p-[14px]">
          <p className="text-[9.5px] font-extrabold uppercase tracking-[.13em] text-muted">Efectividad</p>
          <p className="mt-1 text-[20px] font-extrabold">{efectividad}%</p>
        </div>
        <div className="rounded-[14px] border border-line bg-surface p-[14px]">
          <p className="text-[9.5px] font-extrabold uppercase tracking-[.13em] text-muted">Fechas ganadas</p>
          <p className="mt-1 text-[20px] font-extrabold">{fechasGanadas}</p>
        </div>
        <div className="rounded-[14px] border border-line bg-surface p-[14px]">
          <p className="text-[9.5px] font-extrabold uppercase tracking-[.13em] text-muted">Dif. games</p>
          <p className="mt-1 text-[20px] font-extrabold">{formatSigned(difGames)}</p>
        </div>
        <div className="rounded-[14px] border border-line bg-surface p-[14px]">
          <p className="text-[9.5px] font-extrabold uppercase tracking-[.13em] text-muted">Racha</p>
          <p className="mt-1 text-[20px] font-extrabold">{longestStreak}</p>
        </div>
        <div className="rounded-[14px] border border-line bg-surface p-[14px]">
          <p className="text-[9.5px] font-extrabold uppercase tracking-[.13em] text-muted">Partidos</p>
          <p className="mt-1 text-[20px] font-extrabold">
            {tally.matchesWon}-{matchesLost}
          </p>
        </div>
      </div>

      {marks.length > 0 && (
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${marks.length}, 1fr)` }}>
          {marks.map((mark) => (
            <div key={mark.number} className="flex flex-col items-center gap-1">
              <div
                className={`flex h-[38px] w-full items-center justify-center rounded-[9px] text-[13px] font-extrabold ${
                  mark.status === 'counted'
                    ? 'bg-accent text-accent-text'
                    : mark.status === 'discarded'
                      ? 'bg-chip text-muted'
                      : 'bg-chip text-muted opacity-50'
                }`}
              >
                {mark.points ?? '–'}
              </div>
              <p className="text-[9.5px] font-bold text-muted">F{mark.number}</p>
            </div>
          ))}
        </div>
      )}

      {myRecords.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[15px] font-extrabold tracking-[-.02em]">Con quién le va mejor</p>
          <div className="flex flex-col">
            {myRecords.map((record) => {
              const positive = record.won - record.lost > 0
              return (
                <div key={record.partner} className="flex items-center gap-3 p-2">
                  <span className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full bg-chip text-[10px] font-extrabold text-muted">
                    {initials(nameById.get(record.partner) ?? '')}
                  </span>
                  <span className="flex-1 text-[14px] font-bold">{nameById.get(record.partner) ?? ''}</span>
                  <span className={`text-[12.5px] font-extrabold ${positive ? 'text-up' : 'text-muted'}`}>
                    {record.won}-{record.lost}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
