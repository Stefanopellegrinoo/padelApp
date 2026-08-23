import { defaultConfig } from '../../core/config'
import type { DisciplineId, SeasonConfig, SideSize } from '../../core/types'
import { adminClient } from './admin'
import type { Json } from '../database.types'
import type { TestUser } from './users'

/** Una disciplina a crear junto con la temporada. Todo opcional: `{}` es un PADEL con la config de la temporada. */
export interface DisciplineSpec {
  kind?: 'PADEL' | 'FIFA'
  config?: SeasonConfig
  weight?: number
  /** Mismo contrato que `NewSeasonDiscipline`/`NewDiscipline` (PR14 slice A): elegido al crear, no derivado de `kind`. Sin especificar, default de columna (2). */
  pairSize?: SideSize
  /** Mismo contrato. Sin especificar, default de columna (false). */
  allowsDraw?: boolean
}

interface CreateSeasonOptions {
  admin: TestUser
  config?: SeasonConfig
  /** playerIds del plantel, en el orden que van a tener su seed_position. */
  squad?: string[]
  /** Por defecto una sola disciplina PADEL con `config`. Con el tripwire `disciplines_one_per_season` puesto (hasta PR 4), sólo la primera del array se llega a insertar. */
  disciplines?: DisciplineSpec[]
}

interface CreatedSeason {
  seasonId: string
  /** Un entry por cada id de `squad`, en el mismo orden. */
  entryIds: string[]
  /** Un id por cada spec de `disciplines`, en el mismo orden. */
  disciplineIds: DisciplineId[]
  /** La primera. Los archivos `*.db.test.ts` que ya existen leen ésta y nada más. */
  disciplineId: DisciplineId
}

// Arma una temporada entera con la llave de service_role: es escenario para un
// test, no algo que un test deba ejercitar con RLS.
export async function createSeason({
  admin,
  config = defaultConfig(8),
  squad = [],
  disciplines = [{}],
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

  const disciplineIds: DisciplineId[] = []
  for (const [index, spec] of disciplines.entries()) {
    const { data: discipline, error: disciplineError } = await db
      .from('disciplines')
      .insert({
        season_id: season.id,
        kind: spec.kind ?? 'PADEL',
        config: (spec.config ?? config) as unknown as Json,
        position: index,
        ...(spec.weight === undefined ? {} : { weight: spec.weight }),
        ...(spec.pairSize === undefined ? {} : { pair_size: spec.pairSize }),
        ...(spec.allowsDraw === undefined ? {} : { allows_draw: spec.allowsDraw }),
      })
      .select('id')
      .single()
    if (disciplineError || discipline === null) {
      throw new Error(`No se pudo crear la disciplina de test: ${disciplineError?.message}`)
    }
    // Único cast de este archivo (N2): acá nace el `DisciplineId` que
    // consume el resto de la suite de tests.
    disciplineIds.push(discipline.id as DisciplineId)
  }
  const disciplineId = disciplineIds[0]
  if (disciplineId === undefined) {
    throw new Error('createSeason necesita al menos una disciplina.')
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

  // Desde PR 7 (discipline_entries): cada SQUAD entra a TODAS las disciplinas
  // de la temporada, con el mismo `seed_position` que tiene en `entries` —
  // mismo criterio que el backfill de 0023_discipline_entries.sql. Así los
  // ~215 casos que ya usan `squad` + `disciplines` de a una siguen viendo el
  // plantel sin tocarse; el solape parcial entre disciplinas (REQ-D1-4) se
  // arma a mano, fuera de esta factory, cuando un test lo necesita.
  if (entryIds.length > 0 && disciplineIds.length > 0) {
    const { error: seatsError } = await db.from('discipline_entries').insert(
      disciplineIds.flatMap((disciplineId) =>
        entryIds.map((entryId, index) => ({
          discipline_id: disciplineId,
          entry_id: entryId,
          season_id: season.id,
          seed_position: index,
        })),
      ),
    )
    if (seatsError) {
      throw new Error(`No se pudo asignar el plantel a las disciplinas de test: ${seatsError.message}`)
    }
  }

  return { seasonId: season.id, entryIds, disciplineIds, disciplineId }
}
