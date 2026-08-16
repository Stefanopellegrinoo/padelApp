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

/**
 * La disciplina de una temporada, cuando quien llama no tiene forma de
 * elegir cuál: hoy toda temporada nace con exactamente una (`createSeason`,
 * el seed) y no hay wizard que sume una segunda (PR 11), así que la primera
 * por `position` es siempre LA que hay.
 *
 * Con el tripwire `disciplines_one_per_season` caído (0018) una temporada ya
 * PUEDE tener más de una — sin esto, `createMatchday` y las lecturas
 * scopeadas por temporada rompían con PGRST116 ("multiple/0 rows") o
 * mezclaban las dos disciplinas apenas existiera una segunda (verify-report,
 * hallazgo C4). Mismo orden que `add_squad_seat` (0013/0020): `position,
 * created_at`.
 *
 * `null` en vez de tirar: cero filas visibles puede ser "esta temporada de
 * verdad no tiene disciplina" (C3) o, igual de legítimo, "RLS le esconde la
 * fila a quien llama" (un extraño sin asiento) — `disciplines_read` (0015)
 * exige `is_participant`. Quien llama decide qué hacer con `null`: una
 * lectura que hoy devuelve `[]`/`new Map()` para un extraño sigue
 * devolviendo eso; una escritura que necesita un destino sí tira.
 */
