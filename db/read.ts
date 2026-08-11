/**
 * The read layer: every function a screen calls to show something, never to
 * change it. `db/matchday.ts` exports writes and context builders for
 * mutations; the read-shaped pieces it already had — `resultsOf`, `guestsOf`,
 * `locksOf`, `playingEntryIds` — stay module-private there. The functions
 * here are new, read-only, and duplicate the small amount of query shape they
 * need instead of reaching into that module.
 *
 * Every function takes the caller's own `Client` first and never builds one
 * of its own: RLS is what keeps a stranger from reading a season that is not
 * theirs, and that only holds if the query actually runs as the caller.
 */
import type { Award, EntryId, MatchResult, Pair, PlayedMatchday, SeasonConfig, SetScore } from '@/core'
import type { Client } from './client'
import { EdgeError } from './errors'

export interface SeasonHeader {
  id: string
  name: string
  status: string
  regularMatchdays: number
  isAdmin: boolean
  /** The full config, for screens that need more than `regularMatchdays` — e.g. `narrateRules`. */
  config: SeasonConfig
}

export interface EntryRow {
  id: string
  displayName: string
  kind: 'SQUAD' | 'GUEST'
  seedPosition: number
  playerId: string | null
}

export interface MatchdaySummary {
  id: string
  number: number
  kind: 'REGULAR' | 'MASTERS'
  status: 'DRAFT' | 'OPEN' | 'CLOSED'
  playedOn: string | null
}

export interface MatchdayDetail {
  matchday: MatchdaySummary
  pairs: Pair[]
  matches: MatchResult[]
  guestIds: EntryId[]
}

interface SeasonRow {
  id: string
  name: string
  status: string
  config: unknown
  created_by: string
}

interface MatchdayRow {
  id: string
  number: number
  kind: string
  status: string
  played_on: string | null
}

/** `null` for an anonymous or logged-out caller — never throws, so a stranger's read still resolves to "nothing theirs" instead of blowing up. */
async function currentUserId(supabase: Client): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser()
  if (error) return null
  return data.user?.id ?? null
}

function toSeasonHeader(row: SeasonRow, userId: string | null): SeasonHeader {
  const config = row.config as unknown as SeasonConfig
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    regularMatchdays: config.regularMatchdays,
    isAdmin: row.created_by === userId,
    config,
  }
}

function toMatchdaySummary(row: MatchdayRow): MatchdaySummary {
  return {
    id: row.id,
    number: row.number,
    kind: row.kind as 'REGULAR' | 'MASTERS',
    status: row.status as 'DRAFT' | 'OPEN' | 'CLOSED',
    playedOn: row.played_on,
  }
}

const SEASON_HEADER_COLUMNS = 'id, name, status, config, created_by'

/** Every season where the caller has a seat — admin or squad. RLS does the filtering; this only shapes the rows. */
export async function mySeasons(supabase: Client): Promise<SeasonHeader[]> {
  const [{ data, error }, userId] = await Promise.all([
    supabase.from('seasons').select(SEASON_HEADER_COLUMNS),
    currentUserId(supabase),
  ])
  if (error) throw new EdgeError(`No se pudieron leer las temporadas: ${error.message}`)
  return (data ?? []).map((row) => toSeasonHeader(row, userId))
}

export async function seasonHeader(supabase: Client, seasonId: string): Promise<SeasonHeader> {
  const [{ data, error }, userId] = await Promise.all([
    supabase.from('seasons').select(SEASON_HEADER_COLUMNS).eq('id', seasonId).maybeSingle(),
    currentUserId(supabase),
  ])
  if (error) throw new EdgeError(`No se pudo leer la temporada: ${error.message}`)
  if (data === null) throw new EdgeError('La temporada no existe.')
  return toSeasonHeader(data, userId)
}

/**
 * El nombre de quien organiza la temporada — el jugador cuyo `user_id`
 * coincide con `seasons.created_by`. No hay forma de resolver eso con una
 * consulta directa: `players.user_id` no tiene SELECT otorgado a
 * `authenticated` a propósito (0002_rls.sql, 0006_my_player_id.sql), para no
 * dejar correlacionar `auth.uid()` con un player desde el cliente. La única
 * función que ya hace ese cruce es `season_invite` (0004_claim_seat.sql, la
 * pantalla de Unirse) — se reusa acá en vez de sumar una migración nueva sólo
 * para este campo.
 */
export async function seasonAdminName(supabase: Client, seasonId: string): Promise<string> {
  const { data: season, error: seasonError } = await supabase
    .from('seasons')
    .select('invite_token')
    .eq('id', seasonId)
    .maybeSingle()
  if (seasonError) throw new EdgeError(`No se pudo leer la temporada: ${seasonError.message}`)
  if (season === null) throw new EdgeError('La temporada no existe.')

  const { data: invite, error: inviteError } = await supabase
    .rpc('season_invite', { p_token: season.invite_token })
    .limit(1)
  if (inviteError) throw new EdgeError(`No se pudo leer quién organiza: ${inviteError.message}`)
  const adminName = invite?.[0]?.admin_name
  if (adminName === undefined) throw new EdgeError('No se pudo leer quién organiza.')
  return adminName
}

