/**
 * The read layer: every function a screen calls to show something, never to
 * change it. `db/matchday.ts` exports writes and context builders for
 * mutations; the read-shaped pieces it already had — `resultsOf`, `guestsOf`,
 * `locksOf`, `playingEntryIds` — stay module-private there. The functions
 * here are new, read-only, and duplicate the small amount of query shape they
 * need instead of reaching into that module.
 *
 * Every function takes the caller's own `Client` first and never builds one
 * of its own: RLS is what keeps a stranger from reading a season that is not
 * theirs, and that only holds if the query actually runs as the caller.
 */
import { seasonStatusOf, sideOfRow } from '@/core'
import type {
  Award,
  DisciplineId,
  EntryId,
  MatchdayFormat,
  MatchResult,
  Phase,
  PlayedMatchday,
  SeasonConfig,
  SeasonStatus,
  SetScore,
  Side,
  SideSize,
} from '@/core'
import type { Client } from './client'
import { EdgeError } from './errors'
import { defaultDisciplineId } from './season'

/** Una disciplina, como la necesita un header: sólo lo que una pantalla de config puede llegar a mostrar. */
export interface DisciplineHeader {
  id: DisciplineId
  kind: 'PADEL' | 'FIFA'
  config: SeasonConfig
  /**
   * `disciplines.weight` (REQ-D9-1/2, tabla global) — ya `number` desde que
   * sale de PostgREST (W21, `` ronda 6, medido con el cliente
   * real; el `Number(...)` de `toDisciplineHeader` es un no-op de cinturón,
   * no una conversión real).
   */
  weight: number
  /** `disciplines.pair_size` real — mismo select, una columna más. */
  pairSize: SideSize
  /**
   * `disciplines.has_masters` real (decisión #4029) — mismo select, una
   * columna más. Nace de `pairSize` al crear (parte 1) y es lo único que
   * Ajustes necesita para dibujar el control (parte 2) y para saber si tiene
   * que salir deshabilitado (parte 3: no se puede encender en una disciplina
   * de a uno).
   */
  hasMasters: boolean
  /**
   * `disciplines.allows_draw` real (design rev 2, la cuarta mentira) — mismo
   * select que `pairSize`/`hasMasters`, una columna más. `describeFormat`
   * (`core/narrate.ts`) le prometía "Puede terminar empatado" a CUALQUIER
   * disciplina de marcador abierto sin mirar esta columna; a partir de acá
   * la tiene disponible para dejar de mentir. Es identidad, no forma: se fija
   * al crear la disciplina (`0015:66-68`) y esta rama sólo la LEE.
   */
  allowsDraw: boolean
}

export interface SeasonHeader {
  id: string
  name: string
  status: string
  regularMatchdays: number
  isAdmin: boolean
  /**
   * En orden de `position, created_at` — el mismo criterio que
   * `defaultDisciplineId` y `create_masters` (0021). Nunca vacío: REQ-NR-4 lo
   * garantiza, y `disciplines_read` (0015) usa el mismo gate `is_participant`
   * que `seasons_read`, así que quien ve este header ve su disciplina.
   *
   * `SeasonHeader` ya NO trae `config`: hasta PR 5 este header devolvía
   * `seasons.config`, que podía divergir de la disciplina sin que nada lo
   * notara. `disciplines.config` es la fuente real desde PR 5;
   * `primaryDiscipline` es el acceso de acá hasta que exista el wizard
   * multi-disciplina (PR 11).
   *
   * CORRECCIÓN (C35, verify-report-go-no-go #4034): esta nota decía
   * "(`updateSeasonConfig` era su único escritor)" — falso, y es justo lo que
   * hizo errar a dos tandas (#4028, #4032): las dos buscaron esa función
   * exportada y ninguna miró el `.insert()` inline de `createSeason`, que
   * SÍ escribía `seasons.config` hasta que esta misma tanda lo cerró. La
   * columna sigue existiendo (nullable desde `0059`) sin un solo lector ni
   * escritor de producción; el `drop column` es del CONTRACT.
   */
  disciplines: DisciplineHeader[]
  /** The share link's token. Every participant can already read this column; the wizard and the settings screen show it. */
  inviteToken: string
}

/**
 * La disciplina [0] de un header — la única hasta el wizard multi-disciplina
 * (PR 11). Centraliza acá el único `throw` que necesita este supuesto, en vez
 * de repetirlo en cada pantalla que hoy sólo conoce una disciplina.
 */
export function primaryDiscipline(header: SeasonHeader): DisciplineHeader {
  const discipline = header.disciplines[0]
  if (discipline === undefined) throw new EdgeError('El torneo no tiene disciplina.')
  return discipline
}

/**
 * La disciplina de UNA fecha puntual — no la [0] de la temporada. PR 10 pone
 * la disciplina en la URL de `fechas/[n]`, y ese mismo cambio deja a mano
 * `matchday.disciplineId` donde antes sólo estaba `primaryDiscipline(header)`
 * con dos disciplinas del mismo
 * `kind` en la temporada (Fase 2), la [0] ya no es necesariamente la de ESTA
 * fecha.
 *
 * El `throw` es el mismo supuesto de `primaryDiscipline`: `disciplineId` está
 * garantizado por la FK compuesta `matchdays_discipline_season` (0015) a
 * estar en `header.disciplines`, así que en la práctica nunca dispara.
 */
export function disciplineOf(header: SeasonHeader, disciplineId: DisciplineId): DisciplineHeader {
  const discipline = header.disciplines.find((candidate) => candidate.id === disciplineId)
  if (discipline === undefined) throw new EdgeError('La disciplina de la fecha no existe en el torneo.')
  return discipline
}

export interface EntryRow {
  id: string
  displayName: string
  kind: 'SQUAD' | 'GUEST'
  seedPosition: number
  playerId: string | null
  /** Null for the squad. For a guest, the matchday they were invited to — without it there is no telling one matchday's guests from another's. */
  matchdayId: string | null
}

