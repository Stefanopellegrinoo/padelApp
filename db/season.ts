import { sideOfRow } from '@/core'
import type { Award, DisciplineId, EntryId, MatchdayFormat, MatchdayHistory, SeasonConfig, SideSize } from '@/core'
import type { Database, Json } from './database.types'
import { EdgeError } from './errors'
import { assertValidConfig } from './validate'

// Vive en `db/client.ts`, que es donde el plan lo pone. Se re-exporta para no
// romper a quien ya lo importa de acá.
import type { Client } from './client'
export type { Client }

/**
 * The squad's seed order FOR ONE DISCIPLINE. Explicit `order by`: nothing else
 * keeps it stable.
 *
 * Lee `discipline_entries`, no `entries` (C6):
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
 * mezclaban las dos disciplinas apenas existiera una segunda (
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
  // Única marca de esta función: de acá en más el id que circula es
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
    // `lines: []` — esta lectura no trae `award_lines` (REQ-D10-2: una fecha
    // cerrada antes del cambio no tiene desglose, y a esta pantalla no le
    // hace falta: sólo usa `points`/`position` para el ranking).
    const award: Award = { entryId: row.entry_id, position: row.position, points: row.points, lines: [] }
    const bucket = result.get(matchdayNumber)
    if (bucket === undefined) result.set(matchdayNumber, [award])
    else bucket.push(award)
  }
  return result
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
    // CERRADO (ver `db/read.ts: pairsAndMatchesOf`): antes esto componía
    // `pairFromRow`, que TIRABA con una fila `pair_size=1`. Ese throw es el
    // que C19 tuvo que esquivar con un guard en `pairingContextFor`; ahora la
    // historia de una disciplina de a uno se lee de verdad.
    sides: (pairs ?? []).map((row) =>
      sideOfRow(row.pair_size as SideSize, row.entry_a, row.entry_b),
    ),
    // `lines: []` — mismo motivo que `awardsBefore` más arriba: REQ-D10-2.
    awards: (awards ?? []).map((row) => ({
      entryId: row.entry_id,
      position: row.position,
      points: row.points,
      lines: [],
    })),
  }
}

/**
 * Un premio congelado: lo que la fecha repartió, con su puesto.
 *
 * W55: traía sólo `points`, y con eso la pantalla
 * mostraba los puntos congelados en filas ORDENADAS EN VIVO — el orden sale de
 * `computeStandings`, cuyo desempate depende del snapshot, y el snapshot
 * depende de `discipline_entries`, que PROMOVER cambia. Resultado medido: la
 * tabla mostraba al primero con 6 puntos y al segundo con 8. El `position`
 * congelado es lo que hace que orden y puntos no se puedan contradecir.
 */
export interface FrozenAward {
  position: number
  points: number
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
): Promise<Map<EntryId, FrozenAward>> {
  const { data, error } = await supabase
    .from('awards')
    .select('entry_id, position, points')
    .eq('matchday_id', matchdayId)
  if (error) throw new EdgeError(`No se pudieron leer los premios: ${error.message}`)
  return new Map(
    (data ?? []).map((row) => [row.entry_id, { position: row.position, points: row.points }]),
  )
}

/**
 * ¿`order` es una permutación GENUINA de `[0, length)` -- cada índice de
 * asiento aparece EXACTAMENTE una vez?
 *
 * WU1 (ronda 2 de revisión): reemplaza a `isPermutationOf` (multiset de
 * NOMBRES, borrada en esta tarea) desde que `seedOrder` dejó de viajar como
 * `seedNames: string[]` -- dos jugadores con el mismo nombre ya no se pueden
 * confundir porque acá no hay ningún nombre que comparar, sólo el ÍNDICE de
 * asiento en `squadNames`. `seen` -- no un `sort()` de copias, como hacía la
 * versión de nombres -- porque acá el universo es conocido de antemano
 * (`[0, length)`), así que un array de flags es más directo que ordenar.
 *
 * WU5 (ronda 3 de revisión, dos jueces ciegos, confirmado independiente por
 * los dos): `Number.isInteger(at)` primero en la cadena -- sin esto, `NaN`,
 * `null`, `undefined` y un no-entero (`0.5`) hacían FALSAS las dos
 * comparaciones de rango (`NaN < 0`/`NaN >= length` son las dos `false`, y
 * `null`/`undefined` coercionan a `0`) y `seen[at]` los indexaba como una
 * key de string que no choca con ningún índice real -- quedaban ACEPTADOS.
 * `disciplines` es JSON de cliente sin schema en runtime (`NewSeasonDiscipline`
 * es sólo un tipo de TypeScript, borrado al compilar), y `null` es la forma
 * que toma `undefined`/`NaN` al cruzar JSON -- alcanzable desde afuera, no
 * un caso de laboratorio. `Number.isInteger` rechaza los cuatro con una sola
 * llamada: a diferencia de la función global `isInteger`, no coacciona su
 * argumento (`Number.isInteger(null)`/`Number.isInteger(undefined)` son
 * `false` sin convertirlos a `0` primero).
 */
