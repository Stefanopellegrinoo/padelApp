import Link from 'next/link'
import { MASTERS_SIZE, rankingWithMovement, snapshotForMatchday, type Award, type EntryId } from '@/core'
import type { DisciplineHeader, EntryRow, MatchdaySummary, SeasonHeader } from '@/db/read'
import { initials, matchdayDay } from '@/app/format'
import { Desempate, type StandingsRow, type TiebreakEntry } from './desempate'
import { defendersOf } from './tabla-state'
import { Volver } from './volver'

interface TablaViewProps {
  header: SeasonHeader
  discipline: DisciplineHeader
  entries: EntryRow[]
  matchdays: MatchdaySummary[]
  awardsByMatchday: Map<number, Award[]>
}

/**
 * La Tabla de una disciplina — shaping + presentación, extraída de
 * `page.tsx` (PR12b, slice 1/2 de REQ-D9) para que `[disciplina]/page.tsx`
 * la reuse tal cual. La raíz de la temporada (`page.tsx`) TODAVÍA no la
 * importa a propósito — sigue con su propia copia, apuntando a la disciplina
 * por defecto — porque slice 2 la reemplaza por la tabla global; ahí sí pasa
 * a usar (una variante de) este mismo componente, cerrando la duplicación
 * temporal entre las dos rutas.
 *
 * Recibe `discipline`, no `header.disciplines[0]`: `header.regularMatchdays`
 * es SIEMPRE el de la disciplina primaria (`db/read.ts: toSeasonHeader`), y
 * para una disciplina no-primaria (Fase 2 en adelante) sería el número
 * equivocado. `discipline.config.regularMatchdays` es la fuente correcta
 * para cualquiera de las dos.
 */
export function TablaView({ header, discipline, entries, matchdays, awardsByMatchday }: TablaViewProps) {
  const config = discipline.config

  const squadEntries = entries
    .filter((entry) => entry.kind === 'SQUAD')
    .sort((a, b) => a.seedPosition - b.seedPosition)
  const nameOf = new Map(squadEntries.map((entry) => [entry.id, entry.displayName]))
  const seedOrder: EntryId[] = squadEntries.map((entry) => entry.id)

  const regularMatchdays = matchdays.filter((matchday) => matchday.kind === 'REGULAR')
  const closedRegular = regularMatchdays.filter((matchday) => matchday.status === 'CLOSED')
  const activeMatchdayNumber = Math.min(closedRegular.length + 1, config.regularMatchdays)
  const estado = header.status === 'FINISHED' ? 'terminado' : header.status === 'SETUP' ? null : 'en curso'

  const snapshot = snapshotForMatchday(activeMatchdayNumber, seedOrder, awardsByMatchday, config)
  const ranking = rankingWithMovement(awardsByMatchday, seedOrder, config, snapshot)

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

  const liveMatchday = regularMatchdays.find((matchday) => matchday.status !== 'CLOSED') ?? null

  // La derivación vive en `tabla-state.ts`, con
  // test propio, y ahora recibe `pairSize` — de a uno no hay defensores, y
  // esta pantalla los anunciaba igual sobre un jugador solo.
  const defenders = defendersOf(
    closedRegular.map((matchday) => ({
      number: matchday.number,
      awards: awardsByMatchday.get(matchday.number) ?? [],
    })),
    nameOf,
    discipline.pairSize,
  )

  return (
    <div className="flex flex-col gap-3 pt-4">
      {/* Esta Tabla es por-disciplina, no la
          raíz — "volver" tiene que subir a la tabla global del torneo
          (`/torneo/{id}`), la única otra pantalla donde enciende la misma
          pestaña "Tabla" (`nav.tsx`). Antes apuntaba a "Mis torneos",
          heredado de cuando ESTA vista era la raíz. */}
      <Volver href={`/torneo/${header.id}`} label="Tabla general" />
      <header className="flex items-start justify-between">
        <div>
          {estado !== null && (
            <p className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">
              Fecha {activeMatchdayNumber} de {config.regularMatchdays} · {estado}
            </p>
          )}
          <h1 className="text-[26px] font-extrabold tracking-[-.03em]">{header.name}</h1>
        </div>
        {header.isAdmin && (
          <Link
            href={`/torneo/${header.id}/ajustes`}
            aria-label="Ajustes"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-chip text-[18px]"
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
            {liveMatchday.playedOn !== null ? ` · ${matchdayDay(liveMatchday.playedOn)}` : ''}
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
        seasonId={header.id}
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
