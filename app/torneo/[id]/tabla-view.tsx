import Link from 'next/link'
import type { ReactNode } from 'react'
import { rankingWithMovement, snapshotForMatchday, sportLabel, type Award, type EntryId } from '@/core'
import type { DisciplineHeader, EntryRow, MatchdaySummary, SeasonHeader } from '@/db/read'
import { CompartirImagen, type FilaImagen } from '@/app/compartir-imagen'
import { matchdayDay } from '@/app/format'
import { Hero } from '@/app/ui/hero'
import { Desempate, type StandingsRow, type TiebreakEntry } from './desempate'
import { sportsOf } from './nav-state'
import { defendersOf, footnoteOf, mastersCutoffFor, pairRows, subtitleOf, volverDestination } from './tabla-state'

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
  /** El asiento del que mira (`myEntryId`): su fila va en amarillo y su puesto arriba. `null` si no juega. */
  myEntryId: EntryId | null
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
  myEntryId,
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
    return {
      entryId: row.entryId,
      displayName: nameOf.get(row.entryId) ?? '',
      position: row.position,
      points: row.points,
      movement: row.movement,
      // Una fecha jugada es un premio cobrado, cuente o se descarte.
      played: row.counted.length + row.discarded.length,
      isMe: row.entryId === myEntryId,
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
  const sportName =
    sportsOf(header.disciplines).find((sport) => sport.slug === disciplina)?.label ?? sportLabel(discipline.kind)
  // Con 2+ deportes "Tabla general" es la global (`page.tsx`): ésta dice de cuál es.
  const manySports = header.disciplines.length > 1
  // Antes de la primera fecha cerrada todos están en 0: un "1°" no dice nada todavía.
  const mine = hasClosedMatchday ? (rows.find((row) => row.isMe) ?? null) : null

  return (
    <div className="flex flex-col">
      <HeroTabla
        back={volver}
        title={header.name}
        subtitle={subtitleOf(sportName, header.status, activeMatchdayNumber, config.regularMatchdays)}
        sport={discipline.kind}
        mine={mine}
        settingsHref={header.isAdmin ? `/torneo/${header.id}/ajustes` : null}
        share={
          hasClosedMatchday
            ? {
                subtitulo: `${manySports ? `Tabla de ${sportName}` : 'Tabla'}, ${closedRegular.length} de ${config.regularMatchdays} fechas jugadas`,
                filas: rows.map((row) => ({ nombre: `${row.position}. ${row.displayName}`, puntos: row.points })),
              }
            : null
        }
      />

      {liveMatchday !== null && (
        <Link
          href={`/torneo/${header.id}/${disciplina}/fechas/${liveMatchday.number}`}
          className="press mx-4 mt-4 flex min-h-[64px] items-center gap-3 rounded-tile bg-sport-tint py-2 pr-3 pl-4"
        >
          <span className="font-cond text-[44px] text-sport">{liveMatchday.number}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold text-sport">
              {liveMatchday.status === 'OPEN' ? 'En juego' : 'Próxima fecha'}
            </span>
            <span className="block text-[17px] font-bold">
              {liveMatchday.playedOn !== null ? matchdayDay(liveMatchday.playedOn) : `Fecha ${liveMatchday.number}`}
            </span>
          </span>
          <Chevron />
        </Link>
      )}

      {defenders !== null && (
        <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-tile bg-surface px-4 py-3">
          <div className="min-w-0">
            <p className="text-[16px] font-bold">{defenders.names.join(' y ')}</p>
            <p className="text-[14px] text-muted">Ganaron la fecha {defenders.matchdayNumber}, les queda 1 defensa</p>
          </div>
          <span className="shrink-0 text-[14px] font-bold text-sport">Repiten</span>
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
        title={manySports ? `Tabla de ${sportName}` : undefined}
        footnote={footnoteOf(discipline.hasMasters, config)}
      />
    </div>
  )
}

function Chevron() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6 shrink-0 fill-none stroke-current stroke-2 text-sport [stroke-linecap:round] [stroke-linejoin:round]">
      <path d="M9 5l7 7-7 7" />
    </svg>
  )
}

/**
 * El encabezado en bloque de las dos tablas (la de un deporte y la general):
 * el `Hero` con tu puesto en amarillo a la derecha, y Compartir y Ajustes
 * arriba a la derecha, a la altura del `Volver`. `Hero` no tiene lugar para
 * acciones, así que van encima, en la esquina. Los círculos son `chip` con
 * tinta: el ícono de `CompartirImagen` toma el color de alrededor, y el
 * blanco del bloque sobre `chip` no se vería.
 */
export function HeroTabla({
  back,
  title,
  subtitle,
  sport,
  mine,
  settingsHref,
  share,
}: {
  back: { href: string; label: string }
  title: string
  subtitle: ReactNode
  sport?: string
  mine: { position: number; points: number } | null
  settingsHref: string | null
  share: { subtitulo: string; filas: readonly FilaImagen[] } | null
}) {
  return (
    <div className="relative">
      <Hero
        back={back}
        title={title}
        subtitle={subtitle}
        sport={sport}
        right={
          mine === null ? undefined : (
            // `pt-4`: el número no sube hasta la fila del `Volver`, donde están
            // Compartir y Ajustes; el bloque baja y queda al pie, con el título.
            <p className="pt-4">
              <span className="sr-only">Vas </span>
              <span className="font-cond block text-[64px] text-vos">
                {mine.position}
                <span className="align-top text-[32px]">°</span>
              </span>
              <span className="text-[14px] text-on-block-soft">{mine.points} pts</span>
            </p>
          )
        }
      />
      {(share !== null || settingsHref !== null) && (
        <div className="absolute top-[calc(2px+env(safe-area-inset-top))] right-4 flex gap-2 text-text [--color-focus:var(--color-on-block)]">
          {share !== null && (
            <CompartirImagen archivo="tabla" titulo={title} subtitulo={share.subtitulo} filas={share.filas} />
          )}
          {settingsHref !== null && (
            <Link
              href={settingsHref}
              aria-label="Ajustes"
              className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-chip"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[20px] w-[20px] fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
