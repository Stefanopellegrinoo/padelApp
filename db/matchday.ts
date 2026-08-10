import {
  buildFixture,
  buildPairs,
  computeAwards,
  computeRanking,
  computeStandings,
  previousContext,
  snapshotForMatchday,
  type Award,
  type EntryId,
  type MatchFormat,
  type MatchResult,
  type Pair,
  type PairingInput,
  type SeasonConfig,
  type SetScore,
} from '@/core'
import type { Database, Json } from './database.types'
import { EdgeError } from './errors'
import { awardsBefore, closedHistory, seasonConfig, squadSeedOrder, type Client } from './season'
import {
  assertGuestsNamed,
  assertLocksAndGuests,
  assertMatchdaySize,
  assertPointsCoverMatchday,
  assertValidConfig,
  matchError,
  type GuestSeat,
  type PairLock,
} from './validate'

type MatchdayRow = Database['public']['Tables']['matchdays']['Row']

/**
 * What every operation on a matchday needs, whatever it is going to do with it.
 *
 * The snapshot lives here and NOWHERE else. It is the fourth tiebreak of the
 * matchday table (spec 2.3) as well as the tiebreak of the draw, and the two
 * have to be the same one or reopening a matchday and closing it again would
 * produce a different table. A second function computing "the snapshot" its own
 * way is the one bug in this file that no test can catch: both closes would see
 * the same wrong input and agree with each other.
 */
export interface MatchdayContext {
  matchday: MatchdayRow
  config: SeasonConfig
  seedOrder: EntryId[]
  awardsByMatchday: Map<number, Award[]>
  snapshot: EntryId[]
  guests: GuestSeat[]
  locks: PairLock[]
}

export async function matchdayContextFor(
  supabase: Client,
  matchdayId: string,
): Promise<MatchdayContext> {
  const matchday = await requireMatchday(supabase, matchdayId)
  const config = await seasonConfig(supabase, matchday.season_id)
  assertValidConfig(config)

  // The seed order is also the squad, and it must be stable: buildPairs falls
  // back to the order it is given when two players are missing from the
  // snapshot, so an unordered read makes the draw non-deterministic.
  const seedOrder = await squadSeedOrder(supabase, matchday.season_id)

  // Only the CLOSED matchdays BEFORE this one. Never this one: its own table is
  // what the snapshot is being used to break ties in.
  const awardsByMatchday = await awardsBefore(supabase, matchday.season_id, matchday.number)
  const snapshot = snapshotForMatchday(matchday.number, seedOrder, awardsByMatchday, config)

  const guests = await guestsOf(supabase, matchdayId)
  const locks = await locksOf(supabase, matchdayId)
  assertLocksAndGuests(guests, locks)

  return { matchday, config, seedOrder, awardsByMatchday, snapshot, guests, locks }
}

export interface PairingContext extends MatchdayContext {
  input: PairingInput
}

/**
 * Everything the DRAW of one matchday needs, composed out of core/. No rule of
 * the championship is decided here: this function fetches rows and hands them
 * to the functions that know.
 *
 * Closing a matchday does NOT go through here. It asks a different question —
 * "what does what was played pay?" — and running the draw's validations over
 * today's attendance while closing is how a matchday gets stuck.
 */
export async function pairingContextFor(
  supabase: Client,
  matchdayId: string,
): Promise<PairingContext> {
  const context = await matchdayContextFor(supabase, matchdayId)
  const { matchday, config, seedOrder, awardsByMatchday, snapshot, guests, locks } = context

  // Decision 3: the pool is ordered by the ranking — best N of M — and never by
  // a running total. The table you look at is the table that pairs you, and the
  // snapshot chain is built from this same ranking.
  const ranking = computeRanking(awardsByMatchday, seedOrder, config, snapshot)
  const points = new Map(ranking.map((row) => [row.entryId, row.points]))

  const { defenders, defendersAlreadyRepeated, previousPairs } = previousContext(
    await closedHistory(supabase, matchday.season_id, matchday.number - 1),
    await closedHistory(supabase, matchday.season_id, matchday.number - 2),
  )

  const present = [
    ...(await playingEntryIds(supabase, matchdayId)),
    ...guests.map((guest) => guest.entryId),
  ]
  assertMatchdaySize(present)
  assertPointsCoverMatchday(present, guests, locks, config)

  return {
    ...context,
    input: {
      present,
      points,
      snapshot,
      defenders,
      defendersAlreadyRepeated,
      previousPairs,
      guestIds: guests.map((guest) => guest.entryId),
      // Las parejas trabadas ya vienen con la forma de `Pair`: por eso
      // `pair_locks` es una tabla de dos columnas y no un agrupador. No hay
      // nada que convertir, y no hay una función de armado que se pueda
      // equivocar al hacerlo.
      fixedPairs: locks,
    },
  }
}

