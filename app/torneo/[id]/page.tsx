import Link from 'next/link'
import { MASTERS_SIZE, rankingWithMovement, snapshotForMatchday, type EntryId } from '@/core'
import { awardsOf, entriesOf, matchdaysOf, seasonHeader } from '@/db/read'
import { seasonConfig } from '@/db/season'
import { serverClient } from '@/db/server'
import { Desempate, type StandingsRow, type TiebreakEntry } from './desempate'

interface PageProps {
  params: Promise<{ id: string }>
}

const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const MONTHS = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
]

/** `playedOn` es una fecha (`date`, sin hora) guardada `YYYY-MM-DD`: se arma en UTC para no correrse un día según el huso del servidor. */
function formatMatchdayDay(playedOn: string): string {
  const [year, month, day] = playedOn.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) return playedOn
  const date = new Date(Date.UTC(year, month - 1, day))
  return `${WEEKDAYS[date.getUTCDay()] ?? ''} ${day} ${MONTHS[month - 1] ?? ''}`
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase()
}

/**
 * Tabla — home del torneo. Sección 7 del handoff.
 *
 * "Próxima fecha" y "Campeones defensores" se dibujan sólo cuando hay datos
 * reales que mostrar: sin fechas creadas (torneo recién armado) ninguna de
 * las dos aparece, que es exactamente el estado "tabla en cero, sin
 * defensores" que pide la tarea.
 */
