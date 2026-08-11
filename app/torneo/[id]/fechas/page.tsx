import Link from 'next/link'
import { MASTERS_SIZE, samePair, type MatchResult, type Pair } from '@/core'
import {
  awardsOf,
  entriesOf,
  matchdayDetail,
  matchdaysOf,
  seasonHeader,
  type MatchdaySummary,
} from '@/db/read'
import { serverClient } from '@/db/server'

interface PageProps {
  params: Promise<{ id: string }>
}

interface ChampionInfo {
  names: string
  record: string
}

/**
 * "jue 13 ago", sin punto tras el día de semana ni el mes. `playedOn` es una
 * columna `date` sin hora: arma el `Date` con componentes locales en vez de
 * parsear el ISO directo, porque `new Date('2026-08-13')` es medianoche UTC y
 * en un server en huso horario negativo formatea el día anterior.
 */
function formatMatchdayDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1)
  const parts = new Intl.DateTimeFormat('es-AR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('weekday')} ${get('day')} ${get('month')}`
}

/**
 * Partidos ganados-perdidos y diferencia de games de la pareja campeona,
 * dentro de esa fecha puntual. No pasa por `computeStandings` —pide
 * `SeasonConfig` y el snapshot de desempate, que esta pantalla de lectura no
 * trae— porque el campeón ya lo dice `awardsOf`; sólo falta sumar sus propios
 * partidos, el mismo tally que hace `computeStandings` puertas adentro pero
 * para una sola pareja.
 */
function championRecord(matches: MatchResult[], champion: Pair): string {
  let won = 0
  let lost = 0
  let gamesFor = 0
  let gamesAgainst = 0
  for (const match of matches) {
    const isA = samePair(match.pairA, champion)
    const isB = !isA && samePair(match.pairB, champion)
    if (!isA && !isB) continue

    let setsA = 0
    let setsB = 0
    let gamesA = 0
    let gamesB = 0
    for (const set of match.sets) {
      gamesA += set.gamesA
      gamesB += set.gamesB
      if (set.gamesA > set.gamesB) setsA++
      else if (set.gamesB > set.gamesA) setsB++
    }
    const championWonSets = isA ? setsA > setsB : setsB > setsA
    const championLostSets = isA ? setsB > setsA : setsA > setsB
    if (championWonSets) won++
    else if (championLostSets) lost++
    gamesFor += isA ? gamesA : gamesB
    gamesAgainst += isA ? gamesB : gamesA
  }

  const diff = gamesFor - gamesAgainst
  const sign = diff >= 0 ? '+' : ''
  return `${won}–${lost} · ${sign}${diff} games`
}

export default async function FechasPage({ params }: PageProps) {
  const { id: seasonId } = await params
  const supabase = await serverClient()

  const [header, allMatchdays, entries, awardsByNumber] = await Promise.all([
    seasonHeader(supabase, seasonId),
    matchdaysOf(supabase, seasonId),
    entriesOf(supabase, seasonId),
    awardsOf(supabase, seasonId),
  ])

  const nameById = new Map(entries.map((entry) => [entry.id, entry.displayName]))
  // El Masters no se dibuja como fila: esta pantalla sólo lista fechas REGULAR
  // y muestra el Masters como el bloque bloqueado del final (Task 7, Plan 3).
  const regularMatchdays = allMatchdays.filter((matchday) => matchday.kind === 'REGULAR')
  const closedMatchdays = regularMatchdays.filter((matchday) => matchday.status === 'CLOSED')
  // A la vez sólo puede haber una fecha regular sin cerrar (constraint de base),
  // así que "la que está en juego" es a lo sumo una.
  const openMatchday = regularMatchdays.find((matchday) => matchday.status === 'OPEN') ?? null

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
    const championPair = detail.pairs.find(
      (pair) => championEntryIds.includes(pair.a) || championEntryIds.includes(pair.b),
    )
    if (championPair === undefined) return null

    const names = `${nameById.get(championPair.a) ?? '?'} & ${nameById.get(championPair.b) ?? '?'}`
    return { names, record: championRecord(detail.matches, championPair) }
  }

  const remainingForMasters = Math.max(0, header.regularMatchdays - closedMatchdays.length)

  return (
    <div className="flex flex-col gap-3 pt-3">
      <header className="flex flex-col gap-[3px]">
        <p className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">
          {header.regularMatchdays} fechas · {closedMatchdays.length} jugadas
        </p>
        <h1 className="text-[26px] font-extrabold tracking-[-.03em]">Fechas</h1>
      </header>

      <div className="flex flex-col gap-3">
        {regularMatchdays.map((matchday) => {
          const played = matchday.status === 'CLOSED'
          const inProgress = matchday.status === 'OPEN'
          const champion = played ? championOf(matchday) : null
          // `ok-bg`/`up` y no `live-bg`/`live`: en el handoff `live` es el color de
          // error —borde de input inválido, bloques que impiden continuar, cerrar
          // sesión— y una fecha jugándose no es un problema. El par afirmativo es el
          // que usan todos los chips activos del diseño: "Repiten", "Viene",
          // "Defensora", "Sos vos".
          const tagClass = played ? 'bg-chip text-muted' : inProgress ? 'bg-ok-bg text-up' : 'text-muted'
          const tagLabel = played ? 'Jugada' : inProgress ? 'En juego' : 'Por jugarse'

          return (
            <Link
              key={matchday.id}
              href={`/torneo/${seasonId}/fechas/${matchday.number}`}
              className={`block rounded-[14px] border border-line bg-surface p-[14px] ${matchday.status === 'DRAFT' ? 'opacity-[0.62]' : ''}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">
                  Fecha {matchday.number}
                  {matchday.playedOn !== null ? ` · ${formatMatchdayDate(matchday.playedOn)}` : ''}
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
                  {openDetail.pairs.map((pair) => (
                    <p key={`${pair.a}-${pair.b}`} className="text-[13.5px] font-bold">
                      {nameById.get(pair.a) ?? '?'} & {nameById.get(pair.b) ?? '?'}
                    </p>
                  ))}
                </div>
              )}
            </Link>
          )
        })}
      </div>

      <div className="rounded-[18px] border-[1.5px] border-dashed border-line bg-surface px-[18px] py-5">
        <p className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">Cierre del año</p>
        <h2 className="mt-1 text-[24px] font-extrabold">Masters</h2>
        <p className="mt-2 text-[13.5px] font-medium leading-[1.5]">
          Se juega con los {MASTERS_SIZE} primeros de la tabla al terminar las {header.regularMatchdays}{' '}
          fechas. Faltan {remainingForMasters}.
        </p>
        <span className="mt-3 inline-block rounded-full bg-chip px-[10px] py-[6px] text-[10.5px] font-extrabold text-muted">
          Bloqueado
        </span>
      </div>
    </div>
  )
}
