import Link from 'next/link'
import { rankingWithMovement, snapshotForMatchday, type Award, type EntryId } from '@/core'
import type { DisciplineHeader, EntryRow, MatchdaySummary, SeasonHeader } from '@/db/read'
import { initials, matchdayDay } from '@/app/format'
import { Desempate, type StandingsRow, type TiebreakEntry } from './desempate'
import { sportsOf } from './nav-state'
import { defendersOf, mastersCutoffFor, pairRows, volverDestination } from './tabla-state'
import { Volver } from './volver'

interface TablaViewProps {
  header: SeasonHeader
  discipline: DisciplineHeader
  /** El slug de `discipline` tal como llegó en la URL (ya validado por `resolveDisciplineBySlug` en el caller) — arma los links a `jugador/{entryId}` de `Desempate` sin recalcularlo. */
  disciplina: string
  entries: EntryRow[]
  matchdays: MatchdaySummary[]
  awardsByMatchday: Map<number, Award[]>
  /**
   * Las parejas armadas de un deporte de parejas fijas (`teamsOf`): con alguna,
   * la tabla va por pareja. `[]` sin parejas fijas — la tabla queda por persona,
   * y el desempate (`tiebreakOrder`) va por persona en los dos casos.
   */
  teams: readonly { a: EntryId; b: EntryId }[]
  /** `disciplines.fixed_teams`: con parejas fijas el sorteo no tiene defensores (`pairingContextFor`). */
  fixedTeams: boolean
}

/**
 * La Tabla de una disciplina — shaping + presentación, extraída de
 * `page.tsx` (PR12b, slice 1/2 de REQ-D9); sólo la usa `[disciplina]/page.tsx`.
 * La raíz de la temporada (`page.tsx`) es la tabla global desde slice 2 y no
 * la importa: suma todas las disciplinas con `computeGlobalRanking`.
 *
 * Recibe `discipline`, no `header.disciplines[0]`: `header.regularMatchdays`
 * es SIEMPRE el de la disciplina primaria (`db/read.ts: toSeasonHeader`), y
 * para una disciplina no-primaria (Fase 2 en adelante) sería el número
 * equivocado. `discipline.config.regularMatchdays` es la fuente correcta
 * para cualquiera de las dos.
 */
export function TablaView({
  header,
  discipline,
  disciplina,
  entries,
  matchdays,
  awardsByMatchday,
  teams,
  fixedTeams,
}: TablaViewProps) {
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

  const personRows: StandingsRow[] = ranking.map((row, index) => {
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

  const paired = teams.length > 0 ? pairRows(personRows, teams) : null
  const rows = paired === null ? personRows : paired.rows

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
  const defenders = fixedTeams
    ? null
    : defendersOf(
        closedRegular.map((matchday) => ({
          number: matchday.number,
          awards: awardsByMatchday.get(matchday.number) ?? [],
        })),
        nameOf,
        discipline.pairSize,
      )

  // La derivación vive en `tabla-state.ts` (mismo patrón que `defenders`
  // arriba), con test propio.
  const volver = volverDestination(header.id, header.disciplines.length)
  // Con 2+ deportes "Tabla general" es la global (`page.tsx`): ésta dice de cuál es.
  const sportName =
    header.disciplines.length > 1
      ? sportsOf(header.disciplines).find((sport) => sport.slug === disciplina)?.label
      : undefined

  return (
    <div className="flex flex-col gap-3 pt-4">
      <Volver href={volver.href} label={volver.label} />
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
        base={`/torneo/${header.id}/${disciplina}`}
        rows={rows}
        mastersCutoff={mastersCutoffFor(discipline.hasMasters, rows.length, paired?.mastersAfter)}
        tiebreakOrder={tiebreakOrder}
        tiebreakSnapshotEvery={config.tiebreakSnapshotEvery}
        asOfMatchday={asOfMatchday}
        nextRefreshMatchday={nextRefreshMatchday}
        title={sportName === undefined ? undefined : `Tabla de ${sportName}`}
      />
    </div>
  )
}