export default async function TablaPage({ params }: PageProps) {
  const { id: seasonId } = await params
  const supabase = await serverClient()

  const [header, entries, matchdays, awardsByMatchday, config] = await Promise.all([
    seasonHeader(supabase, seasonId),
    entriesOf(supabase, seasonId),
    matchdaysOf(supabase, seasonId),
    awardsOf(supabase, seasonId),
    seasonConfig(supabase, seasonId),
  ])

  const squadEntries = entries
    .filter((entry) => entry.kind === 'SQUAD')
    .sort((a, b) => a.seedPosition - b.seedPosition)
  const nameOf = new Map(squadEntries.map((entry) => [entry.id, entry.displayName]))
  const seedOrder: EntryId[] = squadEntries.map((entry) => entry.id)

  const regularMatchdays = matchdays.filter((matchday) => matchday.kind === 'REGULAR')
  const closedRegular = regularMatchdays.filter((matchday) => matchday.status === 'CLOSED')
  const activeMatchdayNumber = Math.min(closedRegular.length + 1, header.regularMatchdays)
  // SETUP: la temporada existe pero nadie abrió su primera fecha todavía
  // (0005_matchday_moves.sql: "la temporada arranca cuando se abre su primera
  // fecha"). El prototipo nunca mockeó ese estado —la lista de chips de
  // estado del README (línea 42) no trae una Tabla vacía— así que no hay copy
  // contractual para él: `estado` queda en `null` y el kicker no se dibuja,
  // el mismo criterio que esta pantalla ya usa con "Próxima fecha" y
  // "Campeones defensores".
  const estado = header.status === 'FINISHED' ? 'terminado' : header.status === 'SETUP' ? null : 'en curso'

  const snapshot = snapshotForMatchday(activeMatchdayNumber, seedOrder, awardsByMatchday, config)
  const ranking = rankingWithMovement(awardsByMatchday, seedOrder, config, snapshot)

  // Antes de cerrar la primera fecha todos están en cero: es un empate que no
  // dice nada, así que el chip ⓘ no tiene sentido hasta que haya una fecha jugada.
  const hasClosedMatchday = closedRegular.length > 0

  const rows: StandingsRow[] = ranking.map((row, index) => {
    const previous = ranking[index - 1]
    const next = ranking[index + 1]
    const tiedWithEntryId =
      previous !== undefined && previous.points === row.points
        ? previous.entryId
        : (next !== undefined && next.points === row.points ? next.entryId : null)
    const displayName = nameOf.get(row.entryId) ?? ''
    return {
      entryId: row.entryId,
      displayName,
      initials: initials(displayName),
      position: row.position,
      points: row.points,
      movement: row.movement,
      tiedWithEntryId: hasClosedMatchday ? tiedWithEntryId : null,
    }
  })

  const tiebreakOrder: TiebreakEntry[] = snapshot.map((entryId) => ({
    entryId,
    displayName: nameOf.get(entryId) ?? '',
  }))

  const refreshes = Math.floor((activeMatchdayNumber - 1) / config.tiebreakSnapshotEvery)
  const asOfMatchday = refreshes === 0 ? null : refreshes * config.tiebreakSnapshotEvery
  const nextRefreshMatchday = (refreshes + 1) * config.tiebreakSnapshotEvery

  // Sólo puede haber una fecha regular sin cerrar a la vez (constraint de base):
  // esa es "la próxima fecha", tanto si todavía se está armando (DRAFT) como
  // si ya se está jugando (OPEN).
  const liveMatchday = regularMatchdays.find((matchday) => matchday.status !== 'CLOSED') ?? null

  const sortedClosed = [...closedRegular].sort((a, b) => b.number - a.number)
  const last = sortedClosed[0]
  const beforeLast = sortedClosed[1]
  const lastWinnerIds =
    last !== undefined
      ? (awardsByMatchday.get(last.number) ?? [])
          .filter((award) => award.position === 1)
          .map((award) => award.entryId)
      : []
  const beforeLastWinnerIds = new Set(
    beforeLast !== undefined
      ? (awardsByMatchday.get(beforeLast.number) ?? [])
          .filter((award) => award.position === 1)
          .map((award) => award.entryId)
      : [],
  )
  // Ganaron dos fechas seguidas los mismos dos jugadores: ya jugaron sus 2
  // fechas como pareja defensora (spec 2.5, tope de una defensa) y en la
  // próxima se separan sí o sí. No hay copy contractual para "0 defensas", así
  // que directamente no se muestra la tarjeta.
  const alreadyRepeated =
    lastWinnerIds.length > 0 &&
    lastWinnerIds.length === beforeLastWinnerIds.size &&
    lastWinnerIds.every((entryId) => beforeLastWinnerIds.has(entryId))

  const defenders =
    last !== undefined && lastWinnerIds.length > 0 && !alreadyRepeated
      ? { matchdayNumber: last.number, names: lastWinnerIds.map((entryId) => nameOf.get(entryId) ?? '') }
      : null

  return (
    <div className="flex flex-col gap-3 pt-4">
      <header className="flex items-start justify-between">
        <div>
          {estado !== null && (
            <p className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">
              Fecha {activeMatchdayNumber} de {header.regularMatchdays} · {estado}
            </p>
          )}
          <h1 className="text-[26px] font-extrabold tracking-[-.03em]">{header.name}</h1>
        </div>
        {header.isAdmin && (
          <Link
            href={`/torneo/${seasonId}/ajustes`}
            aria-label="Ajustes"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-chip text-lg"
          >
            ⚙
          </Link>
        )}
      </header>

      {liveMatchday !== null && (
        <div className="rounded-card bg-accent p-4 text-accent-text">
          <p className="text-[10.5px] font-extrabold uppercase tracking-[.14em] opacity-75">
            Próxima fecha
          </p>
          <p className="text-[21px] font-extrabold">
            Fecha {liveMatchday.number}
            {liveMatchday.playedOn !== null ? ` · ${formatMatchdayDay(liveMatchday.playedOn)}` : ''}
          </p>
        </div>
      )}

      {defenders !== null && (
        <div className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-4">
          <div>
            <p className="text-[15px] font-extrabold">{defenders.names.join(' y ')}</p>
            <p className="text-[12px] font-[550] text-muted">
              Ganaron la fecha {defenders.matchdayNumber} · les queda 1 defensa
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-ok-bg px-2.5 py-1 text-[10.5px] font-extrabold text-up">
            Repiten
          </span>
        </div>
      )}

      <Desempate
        seasonId={seasonId}
        rows={rows}
        mastersCutoff={MASTERS_SIZE}
        tiebreakOrder={tiebreakOrder}
        tiebreakSnapshotEvery={config.tiebreakSnapshotEvery}
        asOfMatchday={asOfMatchday}
        nextRefreshMatchday={nextRefreshMatchday}
      />
    </div>
  )
}