/**
 * A match as a screen that WRITES gets it: `MatchResult` plus the id.
 *
 * `saveResult` takes a match id and `core/` has no notion of one, so the read
 * layer is where the two meet. It extends `MatchResult`, so everything that
 * already consumes these as `MatchResult[]` — `computeStandings`,
 * `mastersChampion`, the read-only screens — keeps working untouched.
 */
export interface MatchWithId extends MatchResult {
  id: string
}

/** The five fields the rules page shows to somebody with no account. */
export interface PublicRules {
  name: string
  config: SeasonConfig
  text: string
  updatedAt: string | null
  adminName: string
}

/**
 * Una disciplina vista desde afuera: su tipo y su config, nada más.
 *
 * `kind` va como literal y no como el `DisciplineKind` de `wizard-state`, por
 * lo mismo que `DisciplineHeader.kind` unas líneas más arriba: `db/` no
 * importa de `app/`. La pantalla traduce el literal a etiqueta con
 * `DISCIPLINE_LABELS`, que es donde ese mapa vive.
 */
export interface PublicFormat {
  kind: 'PADEL' | 'FIFA'
  config: SeasonConfig
  /** `disciplines.rules_text` real (0069) — la prosa libre de ESA disciplina, no la de `seasons`. */
  rulesText: string
  /** `disciplines.has_masters` real (0069) — mismo dato que `DisciplineHeader.hasMasters`, para quien no tiene sesión. */
  hasMasters: boolean
  /** `disciplines.pair_size` real (0069) — mismo dato que `DisciplineHeader.pairSize`. */
  pairSize: SideSize
  /** `disciplines.allows_draw` real (0069) — mismo dato que `DisciplineHeader.allowsDraw`. */
  allowsDraw: boolean
}

/** A row of `pair_locks`: the same `{ a, b }` the draw uses, plus the id `unlockPair` deletes by. */
export interface PairLockRow {
  id: string
  a: EntryId
  b: EntryId
}

export interface MatchdaySummary {
  id: string
  number: number
  kind: 'REGULAR' | 'MASTERS'
  status: 'DRAFT' | 'OPEN' | 'CLOSED'
  playedOn: string | null
  /** Para que quien ya tiene esta fila no tenga que resolver la disciplina de nuevo (`awardsBefore`/`closedHistory` la piden). */
  disciplineId: DisciplineId
  /**
   * Si un empate es un resultado legal en ESTA fecha. Sale de `matchdays`, no
   * de la disciplina, y a propósito: `matchdays_discipline_draw` es `on update
   * no action`, así que una vez creada la fecha la disciplina ya no puede
   * cambiarlo. Es el valor CONGELADO, y una fecha vieja se tiene que poder
   * releer con la misma regla con la que se jugó. Mismo criterio que
   * `closeMatchday`, que ya juzgaba los resultados con `matchday.allows_draw`.
   */
  allowsDraw: boolean
  /**
   * `matchdays.formato` (REQ-D8-1, Rebanada C1): cómo se arma esta fecha en
   * particular. `ROUND_ROBIN` por default (0040) — una fecha de pádel de
   * siempre nunca lo cambia y sigue viendo exactamente eso.
   */
  formato: MatchdayFormat
}

export interface MatchdayDetail {
  matchday: MatchdaySummary
  /** Los lados de la fecha, de uno o de dos según la disciplina. */
  sides: Side[]
  matches: MatchWithId[]
  guestIds: EntryId[]
}

interface SeasonRow {
  id: string
  name: string
  created_by: string
  invite_token: string
}

interface DisciplineHeaderRow {
  id: string
  season_id: string
  kind: string
  config: unknown
  /**
   * `database.types.ts` (generado) declara esto `number`, y el tipo NO
   * miente (W21, `` ronda 6, medido con el cliente real):
   * PostgREST emite `numeric(4,2)` sin comillas y `Response.json()` lo
   * entrega ya como `number`. `toDisciplineHeader` igual lo pasa por
   * `Number()`, ver ahí el porqué.
   */
  weight: number
  pair_size: number
  has_masters: boolean
  allows_draw: boolean
  /**
   * `disciplines.status` — NO forma parte de `DisciplineHeader` (el tipo
   * público): ningún consumidor de pantalla lo necesita hoy, sólo
   * `toSeasonHeader` para derivar `SeasonHeader.status` (REQ-D3-3) de la
   * MISMA fila que ya se estaba trayendo, sin una consulta más. Exponerlo en
   * `DisciplineHeader` obligaría a cada fixture de test que arma uno a mano
   * (`cableado-de-formato.unit.test.ts`, `fechas/[n]/page.unit.test.ts`) a
   * cargar un dato que no usan.
   */
  status: string
}

interface MatchdayRow {
  id: string
  number: number
  kind: string
  status: string
  played_on: string | null
  discipline_id: string
  allows_draw: boolean
  formato: unknown
}

/** `null` for an anonymous or logged-out caller — never throws, so a stranger's read still resolves to "nothing theirs" instead of blowing up. */
async function currentUserId(supabase: Client): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser()
  if (error) return null
  return data.user?.id ?? null
}

export function toDisciplineHeader(row: DisciplineHeaderRow): DisciplineHeader {
  return {
    id: row.id as DisciplineId,
    kind: row.kind as 'PADEL' | 'FIFA',
    config: row.config as unknown as SeasonConfig,
    // Number(...) EN ESTE ÚNICO LUGAR: no convierte nada en la práctica —
    // `row.weight` ya llega `number` (ver DisciplineHeaderRow.weight) — pero
    // se deja como cinturón para cualquier lectura futura que no pase por
    //`fetch`+`JSON.parse` (W21, `` ronda 6). `Number(1) === 1`,
    // cero riesgo.
    weight: Number(row.weight),
    pairSize: row.pair_size as SideSize,
    hasMasters: row.has_masters,
    allowsDraw: row.allows_draw,
  }
}

function toSeasonHeader(
  row: SeasonRow,
  disciplines: DisciplineHeader[],
  status: SeasonStatus,
  userId: string | null,
): SeasonHeader {
  const primary = disciplines[0]
  if (primary === undefined) throw new EdgeError('El torneo no tiene disciplina.')
  return {
    id: row.id,
    name: row.name,
    status,
    regularMatchdays: primary.config.regularMatchdays,
    isAdmin: row.created_by === userId,
    disciplines,
    inviteToken: row.invite_token,
  }
}