export async function seasonRules(
  supabase: Client,
  seasonId: string,
): Promise<{ text: string; updatedAt: string | null }> {
  const { data, error } = await supabase
    .from('seasons')
    .select('rules_text, rules_updated_at')
    .eq('id', seasonId)
    .maybeSingle()
  if (error) throw new EdgeError(`No se pudieron leer las reglas: ${error.message}`)
  if (data === null) throw new EdgeError('La temporada no existe.')
  return { text: data.rules_text, updatedAt: data.rules_updated_at }
}

/** Squad and guests together, every matchday of the season. `playerId` is `null` for a seat nobody has claimed. */
export async function entriesOf(supabase: Client, seasonId: string): Promise<EntryRow[]> {
  const { data, error } = await supabase
    .from('entries')
    .select('id, display_name, kind, seed_position, player_id')
    .eq('season_id', seasonId)
  if (error) throw new EdgeError(`No se pudo leer el plantel: ${error.message}`)
  return (data ?? []).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    kind: row.kind as 'SQUAD' | 'GUEST',
    seedPosition: row.seed_position,
    playerId: row.player_id,
  }))
}

export async function matchdaysOf(supabase: Client, seasonId: string): Promise<MatchdaySummary[]> {
  const { data, error } = await supabase
    .from('matchdays')
    .select('id, number, kind, status, played_on')
    .eq('season_id', seasonId)
    .order('number', { ascending: true })
  if (error) throw new EdgeError(`No se pudieron leer las fechas: ${error.message}`)
  return (data ?? []).map(toMatchdaySummary)
}

/** Pairs, matches and full sets of one matchday. Empty pairs/matches — not an error — for a matchday still in DRAFT. */
export async function matchdayDetail(supabase: Client, matchdayId: string): Promise<MatchdayDetail> {
  const { data: matchdayRow, error: matchdayError } = await supabase
    .from('matchdays')
    .select('id, number, kind, status, played_on')
    .eq('id', matchdayId)
    .maybeSingle()
  if (matchdayError) throw new EdgeError(`No se pudo leer la fecha: ${matchdayError.message}`)
  if (matchdayRow === null) throw new EdgeError('La fecha no existe.')

  const { pairs, matches } = await pairsAndMatchesOf(supabase, matchdayId)
  const guestIds = await guestIdsOf(supabase, matchdayId)

  return { matchday: toMatchdaySummary(matchdayRow), pairs, matches, guestIds }
}

/** Every CLOSED regular matchday of the season, in number order. The Masters is excluded: it is not part of the championship's played history. */
export async function closedHistoryAll(supabase: Client, seasonId: string): Promise<PlayedMatchday[]> {
  const { data, error } = await supabase
    .from('matchdays')
    .select('id, number')
    .eq('season_id', seasonId)
    .eq('status', 'CLOSED')
    .eq('kind', 'REGULAR')
    .order('number', { ascending: true })
  if (error) throw new EdgeError(`No se pudieron leer las fechas cerradas: ${error.message}`)

  const history: PlayedMatchday[] = []
  for (const row of data ?? []) {
    const { pairs, matches } = await pairsAndMatchesOf(supabase, row.id)
    history.push({ number: row.number, pairs, matches })
  }
  return history
}

/** Every award of the season, keyed by the matchday number that paid it. */
export async function awardsOf(supabase: Client, seasonId: string): Promise<Map<number, Award[]>> {
  const { data: closed, error: closedError } = await supabase
    .from('matchdays')
    .select('id, number')
    .eq('season_id', seasonId)
    .eq('status', 'CLOSED')
  if (closedError) {
    throw new EdgeError(`No se pudieron leer las fechas cerradas: ${closedError.message}`)
  }

  const numberOf = new Map((closed ?? []).map((row) => [row.id, row.number]))
  const result = new Map<number, Award[]>()
  if (numberOf.size === 0) return result

  const { data: awards, error: awardsError } = await supabase
    .from('awards')
    .select('matchday_id, entry_id, position, points')
    .in('matchday_id', [...numberOf.keys()])
  if (awardsError) throw new EdgeError(`No se pudieron leer los premios: ${awardsError.message}`)

  for (const row of awards ?? []) {
    const matchdayNumber = numberOf.get(row.matchday_id)
    if (matchdayNumber === undefined) continue
    const award: Award = { entryId: row.entry_id, position: row.position, points: row.points }
    const bucket = result.get(matchdayNumber)
    if (bucket === undefined) result.set(matchdayNumber, [award])
    else bucket.push(award)
  }
  return result
}

// ── helpers privados, compartidos por matchdayDetail y closedHistoryAll ─────

/** Las parejas y los partidos de la fecha, con los sets de cada partido ordenados por `set_number`. */
async function pairsAndMatchesOf(
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

async function guestIdsOf(supabase: Client, matchdayId: string): Promise<EntryId[]> {
  const { data, error } = await supabase
    .from('entries')
    .select('id')
    .eq('matchday_id', matchdayId)
    .eq('kind', 'GUEST')
    .order('seed_position', { ascending: true })
  if (error) throw new EdgeError(`No se pudieron leer los invitados: ${error.message}`)
  return (data ?? []).map((row) => row.id)
}
