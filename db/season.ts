import { sideOfRow } from '@/core'
import type { Award, DisciplineId, EntryId, MatchdayHistory, Pair, SeasonConfig, SideSize } from '@/core'
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

/**
 * The squad's seed order FOR ONE DISCIPLINE. Explicit `order by`: nothing else
 * keeps it stable.
 *
 * Lee `discipline_entries`, no `entries` (C6, verify-report ronda 3):
 * `entries.seed_position` es dual-write tail-only desde PR 7
 * (0023_discipline_entries.sql) — `shift_seeds_up`/`add_squad_seat` ya no
 * corren el parking ahí. `discipline_entries.seed_position` es la fuente
 * real, y ésta es la que alimenta `snapshotForMatchday` (el desempate de
 * cada fecha y el orden de fallback del sorteo).
 */
export async function squadSeedOrder(
  supabase: Client,
  disciplineId: DisciplineId,
): Promise<EntryId[]> {
  const { data, error } = await supabase
    .from('discipline_entries')
    .select('entry_id')
    .eq('discipline_id', disciplineId)
    .order('seed_position', { ascending: true })
  if (error) throw new EdgeError(`No se pudo leer el plantel: ${error.message}`)
  return (data ?? []).map((row) => row.entry_id)
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
export async function defaultDisciplineId(supabase: Client, seasonId: string): Promise<DisciplineId | null> {
  const { data, error } = await supabase
    .from('disciplines')
    .select('id')
    .eq('season_id', seasonId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw new EdgeError(`No se pudo leer la disciplina de la temporada: ${error.message}`)
  // Única marca de esta función (N2): de acá en más el id que circula es
  // `DisciplineId`, no `string` a secas — así lo lee todo el que lo reciba.
  return (data?.id as DisciplineId | undefined) ?? null
}

/** Awards of the closed matchdays before `number` of one discipline's own calendar, keyed by matchday number. */
export async function awardsBefore(
  supabase: Client,
  disciplineId: DisciplineId,
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

/**
 * W36/S34 (verify-report ronda 10/11): retira la copia local de
 * `requirePartner` — `sideOfRow` (core/side.ts) es el hogar único. Separa las
 * dos fallas que `requirePartner` fusionaba en una: una fila `pair_size=2`
 * sin `entry_b` es dato roto (tira ahí, con SU mensaje); un lado de uno
 * legítimo (`pair_size=1`) arma un `Side` sin tirar — recién acá, que
 * `closedHistory` alimenta `MatchdayHistory.pairs: Pair[]` (`core/history.ts`,
 * sin migrar a `Side` hasta PR19, design #3801 PUNTO 4), es donde hace falta
 * migrar este camino. `sideOf`/`pairOf` (core/pair-compat.ts) no se importan
 * desde `db/`: ese adaptador es interno de `core/` (core/index.ts,
 * "Deliberadamente NO exportado") — este chequeo hace lo mismo que `pairOf`
 * a mano.
 */
function pairFromRow(pairSize: SideSize, entryA: string, entryB: string | null): Pair {
  const side = sideOfRow(pairSize, entryA, entryB)
  if (side.size === 1) {
    throw new Error('Un lado de a uno no se lee como pareja acá todavía: falta migrar este camino a Side.')
  }
  return { a: side.a, b: side.b }
}

/** The matchday at `number` of one discipline's own calendar, or null when it does not exist or is not CLOSED. */
export async function closedHistory(
  supabase: Client,
  disciplineId: DisciplineId,
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
    .select('entry_a, entry_b, pair_size')
    .eq('matchday_id', matchday.id)
  if (pairsError) throw new EdgeError(`No se pudieron leer las parejas: ${pairsError.message}`)

  const { data: awards, error: awardsError } = await supabase
    .from('awards')
    .select('entry_id, position, points')
    .eq('matchday_id', matchday.id)
  if (awardsError) throw new EdgeError(`No se pudieron leer los premios: ${awardsError.message}`)

  return {
    pairs: (pairs ?? []).map((row) =>
      pairFromRow(row.pair_size as SideSize, row.entry_a, row.entry_b),
    ),
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

/** Una disciplina a crear junto con la temporada. `config` es obligatoria: cada disciplina puede declarar la suya, no hereda de la temporada. */
export interface NewSeasonDiscipline {
  kind?: 'PADEL' | 'FIFA'
  config: SeasonConfig
  /**
   * 1 (lados de a uno) o 2 (parejas), elegido al configurar la disciplina —
   * NO derivado de `kind` (decisión de producto #5: FIFA es 1v1 Y 2v2). Sin
   * especificar, 2: el pádel de siempre. Identidad y forma de la disciplina:
   * `0015_disciplines.sql` revoca su UPDATE a propósito — se fija acá, al
   * crear, y no se edita después.
   */
  pairSize?: SideSize
  /** Si esta disciplina admite empates (decisión #7). Sin especificar, false: el pádel de siempre. Misma inmutabilidad que `pairSize`. */
  allowsDraw?: boolean
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
  /**
   * Una fila de `disciplines` por elemento — `position` sale del ÍNDICE de
   * este array, escrito EXPLÍCITO, nunca el default `0` de la columna
   * (contrato S13, auditoría ronda 5): un insert donde dos filas comparten
   * `position` Y `created_at` empata la clave de orden que `disciplineSlugs`
   * (core/discipline-slug.ts) usa para no colisionar dos disciplinas del
   * mismo `kind`. El orden de este array ES el orden del slug — el wizard
   * multi-disciplina (PR11a, pendiente) crea las disciplinas en el orden en
   * que las quiere ver sloggeadas.
   *
   * Por defecto una sola PADEL con `config`: el comportamiento de siempre,
   * para el único caller de producción que existe hoy
   * (`app/torneos/nuevo/actions.ts`, todavía sin wizard multi-disciplina).
   */
  disciplines?: NewSeasonDiscipline[]
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
  { name, squadNames, config, mySeatIndex = null, disciplines }: NewSeason,
): Promise<{ seasonId: string; inviteToken: string }> {
  const disciplineSpecs = disciplines ?? [{ kind: 'PADEL' as const, config }]
  // `config` es el legacy `seasons.config` (drop en el PR de contract):
  // siempre pádel, sideSize=2 fijo, nunca disciplina-specific.
  assertValidConfig(config, 2)
  for (const spec of disciplineSpecs) {
    assertValidConfig(spec.config, spec.pairSize ?? 2)
    if (squadNames.length !== spec.config.squadSize) {
      throw new EdgeError(
        `El plantel tiene ${squadNames.length} nombres y la configuración de ${spec.kind ?? 'PADEL'} dice ${spec.config.squadSize}.`,
      )
    }
  }

  const trimmed = name.trim()
  if (trimmed.length === 0) throw new EdgeError('El torneo necesita un nombre.')
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

  // Una fila de `disciplines` por spec, `position` = índice del array —
  // nunca el default de la columna (ver el comentario de `disciplines` en
  // `NewSeason`, contrato S13). Sin `disciplines` explícito esto crea la
  // misma PADEL única de siempre, mismo comportamiento pre-PR11.
  const disciplineRows: { id: string }[] = []
  for (const [index, spec] of disciplineSpecs.entries()) {
    const { data: discipline, error: disciplineError } = await supabase
      .from('disciplines')
      .insert({
        season_id: season.id,
        kind: spec.kind ?? 'PADEL',
        config: spec.config as unknown as Json,
        position: index,
        pair_size: spec.pairSize ?? 2,
        allows_draw: spec.allowsDraw ?? false,
      })
      .select('id')
      .single()
    if (disciplineError !== null || discipline === null) {
      await supabase.from('seasons').delete().eq('id', season.id)
      throw new EdgeError(`No se pudo crear la disciplina del torneo: ${disciplineError?.message}`)
    }
    disciplineRows.push(discipline)
  }

  const { data: entryRows, error: entriesError } = await supabase
    .from('entries')
    .insert(
      squadNames.map((seat, index) => ({
        season_id: season.id,
        display_name: seat.trim(),
        kind: 'SQUAD' as const,
        seed_position: index,
        player_id: index === mySeatIndex ? myPlayerId : null,
      })),
    )
    .select('id, seed_position')
  if (entriesError !== null || entryRows === null) {
    await supabase.from('seasons').delete().eq('id', season.id)
    throw new EdgeError(
      entriesError?.message.includes('entries_squad_named') === true
        ? 'Falta un nombre del plantel.'
        : `No se pudo cargar el plantel: ${entriesError?.message}`,
    )
  }

  // Cada asiento entra a TODAS las disciplinas recién creadas, con el mismo
  // seed_position que en `entries`. Decisión de este slice (REQ-D1-3/D1-4):
  // el plantel es compartido a nivel torneo y por default juega todo — no
  // hay pantalla de "quién juega qué" en este wizard todavía (PR13 la agrega
  // para sumar una disciplina en curso). `discipline_entries` (PR 7) es la
  // fuente real del orden; sin este insert, un torneo nuevo nacería con sus
  // disciplinas vacías aunque `entries` tenga todo el plantel.
  if (entryRows.length > 0) {
    const { error: seatsError } = await supabase.from('discipline_entries').insert(
      disciplineRows.flatMap((discipline) =>
        entryRows.map((row) => ({
          discipline_id: discipline.id,
          entry_id: row.id,
          season_id: season.id,
          seed_position: row.seed_position,
        })),
      ),
    )
    if (seatsError !== null) {
      await supabase.from('seasons').delete().eq('id', season.id)
      throw new EdgeError(`No se pudo asignar el plantel a las disciplinas: ${seatsError.message}`)
    }
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

/**
 * The only writer in this plan: `assertValidConfig` runs before the update lands.
 *
 * `sideSize` hardcoded at 2: `seasons.config` is the legacy, pre-disciplines
 * field (dropped at the contract PR) and is always padel-shaped.
 */
export async function updateSeasonConfig(
  supabase: Client,
  seasonId: string,
  config: SeasonConfig,
): Promise<void> {
  assertValidConfig(config, 2)
  const { error } = await supabase
    .from('seasons')
    .update({ config: config as unknown as Json })
    .eq('id', seasonId)
  if (error) throw new EdgeError(`No se pudo actualizar la configuración: ${error.message}`)
}
