import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import {
  computeRanking,
  computeStandings,
  includes,
  mastersChampion,
  mastersQualifiers,
  members,
  previousContext,
  resolveDisciplineBySlug,
  sameSide,
  snapshotForMatchday,
  type MatchResult,
  type SeasonConfig,
  type Side,
  type SideSize,
  type SideStanding,
} from '@/core'
import {
  attendancesOf,
  disciplineOf,
  entriesOf,
  matchdayDetail,
  pairLocksOf,
  seasonHeader,
  seasonMatchdaysOf,
} from '@/db/read'
import { awardsBefore, closedHistory, frozenPointsOf } from '@/db/season'
import { serverClient } from '@/db/server'
import { EdgeError } from '@/db/errors'
import { matchdayFull } from '@/app/format'
import { Rondas, type RoundMatchVM, type RoundVM } from './rondas'
import { Armado, type DraftPairVM, type GuestPairVM, type GuestVM, type SeatVM } from './armado'
import { CierreFecha } from './carga'
import { DiaDeLaFecha } from './dia'
import { MastersDraft, type QualifierVM } from './masters'
import { SumarInvitado, type GuestPromoteVM, type SumarSeatVM } from './sumar'
import { guestsToPromote } from './sumar-state'

interface PageProps {
  params: Promise<{ id: string; disciplina: string; n: string }>
}

/** Clave estable de un lado, de uno o de dos: el orden de los miembros no importa. */
function sideKey(side: Side): string {
  return [...members(side)].sort().join('~')
}

function totalGames(match: MatchResult): [number, number] {
  let a = 0
  let b = 0
  for (const set of match.sets) {
    a += set.gamesA
    b += set.gamesB
  }
  return [a, b]
}

/** Ganador del partido por sets, la misma cuenta que usa `computeStandings`. `null` sin resultado. */
function matchWinner(match: MatchResult): 'A' | 'B' | null {
  if (match.sets.length === 0) return null
  let setsA = 0
  let setsB = 0
  for (const set of match.sets) {
    if (set.gamesA > set.gamesB) setsA++
    else if (set.gamesB > set.gamesA) setsB++
  }
  if (setsA === setsB) return null
  return setsA > setsB ? 'A' : 'B'
}

/**
 * Si la tabla se resolvió por desempate, arma la frase con el criterio real que
 * cortó, mirando `PairStanding` (posición, partidos ganados, diferencia de
 * games) de a pares consecutivos: el patrón del handoff describe exactamente el
 * caso de "empataron en partidos ganados, cortó la diferencia de games".
 */
function tiebreakNote(
  standings: SideStanding[],
  config: SeasonConfig,
  nameOf: Map<string, string>,
  sideSize: SideSize,
): string | null {
  const label = (side: Side) => sideLabel(side, nameOf)
  // S41 (verify-report ronda 13): el slice anterior normalizó "parejas"→
  // "jugadores" en cinco lugares y dejó éste, que es el único texto largo de
  // la pantalla — "Jugador de test 3 QUEDARON 3° ... EMPATARON en partidos
  // ganados" sobre una persona sola.
  const quedaron = sideSize === 1 ? 'quedó' : 'quedaron'
  const empataron = sideSize === 1 ? 'empató' : 'empataron'
  const usesSetsDiff = config.matchFormat.setsToWin > 1

  for (let i = 1; i < standings.length; i++) {
    const better = standings[i - 1]
    const worse = standings[i]
    if (better === undefined || worse === undefined) continue
    if (better.won !== worse.won) continue
    if (usesSetsDiff && better.setsDiff !== worse.setsDiff) continue

    if (better.gamesDiff !== worse.gamesDiff) {
      return `${label(worse.side)} ${quedaron} ${worse.position}° por diferencia de games: ${empataron} en partidos ganados con ${label(better.side)}.`
    }

    // ponytail: con todo empatado (partidos ganados y diferencia de games) el
    // corte real pasa por el resultado directo o, en un triple empate, por el
    // snapshot — ambos viven adentro de `computeStandings` y no se reexponen.
    // No hay copy contractual para ese caso puntual y no ocurre con el formato
    // a un set por defecto (sin empates posibles); si hiciera falta, se
    // exporta el criterio exacto desde `core/standings.ts`.
    return `${label(worse.side)} ${quedaron} ${worse.position}° por el desempate de la fecha: ${empataron} en partidos ganados y en diferencia de games con ${label(better.side)}.`
  }
  return null
}

