import type { ReactNode } from 'react'
import Link from 'next/link'
import {
  bestPair,
  partnerRecords,
  tallyPlayers,
  titleStreaks,
  type Award,
  type EntryId,
  type MatchResult,
  type PartnerRecord,
  type PlayedMatchday,
} from '@/core'
import { awardsOf, closedHistoryAll, entriesOf } from '@/db/read'
import { serverClient } from '@/db/server'

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}

/** Antes de esto no hay `awards` suficientes para que ningún bloque diga algo real. */
const MIN_CLOSED_MATCHDAYS_FOR_STATS = 2

type NameOf = Map<EntryId, string>

interface BarRow {
  entryId: EntryId
  pct: number
}

// ── aritmética de pantalla: todo lo que `core/` deja afuera a propósito ─────

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0
}

function formatSigned(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`
}

function effectiveness(record: { won: number; lost: number }): number {
  return pct(record.won, record.won + record.lost)
}

function matchMargin(match: MatchResult): number {
  let gamesA = 0
  let gamesB = 0
  for (const set of match.sets) {
    gamesA += set.gamesA
    gamesB += set.gamesB
  }
  return Math.abs(gamesA - gamesB)
}

/** La fecha cuyos partidos, en promedio, salieron más parejos — no la tabla más ajustada, los marcadores. */
function evenestMatchday(history: readonly PlayedMatchday[]): number | null {
  let best: { number: number; avgMargin: number } | null = null
  for (const matchday of history) {
    const played = matchday.matches.filter((match) => match.sets.length > 0)
    if (played.length === 0) continue
    const avgMargin = played.reduce((sum, match) => sum + matchMargin(match), 0) / played.length
    if (best === null || avgMargin < best.avgMargin) best = { number: matchday.number, avgMargin }
  }
  return best?.number ?? null
}

function pairKey(a: EntryId, b: EntryId): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

/** `partnerRecords` trae cada pareja dos veces (una por lado); acá queda una fila por pareja. */
function dedupePairs(records: PartnerRecord[]): PartnerRecord[] {
  const seen = new Map<string, PartnerRecord>()
  for (const record of records) {
    const key = pairKey(record.entryId, record.partner)
    if (!seen.has(key)) seen.set(key, record)
  }
  return [...seen.values()]
}

/** La fecha donde más puntos sacó ese jugador — "mejor fecha" personal, con lo que ya pagó `awardsOf`. */
function bestMatchdayFor(awardsByMatchday: Map<number, Award[]>, entryId: EntryId): number | null {
  let best: { number: number; points: number } | null = null
  for (const [number, awards] of awardsByMatchday) {
    const mine = awards.find((award) => award.entryId === entryId)
    if (mine === undefined) continue
    if (best === null || mine.points > best.points) best = { number, points: mine.points }
  }
  return best?.number ?? null
}

// ── piezas visuales ──────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-[14px] border border-line bg-surface p-[14px]">
      <p className="text-[9.5px] font-extrabold uppercase tracking-[.13em] text-muted">{label}</p>
      <p className="mt-1 text-[22px] font-extrabold">{value}</p>
    </div>
  )
}

function PlayerLink({ base, entryId, nameOf }: { base: string; entryId: EntryId; nameOf: NameOf }) {
  return (
    <Link href={`${base}/jugador/${entryId}`} className="hover:underline">
      {nameOf.get(entryId) ?? ''}
    </Link>
  )
}

function BarRanking({ title, rows, base, nameOf }: { title: string; rows: BarRow[]; base: string; nameOf: NameOf }) {
  if (rows.length === 0) return null
  return (
    <section className="flex flex-col gap-2.5">
      <p className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">{title}</p>
      <div className="flex flex-col gap-2.5">
        {rows.map((row, index) => (
          <Link key={row.entryId} href={`${base}/jugador/${row.entryId}`} className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[13.5px] font-bold">{nameOf.get(row.entryId) ?? ''}</span>
              <span className="text-[12.5px] font-extrabold text-muted">{row.pct}%</span>
            </div>
            <div className="h-[7px] rounded-full bg-chip">
              <div
                className={`h-full rounded-full ${index === 0 ? 'bg-accent' : 'bg-muted'}`}
                style={{ width: `${row.pct}%` }}
              />
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}

function Duplas({ title, rows, base, nameOf }: { title: string; rows: PartnerRecord[]; base: string; nameOf: NameOf }) {
  if (rows.length === 0) return null
  return (
    <section className="flex flex-col gap-2.5">
      <p className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">{title}</p>
      <div className="rounded-[14px] border border-line bg-surface px-[14px]">
        {rows.map((record) => {
          const eff = effectiveness(record)
          return (
            <div
              key={pairKey(record.entryId, record.partner)}
              className="flex items-center justify-between gap-2 border-b border-line py-2.5 last:border-b-0"
            >
              <div>
                <p className="text-[14px] font-bold">
                  <PlayerLink base={base} entryId={record.entryId} nameOf={nameOf} />
                  {' y '}
                  <PlayerLink base={base} entryId={record.partner} nameOf={nameOf} />
                </p>
                <p className="text-[11.5px] font-semibold text-muted">jugaron {record.together} fechas</p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-extrabold ${
                  eff >= 50 ? 'bg-ok-bg text-up' : 'bg-chip text-muted'
                }`}
              >
                {eff}%
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function InsufficientData({ closedCount }: { closedCount: number }) {
  const missing = MIN_CLOSED_MATCHDAYS_FOR_STATS - closedCount
  return (
    <div className="flex flex-col gap-3 pt-4">
      <h1 className="text-[26px] font-extrabold tracking-[-.03em]">Estadísticas</h1>
      <p className="text-pretty text-[13.5px] leading-[1.5] font-[550] text-muted">
        Todavía no hay estadísticas: hacen falta al menos {MIN_CLOSED_MATCHDAYS_FOR_STATS} fechas cerradas y{' '}
        {closedCount === 0 ? 'todavía no cerró ninguna' : 'sólo cerró 1'}.
      </p>
      <p className="text-pretty text-[13.5px] leading-[1.5] font-[550] text-muted">
        Cuando cierre {missing === 1 ? 'la próxima fecha' : `${missing} fechas más`} vas a ver acá el % de partidos
        ganados de todo el plantel, la mejor dupla del torneo, con quién te va bien, las rachas de títulos y el
        presentismo.
      </p>
    </div>
  )
}