function toMatchdaySummary(row: MatchdayRow): MatchdaySummary {
  return {
    id: row.id,
    number: row.number,
    kind: row.kind as 'REGULAR' | 'MASTERS',
    status: row.status as 'DRAFT' | 'OPEN' | 'CLOSED',
    playedOn: row.played_on,
    // Única marca de esta función: de acá en más `disciplineId` es
    // `DisciplineId`, no `string` a secas.
    disciplineId: row.discipline_id as DisciplineId,
    allowsDraw: row.allows_draw,
    // Mismo doble cast que `db/matchday.ts` ya usa para esta misma columna: lo
    // honesto es `matchdays_formato_kind` (0040), no la confianza.
    formato: row.formato as unknown as MatchdayFormat,
  }
}

// `status` salió de acá (bloqueante #2 del contract, verify-report-pre-contract
// #4026): `seasons.status` ya no tiene lector de producción. `SeasonHeader.
// status` deriva de `disciplines.status` (REQ-D3-3, `seasonStatusOf`), con la
// MISMA fila que `DISCIPLINE_HEADER_COLUMNS` ya trae — sin una consulta más.
const SEASON_HEADER_COLUMNS = 'id, name, created_by, invite_token'
const DISCIPLINE_HEADER_COLUMNS =
  'id, season_id, kind, config, weight, pair_size, has_masters, allows_draw, status'

/** Every season where the caller has a seat — admin or squad. RLS does the filtering; this only shapes the rows. */
export async function mySeasons(supabase: Client): Promise<SeasonHeader[]> {
  const [{ data, error }, userId] = await Promise.all([
    supabase.from('seasons').select(SEASON_HEADER_COLUMNS),
    currentUserId(supabase),
  ])
  if (error) throw new EdgeError(`No se pudieron leer las temporadas: ${error.message}`)
  const seasons = data ?? []
  if (seasons.length === 0) return []

  // `count: 'exact'` y el guard de abajo (S98): PostgREST corta CADA select
  // en `PGRST_DB_MAX_ROWS` (1000, `supabase/config.toml`) y NO avisa. Antes
  // `status` era un escalar por temporada; desde REQ-D3-3 es un AGREGADO sobre
  // estas filas (`seasonStatusOf`), y perder filas CAMBIA el resultado:
  // `every(FINISHED)` sobre un subconjunto puede decir "Terminado" de un torneo
  // en curso. Es la misma trampa que el tripwire de `db/discipline.db.test.ts`
  // documenta desde que un cruce truncado le reportó 248 huérfanas que no
  // existían.
  const {
    data: disciplineRows,
    error: disciplinesError,
    count,
  } = await supabase
    .from('disciplines')
    .select(DISCIPLINE_HEADER_COLUMNS, { count: 'exact' })
    .in(
      'season_id',
      seasons.map((season) => season.id),
    )
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  if (disciplinesError) {
    throw new EdgeError(`No se pudieron leer las disciplinas: ${disciplinesError.message}`)
  }
  // Falla RUIDOSO en vez de derivar un estado sobre filas que faltan: un error
  // en pantalla se ve y se arregla, un "Terminado" que no lo es no.
  // ponytail: se corta en el techo de PostgREST, no pagina. Hacen falta ~1000
  // disciplinas de UN mismo usuario para llegar; si alguna vez pasa, el
  // upgrade es paginar con `.range()` en bucle, no subir el techo.
  if (count !== null && (disciplineRows ?? []).length < count) {
    throw new EdgeError(
      `No se pudieron leer todas las disciplinas (${(disciplineRows ?? []).length} de ${count}). Recargá la pantalla.`,
    )
  }

  const disciplineRowsBySeason = new Map<string, DisciplineHeaderRow[]>()
  for (const row of disciplineRows ?? []) {
    const bucket = disciplineRowsBySeason.get(row.season_id)
    if (bucket === undefined) disciplineRowsBySeason.set(row.season_id, [row])
    else bucket.push(row)
  }

  return seasons.map((season) => {
    const rows = disciplineRowsBySeason.get(season.id) ?? []
    return toSeasonHeader(
      season,
      rows.map(toDisciplineHeader),
      seasonStatusOf(rows as { status: SeasonStatus }[]),
      userId,
    )
  })
}

export async function seasonHeader(supabase: Client, seasonId: string): Promise<SeasonHeader> {
  const [{ data, error }, { data: disciplineRows, error: disciplinesError }, userId] = await Promise.all([
    supabase.from('seasons').select(SEASON_HEADER_COLUMNS).eq('id', seasonId).maybeSingle(),
    supabase
      .from('disciplines')
      .select(DISCIPLINE_HEADER_COLUMNS)
      .eq('season_id', seasonId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true }),
    currentUserId(supabase),
  ])
  if (error) throw new EdgeError(`No se pudo leer la temporada: ${error.message}`)
  if (data === null) throw new EdgeError('La temporada no existe.')
  if (disciplinesError) {
    throw new EdgeError(`No se pudieron leer las disciplinas: ${disciplinesError.message}`)
  }
  const rows = disciplineRows ?? []
  return toSeasonHeader(
    data,
    rows.map(toDisciplineHeader),
    seasonStatusOf(rows as { status: SeasonStatus }[]),
    userId,
  )
}

/**
 * El nombre de quien organiza la temporada — el jugador cuyo `user_id`
 * coincide con `seasons.created_by`. No hay forma de resolver eso con una
 * consulta directa: `players.user_id` no tiene SELECT otorgado a
 * `authenticated` a propósito (0002_rls.sql, 0006_my_player_id.sql), para no
 * dejar correlacionar `auth.uid()` con un player desde el cliente. La única
 * función que ya hace ese cruce es `season_invite` (0004_claim_seat.sql, la
 * pantalla de Unirse) — se reusa acá en vez de sumar una migración nueva sólo
 * para este campo.
 */
