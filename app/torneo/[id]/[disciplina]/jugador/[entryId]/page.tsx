import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  computeRanking,
  partnerRecords,
  rankingWithMovement,
  resolveDisciplineBySlug,
  snapshotForMatchday,
  tallyPlayers,
  titleStreaks,
  type Award,
  type EntryId,
  type SeasonConfig,
} from '@/core'
import { DISCIPLINE_LABELS } from '@/app/torneos/nuevo/wizard-state'
import { awardsOf, closedHistoryAll, entriesOf, seasonHeader, seasonSquadMembersOf } from '@/db/read'
import { serverClient } from '@/db/server'
import { initials } from '@/app/format'

interface PageProps {
  params: Promise<{ id: string; disciplina: string; entryId: string }>
}

/**
 * La trayectoria del año, dibujada.
 *
 * SVG en línea y no una librería de gráficos: son cuatro cuentas y el proyecto
 * no admite dependencias nuevas. **El eje va al revés** —el 1° arriba— porque un
 * puesto más chico es mejor, y una línea que baja cuando mejorás se lee al
 * revés de lo que pasó.
 *
 * `viewBox` con `preserveAspectRatio="none"` y ancho 100%: se estira al ancho
 * del teléfono sin que haya que medir nada del lado del cliente.
 */
