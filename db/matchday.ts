import {
  buildPairs,
  computeRanking,
  previousContext,
  snapshotForMatchday,
  type Award,
  type EntryId,
  type PairingInput,
  type SeasonConfig,
} from '@/core'
import type { Database } from './database.types'
import { EdgeError } from './errors'
import { awardsBefore, closedHistory, seasonConfig, squadSeedOrder, type Client } from './season'
import {
  assertLocksAndGuests,
  assertMatchdaySize,
  assertPointsCoverMatchday,
  assertValidConfig,
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