export async function seasonAdminName(supabase: Client, seasonId: string): Promise<string> {
  const { data: season, error: seasonError } = await supabase
    .from('seasons')
    .select('invite_token')
    .eq('id', seasonId)
    .maybeSingle()
  if (seasonError) throw new EdgeError(`No se pudo leer la temporada: ${seasonError.message}`)
  if (season === null) throw new EdgeError('La temporada no existe.')

  const { data: invite, error: inviteError } = await supabase
    .rpc('season_invite', { p_token: season.invite_token })
    .limit(1)
  if (inviteError) throw new EdgeError(`No se pudo leer quién organiza: ${inviteError.message}`)
  const adminName = invite?.[0]?.admin_name
  if (adminName === undefined) throw new EdgeError('No se pudo leer quién organiza.')
  return adminName
}

/**
 * `disciplines.rules_text` de TODAS las disciplinas de la temporada (0069),
 * una consulta, mapeada por `DisciplineId`. Lo leen Ajustes
 * (`ajustes/page.tsx`, un editor por disciplina) y Reglas (`reglas/page.tsx`,
 * un bloque por disciplina, rebanada 3b) — reemplazó a `seasonRules`, que
 * leía `seasons.rules_text` de la temporada entera y no distinguía entre
 * disciplinas. `seasons.rules_text` sigue existiendo (dual-write de
 * `updateDisciplineRules`, `db/discipline.ts`) hasta el contract; ya no tiene
 * un lector de pantalla.
 *
 * `disciplines_read` (0015:56-57) usa el MISMO gate `is_participant(season_id)`
 * que `seasons_read` — un extraño sigue sin poder leer esto, igual que hoy.
 */
export async function disciplineRulesOf(
  supabase: Client,
  seasonId: string,
): Promise<Map<DisciplineId, string>> {
  const { data, error } = await supabase
    .from('disciplines')
    .select('id, rules_text')
    .eq('season_id', seasonId)
  if (error) throw new EdgeError(`No se pudieron leer las reglas: ${error.message}`)
  return new Map((data ?? []).map((row) => [row.id as DisciplineId, row.rules_text]))
}

/**
 * Squad and guests together, every matchday of the season. `playerId` is
 * `null` for a seat nobody has claimed.
 *
 * `seedPosition` para un GUEST sigue siendo `entries.seed_position` —
 * correlativo por FECHA, sin relación con `discipline_entries` (un GUEST
 * nunca tiene fila ahí, ver 0023).
 *
 * Para un SQUAD, `disciplineId` (opcional) elige de cuál: sin él cae en
 * `defaultDisciplineId`, el mismo criterio que el resto del código hasta el
 * wizard multi-disciplina (PR 11) — la pantalla de una fecha SÍ pasa la suya
 * (`matchday.disciplineId`, C8).
 *
 * Un SQUAD sin fila en `discipline_entries` de esa disciplina NO PERTENECE a
 * ella y queda AFUERA de lo que devuelve esta función — ya no se lo cubre con
 * `entries.seed_position` (C9, misma ronda): esa columna es otra numeración
 * (de LA TEMPORADA, dual-write tail-only desde PR 7) y mezclarla con
 * `discipline_entries.seed_position` (de LA DISCIPLINA) producía posiciones
 * colisionadas. Única excepción: si la disciplina no se pudo resolver
 * (`defaultDisciplineId` da `null`) el SQUAD se numera 0,1,2… en el orden de
 * entrada, sin `discipline_entries` de por medio, porque ahí no hay dos
 * espacios que mezclar — no hay ninguno.
 *
 * Esa excepción numeraba con `entries.seed_position` hasta C37, y el contract
 * deja esa columna en `null` para el SQUAD. El caso es raro (las tres tablas
 * comparten el gate `is_participant`, así que quien no ve `disciplines`
 * tampoco ve `entries`: hace falta una temporada sin ninguna disciplina) y
 * NO tenía un solo test — medido borrando la rama entera, la suite quedaba
 * verde. Ahora sí lo tiene: `db/entries.db.test.ts`.
 */
export async function entriesOf(
  supabase: Client,
  seasonId: string,
  disciplineId?: DisciplineId,
): Promise<EntryRow[]> {
  const effectiveDisciplineIdPromise: Promise<DisciplineId | null> =
    disciplineId !== undefined ? Promise.resolve(disciplineId) : defaultDisciplineId(supabase, seasonId)

  const [{ data, error }, effectiveDisciplineId] = await Promise.all([
    supabase
      .from('entries')
      .select('id, display_name, kind, seed_position, player_id, matchday_id')
      .eq('season_id', seasonId)
      // Orden de ENTRADA, no el de salida: cada `seedPosition` se resuelve
      // más abajo y las pantallas re-ordenan por ese campo. Dejó de ser
      // `seed_position` (C37) porque esa columna se va a `null` para el
      // SQUAD con el contract, y ordenar por una columna nula es no ordenar.
      // `created_at` solo no alcanza: `createSeason` inserta todo el plantel
      // en UNA sentencia y comparten el `now()`.
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
    effectiveDisciplineIdPromise,
  ])
  if (error) throw new EdgeError(`No se pudo leer el plantel: ${error.message}`)
  const rows = data ?? []

  const squadIds = rows.filter((row) => row.kind === 'SQUAD').map((row) => row.id)
  const disciplineSeed = new Map<string, number>()
  if (effectiveDisciplineId !== null && squadIds.length > 0) {
    const { data: seats, error: seatsError } = await supabase
      .from('discipline_entries')
      .select('entry_id, seed_position')
      .eq('discipline_id', effectiveDisciplineId)
      .in('entry_id', squadIds)
    if (seatsError) throw new EdgeError(`No se pudo leer el orden del plantel: ${seatsError.message}`)
    for (const seat of seats ?? []) disciplineSeed.set(seat.entry_id, seat.seed_position)
  }

  const entries: EntryRow[] = []
  // Sólo para la rama sin disciplina resoluble: numera el SQUAD 0,1,2… en el
  // orden de entrada. Antes ese número salía de `entries.seed_position`
  // (C37), que el contract deja en `null` para el SQUAD — habría devuelto
  // `null` en un campo tipado `number`. Acá no hay orden real que dar (no hay
  // disciplina de la cual leerlo), y lo que importa es no perder a nadie:
  // devolver el plantel con un orden propio es peor que el orden real y
  // MUCHO mejor que una pantalla vacía.
  let fallbackSeed = 0
  for (const row of rows) {
    if (row.kind !== 'SQUAD') {
      // Un GUEST SIEMPRE tiene `seed_position`: es su orden real dentro de la
      // fecha (`entries_guest_order`), lo escribe `addGuestSeat`
      // (`db/matchday.ts`) y el CHECK `entries_seed_shape` del contract se lo
      // va a exigir `not null`. El tipo dejó de garantizarlo cuando la
      // columna se relajó para el SQUAD (C37, `0060`), así que el invariante
      // se chequea acá en vez de taparse con un `?? 0` que ordenaría mal sin
      // decir nada.
      if (row.seed_position === null) {
        throw new EdgeError('Un invitado quedó sin posición en su fecha. Esto es un bug.')
      }
      entries.push({
        id: row.id,
        displayName: row.display_name,
        kind: 'GUEST',
        seedPosition: row.seed_position,
        playerId: row.player_id,
        matchdayId: row.matchday_id,
      })
      continue
    }
    const seedPosition = effectiveDisciplineId === null ? fallbackSeed++ : disciplineSeed.get(row.id)
    if (seedPosition === undefined) continue // no juega esta disciplina
    entries.push({
      id: row.id,
      displayName: row.display_name,
      kind: 'SQUAD',
      seedPosition,
      playerId: row.player_id,
      matchdayId: row.matchday_id,
    })
  }
  return entries
}

