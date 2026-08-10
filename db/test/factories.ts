import { defaultConfig } from '../../core/config'
import type { SeasonConfig } from '../../core/types'
import { adminClient } from './admin'
import type { Json } from '../database.types'
import type { TestUser } from './users'

interface CreateSeasonOptions {
  admin: TestUser
  config?: SeasonConfig
  /** playerIds del plantel, en el orden que van a tener su seed_position. */
  squad?: string[]
}

interface CreatedSeason {
  seasonId: string
  /** Un entry por cada id de `squad`, en el mismo orden. */
  entryIds: string[]
}

// Arma una temporada entera con la llave de service_role: es escenario para un
// test, no algo que un test deba ejercitar con RLS.
export async function createSeason({
  admin,
  config = defaultConfig(8),
  squad = [],
}: CreateSeasonOptions): Promise<CreatedSeason> {
  const db = adminClient()

  const { data: season, error: seasonError } = await db
    .from('seasons')
    .insert({
      name: `Temporada de test ${Date.now()}`,
      config: config as unknown as Json,
      created_by: admin.userId,
    })
    .select('id')
    .single()
  if (seasonError || season === null) {
    throw new Error(`No se pudo crear la temporada de test: ${seasonError?.message}`)
  }

  const entryIds: string[] = []
  for (const [index, playerId] of squad.entries()) {
    const { data: entry, error: entryError } = await db
      .from('entries')
      .insert({
        season_id: season.id,
        player_id: playerId,
        display_name: `Jugador de test ${index + 1}`,
        kind: 'SQUAD',
        seed_position: index,
      })
      .select('id')
      .single()
    if (entryError || entry === null) {
      throw new Error(`No se pudo crear el asiento de test: ${entryError?.message}`)
    }
    entryIds.push(entry.id)
  }

  return { seasonId: season.id, entryIds }
}
