import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  MASTERS_SIZE,
  groupPhaseMatches,
  members,
  resolveDisciplineBySlug,
  sameSide,
  type Award,
  type MatchResult,
  type Side,
} from '@/core'
import {
  entriesOf,
  matchdayDetail,
  primaryDiscipline,
  seasonAwardsOf,
  seasonHeader,
  seasonMatchdaysOf,
  type MatchdaySummary,
} from '@/db/read'
import { serverClient } from '@/db/server'
import { matchdayDay } from '@/app/format'
import { AbrirFecha } from './abrir'
import { championRecord, sideNames } from './campeon-de-la-fecha'
// Import absoluto, no relativo: `./[n]/masters` sería válido pero ilegible
// cruzando un segmento dinámico (mismo criterio que ya documentaba esta
// pantalla en PR 10, cuando vivía un nivel más arriba).
import { ArmarMasters } from '@/app/torneo/[id]/[disciplina]/fechas/[n]/masters'

interface PageProps {
  params: Promise<{ id: string; disciplina: string }>
}

interface ChampionInfo {
  names: string
  record: string
}

/**
 * Clave estable de un lado, de uno o de dos: el orden de los miembros no
 * importa. N30: esta pantalla usaba
 * `members(side).join('-')` (sin ordenar, otro separador) mientras
 * `fechas/[n]/page.tsx` usaba la versión ordenada — la misma pregunta
 * contestada de dos formas a 200 líneas de distancia.
 */
function sideKey(side: Side): string {
  return [...members(side)].sort().join('~')
}