/** Who ticked what on one matchday. A seat with no row is coming: the screens draw the default, and `seedAttendances` makes the database agree. */
export async function attendancesOf(
  supabase: Client,
  matchdayId: string,
): Promise<Map<EntryId, 'PLAYING' | 'ABSENT'>> {
  const { data, error } = await supabase
    .from('attendances')
    .select('entry_id, status')
    .eq('matchday_id', matchdayId)
  if (error) throw new EdgeError(`No se pudo leer el presentismo: ${error.message}`)
  return new Map((data ?? []).map((row) => [row.entry_id, row.status as 'PLAYING' | 'ABSENT']))
}

/**
 * The pairs the admin settled by hand on one matchday, WITH their row id.
 *
 * `locksOf` in `db/matchday.ts` answers the same question for the draw and
 * drops the id on purpose: a `core/` pair is `{ a, b }` and nothing else. The
 * DRAFT screen does need it, because `unlockPair` deletes by id and the
 * guest's partner selector has to be able to change its mind.
 */
export async function pairLocksOf(supabase: Client, matchdayId: string): Promise<PairLockRow[]> {
  const { data, error } = await supabase
    .from('pair_locks')
    .select('id, entry_a, entry_b')
    .eq('matchday_id', matchdayId)
    .order('id', { ascending: true })
  if (error) throw new EdgeError(`No se pudieron leer las parejas fijas: ${error.message}`)
  return (data ?? []).map((row) => ({ id: row.id, a: row.entry_a, b: row.entry_b }))
}

/**
 * Which seat of this season belongs to the caller, or null.
 *
 * It takes two round trips because it has to: `players.user_id` has no SELECT
 * granted to `authenticated` (0002_rls.sql), on purpose, so that nobody can
 * correlate `auth.uid()` with a player from the client. `my_player_id()`
 * (0006) is the only way across, and it is a `security definer` that answers
 * only about the caller.
 */
export async function myEntryId(supabase: Client, seasonId: string): Promise<EntryId | null> {
  const { data: playerId, error: playerError } = await supabase.rpc('my_player_id')
  if (playerError !== null || playerId === null) return null

  const { data, error } = await supabase
    .from('entries')
    .select('id')
    .eq('season_id', seasonId)
    .eq('player_id', playerId)
    .maybeSingle()
  if (error) throw new EdgeError(`No se pudo leer tu asiento: ${error.message}`)
  return data?.id ?? null
}

/** Display names by player id. `players` exposes only (id, display_name, created_at) to authenticated — that is all this needs. */
export async function playerNames(
  supabase: Client,
  playerIds: readonly string[],
): Promise<Map<string, string>> {
  if (playerIds.length === 0) return new Map()
  const { data, error } = await supabase
    .from('players')
    .select('id, display_name')
    .in('id', [...playerIds])
  if (error) throw new EdgeError(`No se pudieron leer los nombres: ${error.message}`)
  return new Map((data ?? []).map((row) => [row.id, row.display_name]))
}

/**
 * The rules, for somebody with no account.
 *
 * The ONLY read in this file that works without a session, and the only public
 * surface of the whole app: `anon` has SELECT on no table at all, so this goes
 * through `season_public_rules` (0007), a `security definer` that returns five
 * fields and none of them says who plays.
 *
 * Returns null instead of throwing for a season that is not there: whoever
 * opens a dead link does not need a stack trace.
 */
export async function publicRules(supabase: Client, seasonId: string): Promise<PublicRules | null> {
  const { data, error } = await supabase.rpc('season_public_rules', { p_season: seasonId })
  if (error !== null) throw new EdgeError(`No se pudieron leer las reglas: ${error.message}`)

  const row = data?.[0]
  if (row === undefined) return null
  return {
    name: row.name,
    config: row.config as unknown as SeasonConfig,
    text: row.rules_text,
    updatedAt: row.rules_updated_at,
    adminName: row.admin_name,
  }
}

/**
 * El formato de CADA disciplina del torneo, para alguien sin cuenta.
 *
 * La segunda —y última— lectura de este archivo que funciona sin sesión.
 * `publicRules` de acá arriba trae los cinco campos de la pantalla pero la
 * config de UNA sola disciplina, la de por defecto, y ni siquiera su `kind`:
 * con eso, un torneo de pádel + FIFA le decía a un extraño "1 set a 4 games"
 * sobre una mitad que se juega a goles (S76, la mitad anónima de W64).
 *
 * Va por `season_public_formats` (0038), una función NUEVA y ADITIVA:
 * `season_public_rules` no se toca. Cambiarle el `returns table` pedía
 * `drop function` —Postgres rechaza cambiar el tipo de retorno con `create or
 * replace`— y el drop se lleva los grants, dejando sin superficie pública la
 * única pantalla que se comparte por link.
 *
 * Devuelve `kind`, `config`, `rules_text`, `has_masters`, `pair_size` y
 * `allows_draw` y NADA más (0069) — fijado por test
 * (`db/public-formats.db.test.ts`): un `id` de más le regalaría a `anon`
 * claves primarias, y `anon` hoy lee **cero** tablas.
 *
 * Array vacío en vez de excepción para un link muerto, mismo criterio que
 * `publicRules`.
 */