function isIndexPermutation(order: readonly number[], length: number): boolean {
  if (order.length !== length) return false
  const seen = new Array<boolean>(length).fill(false)
  for (const at of order) {
    if (!Number.isInteger(at) || at < 0 || at >= length || seen[at]) return false
    seen[at] = true
  }
  return true
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
  /**
   * Si esta disciplina arma Masters de fin de año (decisión #4029). Sin
   * especificar, el mismo automático de siempre: `false` con `pairSize: 1`
   * (`disciplines_has_masters_needs_pair`, 0053, rechaza `true` ahí), `true`
   * si no. Elegido al crear, cada disciplina independiente (docs/tipos-de-torneo.md §0)
   * — no hay razón para que todas las de un torneo mixto compartan el mismo valor.
   */
  hasMasters?: boolean
  /**
   * El formato por default de cada fecha nueva de esta disciplina (0074,
   * docs/tipos-de-torneo.md §2.5). Sin especificar, el default de columna
   * (`ROUND_ROBIN`) — mismo comportamiento de siempre.
   */
  formatoDefault?: MatchdayFormat
  /**
   * Si esta disciplina es de equipos fijos: la pareja no rota nunca,
   * `discipline_teams` la fija en vez de `pair_locks` (0068,
   * docs/tipos-de-torneo.md §1). Sin especificar, `false` — el pádel
   * rotativo de siempre. Sólo tiene sentido con `pairSize: 2`;
   * `disciplines_fixed_teams_needs_pair` (0077) rechaza `true` con
   * `pairSize: 1` pase lo que pase mande el caller.
   */
  fixedTeams?: boolean
  /**
   * El orden inicial de ESTA disciplina, si es distinto del orden global del
   * plantel (`squadNames`). KEY FACT que habilita esto sin migración:
   * `discipline_entries.seed_position` (ver `squadSeedOrder` más arriba) YA
   * es una columna POR disciplina desde PR 7 -- hasta esta tarea
   * `createSeason` sólo escribía el MISMO índice de `squadNames` en la fila
   * de todas las disciplinas nuevas, sin usar la libertad que la columna ya
   * daba.
   *
   * ÍNDICES sobre `squadNames`, NO nombres (WU1, ronda 2 de revisión): este
   * campo se llamaba `seedNames: string[]` y viajaba como texto -- dos
   * asientos con el mismo nombre eran indistinguibles apenas cruzaba este
   * borde, porque el wizard mueve el asiento por ÍNDICE (`orders`,
   * `wizard-state.ts`, desde la corrección del round 1) pero
   * `seedNamesFrom` (borrada) lo convertía a nombre JUSTO en el punto de
   * unión con el server, y `seedOrderIndices` (también borrada) tenía que
   * ADIVINAR cuál de dos nombres iguales era, con un scan de primero-libre
   * sin forma de saber cuál arrastró el usuario. Medido:
   * `squadNames = ['Ana','Juan','Luis','Juan']`, orden deseado = el asiento
   * 3 primero -- con nombres eso cruzaba como `['Juan','Ana','Juan','Luis']`
   * y el server volvía a elegir el asiento 1, no el 3. Con índices de punta
   * a punta no hay nada que adivinar.
   *
   * Sin especificar, `undefined`: la disciplina sigue el orden GLOBAL de
   * `squadNames` -- el comportamiento de siempre, el que toma el 100% de los
   * torneos existentes y el que sigue tomando cualquier disciplina cuyo
   * checkbox de "orden propio" (paso "Formato" del wizard) esté apagado.
   *
   * Tiene que ser una PERMUTACIÓN de `[0, squadNames.length)` -- cada índice
   * exactamente una vez -- o `createSeason` la rechaza (ver el guard más
   * abajo, `isIndexPermutation`): un `seedOrder` que no calce se comería un
   * asiento en silencio o dejaría a otro con dos.
   */
  seedOrder?: number[]
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
  // WU4 (tanda 7, BLOQUEA): `[]` no es nullish, así que el `??` de arriba lo
  // deja pasar tal cual -- y un `disciplineSpecs` vacío hace que el `for`
  // de la validación (acá abajo) nunca corra ni una vuelta: ni
  // `assertValidConfig` ni el guard de `squadSize`. Medido: `squadNames` de
  // largo 2 con `disciplines: []` devolvía OK con una temporada sin
  // ninguna disciplina y su plantel sin ningún `discipline_entries` --
  // exactamente el estado que el tripwire global de
  // `db/discipline.db.test.ts:250` dice que nunca puede pasar. Mismo guard
  // que `db/test/factories.ts` ya tiene para el helper de test
  // ('createSeason necesita al menos una disciplina.'), acá en el registro
  // de EdgeError que usa el resto de esta función.
  if (disciplineSpecs.length === 0) {
    throw new EdgeError('El torneo necesita al menos una disciplina.')
  }
  // `config` YA NO se escribe en `seasons.config` (C35, verify-report-go-no-go
  // #4034): esa columna no tiene lectores desde PR 5 y el `drop column` es del
  // CONTRACT. Acá sólo sobrevive como default de la disciplina implícita
  // cuando el caller no manda `disciplines` — siempre pádel, sideSize=2 fijo.
  // Por eso NO se valida acá aparte (plan-piso-y-techo-del-plantel, tarea 2):
  // sin `disciplines`, `disciplineSpecs` es `[{ kind: 'PADEL', config }]` y el
  // loop de abajo corre `assertValidConfig(config, 2)` igual — validarlo acá
  // TAMBIÉN era puro redundante. Con `disciplines` explícito era directamente
  // incorrecto: validaba el `squadSize` REAL del plantel (`newTournamentPayload`
  // lo arma así) contra el piso de PAREJAS sin importar qué disciplina se
  // haya elegido, y rechazaba un torneo de dos amigos al FIFA (piso real 2)
  // por no llegar al piso de a dos (4) — aunque la validación de LA
  // disciplina, la del loop, lo aceptara.
  for (const spec of disciplineSpecs) {
    assertValidConfig(spec.config, spec.pairSize ?? 2)
    if (squadNames.length !== spec.config.squadSize) {
      throw new EdgeError(
        `El plantel tiene ${squadNames.length} nombres y la configuración de ${spec.kind ?? 'PADEL'} dice ${spec.config.squadSize}.`,
      )
    }
    // Guard de permutación (ver el docblock de `seedOrder` en
    // `NewSeasonDiscipline`): tiene que cubrir CADA índice de
    // `[0, squadNames.length)` exactamente una vez, o esta disciplina se
    // queda sin poder calcular un `seed_position` para cada asiento --
    // comerse uno o duplicar otro en silencio.
    if (spec.seedOrder !== undefined && !isIndexPermutation(spec.seedOrder, squadNames.length)) {
      throw new EdgeError(
        `El orden propio de ${spec.kind ?? 'PADEL'} no coincide con el plantel: tiene que ser el mismo plantel, sólo reordenado.`,
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
    .insert({ name: trimmed, created_by: userId })
    .select('id, invite_token')
    .single()
  if (seasonError !== null || season === null) {
    throw new EdgeError(`No se pudo crear el torneo: ${seasonError?.message}`)
  }

  // Una fila de `disciplines` por spec, `position` = índice del array —
  // nunca el default de la columna (ver el comentario de `disciplines` en
  //`NewSeason`, contrato S13). Sin `disciplines` explícito esto crea la
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
        // Decisión #4029, parte 1 -- mismo automático que `addDiscipline`
        // (`db/discipline.ts`) cuando `spec.hasMasters` no llega: de a uno
        // nace sin Masters, de a dos sigue en `true`. `spec.hasMasters`
        // manda cuando el caller lo especifica -- cada disciplina lo elige
        // por su cuenta (docs/tipos-de-torneo.md §0).
        has_masters: spec.hasMasters ?? (spec.pairSize ?? 2) !== 1,
        // `formato_default` sólo se manda si el spec lo trae: sin esto, la
        // fila nace con el default de columna (`ROUND_ROBIN`, 0074) -- mismo
        // comportamiento de siempre para todo caller que no lo especifique.
        ...(spec.formatoDefault === undefined
          ? {}
          : { formato_default: spec.formatoDefault as unknown as Json }),
        fixed_teams: spec.fixedTeams ?? false,
      })
      .select('id')
      .single()
    if (disciplineError !== null || discipline === null) {
      await supabase.from('seasons').delete().eq('id', season.id)
      throw new EdgeError(`No se pudo crear la disciplina del torneo: ${disciplineError?.message}`)
    }
    disciplineRows.push(discipline)
  }

  // Sin `seed_position` (C37): esa columna se relaja para el SQUAD en el
  // contract y el CHECK `entries_seed_shape` la va a prohibir. El orden del
  // plantel se escribe abajo, en `discipline_entries`, que es donde vive
  // desde PR 7.
  //
  // WU3 (tanda 7, BLOQUEA): esta lista se arma ACÁ, en una variable, ANTES
  // del `.insert(...)` -- mismo hazard, mismo fix que F6 (el bloque de
  // `discipline_entries`/`season_seed_order`, más abajo en este archivo).
  // Adentro del argumento de `.insert()`, un `throw` acá -- `seat.trim()`
  // con `seat = null` -- corre SINCRÓNICAMENTE, antes de que exista ningún
  // `await` que lo atrape y ANTES del `if (entriesError !== null)` de
  // abajo, que es quien hace el rollback: se escaparía de `createSeason`
  // con la temporada y sus disciplinas YA insertadas y sin compensar.
  // `squadNames` es `string[]` sólo en TypeScript -- `createTournament`
  // (`app/torneos/nuevo/actions.ts`) es una Server Action, sus argumentos
  // cruzan como JSON de cliente sin schema en runtime, y esa anotación se
  // borra al compilar (mismo argumento de trust-boundary que
  // `isIndexPermutation` ya acepta para `seedOrder`, línea ~216) -- un
  // `null` en el medio del array es alcanzable desde afuera, no un caso de
  // laboratorio. Hoisteado y con su propio `try` de acá abajo, ese throw SÍ
  // dispara el rollback.
  let squadRows: { season_id: string; display_name: string; kind: 'SQUAD'; player_id: string | null }[]
  try {
    squadRows = squadNames.map((seat, index) => ({
      season_id: season.id,
      display_name: seat.trim(),
      kind: 'SQUAD' as const,
      player_id: index === mySeatIndex ? myPlayerId : null,
    }))
  } catch (err) {
    await supabase.from('seasons').delete().eq('id', season.id)
    throw err
  }

  const { data: entryRows, error: entriesError } = await supabase
    .from('entries')
    .insert(squadRows)
    .select('id')
  if (entriesError !== null || entryRows === null) {
    await supabase.from('seasons').delete().eq('id', season.id)
    throw new EdgeError(
      entriesError?.message.includes('entries_squad_named') === true
        ? 'Falta un nombre del plantel.'
        : `No se pudo cargar el plantel: ${entriesError?.message}`,
    )
  }

  // `season_seed_order` (0080_season_seed_order.sql, torneo-multi-disciplina
  // tanda 1): el orden a nivel TORNEO ya no se deriva de ninguna disciplina
  // (decisión #4044 superseded — ver el docblock de `seasonSeedOrder`,
  // `db/read.ts`). Se persiste ACÁ, en el índice de `squadNames` — el orden
  // GLOBAL del wizard, nunca el `seedNames` de una disciplina en particular:
  // si la primaria pidiera el suyo y esta tabla lo copiara, quedaríamos
  // exactamente donde estábamos antes de esta PR, sólo que en una tabla
  // nueva.
  //
  // WU1 (tanda 7, BLOQUEA): este insert se movió ACÁ, inmediatamente después
  // de `entries` y ANTES de `discipline_entries` -- antes vivía después de
  // ese bloque. `createSeason` no es una transacción (ver el docblock de la
  // función): son 4+N round trips independientes a PostgREST, y si el
  // proceso muere (crash, restart del contenedor, conexión cortada) entre
  // dos de ellos, la temporada queda con lo que ya escribió y nada más -- no
  // hay rollback que deshaga un `await` que nunca volvió. CUÁL de los dos
  // insert queda afuera decide si ese hueco es ruidoso o invisible:
  //
  //   - Sin `discipline_entries`: `setAttendance`/el sorteo de la primera
  //     fecha rebotan 23503 apenas se toca esa disciplina, y el tripwire
  //     GLOBAL de `db/discipline.db.test.ts:250` (cuenta huérfanos en toda
  //     la base) lo agarra igual. Ruidoso, se nota, y hay pantalla que
  //     puede recrearlo (agregar la disciplina de nuevo reconstruye sus
  //     asientos).
  //
  //   - Sin `season_seed_order`: NADA rebota. `seasonSquadMembersOf`
  //     (`db/read.ts`) cae al `?? Number.MAX_SAFE_INTEGER` de todas las
  //     filas, el sort estable estable queda atado a `entries.id` --un
  //     `gen_random_uuid()`--, y el plantel se dibuja en un orden que no es
  //     el del wizard ni se puede predecir. Encima no hay forma de curarlo:
  //     ninguna pantalla ESCRIBE `season_seed_order` (sólo `add_squad_seat`/
  //     `promote_guest`/`createSeason` lo hacen, y ninguno de los tres
  //     backfillea lo que falta) y el backfill de la 0080 ya corrió una
  //     sola vez, en su momento.
  //
  // Este reorder NO hace atómica a `createSeason` -- sigue siendo 4+N round
  // trips y un crash en CUALQUIER punto sigue siendo posible-- sólo cambia
  // CUÁL estado parcial es alcanzable, a propósito: el que un tripwire
  // existente ya nota, en vez del que ninguna pantalla puede reparar.
  if (entryRows.length > 0) {
    const { error: seedOrderError } = await supabase.from('season_seed_order').insert(
      entryRows.map((row, index) => ({
        season_id: season.id,
        entry_id: row.id,
        seed_position: index,
      })),
    )
    if (seedOrderError !== null) {
      await supabase.from('seasons').delete().eq('id', season.id)
      throw new EdgeError(`No se pudo guardar el orden del plantel: ${seedOrderError.message}`)
    }
  }

  // Cada asiento entra a TODAS las disciplinas recién creadas, en el orden en
  // que el wizard los nombró. Decisión de este slice (REQ-D1-3/D1-4):
  // el plantel es compartido a nivel torneo y por default juega todo — no
  // hay pantalla de "quién juega qué" en este wizard todavía (PR13 la agrega
  // para sumar una disciplina en curso). `discipline_entries` (PR 7) es la
  // fuente real del orden; sin este insert, un torneo nuevo nacería con sus
  // disciplinas vacías aunque `entries` tenga todo el plantel.
  if (entryRows.length > 0) {
    // F6 (revisión ciega dual, 37b225b..d33377a): esta lista se arma ACÁ,
    // en una variable, ANTES del `.insert(...)` -- no adentro de sus
    // argumentos, como estaba. Adentro del argumento, un `throw` acá (por
    // ejemplo `entryRows[globalIndex]!.id` con `globalIndex = -1`) queda
    // FUERA de cualquier try/catch y ANTES del `if (seatsError !== null)`
    // de abajo, que es quien hace el rollback -- se escaparía de
    // `createSeason` con la temporada YA insertada y sin compensar, el
    // estado huérfano que el docblock de esta función dice que el delete
    // compensatorio existe para evitar. Hoisteado y con el propio `try`
    // de acá abajo, ese throw SÍ dispara el rollback.
    let seatRows: { discipline_id: string; entry_id: string; season_id: string; seed_position: number }[]
    try {
      seatRows = disciplineRows.flatMap((discipline, disciplineIndex) => {
        const spec = disciplineSpecs[disciplineIndex]!
        const seedOrder = spec.seedOrder
        // El índice del array, no una columna de vuelta (C37): `insert ...
        // returning` devuelve las filas en el orden del `values`, así que
        // `entryRows[i]` es `squadNames[i]`. Lo fija el test de
        // `db/entries.db.test.ts` que compara nombre por nombre contra
        // `seedPosition` 0..7 — si PostgREST dejara de conservar ese orden,
        // cae ahí y no en una tabla desordenada en producción.
        if (seedOrder === undefined) {
          return entryRows.map((row, index) => ({
            discipline_id: discipline.id,
            entry_id: row.id,
            season_id: season.id,
            seed_position: index,
          }))
        }
        // `spec.seedOrder` (PR11c, formato de índices desde WU1) es la
        // EXCEPCIÓN a ese índice global: cuando la disciplina trae su propio
        // orden, cada elemento YA ES el índice sobre `squadNames`/`entryRows`
        // -- no hace falta traducir nada más, `seedOrderFrom`
        // (`wizard-state.ts`) hizo esa traducción una sola vez, en el wizard.
        // El `seed_position` que se escribe es la POSICIÓN dentro de
        // `seedOrder` (0..N-1), no el índice global.
        return seedOrder.map((globalIndex, seedPosition) => {
          // F6, vigente tras WU1: guard explícito, no confiar en que el
          // guard de permutación 130 líneas más arriba (`isIndexPermutation`)
          // sea el único camino hasta acá para siempre. WU5 (ronda 2 de
          // revisión): el chequeo `globalIndex < 0` de acá quedó
          // PROVABLEMENTE inalcanzable con el formato de índices --
          // `isIndexPermutation` ya rechaza cualquier `seedOrder` con un
          // valor negativo antes de llegar a este punto. Lo que SÍ sigue
          // siendo posible (aunque no esté medido, es la misma clase de
          // hazard que `entryRows.length` ya asumía implícitamente en la
          // rama sin `seedOrder`, arriba) es que `entryRows` vuelva más
          // corto que `squadNames` -- p.ej. si RLS filtrara alguna fila del
          // propio `.select()` del insert -- y ahí SÍ hace falta el guard.
          if (globalIndex >= entryRows.length) {
            throw new EdgeError(
              `No se pudo ubicar el orden propio de ${spec.kind ?? 'PADEL'} en el plantel.`,
            )
          }
          return {
            discipline_id: discipline.id,
            entry_id: entryRows[globalIndex]!.id,
            season_id: season.id,
            seed_position: seedPosition,
          }
        })
      })
    } catch (err) {
      await supabase.from('seasons').delete().eq('id', season.id)
      throw err
    }

    const { error: seatsError } = await supabase.from('discipline_entries').insert(seatRows)
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

/**
 * Cambia el nombre del torneo. Lo dice el paso 1 del wizard: "se puede cambiar
 * después".
 *
 * `count: 'exact'` por el mismo motivo que `setMatchdayDate` (W49):
 * un update que no toca ninguna fila NO es un error
 * en PostgREST. Estas escrituras se apoyan en RLS y no chequean admin por su
 * cuenta, así que a un participante que no organiza le decían que guardó y al
 * recargar volvía el valor viejo. La ronda 15 lo midió con un participante
 * real en las cuatro.
 */
export async function renameSeason(
  supabase: Client,
  seasonId: string,
  name: string,
): Promise<void> {
  const trimmed = name.trim()
  if (trimmed.length === 0) throw new EdgeError('El torneo necesita un nombre.')

  const { error, count } = await supabase
    .from('seasons')
    .update({ name: trimmed }, { count: 'exact' })
    .eq('id', seasonId)
  if (error !== null) throw new EdgeError(`No se pudo cambiar el nombre: ${error.message}`)
  if (count === 0) {
    throw new EdgeError('No se pudo cambiar el nombre: sólo puede hacerlo quien organiza.')
  }
}

// `updateSeasonRules` se borró acá (rebanada 2 de "reglas por disciplina"):
// su reemplazo es `updateDisciplineRules` (`db/discipline.ts`), que además
// dual-escribe `seasons.rules_text` en la disciplina default -- ver ese
// comentario para el porqué del dual-write.
