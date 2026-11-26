import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  computeRanking,
  partnerRecords,
  rankingTallies,
  rivalRecords,
  rankingWithMovement,
  resolveDisciplineBySlug,
  snapshotForMatchday,
  sportLabel,
  tallyPlayers,
  titleStreaks,
  unitOf,
  type Award,
  type EntryId,
  type RivalRecord,
  type SeasonConfig,
} from '@/core'
import {
  awardsOf,
  closedHistoryAll,
  closedScoresOf,
  entriesOf,
  myEntryId,
  seasonHeader,
  seasonSquadMembersOf,
} from '@/db/read'
import { serverClient } from '@/db/server'
import { Avatar } from '@/app/ui/avatar'
import { button } from '@/app/ui/button'
import { Hero } from '@/app/ui/hero'
import { row as rowClass, rowMeta, rowTitle } from '@/app/ui/row'
import { desdeOf, perfilHref, volverDelJugador, type Desde } from '../origen'
import { Dato, markMatchdays, PuntosPorFecha, Seccion, Vos, VOS_FILA } from '../piezas'

interface PageProps {
  params: Promise<{ id: string; disciplina: string; entryId: string }>
  /** `?desde=stats|mias`: de dónde se llegó, para nombrar el destino del `Volver` (`../origen.ts`). */
  searchParams: Promise<{ desde?: string }>
}

/**
 * La trayectoria del año, dibujada: el puesto en la tabla al cierre de cada
 * fecha, con el número debajo de cada punto.
 *
 * SVG en línea y no una librería de gráficos: son cuatro cuentas y el proyecto
 * no admite dependencias nuevas. **El eje va al revés** —el 1° arriba— porque un
 * puesto más chico es mejor, y una línea que baja cuando mejorás se lee al
 * revés de lo que pasó. Plana, en el color del deporte (`--color-sport`).
 *
 * `viewBox` con `preserveAspectRatio="none"` y ancho 100%: se estira al ancho
 * del teléfono sin que haya que medir nada del lado del cliente. Cada punto va
 * en el centro de su columna para quedar encima de su número.
 */