export async function publicFormats(supabase: Client, seasonId: string): Promise<PublicFormat[]> {
  const { data, error } = await supabase.rpc('season_public_formats', { p_season: seasonId })
  if (error !== null) throw new EdgeError(`No se pudieron leer los formatos: ${error.message}`)

  return (data ?? []).map((row) => ({
    kind: row.kind as 'PADEL' | 'FIFA',
    config: row.config as unknown as SeasonConfig,
    rulesText: row.rules_text,
    hasMasters: row.has_masters,
    // `check (pair_size in (1, 2))` (0015:19) lo hace total: sin `as`, a
    // diferencia del `row.kind as …` de arriba.
    pairSize: row.pair_size === 1 ? 1 : 2,
    allowsDraw: row.allows_draw,
  }))
}

export async function matchdaysOf(supabase: Client, seasonId: string): Promise<MatchdaySummary[]> {
  const disciplineId = await defaultDisciplineId(supabase, seasonId)
  // Ninguna disciplina visible: para un extraño es RLS escondiéndolas, no un
  // error — misma respuesta que daba `.eq('season_id', seasonId)` antes, que
  // simplemente no encontraba filas.
  if (disciplineId === null) return []
  const { data, error } = await supabase
    .from('matchdays')
    .select('id, number, kind, status, played_on, discipline_id, allows_draw, formato')
    .eq('discipline_id', disciplineId)
    .order('number', { ascending: true })
  if (error) throw new EdgeError(`No se pudieron leer las fechas: ${error.message}`)
  return (data ?? []).map(toMatchdaySummary)
}

/**
 * TODAS las fechas de la temporada, de CUALQUIER disciplina — a diferencia de
 * `matchdaysOf`, que sólo trae las de la disciplina por defecto. Bug latente
 * descubierto escribiendo el test:db del redirect legacy de PR 10 (que el
 * CONTRACT se llevó junto con el redirect):
 * hasta Fase 1 (una disciplina por temporada) las dos consultas daban lo
 * mismo por casualidad, y con una segunda disciplina `matchdaysOf` la deja
 * afuera en silencio — exactamente el síntoma de C8/C9 (ronda 4) en
 * `entriesOf`, acá en `matchdaysOf`.
 *
 * `matchdaysOf` NO se toca: sus otros 4 llamadores (season overview, Mis
 * torneos, Ajustes, la lista de fechas) siguen viendo sólo la disciplina por
 * defecto hasta que ELLOS mismos se vuelvan multi-disciplina (mismo criterio
 * que `entriesOf`: no cambiar el default de quien no lo pidió). Esta función
 * es para quien necesita encontrar una fecha SIN saber de antemano a qué
 * disciplina pertenece: la ruta `[disciplina]/fechas/[n]` (la conoce por la
 * URL y filtra después) y el redirect de la URL vieja (la busca para
 * AVERIGUARLA).
 */
export async function seasonMatchdaysOf(supabase: Client, seasonId: string): Promise<MatchdaySummary[]> {
  const { data, error } = await supabase
    .from('matchdays')
    .select('id, number, kind, status, played_on, discipline_id, allows_draw, formato')
    .eq('season_id', seasonId)
    .order('number', { ascending: true })
  if (error) throw new EdgeError(`No se pudieron leer las fechas: ${error.message}`)
  return (data ?? []).map(toMatchdaySummary)
}

/**
 * El plantel SQUAD de la temporada ENTERA, sin importar qué disciplinas
 * juega cada quien — lo que la tabla global necesita (REQ-D9) y `entriesOf`
 * no da: `entriesOf` deja afuera a quien no tiene fila en
 * `discipline_entries` de LA disciplina resuelta (C8/C9, ronda 4); acá nadie
 * queda afuera porque no se pasa por esa tabla. Sumar puntos ponderados
 * (`computeRanking` por disciplina + `computeGlobalRanking`) ya deja en 0 a
 * quien no jugó una de ellas — no hace falta excluirlo acá.
 *
 * Delega en `seasonSquadMembersOf` y tira los campos de más (C37): las dos
 * traían la misma fila con el mismo orden, y ese orden dejó de ser un
 * `.order()` de una columna para pasar a resolverse contra la disciplina
 * primaria. Duplicarlo era duplicar la parte que se puede desincronizar.
 */
export async function seasonSquadOf(supabase: Client, seasonId: string): Promise<EntryId[]> {
  return (await seasonSquadMembersOf(supabase, seasonId)).map((member) => member.id)
}

/**
 * El orden del plantel A NIVEL TORNEO: `entry_id -> seed_position` de la
 * disciplina PRIMARIA. Quien no juega la primaria no está en el mapa.
 *
 * Decisión #4044 (C37): `entries.seed_position` deja de tener valor para el
 * SQUAD con el contract —se relaja y se ata a `kind = 'GUEST'`—, y el orden
 * pasa a vivir sólo en `discipline_entries`, que es POR DISCIPLINA. La
 * pregunta que quedaba abierta desde PR 7 es cuál de ellas ordena el TORNEO,
 * y la respuesta es la primaria: es la que se sembró desde
 * `entries.seed_position` en el backfill de 0023, así que elegirla es cero
 * cambio visible para las temporadas que ya existen.
 *
 * `defaultDisciplineId` es el mismo criterio que usan `create_masters`
 * (0050) y `season_invite` (0026) —`order by position, created_at limit 1`—
 * y se reusa a propósito en vez de escribir uno nuevo.
 */
