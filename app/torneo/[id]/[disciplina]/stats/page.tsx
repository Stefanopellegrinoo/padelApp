import type { ReactNode } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  bestPair,
  partnerRecords,
  rankingWithMovement,
  resolveDisciplineBySlug,
  snapshotForMatchday,
  sportLabel,
  tallyPlayers,
  titleStreaks,
  unitOf,
  type Award,
  type EntryId,
  type MatchResult,
  type PartnerRecord,
  type PlayedMatchday,
} from '@/core'
import { disciplineConfig } from '@/db/discipline'
import { awardsOf, closedHistoryAll, entriesOf, myEntryId, seasonHeader } from '@/db/read'
import { serverClient } from '@/db/server'
import { Avatar } from '@/app/ui/avatar'
import { button } from '@/app/ui/button'
import { Hero } from '@/app/ui/hero'
import { row as rowClass, rowMeta, rowTitle } from '@/app/ui/row'
import { volverDestination } from '@/app/torneo/[id]/tabla-state'
import { perfilHref, type Desde } from '../jugador/origen'
import { Dato, markMatchdays, PuntosPorFecha, Seccion, Vos, VOS_FILA } from '../jugador/piezas'

interface PageProps {
  params: Promise<{ id: string; disciplina: string }>
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

function cap(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
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

/** Lo que cada pieza necesita para nombrar a alguien y llevar a su perfil. */
interface Gente {
  base: string
  nameOf: NameOf
  /** El asiento del que mira: su fila va marcada. */
  viewer: EntryId | null
  /** De qué pestaña sale el link, para el `Volver` del perfil. */
  desde: Desde
}

/**
 * General y Mías: un control segmentado de dos links a la misma pantalla. Son
 * links (cambian la URL, `?tab=mias`) y no pestañas ARIA: el encendido lleva
 * `aria-current="page"`. El encendido es un bloque lleno del color del
 * deporte; el otro, texto sobre el `chip` del carril.
 */
function Segmentos({ statsBase, activeTab }: { statsBase: string; activeTab: 'torneo' | 'mias' }) {
  const segment = (on: boolean) =>
    `press flex min-h-[44px] items-center justify-center rounded-[11px] text-[16px] font-bold ${
      on ? 'bg-sport text-on-sport' : 'text-muted'
    }`
  return (
    <nav aria-label="Qué estadísticas" className="px-4 pt-4">
      <div className="grid grid-cols-2 gap-1 rounded-btn bg-chip p-1">
        <Link href={statsBase} aria-current={activeTab === 'torneo' ? 'page' : undefined} className={segment(activeTab === 'torneo')}>
          General
        </Link>
        <Link
          href={statsBase + '?tab=mias'}
          aria-current={activeTab === 'mias' ? 'page' : undefined}
          className={segment(activeTab === 'mias')}
        >
          Mías
        </Link>
      </div>
    </nav>
  )
}

/**
 * Un ranking en barras planas del color del deporte: nombre, barra y el
 * número, en una línea por jugador para que las barras arranquen todas a la
 * misma altura y se comparen de un vistazo. Toda la fila lleva al perfil.
 */
function Barras({ title, rows, gente }: { title: string; rows: BarRow[]; gente: Gente }) {
  if (rows.length === 0) return null
  return (
    <Seccion title={title}>
      <ol>
        {rows.map((row) => {
          const isMe = row.entryId === gente.viewer
          return (
            <li
              key={row.entryId}
              className={`relative grid min-h-[48px] grid-cols-[7.5rem_1fr_3.5rem] items-center gap-3 px-4 py-1.5 press-fila${
                isMe ? ` ${VOS_FILA}` : ''
              }`}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <Link
                  href={perfilHref(gente.base, row.entryId, gente.desde)}
                  className="min-w-0 text-[16px] leading-tight font-semibold [overflow-wrap:anywhere] after:absolute after:inset-0"
                >
                  {gente.nameOf.get(row.entryId) ?? ''}
                </Link>
                {isMe && <Vos />}
              </span>
              <span aria-hidden="true" className="h-2.5 overflow-hidden rounded-pill bg-current/15">
                <span className="block h-full rounded-pill bg-sport" style={{ width: `${row.pct}%` }} />
              </span>
              <span className="font-cond text-right text-[26px]">{row.pct}%</span>
            </li>
          )
        })}
      </ol>
    </Seccion>
  )
}

/**
 * Una fila de persona con avatar: quién, qué dato es (la línea gris) y el
 * número a la derecha. Toda la fila lleva al perfil.
 */
function FilaDestacada({
  entryId,
  label,
  value,
  gente,
}: {
  entryId: EntryId
  label: string
  value: ReactNode
  gente: Gente
}) {
  const name = gente.nameOf.get(entryId) ?? ''
  const isMe = entryId === gente.viewer
  return (
    <li className={`relative ${rowClass} press-fila${isMe ? ` ${VOS_FILA}` : ''}`}>
      <Avatar name={name} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <Link
            href={perfilHref(gente.base, entryId, gente.desde)}
            className={`${rowTitle} min-w-0 [overflow-wrap:anywhere] after:absolute after:inset-0`}
          >
            {name}
          </Link>
          {isMe && <Vos />}
        </span>
        <span className={rowMeta}>{label}</span>
      </span>
      {value}
    </li>
  )
}

/** Sube (azul) o baja (rojo) con triángulo y número, como el cambio de la Tabla. */
function Movimiento({ movement }: { movement: number }) {
  const sube = movement > 0
  return (
    <span className={`font-cond flex shrink-0 items-center gap-1 text-[34px] ${sube ? 'text-up' : 'text-down'}`}>
      <svg aria-hidden="true" viewBox="0 0 10 10" className="h-3.5 w-3.5 fill-current">
        <path d={sube ? 'M5 1.5L9.5 8.5H.5z' : 'M5 8.5L.5 1.5h9z'} />
      </svg>
      {Math.abs(movement)}
      <span className="sr-only">{sube ? ' puestos arriba' : ' puestos abajo'}</span>
    </span>
  )
}

/**
 * Un nombre de la dupla: link a su perfil, con la marca si es el que mira. Es
 * texto corrido (los dos nombres pueden partirse en dos líneas), así que el
 * blanco de 44 lo da el relleno vertical y no la caja; la marca va en el
 * nombre, no en el relleno. El relleno de un `<a>` en línea no mueve las
 * líneas: 14 por lado sobre la letra (17-19 px de caja) da 45 o más; con 12
 * medía 41-43 (T17).
 */
function NombreDupla({ entryId, gente }: { entryId: EntryId; gente: Gente }) {
  const name = gente.nameOf.get(entryId) ?? ''
  return (
    <Link href={perfilHref(gente.base, entryId, gente.desde)} className="py-3.5">
      <span className={entryId === gente.viewer ? 'marca-vos' : undefined}>{name}</span>
    </Link>
  )
}

/**
 * Las duplas: la mejor, en un bloque del tinte del deporte con su
 * efectividad grande; el resto, en filas. Cada fila tiene dos links (uno por
 * nombre), así que acá la fila entera no se toca.
 */
function Duplas({ best, rest, gente }: { best: PartnerRecord | null; rest: PartnerRecord[]; gente: Gente }) {
  if (best === null && rest.length === 0) return null
  return (
    <>
      {best !== null && (
        <Seccion title="Mejor dupla del torneo">
          <div className="mx-4 flex items-center gap-3 rounded-tile bg-sport-tint py-2 pr-4 pl-3">
            {/* Los avatares sobre un aro del fondo: el tono del avatar es el
                mismo tinte del bloque y sin aro se perdería. */}
            <span aria-hidden="true" className="flex shrink-0">
              <span className="rounded-full bg-bg p-[3px]">
                <Avatar name={gente.nameOf.get(best.entryId) ?? ''} />
              </span>
              <span className="-ml-3 rounded-full bg-bg p-[3px]">
                <Avatar name={gente.nameOf.get(best.partner) ?? ''} />
              </span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block pt-2 text-[17px] leading-snug font-bold">
                <NombreDupla entryId={best.entryId} gente={gente} />
                {' y '}
                <NombreDupla entryId={best.partner} gente={gente} />
              </span>
              <span className="block pb-1 text-[14px] text-muted">{metaDupla(best)}</span>
            </span>
            <span className="font-cond shrink-0 text-[44px] text-sport">{effectiveness(best)}%</span>
          </div>
        </Seccion>
      )}
      {rest.length > 0 && (
        <Seccion title="Las demás duplas">
          <ul>
            {rest.map((record) => (
              <li key={pairKey(record.entryId, record.partner)} className={`${rowClass} py-1`}>
                <span className="min-w-0 flex-1">
                  <span className="block pt-1 text-[16px] leading-snug font-semibold">
                    <NombreDupla entryId={record.entryId} gente={gente} />
                    {' y '}
                    <NombreDupla entryId={record.partner} gente={gente} />
                  </span>
                  <span className="block pb-1 text-[14px] text-muted">{metaDupla(record)}</span>
                </span>
                <span className={`font-cond shrink-0 text-[30px] ${effectiveness(record) >= 50 ? 'text-sport' : 'text-muted'}`}>
                  {effectiveness(record)}%
                </span>
              </li>
            ))}
          </ul>
        </Seccion>
      )}
    </>
  )
}

function metaDupla(record: PartnerRecord): string {
  return `${record.won}-${record.lost}, ${record.together === 1 ? '1 fecha' : `${record.together} fechas`}`
}

/**
 * El estado vacío: lo que falta en números (fechas cerradas de las que
 * hacen falta) y a dónde ir para que llegue, no un párrafo explicándolo.
 */
function FaltanFechas({
  closedCount,
  showPairs,
  fechasHref,
}: {
  closedCount: number
  /** "Duplas" sólo existe con parejas que rotan. */
  showPairs: boolean
  fechasHref: string
}) {
  const missing = MIN_CLOSED_MATCHDAYS_FOR_STATS - closedCount
  return (
    <div className="px-4 pt-5">
      <div className="rounded-tile bg-sport-tint p-4">
        <div aria-hidden="true" className="flex gap-1.5">
          {Array.from({ length: MIN_CLOSED_MATCHDAYS_FOR_STATS }, (_, index) => (
            <i
              key={index}
              className={`h-3 w-8 rounded-[4px] ${index < closedCount ? 'bg-sport' : 'shadow-[inset_0_0_0_1.5px_var(--color-sport)]'}`}
            />
          ))}
        </div>
        <h2 className="font-titulo mt-3 text-[28px]">
          {missing === 1 ? 'Falta 1 fecha' : `Faltan ${missing} fechas`}
        </h2>
        <p className="mt-1 text-[15px] text-muted">
          {closedCount} de {MIN_CLOSED_MATCHDAYS_FOR_STATS} fechas cerradas. Después: % de partidos ganados,{' '}
          {showPairs ? 'duplas, ' : ''}rachas y presentismo.
        </p>
      </div>
      <Link href={fechasHref} className={`${button('primary', { size: 'lg', full: true })} mt-4`}>
        Ir a las fechas
      </Link>
    </div>
  )
}

// ── la pantalla ───────────────────────────────────────────────────────────────

/**
 * Estadísticas — sección 10 del handoff. Es la única pantalla que no viene del
 * spec del campeonato, así que el handoff manda más que de costumbre. Todo el
 * conteo sale de `core/playerstats.ts` y `core/streak.ts`; acá sólo se convierte
 * en porcentajes, se ordena para mostrar y se arma el estado sin datos.
 *
 * Task 1 (`docs/plan-arquitectura-de-paginas.md`): esta pantalla vivía en
 * `/torneo/{id}/stats`, leía `entriesOf`/`closedHistoryAll`/`awardsOf` sin
 * disciplina y sacaba la config de `defaultDisciplineId` — mostraba la
 * disciplina `[0]` de la temporada y el título nunca decía cuál. Ahora vive
 * bajo `/torneo/{id}/{disciplina}/stats` y resuelve la disciplina del slug,
 * mismo patrón que `[disciplina]/page.tsx:28-29` y `fechas/page.tsx:64-65`:
 * slug desconocido -> `notFound()`. Las tres lecturas reciben `discipline.id`,
 * y `config` sale de `discipline.config` (ya lo trae `seasonHeader`) en vez de
 * una consulta aparte a `disciplineConfig`.
 */
export default async function StatsPage({ params, searchParams }: PageProps) {
  const { id: seasonId, disciplina } = await params
  const { tab } = await searchParams
  const activeTab: 'torneo' | 'mias' = tab === 'mias' ? 'mias' : 'torneo'

  const supabase = await serverClient()
  const header = await seasonHeader(supabase, seasonId)

  const discipline = resolveDisciplineBySlug(header.disciplines, disciplina)
  if (discipline === undefined) notFound()

  // Scopeado a ESTA disciplina, no al contenedor -- alimenta los links a
  // `jugador/{entryId}` de más abajo (Task 2,
  // `docs/plan-arquitectura-de-paginas.md`: el perfil también vive bajo
  // `{disc}/jugador/{entryId}`). Si `base` fuera `/torneo/{seasonId}` a
  // secas, un jugador visto desde `/fifa/stats` caería en la disciplina
  // `[0]` vía el redirect de compatibilidad -- el mismo bug que esta
  // pantalla ya arregló para sí misma.
  const base = `/torneo/${seasonId}/${disciplina}`
  const statsBase = `${base}/stats`
  // Sólo se nombra la disciplina cuando hay más de una — mismo criterio que
  // Ajustes (`[disciplina]/ajustes/page.tsx:61`, `header.disciplines.length
  // > 1 ? ... : null`): con una sola, decirlo es ruido que nadie pidió.
  const disciplineLabel = header.disciplines.length > 1 ? sportLabel(discipline.kind) : null

  const [entries, history, awardsByMatchday, viewerEntryId, { fixedTeams }] = await Promise.all([
    entriesOf(supabase, seasonId, discipline.id),
    closedHistoryAll(supabase, seasonId, discipline.id),
    awardsOf(supabase, seasonId, discipline.id),
    myEntryId(supabase, seasonId),
    disciplineConfig(supabase, discipline.id),
  ])
  const { config } = discipline
  // Lo que se cuenta en un partido es del deporte (§8): games, goles, puntos.
  const unit = unitOf(discipline.kind, config.matchFormat)
  // "Dupla" sólo tiene sentido con parejas que ROTAN: de a uno no hay con quién
  // jugar, y con parejas fijas la dupla es siempre la misma.
  const showPairs = discipline.pairSize === 2 && !fixedTeams

  // El encabezado de las tres caras (General, Mías, sin datos): sube a donde
  // sube la Tabla (`volverDestination`: Mis torneos con un deporte, la Tabla
  // general con más) y nombra el destino. A la derecha, tu puesto en amarillo
  // como en la Tabla, cuando ya hay uno que decir.
  const hero = (mine: { position: number; points: number } | null) => (
    <Hero
      back={volverDestination(seasonId, header.disciplines.length)}
      kicker={header.name}
      title={`Estadísticas${disciplineLabel !== null ? ` de ${disciplineLabel}` : ''}`}
      subtitle={`${history.length} de ${config.regularMatchdays} fechas jugadas`}
      sport={discipline.kind}
      right={
        mine === null ? undefined : (
          <p>
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
  )

  if (history.length < MIN_CLOSED_MATCHDAYS_FOR_STATS) {
    return (
      <div className="flex flex-col">
        {hero(null)}
        <FaltanFechas closedCount={history.length} showPairs={showPairs} fechasHref={`${base}/fechas`} />
      </div>
    )
  }

  const nameOf: NameOf = new Map(entries.map((entry) => [entry.id, entry.displayName]))
  // En orden de siembra, no en el que devuelva la base: `computeRanking` cae en
  // este orden cuando dos jugadores no están en el snapshot, así que un plantel
  // sin ordenar vuelve el desempate no determinista.
  const squad: EntryId[] = entries
    .filter((entry) => entry.kind === 'SQUAD')
    .sort((a, b) => a.seedPosition - b.seedPosition)
    .map((entry) => entry.id)
  const squadSet = new Set(squad)

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

  // Quién viene subiendo y quién bajando. Es la MISMA cuenta que la flecha de la
  // Tabla —`rankingWithMovement`, con el mismo snapshot— y no una segunda
  // opinión: dos formas de decidir quién subió es el bug que ningún test agarra.
  // Lo que agrega esta pantalla es el extremo: en la Tabla tenés que recorrer
  // doce filas para encontrar al que más se movió.
  //
  // El snapshot se arma para la fecha SIGUIENTE a la última cerrada, igual que
  // en la Tabla: es el que está vigente ahora.
  const snapshot = snapshotForMatchday(history.length + 1, squad, awardsByMatchday, config)
  const ranked = rankingWithMovement(awardsByMatchday, squad, config, snapshot)
  const moved = ranked.filter((row) => row.movement !== null && row.movement !== 0)
  const climber = moved.reduce<(typeof moved)[number] | null>(
    (top, row) => (top === null || (row.movement ?? 0) > (top.movement ?? 0) ? row : top),
    null,
  )
  const faller = moved.reduce<(typeof moved)[number] | null>(
    (bottom, row) => (bottom === null || (row.movement ?? 0) < (bottom.movement ?? 0) ? row : bottom),
    null,
  )

  const best = bestPair(history)
  const restPairs = dedupePairs(partnerRecords(history))
    .filter((record) => best === null || pairKey(record.entryId, record.partner) !== pairKey(best.entryId, best.partner))
    .sort((a, b) => b.together - a.together)

  // ── Mías ────────────────────────────────────────────────────────────────
  const myTally = viewerEntryId === null ? undefined : talliesByEntry.get(viewerEntryId)
  const myMatchesPlayed = myTally?.matchesPlayed ?? 0
  const myEffectiveness = myTally === undefined ? 0 : pct(myTally.matchesWon, myTally.matchesPlayed)
  const myNetGames = myTally === undefined ? 0 : myTally.gamesFor - myTally.gamesAgainst
  const myBestMatchday = viewerEntryId === null ? null : bestMatchdayFor(awardsByMatchday, viewerEntryId)
  const myRow = viewerEntryId === null ? undefined : ranked.find((row) => row.entryId === viewerEntryId)
  // Tus puntos fecha por fecha, contadas y descartadas: el gráfico del Stats
  // del prototipo, con la misma cuenta que el perfil (`markMatchdays`).
  const myMarks =
    viewerEntryId === null || myRow === undefined
      ? []
      : markMatchdays(
          history.map((matchday) => matchday.number),
          awardsByMatchday,
          viewerEntryId,
          myRow.counted,
          myRow.discarded,
        )

  const myPartners: BarRow[] =
    viewerEntryId === null
      ? []
      : partnerRecords(history)
          .filter((record) => record.entryId === viewerEntryId)
          .map((record) => ({ entryId: record.partner, pct: effectiveness(record) }))
          .sort((a, b) => b.pct - a.pct)

  const gente: Gente = { base, nameOf, viewer: viewerEntryId, desde: activeTab === 'mias' ? 'mias' : 'stats' }

  return (
    <div className="flex flex-col">
      {hero(myRow === undefined ? null : { position: myRow.position, points: myRow.points })}
      <Segmentos statsBase={statsBase} activeTab={activeTab} />

      {activeTab === 'torneo' ? (
        <>
          <div className="grid grid-cols-3 gap-2.5 px-4 pt-4">
            <Dato label="Partidos jugados" value={totalMatches} />
            <Dato label={`${cap(unit)} totales`} value={totalGames} />
            <Dato
              label="Fecha más pareja"
              value={evenestMatchdayNumber ?? '—'}
              href={evenestMatchdayNumber === null ? undefined : `${base}/fechas/${evenestMatchdayNumber}`}
            />
          </div>

          {/* Racha, en alza y en baja: quién, y el número. En alza y en baja
              son quién más se movió al cerrar la última fecha; si no se movió
              nadie —pasa, y más cuanto más avanzado el año— no hay fila en vez
              de inventar un puesto. */}
          <Seccion title="Destacados">
            <ul>
              <FilaDestacada
                entryId={longestStreak.entryId}
                label="Racha más larga"
                gente={gente}
                value={
                  <span className="font-cond shrink-0 text-[34px] text-sport">
                    {longestStreak.longest}
                    <span className="sr-only"> fechas ganadas seguidas</span>
                  </span>
                }
              />
              {climber !== null && (
                <FilaDestacada
                  entryId={climber.entryId}
                  label="En alza"
                  gente={gente}
                  value={<Movimiento movement={climber.movement ?? 0} />}
                />
              )}
              {faller !== null && (
                <FilaDestacada
                  entryId={faller.entryId}
                  label="En baja"
                  gente={gente}
                  value={<Movimiento movement={faller.movement ?? 0} />}
                />
              )}
            </ul>
          </Seccion>

          <Barras title="% de partidos ganados" rows={winPctRows} gente={gente} />
          <Barras title="Presentismo" rows={presentismoRows} gente={gente} />
          {showPairs && <Duplas best={best} rest={restPairs} gente={gente} />}
        </>
      ) : myMatchesPlayed === 0 ? (
        // No jugó todavía (o mira sin estar en el plantel): lo que falta es
        // jugar, y el camino es la lista de fechas.
        <div className="px-4 pt-5">
          <div className="rounded-tile bg-sport-tint p-4">
            <h2 className="font-titulo text-[28px]">Todavía no jugaste</h2>
            <p className="mt-1 text-[15px] text-muted">Tus partidos, tu efectividad y tus puntos por fecha van acá.</p>
          </div>
          <Link href={`${base}/fechas`} className={`${button('primary', { size: 'lg', full: true })} mt-4`}>
            Ir a las fechas
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 px-4 pt-4">
            <Dato label="Partidos" value={myMatchesPlayed} />
            <Dato label="Efectividad" value={`${myEffectiveness}%`} />
            <Dato label={`Dif. ${unit}`} value={formatSigned(myNetGames)} />
            <Dato
              label="Mejor fecha"
              value={myBestMatchday ?? '—'}
              href={myBestMatchday === null ? undefined : `${base}/fechas/${myBestMatchday}`}
            />
          </div>

          <PuntosPorFecha title="Tus puntos por fecha" marks={myMarks} />

          {showPairs && <Barras title="Con quién te va bien" rows={myPartners} gente={gente} />}
        </>
      )}
    </div>
  )
}
