import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import {
  maxMatchesOf,
  bracketOrderNote,
  buildSides,
  computeRanking,
  computeStandings,
  currentPhase,
  groupPhaseMatches,
  groupSides,
  includes,
  isUnplayedThirdPlace,
  mastersChampion,
  mastersQualifiers,
  members,
  phaseIsComplete,
  PHASE_ORDER,
  previousContext,
  resolveDisciplineBySlug,
  sameSide,
  snapshotForMatchday,
  thirdPlaceNote,
  usesSetsDiff,
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
import { pairingContextFor } from '@/db/matchday'
import { sideLabel, tiebreakNote } from './tabla-desempate'
import { TablaDelDia } from './tabla-del-dia'
import { awardsBefore, closedHistory, frozenPointsOf, type FrozenAward } from '@/db/season'
import { serverClient } from '@/db/server'
import { EdgeError } from '@/db/errors'
import { matchdayFull } from '@/app/format'
import { Rondas, type RoundMatchVM, type RoundVM } from './rondas'
import { Armado, type DraftPairVM, type GroupPreviewVM, type GuestPairVM, type GuestVM, type SeatVM } from './armado'
import { CierreFecha } from './carga'
import { DiaDeLaFecha } from './dia'
import { Llave, type LlaveMatchVM } from './llave'
import { MastersDraft, type QualifierVM } from './masters'
import { SumarInvitado, type GuestPromoteVM, type SumarSeatVM } from './sumar'
import { guestsToPromote } from './sumar-state'
import { frozenTableRows, orderMoved } from './tabla-congelada'

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

  //`number` es único por disciplina (REQ-D3-2), no por temporada: con dos
  // disciplinas del mismo `kind` (Fase 2) puede haber una "fecha 2" de cada
  // una, y buscar sólo por número sin la disciplina de la URL sería
  // ambiguo — se quedaría con la primera que matchee, no necesariamente la
  // que pidió la URL.
  const matchday = matchdays.find(
    (candidate) => candidate.number === matchdayNumber && candidate.disciplineId === discipline.id,
  )
  // `notFound()` y no un `EdgeError`, por lo mismo que el slug de arriba: una
  // URL que apunta a una fecha que no existe es un 404, no un error de la app.
  // Las dos rutas de esta pantalla fallaban distinto —el slug daba 404 y el
  // número caía en el error boundary— siendo la misma clase de URL inválida.
  if (matchday === undefined) notFound()

  // `entriesOf` sin `disciplineId` explícito
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

    // S83 (verify-report-pr21 #4004): entre elegir "2 grupos + llave" y
    // confirmar la fecha no había ninguna vista previa del reparto. En DRAFT
    // los partidos TODAVÍA NO EXISTEN (`generatePairs` corre recién al
    // confirmar), así que no hay llave que dibujar — pero sí se puede
    // mostrar el REPARTO: dado el orden real de hoy, quiénes caen en cada
    // grupo. `pairingContextFor` + `buildSides` son la MISMA pareja de
    // funciones que corre `generatePairs` (`db/matchday.ts`) antes de armar
    // los partidos — acá sólo LEEN, no escriben nada — así que el orden que
    // arma esta vista previa es el mismo que va a usar el confirmar de
    // verdad. `groupSides` (`core/knockout.ts`) reparte en SERPENTINA, no en
    // tajadas: si la previa inventara su propio corte secuencial, mostraría
    // un reparto que después `generatePairs` no arma — peor que no tener
    // previa.
    //
    // `pairingContextFor` puede tirar mientras el armado está incompleto
    // (plantel impar sin invitado todavía, puntos que no alcanzan, etc.) —
    // son los MISMOS guards que `generatePairs` aplicaría al confirmar hoy
    // mismo. Sin nada armable todavía no hay nada que previsualizar: mejor
    // ninguna vista previa que una pantalla rota.
    let groupPreview: GroupPreviewVM[] | null = null
    const formatoDraft = matchday.formato

    // S94 (verify-report-pre-contract #4026): mismo estado divergido que
    // C32/W86 — `changeMatchdayFormat` puede tocar `formato` DESPUÉS de que
    // `generatePairs` ya armó el fixture (`pairs` + `matches`) con el viejo,
    // sin volver a sortear (`pairsAndMatchesOf`, `db/read.ts`, no filtra por
    // status: una vez dibujado, `detail.matches` es el fixture REAL,
    // aunque `matchday.formato` haya cambiado después). `drawNote`
    // (armado.tsx) no puede confiar ciegamente en `formato`: tiene que
    // preguntar si el fixture YA SORTEADO sigue cubriendo los grupos que
    // `formato` declara hoy — misma pregunta que W86 resuelve para la tabla
    // del día, sobre `detail.sides` en vez de `standings` porque acá
    // todavía no hay resultados que tabular.
    const groupOfDrawnSide = new Map<string, number>()
    for (const match of groupPhaseMatches(detail.matches)) {
      groupOfDrawnSide.set(sideKey(match.sideA), match.grupo)
      groupOfDrawnSide.set(sideKey(match.sideB), match.grupo)
    }
    const candidateGroupsDraft: Side[][] =
      formatoDraft.kind === 'GROUPS_KNOCKOUT'
        ? Array.from({ length: formatoDraft.groups }, (_, index) =>
            detail.sides.filter((side) => groupOfDrawnSide.get(sideKey(side)) === index + 1),
          )
        : []
    const drawnCoversFormatoGroups =
      candidateGroupsDraft.every((group) => group.length > 0) &&
      candidateGroupsDraft.reduce((sum, group) => sum + group.length, 0) === detail.sides.length
    const formatDrifted = formatoDraft.kind === 'GROUPS_KNOCKOUT' && !drawnCoversFormatoGroups

    if (formatoDraft.kind === 'GROUPS_KNOCKOUT') {
      try {
        const { input, pairSize } = await pairingContextFor(supabase, matchday.id)
        const previewSides = buildSides({ ...input, sideSize: pairSize })
        groupPreview = groupSides(previewSides, formatoDraft.groups).map((group, index) => ({
          number: index + 1,
          names: group.map((previewSide) => sideName(previewSide)),
        }))
      } catch {
        groupPreview = null
      }
    }

    body = (
      <Armado
        seasonId={seasonId}
        matchdayId={matchday.id}
        disciplina={disciplina}
        sideSize={discipline.pairSize}
        maxMatches={maxMatchesOf(discipline.config, discipline.pairSize)}
        matchdayNumber={matchday.number}
        seats={seats}
        looseGuests={looseGuests}
        guestPairs={guestPairs}
        pairs={draftPairs}
        loadedResults={detail.matches.filter((match) => match.sets.length > 0).length}
        formato={matchday.formato}
        formatDrifted={formatDrifted}
        groupPreview={groupPreview}
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
      // de "Sumar invitado" y —desde C21, — la columna
      // de puntos de la tabla del día. Por eso la condición ya no es
      // `canPromote` (admin) sino la fecha cerrada: cualquiera que mire una
      // fecha cerrada necesita estos puntos, no sólo quien organiza.
      // Es un viaje de ida y vuelta, no tres: por eso no es `closedHistory`,
      // cuyas otras dos consultas acá son plata tirada (las parejas se
      // descartan y el estado ya lo sabemos).
      status === 'CLOSED' && !isMasters
        ? frozenPointsOf(supabase, matchday.id)
        : Promise.resolve(new Map<string, FrozenAward>()),
    ])

    // La fase y la llave (REQ-D8-1, decisión #3979): `matchday.formato` es lo
    // que decide si esta fecha tiene fases que dibujar. `phase`/`phaseComplete`
    // se calculan siempre —son baratos y puros— pero sólo se USAN mientras la
    // fecha está `OPEN` y `GROUPS_KNOCKOUT` (`isGroupsKnockout`, gatea
    // `canClosePhase` directamente, sin pasar por `phase`).
    //
    // (S80, verify-report-pr21 #4004): este bloque decía *"una fecha
    // `ROUND_ROBIN` nunca manda `fase` distinta de `GRUPO` ... así que acá
    // adentro `phase` siempre da `'GRUPO'`"*. Falso en el camino de C31:
    // `redraft_matchday` no borra `matches` (0011), así que una fecha que
    // TUVO una llave y volvió a `ROUND_ROBIN` puede seguir con filas de
    // `SEMI`/`FINAL`/etc. en la base, y `currentPhase` (más abajo) las lee
    // tal cual —devuelve la fase más avanzada que encuentre, sin mirar
    // `matchday.formato`. Lo que SÍ sigue siendo cierto con o sin ese camino:
    // `canClosePhase` está gateado por `isGroupsKnockout`, no por `phase` —
    // con `ROUND_ROBIN` da siempre falso, sea cual sea la fase deducida.
    const isGroupsKnockout = matchday.formato.kind === 'GROUPS_KNOCKOUT'

    const snapshot = snapshotForMatchday(matchdayNumber, seedOrder, awardsByMatchday, config)
    // Restricción de pureza del design (#3801, PUNTO 6): "computeStandings
    // recibe SÓLO los partidos de la fase que tabula. Filtra el caller." Sin
    // esto, el mano a mano de dos lados del MISMO grupo puede quedar decidido
    // por un partido de la LLAVE entre ellos —`headToHead` (core/standings.ts)
    // devuelve el PRIMER partido que los conecta en el array, así que el orden
    // de llegada, no el resultado de grupo, terminaba mandando (W71,
    // verify-report-pr21 #4004). La tabla de la fecha en GROUPS_KNOCKOUT es
    // SIEMPRE la de GRUPO —mientras está OPEN, la fase actual, no ninguna
    // otra; una vez CLOSED, TODA la fase de grupos— nunca la fecha entera:
    // filtrar por la fase actual dejaría la tabla con 2 o 4 filas apenas
    // arranca la llave, y el resto de los lados desaparecería de una tabla
    // que hoy los muestra a todos (S82, otra tanda, sigue sin separar por
    // grupo pero sigue mostrando a todos).
    //
    // CLOSED entra al mismo filtro por lo mismo que ya vale para OPEN: el
    // punto de la fecha (W70, verify-report-pr21 #4004) es que
    // `standingsFromBracket` (`db/matchday.ts`) — quien de verdad calculó los
    // awards al cerrar — arma su `groupTable` con `computeStandings` sobre
    // SÓLO los partidos de GRUPO, y `knockoutPositions` (core/knockout.ts)
    // copia esas mismas filas (`statsOf`) para el podio. Antes de este fix
    // `standingsMatches` era `detail.matches` sin filtrar para CLOSED, así
    // que el `PG`/`Dif` de esta pantalla sumaban semis y final —medido: un
    // campeón con 3 partidos de grupo mostraba PG 5— mientras los puntos que
    // cobró salieron de sumar sólo 3. Las dos tablas tienen que ser la MISMA
    // tabla.
    const standingsMatches = isGroupsKnockout ? groupPhaseMatches(detail.matches) : detail.matches
    const standings = computeStandings(detail.sides, standingsMatches, config, snapshot, matchday.allowsDraw)

    // S82 (verify-report-pr21 #4004): la tabla del día de una fecha
    // `GROUPS_KNOCKOUT` OPEN mostraba UNA sola tabla con las filas de los dos
    // grupos mezcladas. Con grupos, la pregunta del admin es "¿quién
    // clasifica de MI grupo?" y una tabla combinada no la contesta: dos
    // lados con el mismo puntaje pueden estar en grupos distintos y no
    // competir entre sí por nada. Sólo OPEN: la fecha CERRADA cruza los
    // grupos A PROPÓSITO (decisión #3962) — el campeón sale de la FINAL, no
    // de su grupo, y partir esa tabla rompería el orden mixto que ya costó
    // dos rondas fijar (W55/W56/W57).
    //
    // No recalcula nada: `standingsMatches` (arriba) ya viene filtrado a
    // `fase === 'GRUPO'` cuando `isGroupsKnockout`, y cada fila de partido
    // trae su propio `grupo` (lo escribe `groupedMatches`, `db/matchday.ts`,
    // al generar los partidos) — la MISMA partición que `matchupsAfterGroups`
    // arma con `groupSides` para calcular la llave. Alcanza con leerlo.
    const groupOfSide = new Map<string, number>()
    for (const match of standingsMatches) {
      groupOfSide.set(sideKey(match.sideA), match.grupo)
      groupOfSide.set(sideKey(match.sideB), match.grupo)
    }
    const formatoAbierto = matchday.formato
    // W82 (verify-report-pr21-cierre #4016) + W86 (verify-report-pre-contract
    // #4026): `formatoAbierto.groups` fija CUÁNTOS bloques dibujar sin mirar
    // si `groupOfSide` de verdad cubre CADA UNO de esos bloques. Si
    // `matchday.formato` y `matches.grupo` divergen (el fixture roto de C32:
    // formato cambiado después de sortear, sin volver a sortear), la pregunta
    // "¿todo lado está en ALGÚN grupo?" (el guard viejo, `allSidesGrouped`) NO
    // es la misma que "¿algún grupo DECLARADO quedó vacío?" — con un round
    // robin completo sin re-sortear, los 28 partidos nacen `grupo=1` (default
    // de columna, `0039`), así que TODOS los lados están en groupOfSide y el
    // guard viejo daba `true`: partía en 2 bloques y "Grupo 2" salía con
    // encabezado y cero filas. El guard correcto arma la partición candidata
    // y exige que NINGÚN grupo quede vacío Y que la suma cubra a todos los
    // lados (la segunda condición sigue cazando el hueco original de W82: un
    // lado sin ningún partido de grupo tampoco cae en ningún índice). Con
    // cualquiera de los dos huecos, la pantalla NO adivina en qué grupo cae
    // lo que falta —esa es justo la pregunta que C32 deja sin responder—: cae
    // a la tabla ÚNICA (misma que ROUND_ROBIN/CLOSED ya usan) para que todos
    // sigan visibles, y `groupMismatchNote` (más abajo) explica por qué no se
    // pudo partir.
    const candidateGroups: SideStanding[][] =
      formatoAbierto.kind === 'GROUPS_KNOCKOUT'
        ? Array.from({ length: formatoAbierto.groups }, (_, index) =>
            standings.filter((row) => groupOfSide.get(sideKey(row.side)) === index + 1),
          )
        : []
    const groupsCoverEveryone =
      candidateGroups.every((rows) => rows.length > 0) &&
      candidateGroups.reduce((sum, rows) => sum + rows.length, 0) === standings.length
    const groupedStandings: SideStanding[][] =
      status === 'OPEN' && formatoAbierto.kind === 'GROUPS_KNOCKOUT' && groupsCoverEveryone
        ? candidateGroups
        : []
    const groupMismatchNote =
      status === 'OPEN' && formatoAbierto.kind === 'GROUPS_KNOCKOUT' && !groupsCoverEveryone
        ? 'El formato cambió después de sortear: esta tabla no se puede partir por grupo todavía. Volvé al armado y sorteá de nuevo.'
        : null

    const phase = currentPhase(detail.matches)
    const phaseComplete = phase !== null && phaseIsComplete(detail.matches, phase)
    const canClosePhase = header.isAdmin && isGroupsKnockout && phase !== null && phase !== 'FINAL' && phaseComplete
    // Orden (fase, grupo, round): `matchdayDetail` sólo ordena por `round`, que
    // vuelve a 1 en cada grupo Y en cada fase de la llave — sin este orden acá,
    // `Llave` agruparía bien por sección pero las SECCIONES saldrían mezcladas
    // (una semifinal antes que un grupo, por ejemplo).
    const llaveMatches: LlaveMatchVM[] = [...detail.matches]
      .sort((a, b) => {
        const phaseDiff = PHASE_ORDER.indexOf(a.fase) - PHASE_ORDER.indexOf(b.fase)
        if (phaseDiff !== 0) return phaseDiff
        if (a.grupo !== b.grupo) return a.grupo - b.grupo
        return a.round - b.round
      })
      .map((match) => {
        const [gamesA, gamesB] = totalGames(match)
        return {
          key: match.id,
          matchId: match.id,
          fase: match.fase,
          grupo: match.grupo,
          sideAName: sideName(match.sideA),
          sideBName: sideName(match.sideB),
          scoreA: match.sets.length === 0 ? '–' : String(gamesA),
          scoreB: match.sets.length === 0 ? '–' : String(gamesB),
          winner: matchWinner(match),
        }
      })

    const { defenders, defendersAlreadyRepeated } = previousContext(lastHistory, beforeLastHistory)
    const effectiveDefenders = defenders !== null && !defendersAlreadyRepeated ? defenders : null
    const defendingSide = effectiveDefenders
    const isDefendingSide = (side: Side) => defendingSide !== null && sameSide(side, defendingSide)

    // Los puntos de la fecha cerrada son los CONGELADOS, no un recálculo.
    //
    // Acá se llamaba a `computeAwards` con los
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

    // Las filas de una fecha CERRADA se ordenan
    // por el puesto CONGELADO, no por el que `computeStandings` calcula hoy.
    // El criterio vive en `tabla-congelada.ts` —módulo puro, testeable— porque
    // entró sin una sola aserción y de ahí salieron W56 y W57.
    //
    // PG y Dif se siguen tomando de `standings`: salen de los resultados, que
    // una fecha cerrada ya no cambia.
    //
    // La condición es la MISMA que la de la carga de `frozenPoints` de
    // arriba, `!isMasters` incluido. El Masters no reparte puntos (spec 2.7),
    // así que su Map llega vacío y el orden se preservaba igual — pero por la
    // estabilidad de `Array.prototype.sort`, una garantía que ningún test fijaba
    // y ningún comentario mencionaba. Que las dos condiciones digan lo mismo
    // saca la asimetría que parecía un olvido.
    const tableRows =
      status === 'CLOSED' && !isMasters ? frozenTableRows(standings, frozenPoints) : standings

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
    // Excluye un `TERCER_PUESTO` sin jugar (decisiones #3979/#3988): la RPC
    // `close_matchday` (0041) ya tolera cerrar con ese único partido vacío, y
    // el botón "Cerrar fecha" de más abajo tiene que estar de acuerdo — si
    // no, queda deshabilitado para siempre con "faltan 1 partidos" aunque el
    // servidor acepte cerrar. `isUnplayedThirdPlace` (core/knockout.ts): la
    // misma regla vive también en `closeMatchday` (db/matchday.ts) y en 0041
    // (SQL) — refactor sobre PR21 D2, sin esto la regla quedaba escrita tres
    // veces.
    const remainingMatches = detail.matches.filter(
      (match) => match.sets.length === 0 && !isUnplayedThirdPlace(match),
    ).length
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
    //`matchdays` es de TODA la temporada
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
    // El pie describe el orden que la tabla
    // DIBUJA, o no se dibuja. `tiebreakNote` sale de `standings` e imprime
    // `worse.position`, el puesto que `computeStandings` calcula hoy; desde que
    // la tabla se ordena por el puesto congelado las dos fuentes se pueden
    // contradecir, y el pie es el único ordinal que el usuario ve porque la
    // tabla no imprime puestos. Medido: decía "quedó 2°" sobre quien la tabla
    // dibuja primero, citando como mejor a alguien dos filas más abajo.
    //
    // Pasarle `tableRows` no alcanza —`worse.position` sigue siendo el vivo— y
    // reescribir el ordinal sería peor: el desempate que el pie explica lo hizo
    // `computeStandings` sobre el orden vivo, así que sobre el congelado estaría
    // explicando una comparación que nunca ocurrió. Cuando el orden no se movió,
    // que es el caso normal, el pie se ve igual que siempre.
    const note =
      status === 'CLOSED' && !orderMoved(standings, tableRows)
        ? tiebreakNote(standings, config, nameOf, discipline.pairSize)
        : null

    // W70 (verify-report-pr21 #4004), decisión #3962 respetada: el orden NO
    // cambia, esto sólo lo explica. En GROUPS_KNOCKOUT el orden congelado casi
    // siempre mueve el podio (`knockoutPositions` lo arma con el resultado de
    // la LLAVE, no con la tabla de grupos), así que `orderMoved` de arriba
    // apaga a `tiebreakNote` en el caso NORMAL de una fecha con llave —no en
    // el borde raro que `tiebreakNote` ya cubre— y el pie se queda mudo justo
    // donde más hace falta: medido, dos lados con el mismo `PG` y la misma
    // diferencia en un orden que ninguna columna explica. Mutuamente
    // excluyente con `note`: cuando el orden no se movió, `tiebreakNote` ya lo
    // explica y esto no hace falta. `config.matchFormat`, no un "games" fijo:
    // la llave existe sobre todo en FIFA, donde eso es gol, no games —mismo
    // argumento de `tiebreakNote` dos líneas arriba.
    const bracketNote =
      status === 'CLOSED' && isGroupsKnockout && orderMoved(standings, tableRows)
        ? bracketOrderNote(config.matchFormat)
        : null

    // Decisión #3990: el costo que quedó vivo de #3979 ("se puede cerrar sin
    // jugar el tercer puesto") era que nadie se enteraba de que el 3º/4º salió
    // de la tabla de grupos y no de la cancha. Sólo en la fecha CERRADA — es
    // ahí donde se congeló ese resultado.
    const thirdNote = status === 'CLOSED' && isGroupsKnockout ? thirdPlaceNote(detail.matches) : null

    // Sumar invitado (spec Capability 3) sólo existe con la fecha CLOSED:
    // `promote_guest` rechaza cualquier otro estado del lado de la base, y
    // `sumar.tsx` sólo se monta acá para no ofrecer un botón que siempre
    // falla por estado.
    //
    // Los puntos de la tarjeta salen de `awards` —la tabla CONGELADA, la misma
    // fila que `promote_guest` copia con su `join`—, igual que la tabla del
    // día de arriba: desde C21 las dos leen
    // `frozenPoints` y son LA MISMA fuente.
    //
    // Hasta C21 este párrafo distinguía la
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
      ? guestsToPromote({
          guestIds: detail.guestIds,
          sides: detail.sides,
          frozenPoints: new Map([...frozenPoints].map(([entryId, award]) => [entryId, award.points])),
          nameOf,
        })
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

        {/* GROUPS_KNOCKOUT — `Llave` reemplaza a `Rondas` siempre, OPEN o
            CLOSED: agrupa por fase/grupo, no por `round` (que vuelve a 1 en
            cada grupo y en cada fase de la llave). Hasta acá (W70,
            verify-report-pr21 #4004) una fecha CERRADA seguía mostrando
            `Rondas`, que agrupa TODO por `round` — 4 partidos de grupo, las
            semis, la final y el tercer puesto vacío bajo el mismo título
            "Ronda 1", sin que la palabra "Semifinal" o "Final" aparezca una
            sola vez, y con un contador "7/8 cargados" mintiendo sobre una
            fecha que cerró bien (decisión #3979). No era cosmético: era el
            registro histórico de la llave desapareciendo justo cuando la
            fecha pasa a ser historia. `phase` sólo se le pasa mientras está
            OPEN — una fecha CERRADA no tiene una "fase actual", ya jugó
            todas. */}
        {isGroupsKnockout ? (
          <Llave
            seasonId={seasonId}
            matchdayId={matchday.id}
            matchdayNumber={matchday.number}
            phase={status === 'OPEN' ? phase : null}
            matches={llaveMatches}
            canClosePhase={canClosePhase}
            carga={cargaContext}
          />
        ) : (
          totalRounds > 0 && <Rondas rounds={rounds} totalRounds={totalRounds} carga={cargaContext} />
        )}

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
          {/* S82 (verify-report-pr21 #4004): sólo OPEN se parte por grupo —
              `groupedStandings` (arriba) está VACÍO fuera de
              `OPEN && GROUPS_KNOCKOUT`, así que ROUND_ROBIN y la fecha
              CERRADA (decisión #3962, orden mixto que cruza los grupos a
              propósito) siguen dibujando la MISMA tabla única de siempre, sin
              tocar una línea de ese camino. */}
          {groupedStandings.length > 0 ? (
            <div className="flex flex-col gap-4">
              {groupedStandings.map((rows, index) => (
                <div key={`grupo-${index + 1}`} className="flex flex-col gap-1.5">
                  <p className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">
                    Grupo {index + 1}
                  </p>
                  <TablaDelDia
                    tituloLado={discipline.pairSize === 1 ? 'Jugador' : 'Pareja'}
                    muestraEmpates={matchday.allowsDraw}
                    filas={rows.map((row) => ({
                      key: sideKey(row.side),
                      nombre: sideName(row.side),
                      // OPEN siempre: ni invitado congelado ni puntos
                      // repartidos existen todavía. Mismos valores que la
                      // rama sin partir ya usaba para OPEN, ver abajo.
                      esInvitado: false,
                      won: row.won,
                      drawn: row.drawn,
                      gamesDiff: row.gamesDiff,
                      pts: '—',
                    }))}
                  />
                </div>
              ))}
            </div>
          ) : (
            <TablaDelDia
              tituloLado={discipline.pairSize === 1 ? 'Jugador' : 'Pareja'}
              muestraEmpates={matchday.allowsDraw}
              filas={tableRows.map((row) => ({
                key: sideKey(row.side),
                nombre: sideName(row.side),
                esInvitado: status === 'CLOSED' && hasGuest(row.side),
                won: row.won,
                drawn: row.drawn,
                gamesDiff: row.gamesDiff,
                // La columna son "los puntos que se llevó cada jugador"
                // (`ui-screens.md` §9), y en la pareja del invitado los dos no se
                // llevan lo mismo: el invitado 0 y su compañero lo que le tocó.
                // El `??` resuelve eso solo, porque `computeAwards` no le escribe
                // award al invitado. Antes esta fila mostraba `0` fijo, y con eso
                // la pareja que ganaba la fecha 3-0 aparecía sin puntos abajo de
                // otra con un partido ganado — contradiciendo la nota que está
                // más abajo, "su compañero sí". Lo encontró la Task 14.
                // El primer miembro del lado que tenga award manda: en la pareja
                // del invitado los dos no cobran lo mismo (el invitado 0), y en un
                // lado de uno hay un solo miembro y es el suyo. `members` recorre
                // los que haya, así que la regla es la misma para las dos formas.
                pts:
                  status === 'OPEN'
                    ? '—'
                    : String(
                        members(row.side)
                          .map((entryId) => pointsByEntry.get(entryId)?.points)
                          .find((points) => points !== undefined) ?? 0,
                      ),
              }))}
            />
          )}

          {groupMismatchNote !== null && (
            <p className="rounded-field bg-warn-bg px-3 py-2 text-[12.5px] font-bold">{groupMismatchNote}</p>
          )}

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
          {bracketNote !== null && <p className="text-[12.5px] font-[550] text-muted">{bracketNote}</p>}
          {thirdNote !== null && <p className="text-[12.5px] font-[550] text-muted">{thirdNote}</p>}
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