function Trayectoria({
  trail,
  squadSize,
}: {
  trail: Array<{ number: number; position: number }>
  squadSize: number
}) {
  const width = 100
  const height = 34
  const last = trail[trail.length - 1]
  const first = trail[0]
  if (last === undefined || first === undefined) return null

  // De 1 a `squadSize` repartido en la altura, con un margen para que el punto
  // del 1° y el del último no queden cortados por el borde.
  const y = (position: number) =>
    squadSize <= 1 ? height / 2 : 3 + ((position - 1) / (squadSize - 1)) * (height - 6)
  const x = (index: number) =>
    trail.length <= 1 ? width / 2 : (index / (trail.length - 1)) * width

  const points = trail.map((step, index) => `${x(index)},${y(step.position)}`).join(' ')
  const climbed = last.position < first.position
  const stroke = climbed ? 'var(--color-up)' : last.position > first.position ? 'var(--color-down)' : 'var(--color-muted)'

  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-line bg-surface p-[14px]">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[9.5px] font-extrabold uppercase tracking-[.13em] text-muted">
          Cómo viene
        </p>
        <p className="text-[11.5px] font-[600] text-muted">
          Arrancó {first.position}° · va {last.position}°
        </p>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-[34px] w-full"
        role="img"
        aria-label={`Puesto por fecha: ${trail.map((step) => `fecha ${step.number}, ${step.position}°`).join('; ')}`}
      >
        <polyline
          points={points}
          fill="none"
          stroke={stroke}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={x(trail.length - 1)} cy={y(last.position)} r="2.5" fill={stroke} vectorEffect="non-scaling-stroke" />
      </svg>

      <div className="flex justify-between">
        {trail.map((step) => (
          <span key={step.number} className="text-[9.5px] font-bold text-muted">
            F{step.number}
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * En qué puesto de la tabla general estaba este jugador al cerrar cada fecha.
 *
 * No hay nada guardado que responda esto: `awards.position` congela el puesto
 * DE ESA FECHA —1° a 4° del día—, no el del año. La única fuente honesta es
 * recomputar el ranking con las fechas de las que se disponía en cada momento,
 * que es barato porque `computeRanking` es puro y son doce fechas como mucho.
 *
 * Y es la misma función que dibuja la tabla de hoy: la trayectoria termina
 * exactamente en el puesto que el jugador ve arriba, en vez de en un número
 * parecido calculado de otra manera.
 */
function positionsByMatchday(
  numbers: readonly number[],
  awardsByMatchday: Map<number, Award[]>,
  squad: readonly EntryId[],
  config: SeasonConfig,
  entryId: EntryId,
): Array<{ number: number; position: number }> {
  const trail: Array<{ number: number; position: number }> = []

  for (const [index, number] of numbers.entries()) {
    const upToHere = new Map(
      [...awardsByMatchday].filter(([played]) => numbers.slice(0, index + 1).includes(played)),
    )
    // El snapshot vigente en ese momento: el de la fecha siguiente a la última
    // cerrada, igual que en la Tabla.
    const snapshot = snapshotForMatchday(index + 2, [...squad], upToHere, config)
    const ranking = computeRanking(upToHere, [...squad], config, [...snapshot])
    const at = ranking.findIndex((candidate) => candidate.entryId === entryId)
    if (at >= 0) trail.push({ number, position: at + 1 })
  }

  return trail
}

interface MatchdayMark {
  number: number
  status: 'counted' | 'discarded' | 'absent'
  points: number | null
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
 *
 * Task 2 (`docs/plan-arquitectura-de-paginas.md`): esta pantalla vivía en
 * `/torneo/{id}/jugador/{entryId}`, leía `entriesOf`/`closedHistoryAll`/
 * `awardsOf` sin disciplina y sacaba `config` de `primaryDiscipline(header)`
 * — con pádel y FIFA en el mismo torneo, siempre mostraba pádel. Ahora vive
 * bajo `/torneo/{id}/{disciplina}/jugador/{entryId}` y resuelve la disciplina
 * del slug, mismo patrón que `[disciplina]/stats/page.tsx`. Las tres lecturas
 * reciben `discipline.id`, y `config` sale de `discipline.config` — decisión
 * del dueño del producto: el perfil es por disciplina.
 *
 * La IDENTIDAD sigue sin tocarse: `seasonSquadMembersOf` es del CONTENEDOR
 * (el plantel es compartido, §3.2 de `docs/arquitectura-de-paginas.md`), así
 * que quien sólo juega otra disciplina (o ninguna) sigue siendo clickeable
 * desde la Tabla global.
 */
export default async function JugadorPage({ params }: PageProps) {
  const { id: seasonId, disciplina, entryId } = await params
  const supabase = await serverClient()

  const header = await seasonHeader(supabase, seasonId)
  const discipline = resolveDisciplineBySlug(header.disciplines, disciplina)
  if (discipline === undefined) notFound()

  const disciplineLabel = header.disciplines.length > 1 ? DISCIPLINE_LABELS[discipline.kind] : null

  // Deliberadamente SIN discipliner: `volverDestination` (`tabla-state.ts`)
  // ya decide esto para la Tabla -- `/torneos` con una sola disciplina,
  // `/torneo/{seasonId}` (el contenedor) con 2+ -- y reusarlo acá rompería
  // el byte-a-byte con una sola disciplina. Hardcodear `{disciplina}` en su
  // lugar tampoco sirve: quien llega desde la Tabla GLOBAL (`page.tsx`, 2+
  // disciplinas, sin una sola a la que apuntar) volvería a pádel en vez de
  // a la tabla de la que vino. Sin superficie propia para decidirlo bien,
  // se deja como estaba -- Task 3 es quien scopea el resto del nav.
  const volverHref = `/torneo/${seasonId}`

  const [squad, entries, history, awardsByMatchday] = await Promise.all([
    seasonSquadMembersOf(supabase, seasonId),
    entriesOf(supabase, seasonId, discipline.id),
    closedHistoryAll(supabase, seasonId, discipline.id),
    awardsOf(supabase, seasonId, discipline.id),
  ])

  // La identidad se resuelve con el plantel de LA TEMPORADA (C11, verify
  // ronda 6): `entriesOf` sin disciplina explícita filtra por la disciplina
  // POR DEFECTO, y quien sólo juega otra disciplina (o ninguna) no aparecía
  // ahí — pero sí es clickeable desde la tabla global, que lista al plantel
  // entero. `entriesOf` se sigue usando abajo, sólo para las ESTADÍSTICAS de
  // la disciplina de la URL (C9 no se toca).
  const member = squad.find((candidate) => candidate.id === entryId)
  if (member === undefined) notFound()

  const squadEntries = entries
    .filter((candidate) => candidate.kind === 'SQUAD')
    .sort((a, b) => a.seedPosition - b.seedPosition)
  const seedOrder: EntryId[] = squadEntries.map((squadEntry) => squadEntry.id)
  const nameById = new Map(entries.map((candidate) => [candidate.id, candidate.displayName]))

  // No participa de ESTA disciplina (nunca 404: la identidad ya está
  // confirmada arriba) — estado honesto, sin estadísticas fabricadas. Con
  // 2+ disciplinas el texto nombra cuál; con una sola sale igual que siempre.
  const entry = squadEntries.find((candidate) => candidate.id === entryId)
  if (entry === undefined) {
    return (
      <div className="flex flex-col gap-3 pt-4">
        <div className="flex justify-end">
          <Link
            href={volverHref}
            className="flex h-11 shrink-0 items-center rounded-full bg-chip px-[14px] text-[13px] font-bold"
          >
            ← Volver
          </Link>
        </div>
        <div className="flex items-center gap-3 rounded-card border border-line bg-surface p-4">
          <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-accent text-[19px] font-extrabold text-accent-text">
            {initials(member.displayName)}
          </span>
          <div>
            <p className="text-[19px] font-extrabold">{member.displayName}</p>
            <p className="text-[12.5px] font-semibold text-muted">
              {disciplineLabel !== null ? `Todavía no jugó ${disciplineLabel}` : 'Todavía no jugó esta disciplina'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  const { config } = discipline
  const activeMatchdayNumber = Math.min(history.length + 1, config.regularMatchdays)
  const snapshot = snapshotForMatchday(activeMatchdayNumber, seedOrder, awardsByMatchday, config)
  const ranking = rankingWithMovement(awardsByMatchday, seedOrder, config, snapshot)
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

  const trail = positionsByMatchday(
    history.map((matchday) => matchday.number),
    awardsByMatchday,
    seedOrder,
    config,
    entryId,
  )

  const myRecords = partnerRecords(history)
    .filter((record) => record.entryId === entryId)
    .sort((a, b) => b.won - b.lost - (a.won - a.lost) || b.together - a.together)

  return (
    <div className="flex flex-col gap-3 pt-4">
      <div className="flex justify-end">
        <Link
          href={volverHref}
          className="flex h-11 shrink-0 items-center rounded-full bg-chip px-[14px] text-[13px] font-bold"
        >
          ← Volver
        </Link>
      </div>

      <div className="flex items-center gap-3 rounded-card border border-line bg-surface p-4">
        <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-accent text-[19px] font-extrabold text-accent-text">
          {initials(entry.displayName)}
        </span>
        <div>
          <p className="text-[19px] font-extrabold">
            {entry.displayName}
            {disciplineLabel !== null ? ` · ${disciplineLabel}` : ''}
          </p>
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

      {trail.length >= 2 && <Trayectoria trail={trail} squadSize={seedOrder.length} />}

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
