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
  /**
   * Decisión #4029: sin especificar, sigue el mismo automático que
   * `addDiscipline`/`createSeason` (`false` con `pairSize: 1`, `true` si
   * no). `true` combinado con `pairSize: 1` es una combinación que la base
   * RECHAZA (`disciplines_has_masters_needs_pair`, 0053) — no hay forma de
   * armar ese escenario ni con esta factory, a propósito: la parte 3 de la
   * decisión es que esa fila no puede existir, ni para un test.
   */
  hasMasters?: boolean
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
      // Sin `config` (C35): `createSeason` de producción dejó de escribirla y
      // el CONTRACT la dropea. Es nullable desde `0059`. La config REAL vive
      // en `disciplines.config`, que se inserta más abajo.
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
        // Decisión #4029: mismo automático que los escritores de producción
        // (`addDiscipline`/`createSeason`) — sin esto, cualquier spec con
        // `pairSize: 1` viola `disciplines_has_masters_needs_pair` (0053),
        // porque el default de columna (0015) sigue en `true`.
        has_masters: spec.hasMasters ?? spec.pairSize !== 1,
      })
      .select('id')
      .single()
    if (disciplineError || discipline === null) {
      throw new Error(`No se pudo crear la disciplina de test: ${disciplineError?.message}`)
    }
    // Único cast de este archivo: acá nace el `DisciplineId` que
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
        // Sin `seed_position` (C37), igual que `createSeason` de producción:
        // el CHECK `entries_seed_shape` del contract lo va a prohibir para el
        // SQUAD. El orden lo pone `discipline_entries`, abajo — que es de
        // donde lo leen las lecturas desde esta misma tanda. Esta factory era
        // el escritor que producía los ~318 rojos que midió el informe
        // #4034 al aplicar la DDL destructiva.
      })
      .select('id')
      .single()
    if (entryError || entry === null) {
      throw new Error(`No se pudo crear el asiento de test: ${entryError?.message}`)
    }
    entryIds.push(entry.id)
  }

  // Desde PR 7 (discipline_entries): cada SQUAD entra a TODAS las disciplinas
  // de la temporada, en el orden en que se pidió el plantel — mismo criterio
  // que el backfill de 0023_discipline_entries.sql. Así los
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