export async function defaultDisciplineId(supabase: Client, seasonId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('disciplines')
    .select('id')
    .eq('season_id', seasonId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw new EdgeError(`No se pudo leer la disciplina de la temporada: ${error.message}`)
  return data?.id ?? null
}

/** Awards of the closed matchdays before `number` of one discipline's own calendar, keyed by matchday number. */
export async function awardsBefore(
  supabase: Client,
  disciplineId: string,
  number: number,
): Promise<Map<number, Award[]>> {
  const { data: closed, error: closedError } = await supabase
    .from('matchdays')
    .select('id, number')
    .eq('discipline_id', disciplineId)
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

/** The matchday at `number` of one discipline's own calendar, or null when it does not exist or is not CLOSED. */
export async function closedHistory(
  supabase: Client,
  disciplineId: string,
  number: number,
): Promise<MatchdayHistory | null> {
  const { data: matchday, error: matchdayError } = await supabase
    .from('matchdays')
    .select('id, status')
    .eq('discipline_id', disciplineId)
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

/**
 * Los puntos CONGELADOS de una fecha, por asiento: la tabla `awards` tal cual
 * quedó al cerrarla, que es la MISMA fila que `promote_guest` copia.
 *
 * Existe en vez de reusar `closedHistory` porque de sus tres consultas dos
 * sobran acá: quien llama ya probó que la fecha está CLOSED (si no, no dibuja
 * la tarjeta), y `pairs` lo descarta sin mirarlo. Una consulta en vez de tres,
 * y la fecha se identifica por id —no por número— así que tampoco hace falta
 * volver a resolverla.
 */
export async function frozenPointsOf(
  supabase: Client,
  matchdayId: string,
): Promise<Map<EntryId, number>> {
  const { data, error } = await supabase
    .from('awards')
    .select('entry_id, points')
    .eq('matchday_id', matchdayId)
  if (error) throw new EdgeError(`No se pudieron leer los premios: ${error.message}`)
  return new Map((data ?? []).map((row) => [row.entry_id, row.points]))
}

export interface NewSeason {
  name: string
  /** Un nombre por asiento, en el orden que va a ser el orden inicial de desempate. */
  squadNames: string[]
  config: SeasonConfig
  /**
   * Cuál de esos asientos es el de quien está creando el torneo, o `null` si
   * organiza sin jugar. Es un índice sobre `squadNames`, no un nombre.
   */
  mySeatIndex?: number | null
}

/**
 * La temporada y su plantel, desde el wizard.
 *
 * Dos escrituras y no una transacción: PostgREST no las tiene, y una función
 * SQL sólo para esto sería una migración para el camino feliz de una pantalla
 * que se usa una vez por año. Si la segunda falla, se deshace la primera: una
 * temporada sin asientos no se puede arreglar desde ninguna pantalla —Ajustes
 * necesita al menos el plantel para dibujarse— y queda para siempre en la lista
 * de Mis torneos.
 *
 * Los nombres vacíos NO se chequean acá: los rebota `entries_squad_named`, que
 * es la misma regla escrita una sola vez y del lado que no se puede saltear. Lo
 * único que hace este borde es traducir ese error a algo que se pueda leer.
 *
 * ponytail: el rollback es best-effort. Si el delete también falla, gana el
 * error del insert, que es el que explica qué pasó.
 */
export async function createSeason(
  supabase: Client,
  { name, squadNames, config, mySeatIndex = null }: NewSeason,
): Promise<{ seasonId: string; inviteToken: string }> {
  assertValidConfig(config)

  const trimmed = name.trim()
  if (trimmed.length === 0) throw new EdgeError('El torneo necesita un nombre.')
  if (squadNames.length !== config.squadSize) {
    throw new EdgeError(
      `El plantel tiene ${squadNames.length} nombres y la configuración dice ${config.squadSize}.`,
    )
  }
  if (mySeatIndex !== null && (mySeatIndex < 0 || mySeatIndex >= squadNames.length)) {
    throw new EdgeError('El asiento que elegiste no está en el plantel.')
  }

  const { data: auth } = await supabase.auth.getUser()
  const userId = auth.user?.id
  if (userId === undefined) throw new EdgeError('Hay que entrar antes de crear un torneo.')

  // El asiento propio se reclama en el MISMO insert del plantel, no con un
  // `claim_seat` después: acá no hay carrera que ganar —los asientos todavía no
  // existen para nadie más, el link de invitación se reparte recién en el paso
  // 5— y una segunda escritura es una segunda forma de quedar a medias.
  let myPlayerId: string | null = null
  if (mySeatIndex !== null) {
    const { data, error } = await supabase.rpc('my_player_id')
    if (error !== null || data === null) {
      throw new EdgeError('No se pudo encontrar tu jugador para anotarte en el plantel.')
    }
    myPlayerId = data
  }

  const { data: season, error: seasonError } = await supabase
    .from('seasons')
    .insert({ name: trimmed, config: config as unknown as Json, created_by: userId })
    .select('id, invite_token')
    .single()
  if (seasonError !== null || season === null) {
    throw new EdgeError(`No se pudo crear el torneo: ${seasonError?.message}`)
  }

  // Una temporada nace con exactamente una disciplina PADEL con su misma
  // config — el mismo backfill 1:1 que hizo 0015_disciplines.sql para las
  // temporadas que ya existían. El wizard multi-disciplina (PR 11) es el que
  // deja elegir más de una; hasta entonces toda temporada nueva necesita
  // ésta para que `createMatchday` pueda resolver su `discipline_id`.
  const { error: disciplineError } = await supabase
    .from('disciplines')
    .insert({ season_id: season.id, kind: 'PADEL', config: config as unknown as Json })
  if (disciplineError !== null) {
    await supabase.from('seasons').delete().eq('id', season.id)
    throw new EdgeError(`No se pudo crear la disciplina del torneo: ${disciplineError.message}`)
  }

  const { error: entriesError } = await supabase.from('entries').insert(
    squadNames.map((seat, index) => ({
      season_id: season.id,
      display_name: seat.trim(),
      kind: 'SQUAD' as const,
      seed_position: index,
      player_id: index === mySeatIndex ? myPlayerId : null,
    })),
  )
  if (entriesError !== null) {
    await supabase.from('seasons').delete().eq('id', season.id)
    throw new EdgeError(
      entriesError.message.includes('entries_squad_named')
        ? 'Falta un nombre del plantel.'
        : `No se pudo cargar el plantel: ${entriesError.message}`,
    )
  }

  return { seasonId: season.id, inviteToken: season.invite_token }
}

/**
 * Borra el torneo entero: fechas, parejas, partidos, sets, premios y asientos.
 *
 * No hay papelera ni borrado lógico y no se puede deshacer. La guardia real es
 * RLS —`seasons_delete` (0002_rls.sql) pide `created_by = auth.uid()`, así que
 * ni siquiera un participante puede— y la de la pantalla es escribir el nombre.
 *
 * Se apoya entero en las cascadas del schema, que ya estaban: `matchdays` y
 * `entries` cuelgan de `seasons` con `on delete cascade`, y todo lo demás
 * cuelga de esos dos. Los `on delete no action` de `awards.entry_id` y
 * `pair_locks` NO lo frenan, aunque parezca: se chequean al final de la
 * sentencia, y para entonces la cascada de `matchdays` ya se llevó esas filas.
 * Verificado contra la base con una temporada de 79 premios.
 *
 * `delete` sin filas afectadas no es un error en PostgREST, así que se pide el
 * conteo: si RLS lo filtró, esto tiene que decirlo y no quedarse callado.
 */
export async function deleteSeason(supabase: Client, seasonId: string): Promise<void> {
  const { error, count } = await supabase
    .from('seasons')
    .delete({ count: 'exact' })
    .eq('id', seasonId)
  if (error !== null) throw new EdgeError(`No se pudo eliminar el torneo: ${error.message}`)
  if (count === 0) {
    throw new EdgeError('No se pudo eliminar el torneo: sólo puede hacerlo quien lo creó.')
  }
}

/** Cambia el nombre del torneo. Lo dice el paso 1 del wizard: "se puede cambiar después". */
export async function renameSeason(
  supabase: Client,
  seasonId: string,
  name: string,
): Promise<void> {
  const trimmed = name.trim()
  if (trimmed.length === 0) throw new EdgeError('El torneo necesita un nombre.')

  const { error } = await supabase.from('seasons').update({ name: trimmed }).eq('id', seasonId)
  if (error !== null) throw new EdgeError(`No se pudo cambiar el nombre: ${error.message}`)
}

/** El texto libre del admin. Mueve el sello de última actualización, que la página de reglas muestra. */
export async function updateSeasonRules(
  supabase: Client,
  seasonId: string,
  text: string,
): Promise<void> {
  const { error } = await supabase
    .from('seasons')
    .update({ rules_text: text, rules_updated_at: new Date().toISOString() })
    .eq('id', seasonId)
  if (error !== null) throw new EdgeError(`No se pudieron guardar las reglas: ${error.message}`)
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