function Trayectoria({
  trail,
  squadSize,
}: {
  trail: Array<{ number: number; position: number }>
  squadSize: number
}) {
  const width = 100
  const height = 48
  if (trail.length === 0) return null

  // De 1 a `squadSize` repartido en la altura, con un margen para que el punto
  // del 1° y el del último no queden cortados por el borde.
  const y = (position: number) =>
    squadSize <= 1 ? height / 2 : 4 + ((position - 1) / (squadSize - 1)) * (height - 8)
  const x = (index: number) => ((index + 0.5) / trail.length) * width

  const points = trail.map((step, index) => `${x(index)},${y(step.position)}`).join(' ')
  const columns = { gridTemplateColumns: `repeat(${trail.length}, minmax(0, 1fr))` }

  return (
    <Seccion title="Puesto en la tabla">
      <div className="px-4">
        <div
          role="img"
          aria-label={`Puesto por fecha: ${trail.map((step) => `fecha ${step.number}, ${step.position}°`).join('; ')}`}
          className="relative mt-1 h-[104px]"
        >
          <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0 h-full w-full">
            <polyline
              points={points}
              fill="none"
              stroke="var(--color-sport)"
              strokeWidth="3"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {/* Los puntos van en HTML y no en el SVG: estirado con
              `preserveAspectRatio="none"`, un círculo saldría ovalado. */}
          {trail.map((step, index) => {
            const top = (y(step.position) / height) * 100
            return (
              <span key={step.number} aria-hidden="true">
                <span
                  className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sport"
                  style={{ left: `${x(index)}%`, top: `${top}%` }}
                />
                {/* El puesto pegado a su punto: abajo si el punto está
                    arriba, arriba si está abajo, para no salirse. */}
                <span
                  className={`font-cond absolute -translate-x-1/2 text-[24px] ${top > 55 ? '-mt-2.5 -translate-y-full' : 'mt-2.5'}`}
                  style={{ left: `${x(index)}%`, top: `${top}%` }}
                >
                  {step.position}
                  <span className="align-top text-[14px]">°</span>
                </span>
              </span>
            )
          })}
        </div>
        <div aria-hidden="true" className="mt-2 grid gap-1.5 text-center text-[13px] font-semibold text-muted" style={columns}>
          {trail.map((step) => (
            <span key={step.number}>F{step.number}</span>
          ))}
        </div>
      </div>
    </Seccion>
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

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : `${value}`
}

/**
 * Una fila de compañero o de rival: avatar, nombre (el link al perfil, que
 * cubre la fila entera), una línea gris y el resultado en números grandes.
 * La del que mira lleva la marca de "vos". Con `drawn` (ajedrez) el resultado
 * es ganadas-tablas-perdidas.
 */
function FilaPersona({
  name,
  href,
  meta,
  won,
  drawn,
  lost,
  tone,
  isMe,
}: {
  name: string
  href: string
  meta: string
  won: number
  drawn?: number
  lost: number
  tone: 'up' | 'down' | 'muted'
  isMe: boolean
}) {
  return (
    <li className={`relative ${rowClass} press-fila${isMe ? ` ${VOS_FILA}` : ''}`}>
      <Avatar name={name} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <Link href={href} className={`${rowTitle} min-w-0 [overflow-wrap:anywhere] after:absolute after:inset-0`}>
            {name}
          </Link>
          {isMe && <Vos />}
        </span>
        <span className={rowMeta}>{meta}</span>
      </span>
      <span
        className={`font-cond shrink-0 text-[30px] ${tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : 'text-muted'}`}
      >
        <span aria-hidden="true">{drawn === undefined ? `${won}-${lost}` : `${won}-${drawn}-${lost}`}</span>
        <span className="sr-only">
          {drawn === undefined ? `${won} ganados, ${lost} perdidos` : `${won} ganadas, ${drawn} tablas, ${lost} perdidas`}
        </span>
      </span>
    </li>
  )
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
 * (el plantel es compartido, §3.2 de `docs/arquitectura-de-paginas.md`) —
 * necesario porque el redirect de compatibilidad (`jugador/[entryId]/page.tsx`)
 * manda acá cualquier `entryId` del plantel hacia la disciplina primaria SIN
 * comprobar si esa disciplina lo tiene entre sus entries: quien sólo juega
 * otra disciplina (o ninguna) igual encuentra su nombre acá, con "Todavía no
 * jugó {disciplina}" en vez de un 404.
 */
export default async function JugadorPage({ params, searchParams }: PageProps) {
  const { id: seasonId, disciplina, entryId } = await params
  const desde: Desde | null = desdeOf((await searchParams).desde)
  const supabase = await serverClient()

  const header = await seasonHeader(supabase, seasonId)
  const discipline = resolveDisciplineBySlug(header.disciplines, disciplina)
  if (discipline === undefined) notFound()

  const disciplineLabel = header.disciplines.length > 1 ? sportLabel(discipline.kind) : null

  // El perfil es del deporte de la URL: `Volver` sube a la Tabla de ESE
  // deporte, o vuelve a Stats si se vino de ahí (`?desde=`, `../origen.ts`).
  // Antes iba a `/torneo/{seasonId}` (el contenedor: con 2+ deportes, la
  // Tabla general) y decía "Volver" a secas, sin nombrar a dónde.
  const base = `/torneo/${seasonId}/${disciplina}`
  const volver = volverDelJugador(base, desde)

  // Bowling (S4): sin partidos. El perfil cuenta pinos en vez de partidos y games.
  const byPins = discipline.formatoDefault.kind === 'RANKING'
  const [squad, entries, history, awardsByMatchday, viewerEntryId, scoresByMatchday] = await Promise.all([
    seasonSquadMembersOf(supabase, seasonId),
    entriesOf(supabase, seasonId, discipline.id),
    closedHistoryAll(supabase, seasonId, discipline.id),
    awardsOf(supabase, seasonId, discipline.id),
    myEntryId(supabase, seasonId),
    byPins ? closedScoresOf(supabase, discipline.id) : Promise.resolve(new Map<number, Map<EntryId, number>>()),
  ])

  // La identidad se resuelve con el plantel de LA TEMPORADA (C11, verify
  // ronda 6): `entriesOf` sin disciplina explícita filtra por la disciplina
  // POR DEFECTO, y quien sólo juega otra disciplina (o ninguna) no aparecía
  // ahí — y sigue sin aparecer: es exactamente el caso que golpea el
  // redirect de compatibilidad (`jugador/[entryId]/page.tsx`), que manda acá
  // a la disciplina primaria sin comprobar si el `entryId` juega esa
  // disciplina. `entriesOf` se sigue usando abajo, sólo para las
  // ESTADÍSTICAS de la disciplina de la URL (C9 no se toca).
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
      <div className="flex flex-col">
        <Hero
          back={volver}
          kicker={header.name}
          title={member.displayName}
          subtitle={disciplineLabel !== null ? `Todavía no jugó ${disciplineLabel}` : 'Todavía no jugó esta disciplina'}
          sport={discipline.kind}
        />
        <div className="px-4 pt-5">
          <Link href={`${base}/fechas`} className={button('secondary', { full: true })}>
            Ver las fechas
          </Link>
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
  // El sufijo es del deporte (§8): goles en FIFA, games en pádel, puntos en ping pong.
  const unit = unitOf(discipline.kind, config.matchFormat)
  const matchesLost = tally.matchesPlayed - tally.matchesWon
  // Ajedrez: las tablas no son derrotas, y la diferencia sería un 1-0 contado como games.
  const partidas = config.matchFormat.resultado === true

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
  // Los que más veces tuvo enfrente primero: el cara a cara que más se repite es el que se discute.
  // En ajedrez las tablas cuentan (S3); en los demás, como siempre, sólo ganados y perdidos.
  const jugadosContra = (record: RivalRecord) => record.won + record.lost + (partidas ? record.drawn : 0)
  const rivals = rivalRecords(history, entryId)
    .filter((record) => jugadosContra(record) > 0)
    .sort((a, b) => jugadosContra(b) - jugadosContra(a) || b.won - b.lost - (a.won - a.lost))

  const isMe = entryId === viewerEntryId
  const pins = rankingTallies(scoresByMatchday, [entryId])[0]
  const fechasJugadas = byPins ? (pins?.played ?? 0) : tally.matchdaysPlayed

  return (
    <div className="flex flex-col">
      <Hero
        back={volver}
        kicker={disciplineLabel !== null ? `${header.name}, ${disciplineLabel}` : header.name}
        title={entry.displayName}
        // Lo tuyo, en amarillo: el puesto de la derecha y esta marca.
        subtitle={isMe ? <span className="font-bold text-vos">vos</span> : undefined}
        sport={discipline.kind}
        right={
          // Lo de `HeroTabla`: el puesto grande, en amarillo si es el tuyo.
          <p>
            <span className="sr-only">
              {row.position}° de {squadEntries.length}, {row.points} puntos
            </span>
            <span aria-hidden="true">
              <span className={`font-cond block text-[64px] ${isMe ? 'text-vos' : ''}`}>
                {row.position}
                <span className="align-top text-[32px]">°</span>
              </span>
              <span className="block text-[14px] text-on-block-soft">de {squadEntries.length}</span>
              <span className="block text-[14px] text-on-block-soft">{row.points} pts</span>
            </span>
          </p>
        }
      />

      <div className="grid grid-cols-3 gap-2.5 px-4 pt-5">
        {byPins ? (
          <>
            <Dato label="Promedio" value={pins?.average ?? 0} />
            <Dato label="Mejor total" value={pins?.best ?? 0} />
            <Dato label={`${unit.charAt(0).toUpperCase()}${unit.slice(1)} totales`} value={pins?.total ?? 0} />
          </>
        ) : partidas ? (
          <>
            <Dato label="Partidas" value={`${tally.matchesWon}-${matchesLost - tally.matchesDrawn}`} />
            <Dato label="Efectividad" value={`${efectividad}%`} />
            <Dato label="Tablas" value={tally.matchesDrawn} />
          </>
        ) : (
          <>
            <Dato label="Partidos" value={`${tally.matchesWon}-${matchesLost}`} />
            <Dato label="Efectividad" value={`${efectividad}%`} />
            <Dato label={`Dif. ${unit}`} value={formatSigned(difGames)} />
          </>
        )}
        <Dato label="Fechas ganadas" value={fechasGanadas} />
        <Dato label="Racha de títulos" value={longestStreak} />
        <Dato label="Fechas jugadas" value={fechasJugadas} />
      </div>

      <PuntosPorFecha title="Puntos por fecha" marks={marks} />

      {trail.length >= 2 && <Trayectoria trail={trail} squadSize={seedOrder.length} />}

      {myRecords.length > 0 && (
        <Seccion title={isMe ? 'Con quién te va mejor' : 'Con quién le va mejor'}>
          <ul>
            {myRecords.map((record) => {
              const balance = record.won - record.lost
              return (
                <FilaPersona
                  key={record.partner}
                  name={nameById.get(record.partner) ?? ''}
                  href={perfilHref(base, record.partner, desde)}
                  meta={record.together === 1 ? '1 fecha juntos' : `${record.together} fechas juntos`}
                  won={record.won}
                  lost={record.lost}
                  tone={balance > 0 ? 'up' : 'muted'}
                  isMe={record.partner === viewerEntryId}
                />
              )
            })}
          </ul>
        </Seccion>
      )}

      {rivals.length > 0 && (
        <Seccion title="Cara a cara">
          <ul>
            {rivals.map((record) => {
              const balance = record.won - record.lost
              const played = jugadosContra(record)
              const palabra = partidas ? 'partida' : 'partido'
              return (
                <FilaPersona
                  key={record.rival}
                  name={nameById.get(record.rival) ?? ''}
                  href={perfilHref(base, record.rival, desde)}
                  meta={played === 1 ? `1 ${palabra}` : `${played} ${palabra}s`}
                  won={record.won}
                  drawn={partidas ? record.drawn : undefined}
                  lost={record.lost}
                  tone={balance > 0 ? 'up' : balance < 0 ? 'down' : 'muted'}
                  isMe={record.rival === viewerEntryId}
                />
              )
            })}
          </ul>
        </Seccion>
      )}
    </div>
  )
}
