import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  MASTERS_SIZE,
  effectiveMatchFormat,
  groupPhaseMatches,
  members,
  resolveDisciplineBySlug,
  sameSide,
  unitOf,
  type Award,
  type MatchResult,
} from '@/core'
import {
  entriesOf,
  matchdayDetail,
  seasonAwardsOf,
  seasonHeader,
  seasonMatchdaysOf,
  type MatchdaySummary,
} from '@/db/read'
import { serverClient } from '@/db/server'
import { matchdayDay } from '@/app/format'
import { Hero } from '@/app/ui/hero'
import { button } from '@/app/ui/button'
import { volverDestination } from '@/app/torneo/[id]/tabla-state'
import { sportsOf } from '@/app/torneo/[id]/nav-state'
import { AbrirFecha } from './abrir'
import { championRecord, sideNames } from './campeon-de-la-fecha'
// Import absoluto, no relativo: `./[n]/masters` sería válido pero ilegible
// cruzando un segmento dinámico (mismo criterio que ya documentaba esta
// pantalla en PR 10, cuando vivía un nivel más arriba).
import { ArmarMasters } from '@/app/torneo/[id]/[disciplina]/fechas/[n]/masters'
import { formatoNotice } from '@/app/torneo/[id]/[disciplina]/fechas/[n]/armado-state'

interface PageProps {
  params: Promise<{ id: string; disciplina: string }>
}

interface ChampionInfo {
  names: string
  record: string
}