export default async function FechasPage({ params }: PageProps) {
  const { id: seasonId, disciplina } = await params
  const supabase = await serverClient()

  const [header, seasonMatchdays] = await Promise.all([
    seasonHeader(supabase, seasonId),
    seasonMatchdaysOf(supabase, seasonId),
  ])

  //Esta pantalla vivía a nivel temporada y
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
  const matchFormat = discipline.config.matchFormat
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
  //Disciplina (REQ-D3-2, `number` es único por disciplina): si el botón dice
  // "Abrir fecha 7" y la base crea la 8, la app queda mintiendo.
  const nextNumber = Math.max(0, ...disciplineMatchdays.map((matchday) => matchday.number)) + 1

  return (
    <div className="flex flex-col gap-3 pt-3">
      {header.isAdmin && !hasLiveMatchday && (
        <AbrirFecha seasonId={seasonId} disciplineId={discipline.id} number={nextNumber} />
      )}

      <header className="flex flex-col gap-[3px]">
        <p className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">
          {discipline.config.regularMatchdays} fechas · {closedMatchdays.length} jugadas
        </p>
        <h1 className="text-[26px] font-extrabold tracking-[-.03em]">Fechas</h1>
      </header>

      <div className="flex flex-col gap-3">
        {/* Las fechas se crean de a una (docs/estado.md): no se insertan las
            `regularMatchdays` filas al crear la temporada. Esta lista dibuja
            las que faltan a partir de esa config — un número sin fila real en
            `matchdays` sale como "Por jugarse", dimmed, sin link a una fecha
            que todavía no existe. */}
        {Array.from({ length: discipline.config.regularMatchdays }, (_, index) => index + 1).map((number) => {
          const matchday = regularMatchdays.find((candidate) => candidate.number === number) ?? null

          if (matchday === null) {
            return (
              <div
                key={number}
                className="block rounded-[14px] border border-line bg-surface p-[14px] opacity-[0.62]"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">
                    Fecha {number}
                  </p>
                  <span className="shrink-0 rounded-full px-[10px] py-[6px] text-[10.5px] font-extrabold text-muted">
                    Por jugarse
                  </span>
                </div>
              </div>
            )
          }

          const played = matchday.status === 'CLOSED'
          const inProgress = matchday.status === 'OPEN'
          const champion = played ? championOf(matchday) : null

          // La fecha viva —armándose o en juego— es la única sobre la que hay
          // algo que hacer, así que va en `accent`, que es el fondo de bloque
          // del handoff. Antes la de armado salía con `opacity: .62`: la que
          // había que tocar era la más apagada de la lista, y después de abrir
          // una fecha el CTA de arriba desaparece, así que no quedaba UN solo
          // elemento en acento y no se sabía a dónde ir.
          const live = !played
          // `ok-bg`/`up` y no `live-bg`/`live`: en el handoff `live` es el color de
          // error —borde de input inválido, bloques que impiden continuar, cerrar
          // sesión— y una fecha jugándose no es un problema. El par afirmativo es el
          // que usan todos los chips activos del diseño: "Repiten", "Viene",
          // "Defensora", "Sos vos".
          const tagClass = live
            ? 'bg-accent-text text-accent'
            : played
              ? 'bg-chip text-muted'
              : 'text-muted'
          const tagLabel = played ? 'Jugada' : inProgress ? 'En juego' : 'Armando'

          return (
            <Link
              key={matchday.id}
              href={`/torneo/${seasonId}/${disciplina}/fechas/${matchday.number}`}
              className={`block rounded-[14px] p-[14px] ${
                live ? 'bg-accent text-accent-text' : 'border border-line bg-surface'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p
                  className={`text-[10.5px] font-extrabold uppercase tracking-[.14em] ${
                    live ? 'opacity-75' : 'text-muted'
                  }`}
                >
                  Fecha {matchday.number}
                  {matchday.playedOn !== null ? ` · ${matchdayDay(matchday.playedOn)}` : ''}
                </p>
                <span className={`shrink-0 rounded-full px-[10px] py-[6px] text-[10.5px] font-extrabold ${tagClass}`}>
                  {tagLabel}
                </span>
              </div>

              {champion !== null && (
                <div className="mt-2 flex flex-col gap-1">
                  <p className="text-[15px] font-extrabold">{champion.names}</p>
                  <p className="text-[11.5px] font-bold text-muted">{champion.record}</p>
                </div>
              )}

              {inProgress && openDetail !== null && (
                <div className="mt-2 flex flex-col gap-1">
                  {openDetail.sides.map((side) => (
                    <p key={sideKey(side)} className="text-[13.5px] font-bold">
                      {sideNames(side, nameById)}
                    </p>
                  ))}
                </div>
              )}
            </Link>
          )
        })}
      </div>

      {/* El Masters es UNO por temporada (`create_masters`, 0021, resuelve
          `order by position, created_at limit 1` del lado de la base — no
          recibe qué disciplina lo pidió) y hoy sólo se puede crear en la
          disciplina [0]. Antes de PR13c ninguna otra disciplina llegaba a
          `remainingForMasters === 0` (C12 lo impedía). Mostrar el bloque en
          una disciplina no-primary invitaría a un CTA que crea el Masters en
          la disciplina EQUIVOCADA sin decirlo. Volver esto multi-disciplina
          es de Fase 4 (D7); acá se lo deja fuera con esta guarda. */}
      {discipline.id === primaryDiscipline(header).id && (
        <div className="rounded-[18px] border-[1.5px] border-dashed border-line bg-surface px-[18px] py-5">
          <p className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">Cierre del año</p>
          <h2 className="mt-1 text-[24px] font-extrabold">Masters</h2>
          <p className="mt-2 text-[13.5px] font-medium leading-[1.5]">
            Se juega con los {MASTERS_SIZE} primeros de la tabla al terminar las{' '}
            {discipline.config.regularMatchdays} fechas. Faltan {remainingForMasters}.
          </p>

          {/* Lo único que cambia del bloque: cuando ya no falta ninguna fecha
              regular y soy admin, el chip "Bloqueado" deja lugar al CTA. Si el
              Masters ya existe, la fila lo enlaza como cualquier otra fecha. */}
          {mastersMatchday !== null ? (
            <Link
              href={`/torneo/${seasonId}/${disciplina}/fechas/${mastersMatchday.number}`}
              className="mt-3 inline-block rounded-full bg-ok-bg px-[10px] py-[6px] text-[10.5px] font-extrabold text-up"
            >
              {mastersMatchday.status === 'CLOSED' ? 'Jugado' : 'En juego'}
            </Link>
          ) : header.isAdmin && remainingForMasters === 0 && !hasLiveMatchday ? (
            <ArmarMasters seasonId={seasonId} />
          ) : (
            <span className="mt-3 inline-block rounded-full bg-chip px-[10px] py-[6px] text-[10.5px] font-extrabold text-muted">
              Bloqueado
            </span>
          )}
        </div>
      )}
    </div>
  )
}