async function seasonSeedOrder(supabase: Client, seasonId: string): Promise<Map<string, number>> {
  const disciplineId = await defaultDisciplineId(supabase, seasonId)
  if (disciplineId === null) return new Map()
  const { data, error } = await supabase
    .from('discipline_entries')
    .select('entry_id, seed_position')
    .eq('discipline_id', disciplineId)
  if (error) throw new EdgeError(`No se pudo leer el orden del plantel: ${error.message}`)
  return new Map((data ?? []).map((seat) => [seat.entry_id, seat.seed_position]))
}

/** Una fila de `seasonSquadMembersOf`: el id que necesita `computeRanking`, el nombre que la pantalla dibuja, y el dueño del asiento (o `null` si nadie lo reclamó). */
export interface SquadMember {
  id: EntryId
  displayName: string
  playerId: string | null
}

/**
 * El plantel de la temporada CON el nombre (PR12b slice 2, tabla global): la
 * raíz de la temporada necesita el NOMBRE de cada fila, no sólo el id — algo
 * que `entriesOf` sí trae pero filtrado a UNA disciplina (exactamente lo que
 * esta pantalla no puede hacer). Es la implementación de las dos:
 * `seasonSquadOf` delega acá y se queda con los ids.
 *
 * `playerId` (C14) se sumó para que "Plantel" en
 * Ajustes pueda usar esta función en vez de `entriesOf(seasonId)` sin
 * disciplina — esa llamada caía en la disciplina por defecto y perdía a
 * cualquier SQUAD promovido desde otra (`db/read.ts:419`).
 *
 * CUIDADO al tocar esto (C37): desde que el orden es el de la primaria, acá
 * SÍ se lee `discipline_entries` — pero sólo para ORDENAR, nunca para
 * filtrar. Quien no juega la primaria va al final (`seasonSeedOrder`), no
 * afuera. Convertir ese `?? MAX_SAFE_INTEGER` en un `.filter()` reabre
 * exactamente el agujero que esta función existe para tapar.
 */
export async function seasonSquadMembersOf(supabase: Client, seasonId: string): Promise<SquadMember[]> {
  const [{ data, error }, order] = await Promise.all([
    supabase
      .from('entries')
      .select('id, display_name, player_id')
      .eq('season_id', seasonId)
      .eq('kind', 'SQUAD')
      // El orden REAL lo pone `seasonSeedOrder` acá abajo; éste es sólo el de
      // entrada, y tiene que ser determinístico igual porque es el desempate
      // de quien no juega la primaria. `created_at` solo no alcanza:
      // `createSeason` inserta todo el plantel en UNA sentencia, así que
      // comparten el `now()` al milisegundo — de ahí el `id` detrás.
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
    seasonSeedOrder(supabase, seasonId),
  ])
  if (error) throw new EdgeError(`No se pudo leer el plantel: ${error.message}`)
  //`?? MAX_SAFE_INTEGER`: quien no juega la primaria va al FINAL, no se
  // pierde (REQ-D9 — esta función existe justamente para no perder a nadie) y
  // no se cuela en el medio. Mismo criterio que `season_invite` (0026) desde
  // PR 9: `order by (de.seed_position is null), de.seed_position`.
  return (data ?? [])
    .map((row) => ({ row, seed: order.get(row.id) ?? Number.MAX_SAFE_INTEGER }))
    .sort((left, right) => left.seed - right.seed)
    .map(({ row }) => ({ id: row.id, displayName: row.display_name, playerId: row.player_id }))
}

/**
 * Los awards de TODAS las fechas cerradas de la temporada, agrupados por
 * disciplina y por número de fecha adentro — versión "temporada entera" de
 * `awardsOf` (REQ-D9). Toma `matchdays` ya resueltas (`seasonMatchdaysOf`) en
 * vez de leerlas de nuevo: quien ya las pidió para otra cosa no paga la
 * consulta dos veces.
 */
export async function seasonAwardsOf(
  supabase: Client,
  matchdays: readonly MatchdaySummary[],
): Promise<Map<DisciplineId, Map<number, Award[]>>> {
  const closed = matchdays.filter((matchday) => matchday.status === 'CLOSED')
  const result = new Map<DisciplineId, Map<number, Award[]>>()
  if (closed.length === 0) return result

  const metaByMatchdayId = new Map(
    closed.map((matchday) => [matchday.id, { number: matchday.number, disciplineId: matchday.disciplineId }]),
  )
  const { data, error } = await supabase
    .from('awards')
    .select('matchday_id, entry_id, position, points')
    .in('matchday_id', [...metaByMatchdayId.keys()])
  if (error) throw new EdgeError(`No se pudieron leer los premios: ${error.message}`)

  for (const row of data ?? []) {
    const meta = metaByMatchdayId.get(row.matchday_id)
    if (meta === undefined) continue
    // `lines: []` — mismo motivo que `db/season.ts: awardsBefore` (REQ-D10-2):
    // esta lectura no trae `award_lines`, y sus consumidores (ranking,
    // stats, historial) sólo usan `points`/`position`.
    const award: Award = { entryId: row.entry_id, position: row.position, points: row.points, lines: [] }
    let byNumber = result.get(meta.disciplineId)
    if (byNumber === undefined) {
      byNumber = new Map()
      result.set(meta.disciplineId, byNumber)
    }
    const bucket = byNumber.get(meta.number)
    if (bucket === undefined) byNumber.set(meta.number, [award])
    else bucket.push(award)
  }
  return result
}

/** Pairs, matches and full sets of one matchday. Empty pairs/matches — not an error — for a matchday still in DRAFT. */
export async function matchdayDetail(supabase: Client, matchdayId: string): Promise<MatchdayDetail> {
  const { data: matchdayRow, error: matchdayError } = await supabase
    .from('matchdays')
    .select('id, number, kind, status, played_on, discipline_id, allows_draw, formato')
    .eq('id', matchdayId)
    .maybeSingle()
  if (matchdayError) throw new EdgeError(`No se pudo leer la fecha: ${matchdayError.message}`)
  if (matchdayRow === null) throw new EdgeError('La fecha no existe.')

  const { sides, matches } = await pairsAndMatchesOf(supabase, matchdayId)
  const guestIds = await guestIdsOf(supabase, matchdayId)

  return { matchday: toMatchdaySummary(matchdayRow), sides, matches, guestIds }
}

