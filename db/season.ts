import type { Award, EntryId, MatchdayHistory, SeasonConfig } from '@/core'
import type { Database, Json } from './database.types'
import { EdgeError } from './errors'
import { assertValidConfig } from './validate'

// Vive en `db/client.ts`, que es donde el plan lo pone. Se re-exporta para no
// romper a quien ya lo importa de acá.
import type { Client } from './client'
export type { Client }

/** `SeasonConfig` from the `jsonb` column. The cast is a bet `assertValidConfig` backs up. */
export async function seasonConfig(supabase: Client, seasonId: string): Promise<SeasonConfig> {
  const { data, error } = await supabase
    .from('seasons')
    .select('config')
    .eq('id', seasonId)
    .maybeSingle()
  if (error) {
    throw new EdgeError(`No se pudo leer la configuración de la temporada: ${error.message}`)
  }
  if (data === null) throw new EdgeError('La temporada no existe.')
  return data.config as unknown as SeasonConfig
}

/** The squad's seed order. Explicit `order by`: nothing else keeps it stable. */
export async function squadSeedOrder(supabase: Client, seasonId: string): Promise<EntryId[]> {
  const { data, error } = await supabase
    .from('entries')
    .select('id')
    .eq('season_id', seasonId)
    .eq('kind', 'SQUAD')
    .order('seed_position', { ascending: true })
  if (error) throw new EdgeError(`No se pudo leer el plantel: ${error.message}`)
  return (data ?? []).map((row) => row.id)
}

/** Awards of the closed matchdays before `number`, keyed by matchday number. */
export async function awardsBefore(
  supabase: Client,
  seasonId: string,
  number: number,
): Promise<Map<number, Award[]>> {
  const { data: closed, error: closedError } = await supabase
    .from('matchdays')
    .select('id, number')
    .eq('season_id', seasonId)
    .eq('status', 'CLOSED')
    .lt('number', number)
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
  if (awardsError) {
    throw new EdgeError(`No se pudieron leer los premios: ${awardsError.message}`)
  }

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

/** The matchday at `number`, or null when it does not exist or is not CLOSED. */
export async function closedHistory(
  supabase: Client,
  seasonId: string,
  number: number,
): Promise<MatchdayHistory | null> {
  const { data: matchday, error: matchdayError } = await supabase
    .from('matchdays')
    .select('id, status')
    .eq('season_id', seasonId)
    .eq('number', number)
    .maybeSingle()
  if (matchdayError) throw new EdgeError(`No se pudo leer la fecha: ${matchdayError.message}`)
  if (matchday === null || matchday.status !== 'CLOSED') return null

  const { data: pairs, error: pairsError } = await supabase
    .from('pairs')
    .select('entry_a, entry_b')
    .eq('matchday_id', matchday.id)
  if (pairsError) throw new EdgeError(`No se pudieron leer las parejas: ${pairsError.message}`)

  const { data: awards, error: awardsError } = await supabase
    .from('awards')
    .select('entry_id, position, points')
    .eq('matchday_id', matchday.id)
  if (awardsError) throw new EdgeError(`No se pudieron leer los premios: ${awardsError.message}`)

  return {
    pairs: (pairs ?? []).map((row) => ({ a: row.entry_a, b: row.entry_b })),
    awards: (awards ?? []).map((row) => ({
      entryId: row.entry_id,
      position: row.position,
      points: row.points,
    })),
  }
}

/** The only writer in this plan: `assertValidConfig` runs before the update lands. */
export async function updateSeasonConfig(
  supabase: Client,
  seasonId: string,
  config: SeasonConfig,
): Promise<void> {
  assertValidConfig(config)
  const { error } = await supabase
    .from('seasons')
    .update({ config: config as unknown as Json })
    .eq('id', seasonId)
  if (error) throw new EdgeError(`No se pudo actualizar la configuración: ${error.message}`)
}
