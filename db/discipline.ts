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

/** Una disciplina a agregar a un torneo ya en curso — `addDiscipline`, no el wizard. */
export interface NewDiscipline {
  kind?: 'PADEL' | 'FIFA'
  config: SeasonConfig
}

/**
 * Agrega una disciplina a un torneo YA EN CURSO (REQ-D1-2): el `createSeason`
 * de después del wizard. No toca ninguna disciplina existente ni sus fechas
 * — es "gratis" porque `awards` queda congelado por fecha (decisión de
 * producto, #3796) y `matchdays_one_live` ya está scopeado por
 * `discipline_id` (PR 2/0016, REQ-D3-1), así que una fecha OPEN de otra
 * disciplina ni bloquea ni se entera de este insert.
 *
 * `position` sale de `max(position)+1` de la temporada, escrito EXPLÍCITO —
 * mismo contrato que `createSeason` honra desde S13, ahora respaldado por el
 * índice único `disciplines_season_position` (S19, 0027): si dos llamadas
 * concurrentes leen el mismo máximo, la segunda falla con 23505 en vez de
 * empatar en silencio.
 *
 * ponytail: esa carrera (dos admins agregando a la vez) no se resuelve acá
 * —falla ruidoso, no se previene—, mismo techo aceptado que ya documenta
 * `shift_seeds_up` (0023) para el plantel. Si se vuelve más que anecdótico,
 * la solución es un advisory lock por `season_id`.
 *
 * `entryIds`, por default, es TODO el plantel SQUAD de la temporada — mismo
 * comportamiento que `createSeason` (decisión PR11b, REQ-D1-3: "por default
 * juega todo", sin pantalla de "quién juega qué" en el wizard). Pasar un
 * subconjunto explícito es la capacidad que la UI de Ajustes (slice 2 de
 * esta PR) necesita para el solape PARCIAL (REQ-D1-4): esta función ya la
 * expone, aunque todavía no exista ninguna pantalla que la use.
 */
export async function addDiscipline(
  supabase: Client,
  seasonId: string,
  spec: NewDiscipline,
  entryIds?: string[],
): Promise<DisciplineId> {
  assertValidConfig(spec.config)

  const { data: maxRow, error: maxError } = await supabase
    .from('disciplines')
    .select('position')
    .eq('season_id', seasonId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (maxError) throw new EdgeError(`No se pudo leer las disciplinas de la temporada: ${maxError.message}`)

  const { data: discipline, error: disciplineError } = await supabase
    .from('disciplines')
    .insert({
      season_id: seasonId,
      kind: spec.kind ?? 'PADEL',
      config: spec.config as unknown as Json,
      position: (maxRow?.position ?? -1) + 1,
    })
    .select('id')
    .single()
  if (disciplineError !== null) {
    // W22 (verify-report ronda 7): mismo patrón que createMatchday (matchday.ts:237) —
    // traducir los códigos conocidos en vez de dejar pasar el mensaje crudo de Postgres.
    if (disciplineError.code === '23505') {
      throw new EdgeError('Alguien acaba de agregar otra disciplina. Probá de nuevo.')
    }
    if (disciplineError.code === '42501') {
      throw new EdgeError('Sólo quien organiza la temporada puede agregar una disciplina.')
    }
    throw new EdgeError(`No se pudo crear la disciplina: ${disciplineError.message}`)
  }
  if (discipline === null) throw new EdgeError('No se pudo crear la disciplina.')
  const disciplineId = discipline.id as DisciplineId

  let seatQuery = supabase.from('entries').select('id, seed_position').eq('season_id', seasonId).eq('kind', 'SQUAD')
  if (entryIds !== undefined) seatQuery = seatQuery.in('id', entryIds)
  const { data: seats, error: seatsReadError } = await seatQuery
  if (seatsReadError) throw new EdgeError(`No se pudo leer el plantel: ${seatsReadError.message}`)

  // C13 (verify-report ronda 7): misma guarda que createSeason (season.ts:240)
  // — sin esto, la config podía describir un plantel que no era el sembrado.
  const seatCount = seats?.length ?? 0
  if (seatCount !== spec.config.squadSize) {
    await supabase.from('disciplines').delete().eq('id', disciplineId)
    throw new EdgeError(
      `El plantel tiene ${seatCount} nombres y la configuración de ${spec.kind ?? 'PADEL'} dice ${spec.config.squadSize}.`,
    )
  }

  if (seats !== null && seats.length > 0) {
    const { error: seatsError } = await supabase.from('discipline_entries').insert(
      seats.map((seat) => ({
        discipline_id: disciplineId,
        entry_id: seat.id,
        season_id: seasonId,
        seed_position: seat.seed_position,
      })),
    )
    if (seatsError) {
      await supabase.from('disciplines').delete().eq('id', disciplineId)
      throw new EdgeError(`No se pudo asignar el plantel a la nueva disciplina: ${seatsError.message}`)
    }
  }

  return disciplineId
}