/**
 * El nombre de un lado: los dos nombres unidos con `&` cuando es una pareja, y
 * el nombre solo cuando la disciplina se juega de a uno — donde "Fulano &
 * undefined" era exactamente lo que salía antes de que `Side` existiera.
 */
function sideLabel(side: Side, nameOf: ReadonlyMap<string, string>): string {
  return members(side)
    .map((entryId) => nameOf.get(entryId) ?? '?')
    .join(' & ')
}

/**
 * Fecha `[n]` — Task 8, Plan 3. Sólo lectura: dibuja lo que ya pasó (parejas,
 * fixture con los resultados que existan, tabla de la fecha). No arma el
 * wizard de DRAFT, no carga resultados, no cierra ni reabre — todo eso es
 * Plan 4.
 */
export default async function FechaDetailPage({ params }: PageProps) {
  const { id: seasonId, disciplina, n } = await params
  const matchdayNumber = Number(n)
  const supabase = await serverClient()

  const [header, matchdays] = await Promise.all([
    seasonHeader(supabase, seasonId),
    seasonMatchdaysOf(supabase, seasonId),
  ])

  // REQ-NR-5: slug desconocido, o de otra temporada — mismo `notFound()` que
  // `jugador/[entryId]/page.tsx` usa para un `entryId` que no resuelve.
  const discipline = resolveDisciplineBySlug(header.disciplines, disciplina)
  if (discipline === undefined) notFound()

  // `number` es único por disciplina (REQ-D3-2), no por temporada: con dos
  // disciplinas del mismo `kind` (Fase 2) puede haber una "fecha 2" de cada
  // una, y buscar sólo por número sin la disciplina de la URL sería
  // ambiguo — se quedaría con la primera que matchee, no necesariamente la
  // que pidió la URL.
  const matchday = matchdays.find(
    (candidate) => candidate.number === matchdayNumber && candidate.disciplineId === discipline.id,
  )
  if (matchday === undefined) throw new EdgeError('La fecha no existe.')

  // C8, verify-report ronda 4: `entriesOf` sin `disciplineId` explícito
  // resolvía la disciplina por dentro (`defaultDisciplineId`), que no tiene
  // por qué ser la de ESTA fecha — el desempate del día se armaba con el
  // plantel equivocado apenas hubiera más de una disciplina por temporada
  // (PR 11). Por eso `entries` se pide DESPUÉS de conocer `matchday`, con su
  // `disciplineId`, y ya no en el `Promise.all` de arriba.
  const entries = await entriesOf(supabase, seasonId, matchday.disciplineId)

  const nameOf = new Map(entries.map((entry) => [entry.id, entry.displayName]))
  const sideName = (side: Side) => sideLabel(side, nameOf)

  const kicker =
    matchday.status === 'DRAFT'
      ? 'Armando · sólo vos la ves'
      : matchday.status === 'OPEN'
        ? `En juego${matchday.playedOn !== null ? ` · ${matchdayFull(matchday.playedOn)}` : ''}`
        : `Cerrada${matchday.playedOn !== null ? ` · ${matchdayFull(matchday.playedOn)}` : ''}`

  // El vocabulario de la disciplina: un lado de uno no es "una pareja".
  const sideWord = discipline.pairSize === 1 ? 'jugadores' : 'parejas'

  let body: ReactNode = (
    <div className="rounded-card bg-chip p-4 text-center text-[13px] font-[550] text-muted">
      Se está armando. Todavía no hay {sideWord} ni partidos para mostrar.
    </div>
  )

  // El Masters es una fecha más y por eso no tiene ruta propia (decisión
  // registrada 5): se juega acá. Lo que cambia son tres cosas y ninguna más —
  // el título, el armado (4 clasificados en vez de asistencias), y la tabla de
  // la fecha cerrada, que deja lugar al campeón del año.
  const isMasters = matchday.kind === 'MASTERS'

  if (isMasters && matchday.status === 'DRAFT' && header.isAdmin) {
    const seedOrder = entries
      .filter((entry) => entry.kind === 'SQUAD')
      .sort((a, b) => a.seedPosition - b.seedPosition)
      .map((entry) => entry.id)
    const [awardsByMatchday, detail] = await Promise.all([
      awardsBefore(supabase, matchday.disciplineId, matchdayNumber),
      matchdayDetail(supabase, matchday.id),
    ])
    // Adyacente cerrada por PR 10: antes leía primaryDiscipline(header).config
    // ([0] de la temporada), no necesariamente la de ESTA fecha — la URL ya
    // trae la disciplina, así que `matchday.disciplineId` es la fuente real.
    const mastersConfig = disciplineOf(header, matchday.disciplineId).config
    const snapshot = snapshotForMatchday(matchdayNumber, seedOrder, awardsByMatchday, mastersConfig)
    const ranking = computeRanking(awardsByMatchday, seedOrder, mastersConfig, snapshot)

    const qualifiers: QualifierVM[] = mastersQualifiers(ranking).map((entryId) => ({
      entryId,
      name: nameOf.get(entryId) ?? '?',
      points: ranking.find((row) => row.entryId === entryId)?.points ?? 0,
    }))

    body = (
      <MastersDraft
        seasonId={seasonId}
        matchdayId={matchday.id}
        disciplina={disciplina}
        matchdayNumber={matchday.number}
        qualifiers={qualifiers}
        generated={detail.matches.length > 0}
        loadedResults={detail.matches.filter((match) => match.sets.length > 0).length}
      />
    )
  }

  // El armado es del admin y de nadie más: el kicker dice "sólo vos la ves" y
  // `attendances_write` no deja tildar a nadie que no sea admin. Un jugador que
  // llegue a esta URL ve la tarjeta de arriba, que es la verdad para él.
  if (!isMasters && matchday.status === 'DRAFT' && header.isAdmin) {
    const [attendances, detail, locks, lastHistory, beforeLastHistory] = await Promise.all([
      attendancesOf(supabase, matchday.id),
      matchdayDetail(supabase, matchday.id),
      pairLocksOf(supabase, matchday.id),
      closedHistory(supabase, matchday.disciplineId, matchdayNumber - 1),
      closedHistory(supabase, matchday.disciplineId, matchdayNumber - 2),
    ])

    const { defenders, defendersAlreadyRepeated } = previousContext(lastHistory, beforeLastHistory)
    const effectiveDefenders = defenders !== null && !defendersAlreadyRepeated ? defenders : null
    // Los defensores ya llegan como `Side` (PR19): `previousContext` devuelve
    // `null` en una disciplina de a uno —no hay con quién repetir— así que
    // ningún lado se marca como defensor ahí. Antes esto los subía de `Pair` a
    // `Side` con `pair()`; ese puente se fue con el tipo.
    const defendingSide = effectiveDefenders

    // Sin fila de asistencia es "viene": el admin arma la fecha con todos y
    // descuenta a los que avisaron. `seedAttendances` —que corre en cada action,
    // nunca al dibujar— hace que la base opine lo mismo.
    const seats: SeatVM[] = entries
      .filter((entry) => entry.kind === 'SQUAD')
      .sort((a, b) => a.seedPosition - b.seedPosition)
      .map((entry) => ({
        entryId: entry.id,
        name: entry.displayName,
        playing: attendances.get(entry.id) !== 'ABSENT',
      }))

    // `entriesOf` trae los invitados de TODAS las fechas de la temporada, por
    // eso el filtro por `matchdayId`.
    //
    // Los invitados de una fecha son de dos clases, y la pantalla las trata
    // distinto porque el campeonato las trata distinto: los que están trabados
    // con otro invitado son una **pareja invitada** —juegan de amistoso y no
    // cobran ninguno de los dos— y el resto son **sueltos**, que juegan con
    // alguien del torneo y le hacen cobrar a su compañero. Como máximo hay un
    // suelto: es el que aparece cuando el plantel da impar.
    const guestEntries = entries
      .filter((entry) => entry.kind === 'GUEST' && entry.matchdayId === matchday.id)
      .sort((a, b) => a.seedPosition - b.seedPosition)
    const guestById = new Map(guestEntries.map((entry) => [entry.id, entry]))

    const guestPairs: GuestPairVM[] = []
    const inGuestPair = new Set<string>()
    for (const lock of locks) {
      const a = guestById.get(lock.a)
      const b = guestById.get(lock.b)
      if (a === undefined || b === undefined) continue
      guestPairs.push({
        lockId: lock.id,
        a: { entryId: a.id, name: a.displayName },
        b: { entryId: b.id, name: b.displayName },
      })
      inGuestPair.add(a.id).add(b.id)
    }

    const looseGuests: GuestVM[] = guestEntries
      .filter((entry) => !inGuestPair.has(entry.id))
      .map((entry) => {
        const lock = locks.find((candidate) => candidate.a === entry.id || candidate.b === entry.id)
        return {
          entryId: entry.id,
          name: entry.displayName,
          partnerId: lock === undefined ? null : lock.a === entry.id ? lock.b : lock.a,
        }
      })

    const draftPairs: DraftPairVM[] = detail.sides.map((side) => ({
      key: sideKey(side),
      names: sideName(side),
      defending: defendingSide !== null && sameSide(side, defendingSide),
      withGuest: members(side).some((entryId) => detail.guestIds.includes(entryId)),
    }))

    body = (
      <Armado
        seasonId={seasonId}
        matchdayId={matchday.id}
        disciplina={disciplina}
        sideSize={discipline.pairSize}
        matchdayNumber={matchday.number}
        seats={seats}
        looseGuests={looseGuests}
        guestPairs={guestPairs}
        pairs={draftPairs}
        loadedResults={detail.matches.filter((match) => match.sets.length > 0).length}
      />
    )
  }

  if (matchday.status !== 'DRAFT') {
    const status = matchday.status
    // Mismo cierre que arriba (Masters): la config es de la disciplina de
    // ESTA fecha, no la [0] de la temporada.
    const config = disciplineOf(header, matchday.disciplineId).config
    const seedOrder = entries
      .filter((entry) => entry.kind === 'SQUAD')
      .sort((a, b) => a.seedPosition - b.seedPosition)
      .map((entry) => entry.id)

    const canPromote = header.isAdmin && status === 'CLOSED' && !isMasters
    const [detail, awardsByMatchday, lastHistory, beforeLastHistory, frozenPoints] = await Promise.all([
      matchdayDetail(supabase, matchday.id),
      awardsBefore(supabase, matchday.disciplineId, matchdayNumber),
      closedHistory(supabase, matchday.disciplineId, matchdayNumber - 1),
      closedHistory(supabase, matchday.disciplineId, matchdayNumber - 2),
      // Los awards CONGELADOS de ESTA fecha. Alimentan DOS cosas: la tarjeta
      // de "Sumar invitado" y —desde C21, verify-report ronda 14— la columna
      // de puntos de la tabla del día. Por eso la condición ya no es
      // `canPromote` (admin) sino la fecha cerrada: cualquiera que mire una
      // fecha cerrada necesita estos puntos, no sólo quien organiza.
      // Es un viaje de ida y vuelta, no tres: por eso no es `closedHistory`,
      // cuyas otras dos consultas acá son plata tirada (las parejas se
      // descartan y el estado ya lo sabemos).
      status === 'CLOSED' && !isMasters
        ? frozenPointsOf(supabase, matchday.id)
        : Promise.resolve(new Map<string, number>()),
    ])

    const snapshot = snapshotForMatchday(matchdayNumber, seedOrder, awardsByMatchday, config)
    const standings = computeStandings(detail.sides, detail.matches, config, snapshot)

    const { defenders, defendersAlreadyRepeated } = previousContext(lastHistory, beforeLastHistory)
    const effectiveDefenders = defenders !== null && !defendersAlreadyRepeated ? defenders : null
    const defendingSide = effectiveDefenders
    const isDefendingSide = (side: Side) => defendingSide !== null && sameSide(side, defendingSide)

    // Los puntos de la fecha cerrada son los CONGELADOS, no un recálculo.
    //
    // C21 (verify-report ronda 14): acá se llamaba a `computeAwards` con los
    // `guestIds` de HOY. Mientras el conjunto de lados que cobran no cambiara
    // después del cierre las dos fuentes coincidían — y PR18c es lo primero en
    // toda la cadena que hace que cambie. Al promover al invitado que jugó
    // solo, sale de `guestIds`, su lado pasa a cobrar, quedan 9 lados pagos
    // contra 8 valores de puntos y `computeAwards` tira un `Error` PELADO (no
    // `EdgeError`) que el server action re-tira: error boundary de Next, sin
    // mensaje, sobre la pantalla desde la que se acababa de tocar el botón.
    // `validateConfig` exige el largo exacto de `points`, así que no hay
    // holgura posible: pasaba siempre, no era un borde.
    //
    // Leer los congelados es la fuente correcta POR DEFINICIÓN, no un parche:
    // son lo que la fecha repartió, y una fecha cerrada no vuelve a repartir.
    // Es el mismo argumento que ya estaba escrito para la tarjeta de promoción
    // veinte líneas más abajo —"leer `awards` hoy no cambia lo que se ve,
    // cambia DE QUÉ DEPENDE lo que se ve"— que resultó ser cierto también acá.
    // De paso cierra W43 y saca la posibilidad de que esta tabla contradiga a
    // la de la temporada, que lee `awards`.
    //
    // El Masters queda en cero como antes: no reparte puntos (spec 2.7), así
    // que no tiene filas en `awards` y `frozenPointsOf` ni se consulta.
    const pointsByEntry = frozenPoints

    // El campeón del año. Los partidos ganados por jugador salen de `standings`
    // —cada pareja del Masters juega una vez, así que sumar las tres parejas de
    // alguien es su marca— y no de una segunda cuenta propia: dos formas de
    // decidir quién ganó un partido es el bug que ningún test agarra.
    let champion: { name: string; tiebreak: string | null } | null = null
    if (isMasters && status === 'CLOSED') {
      const ranking = computeRanking(awardsByMatchday, seedOrder, config, snapshot)
      const four = mastersQualifiers(ranking)
      const winsOf = (entryId: string) =>
        standings
          .filter((row) => includes(row.side, entryId))
          .reduce((total, row) => total + row.won, 0)

      const championId = mastersChampion(four, detail.matches)
      const wins = winsOf(championId)
      // El formato sólo admite dos desenlaces (spec 2.7): campeón limpio con 3
      // ganados, o triple empate en 2 con uno en 0 — y el empate pasa la mitad
      // de las veces. Un campeón con 2 victorias igual que otros dos, sin una
      // línea que diga por qué es él, se lee como un bug.
      const tied = four.filter((entryId) => winsOf(entryId) === wins)
      const others = tied.filter((entryId) => entryId !== championId).map((id) => nameOf.get(id) ?? '?')
      champion = {
        name: nameOf.get(championId) ?? '?',
        tiebreak:
          others.length === 0
            ? null
            : `${nameOf.get(championId) ?? '?'} y ${others.join(' y ')} ganaron ${wins} partidos cada uno. Corta el ranking del año.`,
      }
    }

    const roundNumbers = [...new Set(detail.matches.map((match) => match.round))].sort((a, b) => a - b)
    const totalRounds = roundNumbers.length
    const rounds: RoundVM[] = roundNumbers.map((roundNumber) => {
      const roundMatches = detail.matches.filter((match) => match.round === roundNumber)
      const playingKeys = new Set<string>()
      for (const match of roundMatches) {
        playingKeys.add(sideKey(match.sideA))
        playingKeys.add(sideKey(match.sideB))
      }
      // La pareja libre existe en una fecha de 5 parejas, donde una descansa por
      // ronda. En el Masters no descansa nadie: son 6 "parejas" que son las tres
      // combinaciones de los mismos 4 jugadores, y cada ronda juega una sola,
      // así que "la que no juega" son cuatro y nombrar una es mentir.
      const restingSide = isMasters
        ? undefined
        : detail.sides.find((side) => !playingKeys.has(sideKey(side)))
      const loadedCount = roundMatches.filter((match) => match.sets.length > 0).length

      const matches: RoundMatchVM[] = roundMatches.map((match, index) => {
        const [gamesA, gamesB] = totalGames(match)
        const winner = matchWinner(match)
        return {
          key: `${roundNumber}-${index}`,
          matchId: match.id,
          pairAName: sideName(match.sideA),
          pairBName: sideName(match.sideB),
          scoreA: match.sets.length === 0 ? '–' : String(gamesA),
          scoreB: match.sets.length === 0 ? '–' : String(gamesB),
          winner,
        }
      })

      return {
        number: roundNumber,
        totalCount: roundMatches.length,
        loadedCount,
        complete: roundMatches.length > 0 && loadedCount === roundMatches.length,
        restingPairName: restingSide !== undefined ? sideName(restingSide) : null,
        matches,
      }
    })

    // Cargar, cerrar y reabrir son de quien organiza. La fecha cerrada no se
    // carga más —el handoff §9c: "sin botones de carga"—, y sólo se reabre la
    // última cerrada: las parejas de las que siguen salieron de esta tabla.
    // `reopen_matchday` lo vuelve a verificar y su mensaje es el que se muestra.
    const cargaContext =
      header.isAdmin && status === 'OPEN'
        ? { seasonId, matchdayId: matchday.id, disciplina, matchdayNumber: matchday.number, format: config.matchFormat }
        : null
    const remainingMatches = detail.matches.filter((match) => match.sets.length === 0).length
    // Para los dos avisos destructivos del pie: "Volver al armado" (spec: no
    // prometer que se conservan las parejas si ya hay algo cargado) y "Borrar
    // fecha", que nombra cuántos resultados se pierde. No sale de
    // `remainingMatches`: una fecha con resultados a medio cargar tiene
    // `remaining > 0` Y resultados a la vez, así que hace falta contar
    // directamente los partidos que ya tienen sets.
    const loadedResults = detail.matches.filter((match) => match.sets.length > 0).length
    // "Reabrir fecha" aparece sólo donde `reopen_matchday` va a decir que sí, y
    // eso son DOS de sus guardas, no una:
    //   · no hay una fecha CLOSED posterior (0005_matchday_moves.sql:180-185)
    //   · no hay otra fecha EN JUEGO (0005:174-179) — una fecha OPEN nunca se
    //     borra sola, así que ahí el botón falla siempre, y "cerré la 2, abrí
    //     la 3, vuelvo a mirar la 2" es el camino normal, no un borde.
    // La tercera guarda —la fecha siguiente en DRAFT— se deja pasar a propósito:
    // si está vacía, `reopen_matchday` la borra y sigue, que es exactamente el
    // caso para el que se escribió; si tiene datos, su mensaje es el correcto.
    // W13 (verify-report ronda 5): `matchdays` es de TODA la temporada
    // (`seasonMatchdaysOf`), pero `reopen_matchday` (0018) filtra sus dos
    // guardas por `discipline_id` — una fecha OPEN o CLOSED de OTRA
    // disciplina no debe apagar el botón acá.
    const ownMatchdays = matchdays.filter((candidate) => candidate.disciplineId === matchday.disciplineId)
    const isLastClosed =
      !ownMatchdays.some(
        (candidate) => candidate.status === 'CLOSED' && candidate.number > matchday.number,
      ) && !ownMatchdays.some((candidate) => candidate.status === 'OPEN' && candidate.id !== matchday.id)

    const hasGuest = (side: Side) => members(side).some((entryId) => detail.guestIds.includes(entryId))
    const anyGuestInTable = status === 'CLOSED' && standings.some((row) => hasGuest(row.side))
    const note = status === 'CLOSED' ? tiebreakNote(standings, config, nameOf, discipline.pairSize) : null

    // Sumar invitado (spec Capability 3) sólo existe con la fecha CLOSED:
    // `promote_guest` rechaza cualquier otro estado del lado de la base, y
    // `sumar.tsx` sólo se monta acá para no ofrecer un botón que siempre
    // falla por estado.
    //
    // Los puntos de la tarjeta salen de `awards` —la tabla CONGELADA, la misma
    // fila que `promote_guest` copia con su `join`—, igual que la tabla del
    // día de arriba: desde C21 (verify-report ronda 14) las dos leen
    // `frozenPoints` y son LA MISMA fuente.
    //
    // N35 (verify-report ronda 15): hasta C21 este párrafo distinguía la
    // tarjeta de `pointsByEntry`, que era un recálculo en vivo, y la
    // distinción era real — medido en una temporada de 12, después de promover
    // la pantalla mostraba al invitado con 5 puntos que no existían en ninguna
    // fila de `awards` y a su compañero con 3 donde la tabla tenía 5. C21
    // borró esa diferencia haciendo que la tabla también lea los congelados,
    // así que el párrafo pasó a distinguir `pointsByEntry` de sí mismo.
    //
    // Lo que sigue valiendo es el argumento, y por eso queda escrito: la
    // tarjeta tiene que prometer lo que la escritura va a GRABAR, no lo que un
    // recálculo daría hoy. Leer `awards` no cambia lo que se ve, cambia DE QUÉ
    // DEPENDE lo que se ve — y resultó ser cierto también para la tabla.
    //
    // La clasificación en sí —qué estado le toca a cada invitado— vive en
    // `sumar-state.ts`, que es pura y por eso tiene tests: acá adentro no los
    // podía tener, y su predicado ya se escribió mal una vez.
    const guestsForPromotion: GuestPromoteVM[] = canPromote
      ? guestsToPromote({ guestIds: detail.guestIds, sides: detail.sides, frozenPoints, nameOf })
      : []
    // La lista de asientos es sólo para el select de "antes de quién" de esa
    // tarjeta: sin invitados que sumar no hay tarjeta, y armarla es trabajo al
    // pedo en la fecha cerrada de cualquier temporada sin invitados.
    const squadSeatsForPromotion: SumarSeatVM[] =
      guestsForPromotion.length === 0
        ? []
        : entries
            .filter((entry) => entry.kind === 'SQUAD')
            .sort((a, b) => a.seedPosition - b.seedPosition)
            .map((entry) => ({ entryId: entry.id, name: entry.displayName }))

    body = (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-1.5">
          {detail.sides.map((side) => {
            const defending = isDefendingSide(side)
            return (
              <span
                key={sideKey(side)}
                className={`rounded-full px-3 py-1.5 text-[11.5px] font-[750] ${
                  defending ? 'bg-ok-bg text-up' : 'bg-chip text-muted'
                }`}
              >
                {sideName(side)}
                {defending ? ' · Defensora' : ''}
              </span>
            )
          })}
        </div>

        {totalRounds > 0 && <Rondas rounds={rounds} totalRounds={totalRounds} carga={cargaContext} />}

        {champion !== null ? (
          <div className="flex flex-col gap-2">
            <div className="rounded-card bg-accent p-5 text-center text-accent-text">
              <p className="text-[10.5px] font-extrabold uppercase tracking-[.14em] opacity-75">
                Campeón del año
              </p>
              <p className="mt-1 text-[26px] font-extrabold tracking-[-.03em]">{champion.name}</p>
            </div>
            {champion.tiebreak !== null && (
              <p className="text-[12.5px] font-[550] text-muted">{champion.tiebreak}</p>
            )}
          </div>
        ) : (
        <div className="flex flex-col gap-2">
          <p className="text-[15px] font-extrabold tracking-[-.02em]">Tabla de la fecha</p>
          <div className="overflow-hidden rounded-[14px] border border-line">
            <div className="grid grid-cols-[1fr_34px_44px_44px] gap-2 bg-chip px-3 py-2 text-[9.5px] font-extrabold uppercase tracking-[.13em] text-muted">
              <span>{discipline.pairSize === 1 ? 'Jugador' : 'Pareja'}</span>
              <span className="text-right">PG</span>
              <span className="text-right">Dif</span>
              <span className="text-right">Pts</span>
            </div>
            {standings.map((row, index) => {
              const guestInRow = status === 'CLOSED' && hasGuest(row.side)
              // La columna son "los puntos que se llevó cada jugador"
              // (`ui-screens.md` §9), y en la pareja del invitado los dos no se
              // llevan lo mismo: el invitado 0 y su compañero lo que le tocó.
              // El `??` resuelve eso solo, porque `computeAwards` no le escribe
              // award al invitado. Antes esta fila mostraba `0` fijo, y con eso
              // la pareja que ganaba la fecha 3-0 aparecía sin puntos abajo de
              // otra con un partido ganado — contradiciendo la nota que está dos
              // líneas más abajo, "su compañero sí". Lo encontró la Task 14.
              // El primer miembro del lado que tenga award manda: en la pareja
              // del invitado los dos no cobran lo mismo (el invitado 0), y en un
              // lado de uno hay un solo miembro y es el suyo. `members` recorre
              // los que haya, así que la regla es la misma para las dos formas.
              const pts =
                status === 'OPEN'
                  ? '—'
                  : String(
                      members(row.side)
                        .map((entryId) => pointsByEntry.get(entryId))
                        .find((points) => points !== undefined) ?? 0,
                    )
              const diff = row.gamesDiff
              return (
                <div
                  key={sideKey(row.side)}
                  className={`grid grid-cols-[1fr_34px_44px_44px] items-center gap-2 px-3 py-2 text-[13.5px] ${
                    index > 0 ? 'border-t border-line' : ''
                  }`}
                >
                  <span className="flex items-center gap-1.5 font-bold">
                    {sideName(row.side)}
                    {guestInRow && (
                      <span className="shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[9px] font-extrabold text-muted">
                        Invitado
                      </span>
                    )}
                  </span>
                  <span className="text-right font-bold text-muted">{row.won}</span>
                  <span className="text-right font-bold text-muted">
                    {diff >= 0 ? '+' : ''}
                    {diff}
                  </span>
                  <span className="text-right text-[17px] font-extrabold">{pts}</span>
                </div>
              )
            })}
          </div>

          {status === 'OPEN' && (
            <p className="text-[12.5px] font-[550] text-muted">
              Se actualiza a medida que se cargan los resultados. Los puntos se reparten al cerrar la fecha.
            </p>
          )}

          {anyGuestInTable && (
            <p className="text-[11.5px] font-[600] text-muted">
              El invitado no suma para el campeonato; su compañero sí.
            </p>
          )}

          {guestsForPromotion.length > 0 && (
            <SumarInvitado seasonId={seasonId} guests={guestsForPromotion} seats={squadSeatsForPromotion} />
          )}

          {note !== null && <p className="text-[12.5px] font-[550] text-muted">{note}</p>}
        </div>
        )}

        {header.isAdmin && (
          <CierreFecha
            context={{
              seasonId,
              matchdayId: matchday.id,
              disciplina,
              matchdayNumber: matchday.number,
              format: config.matchFormat,
            }}
            status={status}
            remaining={remainingMatches}
            canReopen={isLastClosed}
            loadedResults={loadedResults}
          />
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 pt-3">
      <header className="flex flex-col gap-[3px]">
        <Link href={`/torneo/${seasonId}/${disciplina}/fechas`} className="-mt-2 mb-1 flex min-h-[44px] w-fit items-center text-[12.5px] font-bold text-accent-link">
          ← Volver
        </Link>
        <p className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">{kicker}</p>
        <h1 className="text-[26px] font-extrabold tracking-[-.03em]">
          {isMasters ? 'Masters' : `Fecha ${matchday.number}`}
        </h1>
      </header>

      {/* El día se elegía una sola vez, al abrir la fecha, y quedaba para
          siempre. Un toque de más y el error no se podía deshacer. */}
      {header.isAdmin && (
        <DiaDeLaFecha
          seasonId={seasonId}
          matchdayId={matchday.id}
          matchdayNumber={matchday.number}
          playedOn={matchday.playedOn}
        />
      )}

      {body}
    </div>
  )
}
