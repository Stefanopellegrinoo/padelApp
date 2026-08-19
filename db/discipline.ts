import type { DisciplineId, SeasonConfig, SideSize } from '@/core'
import type { Client } from './client'
import type { Json } from './database.types'
import { EdgeError } from './errors'
import { assertValidConfig } from './validate'

/** `disciplineConfig`'s return: la config Y el `pair_size` real, del mismo select. */
export interface DisciplineConfigRow {
  config: SeasonConfig
  pairSize: SideSize
}

/**
 * La config de UNA disciplina — `disciplines.config`, no `seasons.config` —
 * MÁS `pair_size`, de la misma fila y el mismo select (W30, verify-report
 * ronda 9): antes esta función sólo traía `config` y tres call sites
 * (`matchdayContextFor`, `pairingContextFor`, `DISCIPLINE_HEADER_COLUMNS` en
 * db/read.ts) pasaban un `2` literal a `assertValidConfig`/`assertMatchdaySize`
 * aunque el valor real estaba a una columna de un select que ya corría.
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
): Promise<DisciplineConfigRow> {
  const { data, error } = await supabase
    .from('disciplines')
    .select('config, pair_size')
    .eq('id', disciplineId)
    .maybeSingle()
  if (error) {
    throw new EdgeError(`No se pudo leer la configuración de la disciplina: ${error.message}`)
  }
  if (data === null) throw new EdgeError('La disciplina no existe.')
  return { config: data.config as unknown as SeasonConfig, pairSize: data.pair_size as SideSize }
}

/**
 * El único escritor de `disciplines.config`: `assertValidConfig` corre antes que el update, igual que `updateSeasonConfig`.
 *
 * C20 (verify-report ronda 13): el `sideSize` estaba HARDCODEADO en 2, y sobre
 * una disciplina de a uno eso dejaba la validación invertida — rechazaba la
 * única config válida (8 valores de puntos para 8 asientos) y aceptaba la de
 * parejas (4), que después `matchdayContextFor` rechaza al armar y al cerrar.
 * Una fecha OPEN con resultados quedaba sin poder cerrarse Y sin poder volver
 * atrás desde Ajustes, porque el rollback chocaba contra este mismo `2`.
 *
 * El `pair_size` se LEE acá adentro en vez de recibirse por parámetro, a
 * propósito: es identidad de la disciplina, no una opción de quien llama. Con
 * un parámetro, cada call site presente y futuro puede pasar el equivocado y
 * el compilador no lo nota —`SideSize` es `1 | 2` en los dos casos—, que es
 * exactamente la clase de bug por la que `DisciplineId` está branded (N2,
 * ronda 2). Leerlo cuesta un SELECT por guardado en una pantalla de admin;
 * `disciplineConfig`, justo arriba, ya trae la fila que hace falta.
 *
 * S46 (verify-report ronda 14): `count: 'exact'` por el mismo motivo que
 * `setMatchdayDate` (`db/matchday.ts:198-200`) — un update que no toca ninguna
 * fila NO es un error en PostgREST. `saveDisciplineConfig` no tiene chequeo de
 * admin propio, se apoya en RLS, y un participante que NO organiza pasa el
 * `select` de `disciplineConfig` (`disciplines_read` usa `is_participant`) y
 * después su update matchea 0 filas contra `disciplines_write` (que usa
 * `is_season_admin`). Sin esto la pantalla le decía que guardó y al recargar
 * volvía la config vieja.
 *
 * C23 (verify-report ronda 16): desde `0032_promote_guest_points_slot.sql` la
 * BASE también escribe `disciplines.config` —al promover un invitado de a uno
 * agrega un casillero de puntos y sube `squadSize`—, y esta función era un
 * overwrite CIEGO del blob entero. Con Formato abierto en una pestaña y una
 * promoción en otra, el primer toque del admin pisaba el casillero recién
 * agregado sin un solo error en pantalla, y la fecha volvía a quedar sin poder
 * cerrarse (C22).
 *
 * El guard compara el LARGO de `points` y `squadSize`, que son exactamente los
 * dos campos que la app se escribe a sí misma. Formato edita VALORES —no tiene
 * control para agregar o sacar un puesto, ni para mover el plantel—, así que
 * una diferencia ahí no puede venir del formulario: sólo de que la fila cambió
 * abajo mientras estaba abierto.
 *
 * ponytail: es un lock optimista pobre, sobre dos campos elegidos a mano y no
 * sobre la fila entera. Alcanza porque hoy hay UN solo escritor automático y
 * toca esos dos campos. El día que aparezca otro que toque cualquier otra
 * cosa, esto no lo ve — ahí corresponde una columna de versión y comparar la
 * fila, no dos campos.
 */
export async function updateDisciplineConfig(
  supabase: Client,
  disciplineId: DisciplineId,
  config: SeasonConfig,
): Promise<void> {
  const { config: vigente, pairSize } = await disciplineConfig(supabase, disciplineId)
  // La validez del payload se chequea PRIMERO, y el orden importa: una config
  // con la cantidad equivocada de puntos y una armada sobre una fila vieja se
  // ven iguales desde acá (las dos tienen otro largo), pero la primera es un
  // error de contenido y merece el mensaje de `validateConfig`, que dice
  // cuántos valores hacen falta. Con el orden al revés, ese mensaje quedaba
  // tapado por el de concurrencia.
  assertValidConfig(config, pairSize)
  if (
    config.points.length !== vigente.points.length ||
    config.squadSize !== vigente.squadSize
  ) {
    throw new EdgeError(
      'La configuración cambió mientras editabas —alguien sumó un jugador al plantel—. Recargá la pantalla y volvé a aplicar el cambio.',
    )
  }
  const { error, count } = await supabase
    .from('disciplines')
    .update({ config: config as unknown as Json }, { count: 'exact' })
    .eq('id', disciplineId)
  if (error) {
    throw new EdgeError(`No se pudo actualizar la configuración de la disciplina: ${error.message}`)
  }
  if (count === 0) {
    throw new EdgeError('No se pudo guardar el formato: sólo puede hacerlo quien organiza.')
  }
}

/** Una disciplina a agregar a un torneo ya en curso — `addDiscipline`, no el wizard. */
export interface NewDiscipline {
  kind?: 'PADEL' | 'FIFA'
  config: SeasonConfig
  /** Mismo contrato que `NewSeasonDiscipline` (db/season.ts): elegido al crear, no derivado de `kind`. Sin especificar, 2. */
  pairSize?: SideSize
  /** Mismo contrato que `NewSeasonDiscipline`. Sin especificar, false. */
  allowsDraw?: boolean
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
  assertValidConfig(spec.config, spec.pairSize ?? 2)

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
      pair_size: spec.pairSize ?? 2,
      allows_draw: spec.allowsDraw ?? false,
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