// ── la pantalla ───────────────────────────────────────────────────────────────

/**
 * Estadísticas — sección 10 del handoff. Es la única pantalla que no viene del
 * spec del campeonato, así que el handoff manda más que de costumbre. Todo el
 * conteo sale de `core/playerstats.ts` y `core/streak.ts`; acá sólo se convierte
 * en porcentajes, se ordena para mostrar y se arma el estado sin datos.
 */
export default async function StatsPage({ params, searchParams }: PageProps) {
  const { id: seasonId } = await params
  const { tab } = await searchParams
  const activeTab: 'torneo' | 'mias' = tab === 'mias' ? 'mias' : 'torneo'
  const base = `/torneo/${seasonId}`

  const supabase = await serverClient()

  const [entries, history, awardsByMatchday, myPlayerIdResult] = await Promise.all([
    entriesOf(supabase, seasonId),
    closedHistoryAll(supabase, seasonId),
    awardsOf(supabase, seasonId),
    supabase.rpc('my_player_id'),
  ])

  if (history.length < MIN_CLOSED_MATCHDAYS_FOR_STATS) {
    return <InsufficientData closedCount={history.length} />
  }

  const nameOf: NameOf = new Map(entries.map((entry) => [entry.id, entry.displayName]))
  const squad: EntryId[] = entries.filter((entry) => entry.kind === 'SQUAD').map((entry) => entry.id)
  const squadSet = new Set(squad)

  const myPlayerId = myPlayerIdResult.data ?? null
  const viewerEntryId =
    myPlayerId === null ? null : (entries.find((entry) => entry.playerId === myPlayerId)?.id ?? null)

  // ── Del torneo ──────────────────────────────────────────────────────────
  const totalMatches = history.reduce(
    (sum, matchday) => sum + matchday.matches.filter((match) => match.sets.length > 0).length,
    0,
  )
  const totalGames = history.reduce(
    (sum, matchday) =>
      sum +
      matchday.matches.reduce(
        (matchSum, match) => matchSum + match.sets.reduce((setSum, set) => setSum + set.gamesA + set.gamesB, 0),
        0,
      ),
    0,
  )
  const evenestMatchdayNumber = evenestMatchday(history)

  const tallies = tallyPlayers(history, squad)
  const talliesByEntry = new Map(tallies.map((tally) => [tally.entryId, tally]))
  const squadTallies = tallies.filter((tally) => squadSet.has(tally.entryId))

  const winPctRows: BarRow[] = squadTallies
    .map((tally) => ({ entryId: tally.entryId, pct: pct(tally.matchesWon, tally.matchesPlayed) }))
    .sort((a, b) => b.pct - a.pct)

  const presentismoRows: BarRow[] = squadTallies
    .map((tally) => ({ entryId: tally.entryId, pct: pct(tally.matchdaysPlayed, history.length) }))
    .sort((a, b) => b.pct - a.pct)

  const streaks = titleStreaks(awardsByMatchday, squad)
  const longestStreak = streaks.reduce((top, streak) => (streak.longest > top.longest ? streak : top))

  const best = bestPair(history)
  const restPairs = dedupePairs(partnerRecords(history))
    .filter((record) => best === null || pairKey(record.entryId, record.partner) !== pairKey(best.entryId, best.partner))
    .sort((a, b) => b.together - a.together)
  const duplasRows = best === null ? restPairs : [best, ...restPairs]

  // ── Mías ────────────────────────────────────────────────────────────────
  const myTally = viewerEntryId === null ? undefined : talliesByEntry.get(viewerEntryId)
  const myMatchesPlayed = myTally?.matchesPlayed ?? 0
  const myEffectiveness = myTally === undefined ? 0 : pct(myTally.matchesWon, myTally.matchesPlayed)
  const myNetGames = myTally === undefined ? 0 : myTally.gamesFor - myTally.gamesAgainst
  const myBestMatchday = viewerEntryId === null ? null : bestMatchdayFor(awardsByMatchday, viewerEntryId)

  const myPartners: BarRow[] =
    viewerEntryId === null
      ? []
      : partnerRecords(history)
          .filter((record) => record.entryId === viewerEntryId)
          .map((record) => ({ entryId: record.partner, pct: effectiveness(record) }))
          .sort((a, b) => b.pct - a.pct)

  return (
    <div className="flex flex-col gap-4 pt-4">
      <h1 className="text-[26px] font-extrabold tracking-[-.03em]">Estadísticas</h1>

      <div className="flex gap-2">
        <Link
          href={base + '/stats'}
          className={`rounded-full px-[15px] py-[9px] text-[11.5px] font-extrabold ${
            activeTab === 'torneo' ? 'bg-accent text-accent-text' : 'bg-chip text-muted'
          }`}
        >
          Del torneo
        </Link>
        <Link
          href={base + '/stats?tab=mias'}
          className={`rounded-full px-[15px] py-[9px] text-[11.5px] font-extrabold ${
            activeTab === 'mias' ? 'bg-accent text-accent-text' : 'bg-chip text-muted'
          }`}
        >
          Mías
        </Link>
      </div>

      {activeTab === 'torneo' ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Partidos jugados" value={totalMatches} />
            <StatCard label="Games totales" value={totalGames} />
            <StatCard label="Fecha más pareja" value={evenestMatchdayNumber !== null ? `Fecha ${evenestMatchdayNumber}` : '—'} />
            <StatCard
              label="Racha más larga"
              value={
                <>
                  <PlayerLink base={base} entryId={longestStreak.entryId} nameOf={nameOf} />
                  {` · ${longestStreak.longest}`}
                </>
              }
            />
          </div>

          <BarRanking title="% de partidos ganados" rows={winPctRows} base={base} nameOf={nameOf} />
          <BarRanking title="Presentismo" rows={presentismoRows} base={base} nameOf={nameOf} />
          <Duplas title="Mejor dupla del torneo" rows={duplasRows} base={base} nameOf={nameOf} />
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Partidos" value={myMatchesPlayed} />
            <StatCard label="Efectividad" value={`${myEffectiveness}%`} />
            <StatCard label="Games a favor" value={formatSigned(myNetGames)} />
            <StatCard label="Mejor fecha" value={myBestMatchday !== null ? `Fecha ${myBestMatchday}` : '—'} />
          </div>

          <BarRanking title="Con quién te va bien" rows={myPartners} base={base} nameOf={nameOf} />
        </>
      )}
    </div>
  )
}