export default async function FechasPage({ params }: PageProps) {
  const { id: seasonId, disciplina } = await params
  const supabase = await serverClient()

  const [header, seasonMatchdays] = await Promise.all([
    seasonHeader(supabase, seasonId),
    seasonMatchdaysOf(supabase, seasonId),
  ])

  // Esta pantalla vivía a nivel temporada y
  // contaba fechas de la disciplina por DEFECTO nada más — con 2+
  // disciplinas, mentía ("10 FECHAS · 1 JUGADAS" medido). Mismo patrón de
  // resolución que `fechas/[n]/page.tsx` y la Tabla (`[disciplina]/page.tsx`):
  // slug desconocido, o de otra temporada -> notFound().
  const discipline = resolveDisciplineBySlug(header.disciplines, disciplina)
  if (discipline === undefined) notFound()

  const [entries, awardsByDiscipline] = await Promise.all([
    entriesOf(supabase, seasonId, discipline.id),
    seasonAwardsOf(supabase, seasonMatchdays),
  ])
  const awardsByNumber: Map<number, Award[]> = awardsByDiscipline.get(discipline.id) ?? new Map()

  const nameById = new Map(entries.map((entry) => [entry.id, entry.displayName]))
  // Levantado afuera de `championOf`: es una función ANIDADA y el narrowing
  // del `notFound()` de arriba no la cruza.
  const tournamentFormat = discipline.config.matchFormat
  const sportKind = discipline.kind
  // El Masters no se dibuja como fila: esta pantalla sólo lista fechas REGULAR
  // y muestra el Masters como el bloque bloqueado del final (Task 7, Plan 3).
  const disciplineMatchdays = seasonMatchdays.filter((matchday) => matchday.disciplineId === discipline.id)
  const regularMatchdays = disciplineMatchdays.filter((matchday) => matchday.kind === 'REGULAR')
  const closedMatchdays = regularMatchdays.filter((matchday) => matchday.status === 'CLOSED')
  // A la vez sólo puede haber una fecha regular sin cerrar (constraint de base),
  // así que "la que está en juego" es a lo sumo una.
  const openMatchday = regularMatchdays.find((matchday) => matchday.status === 'OPEN') ?? null
  const mastersMatchday = disciplineMatchdays.find((matchday) => matchday.kind === 'MASTERS') ?? null

  const [closedDetails, openDetail] = await Promise.all([
    Promise.all(closedMatchdays.map((matchday) => matchdayDetail(supabase, matchday.id))),
    openMatchday !== null ? matchdayDetail(supabase, openMatchday.id) : Promise.resolve(null),
  ])
  const detailByMatchdayId = new Map(
    closedMatchdays.map((matchday, index) => [matchday.id, closedDetails[index]]),
  )

  function championOf(matchday: MatchdaySummary): ChampionInfo | null {
    const detail = detailByMatchdayId.get(matchday.id)
    if (detail === undefined) return null

    const championEntryIds = (awardsByNumber.get(matchday.number) ?? [])
      .filter((award) => award.position === 1)
      .map((award) => award.entryId)
    const championSide = detail.sides.find((side) =>
      members(side).some((entryId) => championEntryIds.includes(entryId)),
    )
    if (championSide === undefined) return null

    const names = sideNames(championSide, nameById)
    // A cuánto se jugó ESA fecha (§7), no el formato de hoy del torneo.
    const matchFormat = effectiveMatchFormat(tournamentFormat, matchday.matchFormat)
    return {
      names,
      record: championRecord(
        // W85 (verify-report-pre-contract #4026): `detail.matches` sin
        // filtrar sumaba la llave al récord ("5–0 · +15 goles" acá contra
        // "PG 3 DIF +9" en `/fechas/[n]`, para el MISMO campeón de la MISMA
        // fecha). `groupPhaseMatches` es el mismo criterio que ya usa
        // `standingsFromBracket` (db/matchday.ts) — quien de verdad reparte
        // los puntos — y que `/fechas/[n]` ya aplicaba.
        groupPhaseMatches(detail.matches),
        championSide,
        matchFormat,
        // El `allows_draw` CONGELADO en la fecha, no el de la disciplina de
        // hoy: una fecha vieja se lee con la regla con la que se jugó. Mismo
        // criterio que la tabla del día y que `closeMatchday`.
        matchday.allowsDraw,
        unitOf(sportKind, matchFormat),
      ),
    }
  }

  const remainingForMasters = Math.max(0, discipline.config.regularMatchdays - closedMatchdays.length)

  // El CTA de abrir aparece sólo si soy admin Y no hay ninguna fecha sin cerrar
  // EN ESTA DISCIPLINA. La segunda condición no es cosmética: `matchdays_one_live`
  // (0016_disciplines_matchdays.sql) es un índice único sobre `discipline_id
  // where status <> 'CLOSED'`, así que el insert rebota con un 23505 y
  // `createMatchday` lo traduce a "Ya hay una fecha sin cerrar en esta
  // temporada.". Un botón que siempre falla es peor que no tener botón. Cuenta
  // sobre `disciplineMatchdays` y no sobre las regulares, porque el índice
  // tampoco distingue el Masters.
  const hasLiveMatchday = disciplineMatchdays.some((matchday) => matchday.status !== 'CLOSED')
  // El mismo `coalesce(max(number), 0) + 1` que hace `createMatchday` PARA ESTA
  // disciplina (REQ-D3-2, `number` es único por disciplina): si el botón dice
  // "Abrir fecha 7" y la base crea la 8, la app queda mintiendo.
  const nextNumber = Math.max(0, ...disciplineMatchdays.map((matchday) => matchday.number)) + 1

  // Con 2+ deportes el botón dice de cuál abre la fecha (el mismo nombre que el
  // chip de arriba, numerado si el deporte se repite); con uno, queda como estaba.
  const sportName =
    header.disciplines.length > 1
      ? sportsOf(header.disciplines).find((sport) => sport.slug === disciplina)?.label
      : undefined

  // Lo cargado de la fecha en juego: el dato que importa desde la lista.
  const openLoaded = openDetail === null ? null : openDetail.matches.filter((match) => match.sets.length > 0).length
  const volver = volverDestination(seasonId, header.disciplines.length)
  const firstUnplayed = Array.from({ length: discipline.config.regularMatchdays }, (_, index) => index + 1).find(
    (number) => !regularMatchdays.some((candidate) => candidate.number === number),
  )
  const numero = 'font-cond w-[30px] shrink-0 text-[24px]'

  return (
    <div data-deporte={discipline.kind} className="flex flex-col">
      <Hero
        back={volver}
        kicker={sportName === undefined ? header.name : `${header.name} · ${sportName}`}
        title="Fechas"
        subtitle={`${discipline.config.regularMatchdays} ${discipline.config.regularMatchdays === 1 ? 'fecha' : 'fechas'} · ${closedMatchdays.length} ${closedMatchdays.length === 1 ? 'jugada' : 'jugadas'}`}
        sport={discipline.kind}
      />

      <div className="flex flex-col gap-6 px-4 pt-5 pb-8">
        {header.isAdmin && !hasLiveMatchday && (
          <AbrirFecha seasonId={seasonId} disciplineId={discipline.id} number={nextNumber} sportName={sportName} />
        )}

        {/* Las fechas se crean de a una (docs/estado.md): no se insertan las
            `regularMatchdays` filas al crear la temporada. Esta lista dibuja
            las que faltan a partir de esa config — un número sin fila real en
            `matchdays` sale apagado, sin link a una fecha que todavía no
            existe. Se apaga con `text-muted` (AA) y NO con `opacity`, que daba
            2.18:1 en claro y 3.14 en oscuro. */}
        <ol className="flex flex-col">
          {Array.from({ length: discipline.config.regularMatchdays }, (_, index) => index + 1).map((number) => {
            const matchday = regularMatchdays.find((candidate) => candidate.number === number) ?? null

            if (matchday === null) {
              return (
                <li key={number}>
                  {number === firstUnplayed && (
                    <h2 className="font-titulo px-1 pt-3.5 pb-1 text-[20px]">Por jugar</h2>
                  )}
                  <div className="flex min-h-[56px] items-center gap-3 border-t border-line px-1 text-muted">
                    <span className={numero}>{number}</span>
                    <span className="flex-1 font-semibold">{`Fecha ${number}`}</span>
                  </div>
                </li>
              )
            }

            const played = matchday.status === 'CLOSED'
            const champion = played ? championOf(matchday) : null
            // "1 set a 6 games" cuando se juega distinto que el deporte (§7).
            const effective = effectiveMatchFormat(tournamentFormat, matchday.matchFormat)
            const notice = formatoNotice(matchday.number, effective, tournamentFormat, unitOf(sportKind, effective))
            const day = matchday.playedOn === null ? `Fecha ${matchday.number}` : matchdayDay(matchday.playedOn)
            const href = `/torneo/${seasonId}/${disciplina}/fechas/${matchday.number}`

            // La fecha viva —armándose o en juego— es la única sobre la que hay
            // algo que hacer: va en el bloque del deporte, como en el prototipo.
            if (!played) {
              const estado =
                matchday.status === 'OPEN'
                  ? openLoaded !== null && openDetail !== null && openDetail.matches.length > 0
                    ? `En juego · ${openLoaded} de ${openDetail.matches.length} cargados`
                    : 'En juego'
                  : 'Armando'
              return (
                <li key={matchday.id} className="py-2">
                  <Link
                    href={href}
                    className="press flex min-h-[72px] items-center gap-3 rounded-tile bg-block px-4 py-3 text-on-block [--color-focus:var(--color-on-block)]"
                  >
                    <span className={numero}>{matchday.number}</span>
                    <span className="min-w-0 flex-1">
                      <b className="block text-[17px] font-bold first-letter:uppercase">{day}</b>
                      <span className="block text-[15px] text-on-block-soft">{estado}</span>
                      {notice !== null && <span className="block text-[15px] text-on-block-soft">{notice}</span>}
                    </span>
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-6 w-6 shrink-0 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
                    >
                      <path d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                </li>
              )
            }

            return (
              <li key={matchday.id} className="border-t border-line first:border-t-0">
                <Link href={href} className="press-fila flex min-h-[56px] items-center gap-3 px-1 py-2.5">
                  <span className={numero}>{matchday.number}</span>
                  <span className="min-w-0 flex-1">
                    <b className="block font-semibold first-letter:uppercase">{day}</b>
                    {champion !== null && (
                      <span className="block text-[15px] text-muted">
                        <span className="font-semibold text-text">{champion.names}</span>
                        {` · ${champion.record}`}
                      </span>
                    )}
                    {notice !== null && <span className="block text-[15px] text-muted">{notice}</span>}
                  </span>
                </Link>
              </li>
            )
          })}
        </ol>

        {/* El Masters es UNO POR DISCIPLINA y cada una juega el suyo (C36,
            decisión #4035): la guarda es `hasMasters`, que también cierra W89
            —una disciplina que declaró que NO juega Masters no promete nada ni
            ofrece un CTA que rebota siempre. */}
        {discipline.hasMasters && (
          <section className="rounded-block bg-surface px-5 py-5">
            <p className="text-[15px] font-semibold text-muted">Cierre del año</p>
            <h2 className="font-titulo mt-1 text-[28px]">Masters</h2>
            <p className="mt-2 text-[16px]">
              {`Los ${MASTERS_SIZE} primeros de la tabla, al terminar las ${discipline.config.regularMatchdays} fechas.`}
              {remainingForMasters > 0 && (
                <b className="font-semibold">{` Faltan ${remainingForMasters}.`}</b>
              )}
            </p>

            {/* Cuando ya no falta ninguna fecha regular y soy admin, el chip
                "Bloqueado" deja lugar al CTA. Si el Masters ya existe, lo
                enlaza como cualquier otra fecha. */}
            {mastersMatchday !== null ? (
              <Link
                href={`/torneo/${seasonId}/${disciplina}/fechas/${mastersMatchday.number}`}
                className={`${button('primary', { size: 'lg', full: true })} mt-4`}
              >
                {mastersMatchday.status === 'CLOSED' ? 'Jugado · Ver el Masters' : 'En juego · Ver el Masters'}
              </Link>
            ) : header.isAdmin && remainingForMasters === 0 && !hasLiveMatchday ? (
              <ArmarMasters seasonId={seasonId} disciplineId={discipline.id} />
            ) : (
              <span className="mt-4 inline-block rounded-pill bg-chip px-3 py-1.5 text-[15px] font-semibold text-muted">
                Bloqueado
              </span>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