/** Every CLOSED regular matchday of the season's own discipline, in number order. The Masters is excluded: it is not part of the championship's played history. */
export async function closedHistoryAll(supabase: Client, seasonId: string): Promise<PlayedMatchday[]> {
  const disciplineId = await defaultDisciplineId(supabase, seasonId)
  if (disciplineId === null) return []
  const { data, error } = await supabase
    .from('matchdays')
    .select('id, number')
    .eq('discipline_id', disciplineId)
    .eq('status', 'CLOSED')
    .eq('kind', 'REGULAR')
    .order('number', { ascending: true })
  if (error) throw new EdgeError(`No se pudieron leer las fechas cerradas: ${error.message}`)

  const history: PlayedMatchday[] = []
  for (const row of data ?? []) {
    const { sides, matches } = await pairsAndMatchesOf(supabase, row.id)
    history.push({ number: row.number, sides, matches })
  }
  return history
}

/** Every award of the season's own discipline, keyed by the matchday number that paid it. */
export async function awardsOf(supabase: Client, seasonId: string): Promise<Map<number, Award[]>> {
  const disciplineId = await defaultDisciplineId(supabase, seasonId)
  if (disciplineId === null) return new Map()
  const { data: closed, error: closedError } = await supabase
    .from('matchdays')
    .select('id, number')
    .eq('discipline_id', disciplineId)
    .eq('status', 'CLOSED')
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
  if (awardsError) throw new EdgeError(`No se pudieron leer los premios: ${awardsError.message}`)

  for (const row of awards ?? []) {
    const matchdayNumber = numberOf.get(row.matchday_id)
    if (matchdayNumber === undefined) continue
    // `lines: []` — mismo motivo que `db/season.ts: awardsBefore` (REQ-D10-2):
    // esta lectura no trae `award_lines`, y sus consumidores (ranking,
    // stats, historial) sólo usan `points`/`position`.
    const award: Award = { entryId: row.entry_id, position: row.position, points: row.points, lines: [] }
    const bucket = result.get(matchdayNumber)
    if (bucket === undefined) result.set(matchdayNumber, [award])
    else bucket.push(award)
  }
  return result
}

// ── helpers privados, compartidos por matchdayDetail y closedHistoryAll ─────

// CERRADO acá: hasta PR18b este lector componía
// `pairFromRow`, que TIRABA con una fila `pair_size=1` — o sea, una fecha de a
// uno se podía jugar y cerrar en la base pero ninguna pantalla de su
// disciplina la podía dibujar. `sideOfRow` devuelve el lado con su forma real,
// así que el dato que 18a habilitó escribir ahora también se puede leer.

/** Los lados y los partidos de la fecha, con los sets de cada partido ordenados por `set_number`. */
async function pairsAndMatchesOf(
  supabase: Client,
  matchdayId: string,
): Promise<{ sides: Side[]; matches: MatchWithId[] }> {
  const { data: pairRows, error: pairsError } = await supabase
    .from('pairs')
    .select('id, entry_a, entry_b, pair_size')
    .eq('matchday_id', matchdayId)
  if (pairsError) throw new EdgeError(`No se pudieron leer las parejas: ${pairsError.message}`)

  const sideById = new Map(
    (pairRows ?? []).map((row) => [
      row.id,
      sideOfRow(row.pair_size as SideSize, row.entry_a, row.entry_b),
    ]),
  )

  const { data: matchRows, error: matchesError } = await supabase
    .from('matches')
    .select('id, round, pair_a, pair_b, fase, grupo')
    .eq('matchday_id', matchdayId)
    .order('round', { ascending: true })
    // Desempate por `id` (N77): `round` solo NO alcanza — una fecha de 4 lados
    // tiene DOS partidos por ronda, y sin un segundo criterio el orden entre
    // ellos lo decide el plan de Postgres. Es la causa del flake intermitente
    // de `db/redraft.db.test.ts`, que comparaba el array de partidos con
    // `toEqual` antes y después de un redraft: las escrituras movían las filas
    // en el heap y a veces volvían al revés, sin que nada estuviera roto.
    .order('id', { ascending: true })
  if (matchesError) throw new EdgeError(`No se pudieron leer los partidos: ${matchesError.message}`)

  const matchIds = (matchRows ?? []).map((row) => row.id)
  const { data: setRows, error: setsError } =
    matchIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from('match_sets')
          .select('match_id, set_number, games_a, games_b')
          .in('match_id', matchIds)
          .order('set_number', { ascending: true })
  if (setsError) throw new EdgeError(`No se pudieron leer los sets: ${setsError.message}`)

  const setsByMatch = new Map<string, SetScore[]>()
  for (const row of setRows ?? []) {
    const set = { gamesA: row.games_a, gamesB: row.games_b }
    const bucket = setsByMatch.get(row.match_id)
    if (bucket === undefined) setsByMatch.set(row.match_id, [set])
    else bucket.push(set)
  }

  const matches: MatchWithId[] = (matchRows ?? []).map((row) => {
    const sideA = sideById.get(row.pair_a)
    const sideB = sideById.get(row.pair_b)
    if (sideA === undefined || sideB === undefined) {
      throw new Error(
        `El partido ${row.id} referencia una pareja que no está en la fecha. Esto es un bug.`,
      )
    }
    return {
      id: row.id,
      round: row.round,
      fase: row.fase as Phase,
      grupo: row.grupo,
      sideA,
      sideB,
      sets: setsByMatch.get(row.id) ?? [],
    }
  })

  return { sides: [...sideById.values()], matches }
}

async function guestIdsOf(supabase: Client, matchdayId: string): Promise<EntryId[]> {
  const { data, error } = await supabase
    .from('entries')
    .select('id')
    .eq('matchday_id', matchdayId)
    .eq('kind', 'GUEST')
    .order('seed_position', { ascending: true })
  if (error) throw new EdgeError(`No se pudieron leer los invitados: ${error.message}`)
  return (data ?? []).map((row) => row.id)
}
