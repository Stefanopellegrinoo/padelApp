import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  computeAwards,
  computeRanking,
  computeStandings,
  mastersChampion,
  mastersQualifiers,
  previousContext,
  samePair,
  snapshotForMatchday,
  type MatchResult,
  type Pair,
  type PairStanding,
  type SeasonConfig,
} from '@/core'
import { attendancesOf, entriesOf, matchdayDetail, matchdaysOf, pairLocksOf, seasonHeader } from '@/db/read'
import { awardsBefore, closedHistory, frozenPointsOf } from '@/db/season'
import { serverClient } from '@/db/server'
import { EdgeError } from '@/db/errors'
import { matchdayFull } from '@/app/format'
import { Rondas, type RoundMatchVM, type RoundVM } from './rondas'
import { Armado, type DraftPairVM, type GuestPairVM, type GuestVM, type SeatVM } from './armado'
import { CierreFecha } from './carga'
import { DiaDeLaFecha } from './dia'
import { MastersDraft, type QualifierVM } from './masters'
import { SumarInvitado, type SumarSeatVM } from './sumar'
import { guestsToPromote, type GuestPromoteVM } from './sumar-state'

interface PageProps {
  params: Promise<{ id: string; n: string }>
}

function pairKey(pair: Pair): string {
  return [pair.a, pair.b].sort().join('~')
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
function tiebreakNote(standings: PairStanding[], config: SeasonConfig, nameOf: Map<string, string>): string | null {
  const label = (pair: Pair) => `${nameOf.get(pair.a) ?? '?'} & ${nameOf.get(pair.b) ?? '?'}`
  const usesSetsDiff = config.matchFormat.setsToWin > 1

  for (let i = 1; i < standings.length; i++) {
    const better = standings[i - 1]
    const worse = standings[i]
    if (better === undefined || worse === undefined) continue
    if (better.won !== worse.won) continue
    if (usesSetsDiff && better.setsDiff !== worse.setsDiff) continue

    if (better.gamesDiff !== worse.gamesDiff) {
      return `${label(worse.pair)} quedaron ${worse.position}° por diferencia de games: empataron en partidos ganados con ${label(better.pair)}.`
    }

    // ponytail: con todo empatado (partidos ganados y diferencia de games) el
    // corte real pasa por el resultado directo o, en un triple empate, por el
    // snapshot — ambos viven adentro de `computeStandings` y no se reexponen.
    // No hay copy contractual para ese caso puntual y no ocurre con el formato
    // a un set por defecto (sin empates posibles); si hiciera falta, se
    // exporta el criterio exacto desde `core/standings.ts`.
    return `${label(worse.pair)} quedaron ${worse.position}° por el desempate de la fecha: empataron en partidos ganados y en diferencia de games con ${label(better.pair)}.`
  }
  return null
}

/**
 * Fecha `[n]` — Task 8, Plan 3. Sólo lectura: dibuja lo que ya pasó (parejas,
 * fixture con los resultados que existan, tabla de la fecha). No arma el
 * wizard de DRAFT, no carga resultados, no cierra ni reabre — todo eso es
 * Plan 4.
 */
export default async function FechaDetailPage({ params }: PageProps) {
  const { id: seasonId, n } = await params
  const matchdayNumber = Number(n)
  const supabase = await serverClient()

  const [header, entries, matchdays] = await Promise.all([
    seasonHeader(supabase, seasonId),
    entriesOf(supabase, seasonId),
    matchdaysOf(supabase, seasonId),
  ])

  const matchday = matchdays.find((candidate) => candidate.number === matchdayNumber)
  if (matchday === undefined) throw new EdgeError('La fecha no existe.')

  const nameOf = new Map(entries.map((entry) => [entry.id, entry.displayName]))
  const pairName = (pair: Pair) => `${nameOf.get(pair.a) ?? '?'} & ${nameOf.get(pair.b) ?? '?'}`

  const kicker =
    matchday.status === 'DRAFT'
      ? 'Armando · sólo vos la ves'
      : matchday.status === 'OPEN'
        ? `En juego${matchday.playedOn !== null ? ` · ${matchdayFull(matchday.playedOn)}` : ''}`
        : `Cerrada${matchday.playedOn !== null ? ` · ${matchdayFull(matchday.playedOn)}` : ''}`

  let body: ReactNode = (
    <div className="rounded-card bg-chip p-4 text-center text-[13px] font-[550] text-muted">
      Se está armando. Todavía no hay parejas ni partidos para mostrar.
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
      awardsBefore(supabase, seasonId, matchdayNumber),
      matchdayDetail(supabase, matchday.id),
    ])
    const snapshot = snapshotForMatchday(matchdayNumber, seedOrder, awardsByMatchday, header.config)
    const ranking = computeRanking(awardsByMatchday, seedOrder, header.config, snapshot)

    const qualifiers: QualifierVM[] = mastersQualifiers(ranking).map((entryId) => ({
      entryId,
      name: nameOf.get(entryId) ?? '?',
      points: ranking.find((row) => row.entryId === entryId)?.points ?? 0,
    }))

    body = (
      <MastersDraft
        seasonId={seasonId}
        matchdayId={matchday.id}
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
      closedHistory(supabase, seasonId, matchdayNumber - 1),
      closedHistory(supabase, seasonId, matchdayNumber - 2),
    ])

    const { defenders, defendersAlreadyRepeated } = previousContext(lastHistory, beforeLastHistory)
    const effectiveDefenders = defenders !== null && !defendersAlreadyRepeated ? defenders : null

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

    const draftPairs: DraftPairVM[] = detail.pairs.map((pair) => ({
      key: pairKey(pair),
      names: pairName(pair),
      defending: effectiveDefenders !== null && samePair(pair, effectiveDefenders),
      withGuest: detail.guestIds.includes(pair.a) || detail.guestIds.includes(pair.b),
    }))

    body = (
      <Armado
        seasonId={seasonId}
        matchdayId={matchday.id}
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
    const config = header.config
    const seedOrder = entries
      .filter((entry) => entry.kind === 'SQUAD')
      .sort((a, b) => a.seedPosition - b.seedPosition)
      .map((entry) => entry.id)

    const canPromote = header.isAdmin && status === 'CLOSED' && !isMasters
    const [detail, awardsByMatchday, lastHistory, beforeLastHistory, frozenPoints] = await Promise.all([
      matchdayDetail(supabase, matchday.id),
      awardsBefore(supabase, seasonId, matchdayNumber),
      closedHistory(supabase, seasonId, matchdayNumber - 1),
      closedHistory(supabase, seasonId, matchdayNumber - 2),
      // Los awards CONGELADOS de ESTA fecha, para la tarjeta de "Sumar
      // invitado" de más abajo. `canPromote` NO sabe si hay invitados —eso lo
      // contesta `detail`, que resuelve en este mismo `Promise.all`—, así que
      // esto sale en TODA fecha cerrada que abra quien organiza, tenga o no
      // invitados. Es un viaje de ida y vuelta, no tres: por eso no es
      // `closedHistory`, cuyas otras dos consultas acá son plata tirada (el
      // estado ya está probado por `canPromote`, y las parejas se descartan).
      canPromote ? frozenPointsOf(supabase, matchday.id) : Promise.resolve(new Map<string, number>()),
    ])

    const snapshot = snapshotForMatchday(matchdayNumber, seedOrder, awardsByMatchday, config)
    const standings = computeStandings(detail.pairs, detail.matches, config, snapshot)

    const { defenders, defendersAlreadyRepeated } = previousContext(lastHistory, beforeLastHistory)
    const effectiveDefenders = defenders !== null && !defendersAlreadyRepeated ? defenders : null
    const isDefendingPair = (pair: Pair) => effectiveDefenders !== null && samePair(pair, effectiveDefenders)

    // El Masters no reparte puntos, así que tampoco se calculan: `computeAwards`
    // devolvería un reparto que no existe en `awards` y que nadie escribió.
    const pointsByEntry =
      status === 'CLOSED' && !isMasters
        ? new Map(computeAwards(standings, config, detail.guestIds).map((award) => [award.entryId, award.points]))
        : new Map<string, number>()

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
          .filter((row) => row.pair.a === entryId || row.pair.b === entryId)
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
        playingKeys.add(pairKey(match.pairA))
        playingKeys.add(pairKey(match.pairB))
      }
      // La pareja libre existe en una fecha de 5 parejas, donde una descansa por
      // ronda. En el Masters no descansa nadie: son 6 "parejas" que son las tres
      // combinaciones de los mismos 4 jugadores, y cada ronda juega una sola,
      // así que "la que no juega" son cuatro y nombrar una es mentir.
      const restingPair = isMasters
        ? undefined
        : detail.pairs.find((pair) => !playingKeys.has(pairKey(pair)))
      const loadedCount = roundMatches.filter((match) => match.sets.length > 0).length

      const matches: RoundMatchVM[] = roundMatches.map((match, index) => {
        const [gamesA, gamesB] = totalGames(match)
        const winner = matchWinner(match)
        return {
          key: `${roundNumber}-${index}`,
          matchId: match.id,
          pairAName: pairName(match.pairA),
          pairBName: pairName(match.pairB),
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
        restingPairName: restingPair !== undefined ? pairName(restingPair) : null,
        matches,
      }
    })

    // Cargar, cerrar y reabrir son de quien organiza. La fecha cerrada no se
    // carga más —el handoff §9c: "sin botones de carga"—, y sólo se reabre la
    // última cerrada: las parejas de las que siguen salieron de esta tabla.
    // `reopen_matchday` lo vuelve a verificar y su mensaje es el que se muestra.
    const cargaContext =
      header.isAdmin && status === 'OPEN'
        ? { seasonId, matchdayId: matchday.id, matchdayNumber: matchday.number, format: config.matchFormat }
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
    const isLastClosed =
      !matchdays.some(
        (candidate) => candidate.status === 'CLOSED' && candidate.number > matchday.number,
      ) && !matchdays.some((candidate) => candidate.status === 'OPEN' && candidate.id !== matchday.id)

    const hasGuest = (pair: Pair) => detail.guestIds.includes(pair.a) || detail.guestIds.includes(pair.b)
    const anyGuestInTable = status === 'CLOSED' && standings.some((row) => hasGuest(row.pair))
    const note = status === 'CLOSED' ? tiebreakNote(standings, config, nameOf) : null

    // Sumar invitado (spec Capability 3) sólo existe con la fecha CLOSED:
    // `promote_guest` rechaza cualquier otro estado del lado de la base, y
    // `sumar.tsx` sólo se monta acá para no ofrecer un botón que siempre
    // falla por estado.
    //
    // Los puntos de la tarjeta salen de `awards` —la tabla CONGELADA, la misma
    // fila que `promote_guest` copia con su `join`— y NO de `pointsByEntry`,
    // que es el recálculo en vivo de veinte líneas más arriba. Reusar
    // `pointsByEntry` parecía lo prudente ("una sola cuenta") y era justo al
    // revés, porque las dos no contestan la misma pregunta: `pointsByEntry`
    // dice cuánto daría un recálculo HOY, y la tarjeta tiene que prometer
    // cuánto va a GRABAR la escritura. Con el salteo silencioso que había
    // antes se separaban: medido en una temporada de 12, después de promover
    // la pantalla mostraba al invitado con 5 puntos que no existían en ninguna
    // fila de `awards` y a su compañero con 3 donde la tabla tenía 5.
    // `promote_guest` ahora refusa ese caso, y sobre los dos escenarios que SÍ
    // acepta —invitado suelto en una temporada de 12, e invitado suelto
    // conviviendo con una pareja toda invitada en una de 8— las dos fuentes
    // coinciden fila por fila. O sea: leer `awards` hoy no cambia lo que se
    // ve, cambia DE QUÉ DEPENDE lo que se ve.
    //
    // La clasificación en sí —qué estado le toca a cada invitado— vive en
    // `sumar-state.ts`, que es pura y por eso tiene tests: acá adentro no los
    // podía tener, y su predicado ya se escribió mal una vez.
    const guestsForPromotion: GuestPromoteVM[] = canPromote
      ? guestsToPromote({ guestIds: detail.guestIds, pairs: detail.pairs, frozenPoints, nameOf })
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
          {detail.pairs.map((pair) => {
            const defending = isDefendingPair(pair)
            return (
              <span
                key={pairKey(pair)}
                className={`rounded-full px-3 py-1.5 text-[11.5px] font-[750] ${
                  defending ? 'bg-ok-bg text-up' : 'bg-chip text-muted'
                }`}
              >
                {pairName(pair)}
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
              <span>Pareja</span>
              <span className="text-right">PG</span>
              <span className="text-right">Dif</span>
              <span className="text-right">Pts</span>
            </div>
            {standings.map((row, index) => {
              const guestInRow = status === 'CLOSED' && hasGuest(row.pair)
              // La columna son "los puntos que se llevó cada jugador"
              // (`ui-screens.md` §9), y en la pareja del invitado los dos no se
              // llevan lo mismo: el invitado 0 y su compañero lo que le tocó.
              // El `??` resuelve eso solo, porque `computeAwards` no le escribe
              // award al invitado. Antes esta fila mostraba `0` fijo, y con eso
              // la pareja que ganaba la fecha 3-0 aparecía sin puntos abajo de
              // otra con un partido ganado — contradiciendo la nota que está dos
              // líneas más abajo, "su compañero sí". Lo encontró la Task 14.
              const pts =
                status === 'OPEN'
                  ? '—'
                  : String(pointsByEntry.get(row.pair.a) ?? pointsByEntry.get(row.pair.b) ?? 0)
              const diff = row.gamesDiff
              return (
                <div
                  key={pairKey(row.pair)}
                  className={`grid grid-cols-[1fr_34px_44px_44px] items-center gap-2 px-3 py-2 text-[13.5px] ${
                    index > 0 ? 'border-t border-line' : ''
                  }`}
                >
                  <span className="flex items-center gap-1.5 font-bold">
                    {pairName(row.pair)}
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
        <Link href={`/torneo/${seasonId}/fechas`} className="-mt-2 mb-1 flex min-h-[44px] w-fit items-center text-[12.5px] font-bold text-accent-link">
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
