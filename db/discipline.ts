import type { DisciplineId, SeasonConfig } from '@/core'
import type { Client } from './client'
import type { Json } from './database.types'
import { EdgeError } from './errors'
import { assertValidConfig } from './validate'

/**
 * La config de UNA disciplina — `disciplines.config`, no `seasons.config`.
 *
 * `disciplines.config` existe desde PR 1 (0015), backfillada 1:1 con la
 * config de la temporada en ese momento, pero hasta PR 5 nada la volvía a
 * escribir: `updateSeasonConfig` (db/season.ts) sólo toca `seasons.config`,
 * así que dos disciplinas de la misma temporada podían divergir de la
 * temporada sin que ninguna pantalla lo viera. De acá en más ésta es la
 * fuente real, por disciplina, sin herencia cruzada (REQ-D2-1).
 */
export async function disciplineConfig(
  supabase: Client,
  disciplineId: DisciplineId,
): Promise<SeasonConfig> {
  const { data, error } = await supabase
    .from('disciplines')
    .select('config')
    .eq('id', disciplineId)
    .maybeSingle()
  if (error) {
    throw new EdgeError(`No se pudo leer la configuración de la disciplina: ${error.message}`)
  }
  if (data === null) throw new EdgeError('La disciplina no existe.')
  return data.config as unknown as SeasonConfig
}

/** El único escritor de `disciplines.config`: `assertValidConfig` corre antes que el update, igual que `updateSeasonConfig`. */
export async function updateDisciplineConfig(
  supabase: Client,
  disciplineId: DisciplineId,
  config: SeasonConfig,
): Promise<void> {
  assertValidConfig(config)
  const { error } = await supabase
    .from('disciplines')
    .update({ config: config as unknown as Json })
    .eq('id', disciplineId)
  if (error) {
    throw new EdgeError(`No se pudo actualizar la configuración de la disciplina: ${error.message}`)
  }
}