/** La siguiente fecha por número. Escribe `played_on`: la columna existe y es el dato que muestran todas las pantallas. */
export async function createMatchday(
  supabase: Client,
  seasonId: string,
  playedOn: string,
): Promise<string> {
  const { data: last, error: lastError } = await supabase
    .from('matchdays')
    .select('number')
    .eq('season_id', seasonId)
    .order('number', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (lastError) throw new EdgeError(`No se pudo leer las fechas: ${lastError.message}`)
  const number = (last?.number ?? 0) + 1

  const { data, error } = await supabase
    .from('matchdays')
    .insert({ season_id: seasonId, number, played_on: playedOn })
    .select('id')
    .single()
  if (error !== null) {
    // El índice `matchdays_one_live` rebota esto cuando ya hay otra fecha sin
    // cerrar en la temporada.
    if (error.code === '23505') {
      throw new EdgeError('Ya hay una fecha sin cerrar en esta temporada.')
    }
    throw new EdgeError(`No se pudo crear la fecha: ${error.message}`)
  }
  return data.id
}

/** Tilda viene / no viene. Sólo con la fecha en armado. */
export async function setAttendance(
  supabase: Client,
  matchdayId: string,
  entryId: string,
  status: 'PLAYING' | 'ABSENT',
): Promise<void> {
  const matchday = await requireMatchday(supabase, matchdayId)
  if (matchday.status !== 'DRAFT') {
    throw new EdgeError('El presentismo sólo se toca con la fecha en armado.')
  }

  const { error } = await supabase
    .from('attendances')
    .upsert(
      { matchday_id: matchdayId, entry_id: entryId, season_id: matchday.season_id, status },
      { onConflict: 'matchday_id,entry_id' },
    )
  if (error !== null) throw new EdgeError(`No se pudo guardar el presentismo: ${error.message}`)
}

/** Agrega un asiento GUEST. `seed_position` correlativo entre los invitados de esta fecha; `displayName` puede ir vacío. */
export async function addGuest(
  supabase: Client,
  matchdayId: string,
  { displayName }: { displayName: string },
): Promise<string> {
  const matchday = await requireMatchday(supabase, matchdayId)

  const { data: last, error: lastError } = await supabase
    .from('entries')
    .select('seed_position')
    .eq('matchday_id', matchdayId)
    .eq('kind', 'GUEST')
    .order('seed_position', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (lastError) throw new EdgeError(`No se pudieron leer los invitados: ${lastError.message}`)
  const seedPosition = (last?.seed_position ?? -1) + 1

  const { data, error } = await supabase
    .from('entries')
    .insert({
      season_id: matchday.season_id,
      matchday_id: matchdayId,
      kind: 'GUEST',
      display_name: displayName,
      seed_position: seedPosition,
    })
    .select('id')
    .single()
  if (error !== null) throw new EdgeError(`No se pudo agregar el invitado: ${error.message}`)
  return data.id
}

/** Traba una pareja antes del sorteo. Pasa por `assertLocksAndGuests` antes de escribir. */
export async function lockPair(
  supabase: Client,
  matchdayId: string,
  entryA: string,
  entryB: string,
): Promise<void> {
  const matchday = await requireMatchday(supabase, matchdayId)
  const guests = await guestsOf(supabase, matchdayId)
  const locks = await locksOf(supabase, matchdayId)
  assertLocksAndGuests(guests, [...locks, { a: entryA, b: entryB }])

  const { error } = await supabase.from('pair_locks').insert({
    matchday_id: matchdayId,
    season_id: matchday.season_id,
    entry_a: entryA,
    entry_b: entryB,
  })
  if (error !== null) throw new EdgeError(`No se pudo trabar la pareja: ${error.message}`)
}

/** La destraba. */
export async function unlockPair(supabase: Client, lockId: string): Promise<void> {
  const { error } = await supabase.from('pair_locks').delete().eq('id', lockId)
  if (error !== null) throw new EdgeError(`No se pudo destrabar la pareja: ${error.message}`)
}

/**
 * Draws the pairs and lays out the round robin. Re-runnable on purpose: the
 * DRAFT screen has a regenerate button, and the draw is deterministic, so the
 * same input gives the same pairs every time.
 */
export async function generatePairs(supabase: Client, matchdayId: string): Promise<void> {
  const matchday = await requireMatchday(supabase, matchdayId)
  if (matchday.status !== 'DRAFT') {
    throw new EdgeError('Las parejas sólo se arman con la fecha en armado.')
  }

  const { input } = await pairingContextFor(supabase, matchdayId)
  const pairs = buildPairs(input)
  const fixture = buildFixture(pairs.length)

  // Deleting the pairs cascades to matches and match_sets. In DRAFT there are
  // no results to lose; anywhere else this would be destructive, which is what
  // the status guard above is for.
  await deletePairs(supabase, matchdayId)

  const stored = await insertPairs(supabase, matchdayId, pairs)
  const matches = fixture.flatMap((round, index) =>
    round.map(([left, right]) => {
      const pairA = stored[left]
      const pairB = stored[right]
      if (pairA === undefined || pairB === undefined) {
        throw new Error(
          `El fixture nombró la pareja ${left} o ${right} y sólo hay ${stored.length}. Esto es un bug.`,
        )
      }
      return { matchday_id: matchdayId, round: index + 1, pair_a: pairA, pair_b: pairB }
    }),
  )
  await insertMatches(supabase, matches)
}

export async function openMatchday(supabase: Client, matchdayId: string): Promise<void> {
  const { input, guests } = await pairingContextFor(supabase, matchdayId)
  assertGuestsNamed(guests)

  // Las asistencias se pueden seguir tocando mientras la fecha está en DRAFT,
  // así que las parejas guardadas pueden haber quedado viejas. Éste es el
  // único momento en que la igualdad se puede exigir: una vez OPEN no se
  // regenera, y una fecha con más presentes que jugadores no tiene arreglo.
  const inPairs = new Set((await pairEntryIds(supabase, matchdayId)).flat())
  const present = new Set(input.present)
  const sameSet =
    inPairs.size === present.size && [...present].every((entryId) => inPairs.has(entryId))

  if (!sameSet) {
    throw new EdgeError('Cambió quién viene desde que armaste las parejas. Volvé a generarlas.')
  }

  const { error } = await supabase.rpc('open_matchday', { p_matchday: matchdayId })
  if (error !== null) throw new EdgeError(error.message)
}

/**
 * Freezes the points and shuts the matchday. The table itself is never stored:
 * it is recomputed from match_sets every time, which is what lets an old
 * matchday be replayed and come out the same.
 */
export async function closeMatchday(supabase: Client, matchdayId: string): Promise<void> {
  // matchdayContextFor, NO pairingContextFor: cerrar no es sortear. Pasar por
  // el contexto del sorteo correría las validaciones de asistencia y de tamaño
  // sobre quién viene HOY en vez de sobre quiénes jugaron, y previousContext
  // podría tirar por un problema de la fecha anterior mientras cerrás ésta.
  const { config, guests, snapshot } = await matchdayContextFor(supabase, matchdayId)
  const { pairs, matches } = await resultsOf(supabase, matchdayId)

  for (const match of matches) {
    const problem = matchError(match.sets, config.matchFormat)
    if (problem !== null) throw new EdgeError(problem)
  }

  const standings = computeStandings(pairs, matches, config, snapshot)
  const awards = computeAwards(standings, config, guests.map((guest) => guest.entryId))

  const { error } = await supabase.rpc('close_matchday', {
    p_matchday: matchdayId,
    p_awards: awards as unknown as Json,
  })
  if (error !== null) throw new EdgeError(error.message)
}

/** Guarda el resultado de un partido. Reemplaza cualquier set anterior en vez de acumularlo. */
export async function saveResult(
  supabase: Client,
  matchId: string,
  sets: SetScore[],
): Promise<void> {
  const format = await matchFormatOf(supabase, matchId)
  const problem = matchError(sets, format)
  if (problem !== null) throw new EdgeError(problem)

  // La política match_sets_write ya exige que la fecha esté OPEN: acá alcanza
  // con traducir el error de RLS a un mensaje que se pueda leer.
  const { error: deleteError } = await supabase.from('match_sets').delete().eq('match_id', matchId)
  if (deleteError !== null) {
    throw new EdgeError(`No se pudo guardar el resultado: ${deleteError.message}`)
  }

  const rows = sets.map((set, index) => ({
    match_id: matchId,
    set_number: index + 1,
    games_a: set.gamesA,
    games_b: set.gamesB,
  }))
  const { error: insertError } = await supabase.from('match_sets').insert(rows)
  if (insertError !== null) {
    throw new EdgeError(`No se pudo guardar el resultado: ${insertError.message}`)
  }
}

async function requireMatchday(supabase: Client, matchdayId: string): Promise<MatchdayRow> {
  const { data, error } = await supabase
    .from('matchdays')
    .select('*')
    .eq('id', matchdayId)
    .maybeSingle()
  if (error) throw new EdgeError(`No se pudo leer la fecha: ${error.message}`)
  if (data === null) throw new EdgeError('La fecha no existe.')
  return data
}

async function guestsOf(supabase: Client, matchdayId: string): Promise<GuestSeat[]> {
  const { data, error } = await supabase
    .from('entries')
    .select('id, display_name')
    .eq('matchday_id', matchdayId)
    .eq('kind', 'GUEST')
    .order('seed_position', { ascending: true })
  if (error) throw new EdgeError(`No se pudieron leer los invitados: ${error.message}`)
  return (data ?? []).map((row) => ({ entryId: row.id, displayName: row.display_name }))
}

async function locksOf(supabase: Client, matchdayId: string): Promise<PairLock[]> {
  const { data, error } = await supabase
    .from('pair_locks')
    .select('entry_a, entry_b')
    .eq('matchday_id', matchdayId)
    .order('id', { ascending: true })
  if (error) throw new EdgeError(`No se pudieron leer las parejas fijas: ${error.message}`)
  return (data ?? []).map((row) => ({ a: row.entry_a, b: row.entry_b }))
}

// `attendances` has two foreign keys into `entries` (kind and season_id), so a
// PostgREST embed would need a disambiguating hint either way — two plain
// reads plus an in-memory sort is the same number of round trips without it.
async function playingEntryIds(supabase: Client, matchdayId: string): Promise<EntryId[]> {
  const { data: attendances, error: attendancesError } = await supabase
    .from('attendances')
    .select('entry_id')
    .eq('matchday_id', matchdayId)
    .eq('status', 'PLAYING')
  if (attendancesError) {
    throw new EdgeError(`No se pudo leer el presentismo: ${attendancesError.message}`)
  }
  const entryIds = (attendances ?? []).map((row) => row.entry_id)
  if (entryIds.length === 0) return []

  const { data: entries, error: entriesError } = await supabase
    .from('entries')
    .select('id, seed_position')
    .in('id', entryIds)
  if (entriesError) throw new EdgeError(`No se pudieron leer los asientos: ${entriesError.message}`)

  const seedPosition = new Map((entries ?? []).map((row) => [row.id, row.seed_position]))
  return [...entryIds].sort(
    (left, right) => (seedPosition.get(left) ?? 0) - (seedPosition.get(right) ?? 0),
  )
}

/** Borra las parejas de la fecha. Cascadea a matches y match_sets. */
async function deletePairs(supabase: Client, matchdayId: string): Promise<void> {
  const { error } = await supabase.from('pairs').delete().eq('matchday_id', matchdayId)
  if (error) throw new EdgeError(`No se pudieron borrar las parejas: ${error.message}`)
}

/**
 * Inserta las parejas y devuelve sus ids EN EL MISMO ORDEN en que se pasaron:
 * el fixture habla por índice, e `insert ... returning` no lo promete.
 * Insertando de a una lo garantiza sin tener que reordenar nada después.
 */
async function insertPairs(
  supabase: Client,
  matchdayId: string,
  pairs: Pair[],
): Promise<string[]> {
  const matchday = await requireMatchday(supabase, matchdayId)
  const ids: string[] = []
  for (const pair of pairs) {
    const { data, error } = await supabase
      .from('pairs')
      .insert({
        matchday_id: matchdayId,
        season_id: matchday.season_id,
        entry_a: pair.a,
        entry_b: pair.b,
      })
      .select('id')
      .single()
    if (error || data === null) {
      throw new EdgeError(`No se pudo guardar una pareja: ${error?.message}`)
    }
    ids.push(data.id)
  }
  return ids
}

interface MatchRow {
  matchday_id: string
  round: number
  pair_a: string
  pair_b: string
}

/** Inserta el fixture. */
async function insertMatches(supabase: Client, rows: MatchRow[]): Promise<void> {
  const { error } = await supabase.from('matches').insert(rows)
  if (error) throw new EdgeError(`No se pudo guardar el fixture: ${error.message}`)
}

/** Los dos `entry_id` de cada pareja de la fecha. */
async function pairEntryIds(supabase: Client, matchdayId: string): Promise<string[][]> {
  const { data, error } = await supabase
    .from('pairs')
    .select('entry_a, entry_b')
    .eq('matchday_id', matchdayId)
  if (error) throw new EdgeError(`No se pudieron leer las parejas: ${error.message}`)
  return (data ?? []).map((row) => [row.entry_a, row.entry_b])
}

/** Las parejas y los partidos de la fecha, con los sets de cada partido ordenados por `set_number`. */
async function resultsOf(
  supabase: Client,
  matchdayId: string,
): Promise<{ pairs: Pair[]; matches: MatchResult[] }> {
  const { data: pairRows, error: pairsError } = await supabase
    .from('pairs')
    .select('id, entry_a, entry_b')
    .eq('matchday_id', matchdayId)
  if (pairsError) throw new EdgeError(`No se pudieron leer las parejas: ${pairsError.message}`)

  const pairById = new Map(
    (pairRows ?? []).map((row) => [row.id, { a: row.entry_a, b: row.entry_b }]),
  )

  const { data: matchRows, error: matchesError } = await supabase
    .from('matches')
    .select('id, round, pair_a, pair_b')
    .eq('matchday_id', matchdayId)
    .order('round', { ascending: true })
  if (matchesError) throw new EdgeError(`No se pudieron leer los partidos: ${matchesError.message}`)

  const matchIds = (matchRows ?? []).map((row) => row.id)
  const { data: setRows, error: setsError } =
    matchIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from('match_sets')
          .select('match_id, set_number, games_a, games_b')
          .in('match_id', matchIds)
          .order('set_number', { ascending: true })
  if (setsError) throw new EdgeError(`No se pudieron leer los sets: ${setsError.message}`)

  const setsByMatch = new Map<string, SetScore[]>()
  for (const row of setRows ?? []) {
    const set = { gamesA: row.games_a, gamesB: row.games_b }
    const bucket = setsByMatch.get(row.match_id)
    if (bucket === undefined) setsByMatch.set(row.match_id, [set])
    else bucket.push(set)
  }

  const matches: MatchResult[] = (matchRows ?? []).map((row) => {
    const pairA = pairById.get(row.pair_a)
    const pairB = pairById.get(row.pair_b)
    if (pairA === undefined || pairB === undefined) {
      throw new Error(
        `El partido ${row.id} referencia una pareja que no está en la fecha. Esto es un bug.`,
      )
    }
    return { round: row.round, pairA, pairB, sets: setsByMatch.get(row.id) ?? [] }
  })

  return { pairs: [...pairById.values()], matches }
}

/** El `matchFormat` de la configuración de la temporada dueña de este partido. */
async function matchFormatOf(supabase: Client, matchId: string): Promise<MatchFormat> {
  const { data: match, error: fetchError } = await supabase
    .from('matches')
    .select('matchday_id')
    .eq('id', matchId)
    .maybeSingle()
  if (fetchError) throw new EdgeError(`No se pudo leer el partido: ${fetchError.message}`)
  if (match === null) throw new EdgeError('El partido no existe.')

  const matchday = await requireMatchday(supabase, match.matchday_id)
  const config = await seasonConfig(supabase, matchday.season_id)
  return config.matchFormat
}
