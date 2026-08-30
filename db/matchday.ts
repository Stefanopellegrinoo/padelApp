import {
  buildFixture,
  buildSides,
  computeAwards,
  computeRanking,
  computeStandings,
  currentPhase,
  drawIsLegal,
  faseForCount,
  groupPhaseMatches,
  groupSides,
  isUnplayedThirdPlace,
  knockoutMatchups,
  knockoutPositions,
  losingMatchup,
  mastersFixture,
  mastersQualifiers,
  members,
  nextRoundMatchups,
  formatoOfrecible,
  maxMatchesOf,
  phaseIsComplete,
  previousContext,
  pair,
  sameSide,
  sideOfRow,
  snapshotForMatchday,
  type Award,
  type DisciplineId,
  type EntryId,
  type MatchdayFormat,
  type MatchFormat,
  type MatchResult,
  type PairingInput,
  type Phase,
  type SeasonConfig,
  type SetScore,
  type Side,
  type SideSize,
  type SideStanding,
} from '@/core'
import type { Database, Json } from './database.types'
import { disciplineConfig } from './discipline'
import { EdgeError } from './errors'
import {
  awardsBefore,
  closedHistory,
  defaultDisciplineId,
  squadSeedOrder,
  type Client,
} from './season'
import {
  assertGuestsNamed,
  assertLocksAndGuests,
  assertLocksArePlaying,
  assertSquadCoversLooseGuests,
  assertMatchdaySize,
  assertPointsCoverMatchday,
  assertValidConfig,
  matchError,
  type GuestSeat,
  type PairLock,
} from './validate'

type RawMatchdayRow = Database['public']['Tables']['matchdays']['Row']
/**
 * `discipline_id` distinguido NOMINALMENTE de `season_id` (N2,
 * ronda 2 de torneo-multi-disciplina): en la fila cruda que devuelve Supabase
 * los dos son el mismo tipo (`string`/uuid), y `awardsBefore`/`closedHistory`
 * cambiaron su 2º parámetro de "season" a "discipline" sin cambiar de tipo —
 * un caller que pasara `matchday.season_id` donde correspondía
 * `matchday.discipline_id` compilaba limpio. La marca se aplica UNA vez, acá,
 * al leer la fila (`requireMatchday`); de ahí en más `matchday.discipline_id`
 * ya es `DisciplineId` y `matchday.season_id` sigue siendo `string` a secas,
 * así que confundirlos es error de compilación en el call site.
 */
type MatchdayRow = Omit<RawMatchdayRow, 'discipline_id'> & { discipline_id: DisciplineId }

/**
 * What every operation on a matchday needs, whatever it is going to do with it.
 *
 * The snapshot lives here and NOWHERE else. It is the fourth tiebreak of the
 * matchday table (spec 2.3) as well as the tiebreak of the draw, and the two
 * have to be the same one or reopening a matchday and closing it again would
 * produce a different table. A second function computing "the snapshot" its own
 * way is the one bug in this file that no test can catch: both closes would see
 * the same wrong input and agree with each other.
 */
export interface MatchdayContext {
  matchday: MatchdayRow
  config: SeasonConfig
  /**
   * El `pair_size` real de la disciplina de esta fecha (W30,
   * ronda 9), leído del mismo `disciplineConfig` que ya trae `config` —
   * ningún select nuevo. `matchdays.pair_size` (design #3801 PUNTO 1) sigue
   * sin migrar: hasta que exista, ésta es la fuente, y es la real, no un
   * hardcode.
   */
  pairSize: SideSize
  seedOrder: EntryId[]
  awardsByMatchday: Map<number, Award[]>
  snapshot: EntryId[]
  guests: GuestSeat[]
  locks: PairLock[]
  /** `disciplines.fixed_teams`: si la fecha ROTA parejas, o los equipos ya vienen dados (0068). */
  fixedTeams: boolean
}

export async function matchdayContextFor(
  supabase: Client,
  matchdayId: string,
): Promise<MatchdayContext> {
  const matchday = await requireMatchday(supabase, matchdayId)
  const { config, pairSize, fixedTeams } = await disciplineConfig(supabase, matchday.discipline_id)
  assertValidConfig(config, pairSize)

  // The seed order is also the squad, and it must be stable: buildPairs falls
  // back to the order it is given when two players are missing from the
  // snapshot, so an unordered read makes the draw non-deterministic.
  const seedOrder = await squadSeedOrder(supabase, matchday.discipline_id)

  // Only the CLOSED matchdays BEFORE this one. Never this one: its own table is
  // what the snapshot is being used to break ties in.
  const awardsByMatchday = await awardsBefore(supabase, matchday.discipline_id, matchday.number)
  const snapshot = snapshotForMatchday(matchday.number, seedOrder, awardsByMatchday, config)

  const guests = await guestsOf(supabase, matchdayId)
  const locks = await locksOf(supabase, matchdayId)
  assertLocksAndGuests(guests, locks)

  return { matchday, config, pairSize, seedOrder, awardsByMatchday, snapshot, guests, locks, fixedTeams }
}

export interface PairingContext extends MatchdayContext {
  input: PairingInput
}

/**
 * Everything the DRAW of one matchday needs, composed out of core/. No rule of
 * the championship is decided here: this function fetches rows and hands them
 * to the functions that know.
 *
 * Closing a matchday does NOT go through here. It asks a different question —
 * "what does what was played pay?" — and running the draw's validations over
 * today's attendance while closing is how a matchday gets stuck.
 */
export async function pairingContextFor(
  supabase: Client,
  matchdayId: string,
): Promise<PairingContext> {
  const context = await matchdayContextFor(supabase, matchdayId)
  const { matchday, config, pairSize, seedOrder, awardsByMatchday, snapshot, guests, locks, fixedTeams } =
    context

  // Decision 3: the pool is ordered by the ranking — best N of M — and never by
  // a running total. The table you look at is the table that pairs you, and the
  // snapshot chain is built from this same ranking.
  const ranking = computeRanking(awardsByMatchday, seedOrder, config, snapshot)
  const points = new Map(ranking.map((row) => [row.entryId, row.points]))

  // Con un lado de uno, `buildSides` (design
  // PUNTO 5) ignora `defenders`/`previousPairs`/`fixedPairs` enteros — no hay
  // compañero que defender ni pareja que repetir. Antes de este guard,
  // `closedHistory` corría igual y calculaba ese dato descartado, y encima
  // TIRABA: leía `pairs` de la fecha CERRADA anterior con `pairFromRow`, que
  // no sabía leer un `pair_size=1`. Ninguna disciplina de a uno llegaba a la
  // fecha 2. Ese throw ya no existe (W40, PR18b: `closedHistory` devuelve
  // `Side[]`), así que este guard queda por su OTRO motivo, que sigue en pie:
  // ahorrarse dos consultas cuyo resultado se descarta entero. Los valores
  // neutros son los mismos que `previousContext` devuelve para una historia
  // de lados de uno (core/history.ts) — no una invención de acá.
  const { defenders, defendersAlreadyRepeated, previousPairs } =
    pairSize === 1 || fixedTeams
      ? { defenders: null, defendersAlreadyRepeated: false, previousPairs: [] }
      : previousContext(
          await closedHistory(supabase, matchday.discipline_id, matchday.number - 1),
          await closedHistory(supabase, matchday.discipline_id, matchday.number - 2),
        )

  const present = [
    ...(await playingEntryIds(supabase, matchdayId, matchday.discipline_id)),
    ...guests.map((guest) => guest.entryId),
  ]
  // Los equipos fijos entran al sorteo como parejas YA resueltas, igual que un
  // lock, pero sólo los que vinieron enteros.
  //
  // Un equipo a medias no es una fecha rara: es estado inválido. El
  // presentismo de una disciplina de equipos se marca de a dos
  // (docs/tipos-de-torneo.md §1). Si igual llega uno solo, esto FALLA, y falla
  // acá porque es el único lugar donde se conocen las dos mitades del dato:
  // quién vino y quién es de quién. La alternativa —dejarlo pasar— es que el
  // que vino se caiga al sorteo suelto y termine de pareja con un rival, en
  // silencio y con el equipo roto.
  const teams = fixedTeams ? await teamsOf(supabase, matchday.discipline_id) : []
  const playing = new Set(present)
  const halved = teams.filter((team) => playing.has(team.a) !== playing.has(team.b))
  if (halved.length > 0) {
    throw new EdgeError(
      halved.length === 1
        ? 'Hay un equipo con un solo integrante presente: en equipos fijos se viene de a dos.'
        : `Hay ${halved.length} equipos con un solo integrante presente: en equipos fijos se viene de a dos.`,
    )
  }
  const presentTeams = teams.filter((team) => playing.has(team.a))

  assertMatchdaySize(present, pairSize)
  // Van acá y no en `matchdayContextFor` porque es la primera vez que el
  // presentismo existe, y correr una validación del sorteo al CERRAR es como
  // una fecha se traba (ver el docstring de esta función).
  assertLocksArePlaying(present, locks)
  // Los defensores salen del pool ANTES del sorteo, así que no son
  // acompañantes disponibles. El filtro es el mismo que hace `resolveDefenders`
  // del otro lado: si gastaron la repetición no hay defensores, y si falta uno
  // la pareja se disuelve — eso último lo resuelve el guard, que ve `present`.
  assertSquadCoversLooseGuests(
    present,
    guests,
    locks,
    defendersAlreadyRepeated ? null : defenders,
  )
  assertPointsCoverMatchday(present, guests, locks, config, pairSize)

  return {
    ...context,
    input: {
      present,
      points,
      snapshot,
      defenders,
      defendersAlreadyRepeated,
      previousPairs,
      guestIds: guests.map((guest) => guest.entryId),
      // `pair_locks` es una tabla de DOS columnas, no un agrupador: una traba
      // es siempre de dos por construcción del schema. Desde PR19 el tipo es
      // `Side`, así que se construye con `pair()` en vez de pasar la fila
      // cruda — el constructor pone el discriminante y `requireDuo`
      // (core/pairing.ts) rechazaría cualquier cosa que llegara mal formada.
      fixedPairs: [
        ...presentTeams.map((team) => pair(team.a, team.b)),
        ...locks.map((lock) => pair(lock.a, lock.b)),
      ],
    },
  }
}

/**
 * Corrige el día en que se juega —o se jugó— una fecha.
 *
 * La base ya lo permitía y nadie lo usaba: `0002_rls.sql` otorga
 * `update (played_on)` a `authenticated`, y sólo esa columna. El grant está
 * escrito por columna justamente para que corregir el día no pueda tocar
 * `status` ni `number`, así que el peor error posible acá es poner mal una
 * etiqueta.
 *
 * Se puede en cualquier estado, incluida una fecha cerrada: `played_on` no
 * ordena nada ni entra en ningún cálculo —las fechas se ordenan por `number`—
 * así que enterarse tarde de que la fecha real era otra no debería obligar a
 * reabrir nada.
 *
 * `count: 'exact'` porque un update que no toca ninguna fila NO es un error en
 * PostgREST: sin esto, a quien no es admin le diría que guardó y al recargar
 * volvería el día viejo.
 */
export async function setMatchdayDate(
  supabase: Client,
  matchdayId: string,
  playedOn: string,
): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(playedOn)) {
    throw new EdgeError('La fecha tiene que tener día, mes y año.')
  }

  const { error, count } = await supabase
    .from('matchdays')
    .update({ played_on: playedOn }, { count: 'exact' })
    .eq('id', matchdayId)
  if (error !== null) throw new EdgeError(`No se pudo cambiar el día: ${error.message}`)
  if (count === 0) {
    throw new EdgeError('No se pudo cambiar el día: sólo puede hacerlo quien organiza.')
  }
}

/**
 * Cambia el formato sugerido de una fecha (REQ-D8-1) — el primer escritor de
 * producción del `grant update (formato)` que trajo la Rebanada C1 (0040).
 *
 * A diferencia de `setMatchdayDate`, el formato SÓLO se puede tocar con la
 * fecha en `DRAFT`: "editable antes de armar" es el requisito, y `formato`
 * deja de importar en cuanto `generatePairs` ya lo leyó para armar los
 * partidos — cambiarlo después no reordena nada, sólo confunde con qué se
 * arma la fecha si se vuelve a sortear.
 */
export async function setMatchdayFormat(
  supabase: Client,
  matchdayId: string,
  formato: MatchdayFormat,
): Promise<void> {
  const matchday = await requireMatchday(supabase, matchdayId)
  if (matchday.status !== 'DRAFT') {
    throw new EdgeError('El formato sólo se cambia con la fecha en armado.')
  }

  // W78 (verify-report-pr21-cierre, #4016): `matchdays_formato_kind` (0040)
  // sólo valida la FORMA (`groups ∈ {1,2,4}`), nunca si esos grupos tienen
  // sentido para cuántos lados hay HOY — así que una fecha FIFA de 8 lados
  // aceptaba `groups: 4` (grupos de 2, eliminación cero) y `groups: 1`
  // (siempre round robin + 1 partido), los dos descartados por la decisión
  // #4014. `offerableFormats` (`core/knockout.ts`) YA es la fuente única de
  // qué `groups` tienen sentido para `sides` lados — se reusa acá, no se
  // repite la regla (evita ser la cuarta copia que W81, el mismo informe,
  // señala como el problema).
  //
  // Guard en TypeScript, no en un trigger de SQL: reproducir "cuántos lados
  // hay hoy" en PL/pgSQL exigiría repetir en SQL la cuenta de `attendances`
  // + invitados que YA vive acá (`playingEntryIds`/`guestsOf`, las mismas
  // que arma `pairingContextFor`) — una copia más de esa cuenta en un
  // lenguaje distinto, con su propio riesgo de driftear. La reachability de
  // un PATCH directo que salte este guard queda acotada por lo mismo que ya
  // protege al resto de `formato`: sólo el organizador (`grant update` +
  // RLS) y sólo con la fecha en DRAFT (trigger `matchdays_formato_immutable_after_draft`,
  // 0045) — y si igual pasara, el guard de `advancePhase` (C32, más abajo)
  // convierte cualquier desalineación entre `formato` y el fixture ya
  // armado en un `EdgeError` prolijo, nunca en un 500.
  //
  // El guard YA NO se saltea con ROUND_ROBIN, y ese era el agujero: el techo de
  // la fecha se mide en PARTIDOS (`MAX_MATCHES`) y un round robin es el formato
  // que más produce — 12 lados de a uno son 66, contra los 15 del peor caso de
  // pádel. Mientras este `if` preguntaba por `GROUPS_KNOCKOUT`, el formato más
  // caro era el único que entraba sin que nadie lo mirara.
  {
    const { config, pairSize } = await disciplineConfig(supabase, matchday.discipline_id)
    const present = [
      ...(await playingEntryIds(supabase, matchdayId, matchday.discipline_id)),
      ...(await guestsOf(supabase, matchdayId)).map((guest) => guest.entryId),
    ]
    const sides = Math.floor(present.length / pairSize)
    if (!formatoOfrecible(formato, sides, maxMatchesOf(config, pairSize))) {
      throw new EdgeError(
        formato.kind === 'GROUPS_KNOCKOUT'
          ? `Con ${sides} lados, ${formato.groups} grupos no es un formato ofrecible.`
          : `Con ${sides} lados, todos contra todos son demasiados partidos para una fecha. Elegí grupos + llave.`,
      )
    }
  }

  const { error, count } = await supabase
    .from('matchdays')
    .update({ formato: formato as unknown as Json }, { count: 'exact' })
    .eq('id', matchdayId)
  if (error !== null) throw new EdgeError(`No se pudo cambiar el formato: ${error.message}`)
  if (count === 0) {
    throw new EdgeError('No se pudo cambiar el formato: sólo puede hacerlo quien organiza.')
  }
}

/**
 * La siguiente fecha por número, de la disciplina que se le pasa. Escribe
 * `played_on`: la columna existe y es el dato que muestran todas las
 * pantallas.
 *
 * `disciplineId` es OPCIONAL (C12): sin él, cae en
 * `defaultDisciplineId` (la primera por `position`) — el único camino que usa
 * hoy `app/torneo/[id]/actions.ts`, que todavía no deja elegir disciplina
 * (queda para el slice de UI que cierra C12 del todo). Con él explícito, la
 * fecha queda scopeada a ESA disciplina sin tocar `defaultDisciplineId` —
 * es lo que REQ-D3-1 necesita (dos disciplinas, cada una con su propia fecha
 * sin cerrar a la vez): `matchdays_one_live` (0016) ya scopea por
 * `discipline_id`, así que dos llamadas a disciplinas distintas no compiten
 * entre sí.
 */
export async function createMatchday(
  supabase: Client,
  seasonId: string,
  playedOn: string,
  disciplineId?: string,
): Promise<string> {
  // Omitir `disciplineId` no es ambiguo con UNA
  // disciplina — es la única respuesta posible, y sigue resolviendo por
  // default más abajo. Con DOS o más, adivinar en silencio es la misma
  // clase de bug que ya causó C8, C9, C12 y el de `matchdaysOf` en esta
  // cadena: mismo criterio tripwire que `0021` (create_masters, empate de
  // disciplina) y `0027` (empate de position) — el estado ambiguo se vuelve
  // ruidoso en vez de silencioso.
  if (disciplineId === undefined) {
    const { count, error: countError } = await supabase
      .from('disciplines')
      .select('id', { count: 'exact', head: true })
      .eq('season_id', seasonId)
    if (countError) throw new EdgeError(`No se pudo leer las disciplinas de la temporada: ${countError.message}`)
    if ((count ?? 0) > 1) {
      throw new EdgeError('La temporada tiene más de una disciplina: hay que indicar cuál.')
    }
  }

  const resolvedDisciplineId = disciplineId ?? (await defaultDisciplineId(supabase, seasonId))
  if (resolvedDisciplineId === null) {
    throw new EdgeError('No se pudo leer la disciplina de la temporada.')
  }

  //`matchdays_discipline_size` (0028, REQ-D5-1) exige que `pair_size` de la
  // fecha coincida con el de SU disciplina — sin esto, el default de columna
  // (2) rechazaría cada fecha nueva de una disciplina pair_size=1 con una
  // violación de FK, no con un mensaje de usuario. `disciplineId` es un
  // `string` crudo acá (parámetro público, todavía sin marcar en el origen);
  // la FK de arriba es la que de verdad lo valida contra `disciplines`.
  //
  //`matchdays_discipline_draw` (0034, REQ-D6-1)
  // es la MISMA trampa con `allows_draw`, y `0034` la reintrodujo seis líneas
  // más abajo, en este mismo `.insert()`, con el párrafo de arriba ya escrito.
  // Las dos columnas salen de la misma fila y del mismo select.
  const { pairSize, allowsDraw } = await disciplineConfig(
    supabase,
    resolvedDisciplineId as DisciplineId,
  )

  const { data: last, error: lastError } = await supabase
    .from('matchdays')
    .select('number')
    .eq('discipline_id', resolvedDisciplineId)
    .order('number', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (lastError) throw new EdgeError(`No se pudo leer las fechas: ${lastError.message}`)
  const number = (last?.number ?? 0) + 1

  const { data, error } = await supabase
    .from('matchdays')
    .insert({
      season_id: seasonId,
      discipline_id: resolvedDisciplineId,
      number,
      played_on: playedOn,
      pair_size: pairSize,
      allows_draw: allowsDraw,
    })
    .select('id')
    .single()
  if (error !== null) {
    // El índice `matchdays_one_live` rebota esto cuando ya hay otra fecha sin
    // cerrar en esta disciplina.
    if (error.code === '23505') {
      throw new EdgeError('Ya hay una fecha sin cerrar en esta temporada.')
    }
    throw new EdgeError(`No se pudo crear la fecha: ${error.message}`)
  }
  return data.id
}

/** Tilda viene / no viene. Sólo con la fecha en armado. */
export async function setAttendance(
  supabase: Client,
  matchdayId: string,
  entryId: string,
  status: 'PLAYING' | 'ABSENT',
): Promise<void> {
  const matchday = await requireMatchday(supabase, matchdayId)
  if (matchday.status !== 'DRAFT') {
    throw new EdgeError('El presentismo sólo se toca con la fecha en armado.')
  }

  const { error } = await supabase.from('attendances').upsert(
    {
      matchday_id: matchdayId,
      entry_id: entryId,
      season_id: matchday.season_id,
      discipline_id: matchday.discipline_id,
      status,
    },
    { onConflict: 'matchday_id,entry_id' },
  )
  if (error !== null) throw new EdgeError(`No se pudo guardar el presentismo: ${error.message}`)
}

/**
 * El jugador marca su propia asistencia, desde la Tabla.
 *
 * No es `setAttendance` con otro nombre: aquélla la corre el admin y la deja
 * pasar `attendances_write`, que pide `is_season_admin`. Un jugador no tiene ese
 * permiso sobre ninguna fila, ni la suya, así que va por `set_my_attendance`
 * (0007), que resuelve cuál es su asiento del lado de la base — nunca lo recibe
 * de quien llama.
 */
export async function setMyAttendance(
  supabase: Client,
  matchdayId: string,
  status: 'PLAYING' | 'ABSENT',
): Promise<void> {
  const { error } = await supabase.rpc('set_my_attendance', {
    p_matchday: matchdayId,
    p_status: status,
  })
  if (error !== null) throw new EdgeError(error.message)
}

/**
 * Escribe PLAYING para todo asiento QUE JUEGA ESTA DISCIPLINA y todavía no
 * tenga fila.
 *
 * Existe por una asimetría que muerde: `playingEntryIds` —lo que arma
 * `present`— cuenta filas PLAYING EXISTENTES, así que un plantel sin filas da
 * `present` vacío. La pantalla del armado dibuja "sin fila = viene", y ésta es
 * la función que hace que la base opine lo mismo.
 *
 * Lee `discipline_entries`, no el plantel entero de la temporada (PR 8,
 * `attendances_entry_discipline`): sembrar PLAYING para alguien que no juega
 * esta disciplina violaría esa FK — y aunque no la violara, sería presentismo
 * fantasma para quien nunca pudo estar en esta fecha.
 *
 * Idempotente, y se llama al principio de cada acción del armado. Nunca al
 * renderizar: un Server Component que escribe al dibujarse es un GET con
 * efectos.
 */
export async function seedAttendances(supabase: Client, matchdayId: string): Promise<void> {
  const matchday = await requireMatchday(supabase, matchdayId)
  if (matchday.status !== 'DRAFT') {
    throw new EdgeError('El presentismo sólo se toca con la fecha en armado.')
  }

  const { data: squad, error: squadError } = await supabase
    .from('discipline_entries')
    .select('entry_id')
    .eq('discipline_id', matchday.discipline_id)
  if (squadError) throw new EdgeError(`No se pudo leer el plantel: ${squadError.message}`)

  const { data: existing, error: existingError } = await supabase
    .from('attendances')
    .select('entry_id')
    .eq('matchday_id', matchdayId)
  if (existingError) {
    throw new EdgeError(`No se pudo leer el presentismo: ${existingError.message}`)
  }

  const already = new Set((existing ?? []).map((row) => row.entry_id))
  const missing = (squad ?? []).filter((entry) => !already.has(entry.entry_id))
  if (missing.length === 0) return

  const { error } = await supabase.from('attendances').insert(
    missing.map((entry) => ({
      matchday_id: matchdayId,
      entry_id: entry.entry_id,
      season_id: matchday.season_id,
      discipline_id: matchday.discipline_id,
      status: 'PLAYING' as const,
    })),
  )
  if (error !== null) throw new EdgeError(`No se pudo guardar el presentismo: ${error.message}`)
}

/**
 * Borra las parejas sorteadas de una fecha en armado.
 *
 * Es el `generated: false` del handoff, escrito de verdad: cualquier cambio de
 * quién viene invalida el sorteo. Sin esto, `openMatchday` rebota con "Cambió
 * quién viene desde que armaste las parejas" y sacar un invitado que quedó
 * adentro de una pareja falla con un 23503 que nadie puede leer.
 */
export async function clearPairs(supabase: Client, matchdayId: string): Promise<void> {
  const matchday = await requireMatchday(supabase, matchdayId)
  if (matchday.status !== 'DRAFT') {
    throw new EdgeError('Las parejas sólo se rehacen con la fecha en armado.')
  }
  await deletePairs(supabase, matchdayId)
}

/** Le pone nombre al invitado. Sin esto la fecha no abre (spec 2.6). */
export async function nameGuest(
  supabase: Client,
  entryId: string,
  displayName: string,
): Promise<void> {
  const { error } = await supabase
    .from('entries')
    .update({ display_name: displayName.trim() })
    .eq('id', entryId)
  if (error !== null) throw new EdgeError(`No se pudo guardar el nombre: ${error.message}`)
}

/** Saca un asiento de invitado. */
export async function removeGuest(supabase: Client, entryId: string): Promise<void> {
  const { error } = await supabase.from('entries').delete().eq('id', entryId)
  if (error !== null) throw new EdgeError(`No se pudo sacar al invitado: ${error.message}`)
}

/**
 * La regla del spec 2.6, escrita una sola vez: sólo se juega con número par, así
 * que si los confirmados dan impar la app suma un lugar de invitado.
 *
 * Lo que NO hace, y es a propósito:
 * - con dos o más invitados SUELTOS no toca nada. Los puso el admin a mano, uno
 *   por hueco, y decidir a cuál sacar no es de esta función. (Decía que dos
 *   invitados eran siempre el equipo que vino a jugar junto: dejó de ser cierto
 *   cuando "+ Agregar invitado" hizo válido mandar varios sueltos al sorteo.)
 * - con número par y un invitado YA NOMBRADO tampoco. Alguien lo puso a
 *   propósito; sacarlo porque cambió un tilde es perder un dato cargado
 *
 * C15: la regla entera es de PAREJA, no de cantidad —
 * en una disciplina `pair_size=1` cada presente YA es su propio lado, así que
 * un plantel impar no le falta nada a nadie. Antes de este guard, la función
 * escribía un GUEST fantasma (nombre vacío) y borraba el sorteo en una
 * disciplina de a uno con presentes impares: medido, fila real. Con
 * `pairSize !== 2` ninguna de las dos ramas de abajo aplica (ni sumar ni
 * sacar un invitado), así que se corta antes de leer nada más.
 */
export async function syncGuestSeat(supabase: Client, matchdayId: string): Promise<void> {
  const matchday = await requireMatchday(supabase, matchdayId)
  const { pairSize } = await disciplineConfig(supabase, matchday.discipline_id)
  if (pairSize !== 2) return

  const playing = await playingEntryIds(supabase, matchdayId, matchday.discipline_id)
  const guests = await guestsOf(supabase, matchdayId)
  const locks = await locksOf(supabase, matchdayId)
  const isOdd = playing.length % 2 !== 0

  // Sólo cuentan los invitados SUELTOS —los que van a jugar con alguien del
  // torneo—, no los que ya están en una pareja invitada. Una pareja suma dos y
  // no cambia la paridad, así que no tiene nada que ver con que falte uno:
  // contarla dejaba una fecha de 7 + pareja en 9 y sin poder generarse.
  const inGuestPair = new Set<string>()
  const isGuest = new Set(guests.map((guest) => guest.entryId))
  for (const lock of locks) {
    if (isGuest.has(lock.a) && isGuest.has(lock.b)) {
      inGuestPair.add(lock.a)
      inGuestPair.add(lock.b)
    }
  }
  const loose = guests.filter((guest) => !inGuestPair.has(guest.entryId))

  if (isOdd && loose.length === 0) {
    await clearPairs(supabase, matchdayId)
    await addGuest(supabase, matchdayId, { displayName: '' })
    return
  }

  const only = loose[0]
  if (!isOdd && loose.length === 1 && only !== undefined && only.displayName.trim().length === 0) {
    await clearPairs(supabase, matchdayId)
    await removeGuest(supabase, only.entryId)
  }
}

/**
 * Suma un invitado suelto a mano: un asiento más que juega con alguien del
 * torneo, y ese compañero sí cobra (spec 2.6).
 *
 * `syncGuestSeat` NO se llama acá: con plantel par borraría en el mismo
 * momento el asiento que se acaba de crear.
 *
 * ponytail: un suelto agregado a mano, sin nombre y con plantel par es
 * indistinguible del asiento automático que `syncGuestSeat` pone y saca, así
 * que el próximo sync —cualquier tilde de asistencia o nombre guardado— se lo
 * lleva sin aviso. Techo conocido: separarlos pide una columna nueva en
 * `entries` (un `added_by_admin`), que es una migración. Mientras tanto se
 * salva ponténdole nombre, o sumando el segundo invitado (con dos sueltos el
 * guard `loose.length === 1` del sync ya no aplica).
 */
export async function addLooseGuestSeat(supabase: Client, matchdayId: string): Promise<void> {
  await clearPairs(supabase, matchdayId)
  await addGuest(supabase, matchdayId, { displayName: '' })
}

/**
 * Saca un invitado suelto. Si tenía un compañero trabado, el lock cae solo con
 * el asiento.
 *
 * Cierra con `syncGuestSeat`, igual que sacar una pareja invitada: sacar el
 * asiento que la paridad EXIGE dejaba la fecha impar y sin nadie que la
 * arreglara —`generatePairs` no sincroniza— y el admin quedaba encerrado
 * hasta tocar un tilde cualquiera. La pantalla además no ofrece la cruz sobre
 * ese asiento, así que este sync es la red y no el camino normal.
 */
export async function removeLooseGuestSeat(
  supabase: Client,
  matchdayId: string,
  entryId: string,
): Promise<void> {
  await clearPairs(supabase, matchdayId)
  await removeGuest(supabase, entryId)
  await syncGuestSeat(supabase, matchdayId)
}

/** Agrega un asiento GUEST. `seed_position` correlativo entre los invitados de esta fecha; `displayName` puede ir vacío. */
export async function addGuest(
  supabase: Client,
  matchdayId: string,
  { displayName }: { displayName: string },
): Promise<string> {
  const matchday = await requireMatchday(supabase, matchdayId)

  const { data: last, error: lastError } = await supabase
    .from('entries')
    .select('seed_position')
    .eq('matchday_id', matchdayId)
    .eq('kind', 'GUEST')
    .order('seed_position', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (lastError) throw new EdgeError(`No se pudieron leer los invitados: ${lastError.message}`)
  const seedPosition = (last?.seed_position ?? -1) + 1

  const { data, error } = await supabase
    .from('entries')
    .insert({
      season_id: matchday.season_id,
      matchday_id: matchdayId,
      kind: 'GUEST',
      display_name: displayName,
      seed_position: seedPosition,
    })
    .select('id')
    .single()
  if (error !== null) throw new EdgeError(`No se pudo agregar el invitado: ${error.message}`)
  return data.id
}

/** Traba una pareja antes del sorteo. Pasa por `assertLocksAndGuests` antes de escribir. */
export async function lockPair(
  supabase: Client,
  matchdayId: string,
  entryA: string,
  entryB: string,
): Promise<void> {
  const matchday = await requireMatchday(supabase, matchdayId)
  const guests = await guestsOf(supabase, matchdayId)
  const locks = await locksOf(supabase, matchdayId)
  assertLocksAndGuests(guests, [...locks, { a: entryA, b: entryB }])

  const { error } = await supabase.from('pair_locks').insert({
    matchday_id: matchdayId,
    season_id: matchday.season_id,
    entry_a: entryA,
    entry_b: entryB,
  })
  if (error !== null) throw new EdgeError(`No se pudo trabar la pareja: ${error.message}`)
}

/** La destraba. */
export async function unlockPair(supabase: Client, lockId: string): Promise<void> {
  const { error } = await supabase.from('pair_locks').delete().eq('id', lockId)
  if (error !== null) throw new EdgeError(`No se pudo destrabar la pareja: ${error.message}`)
}

/**
 * Draws the pairs and lays out the round robin. Re-runnable on purpose: the
 * DRAFT screen has a regenerate button, and the draw is deterministic, so the
 * same input gives the same pairs every time.
 */
export async function generatePairs(supabase: Client, matchdayId: string): Promise<void> {
  const matchday = await requireMatchday(supabase, matchdayId)
  if (matchday.status !== 'DRAFT') {
    throw new EdgeError('Las parejas sólo se arman con la fecha en armado.')
  }

  // `buildSides` (PR16, wired here — PR18a): con `sideSize=2` es `buildPairs`
  // sin cambios (desde PR19 ya devuelve `Side[]` solo); con `sideSize=1` cada
  // presente es su propio lado. `pairSize` sale del mismo `pairingContextFor`
  // que ya trae `input` — ningún select nuevo.
  const { input, pairSize, config } = await pairingContextFor(supabase, matchdayId)
  const sides = buildSides({ ...input, sideSize: pairSize })

  //`matchday.formato` generaliza el armado (REQ-D8-1, Rebanada C1): con
  // `ROUND_ROBIN` es EXACTAMENTE el camino de siempre, sin tocar una línea —
  // `roundRobinMatches` no manda `fase`/`grupo` y la fila cae en el default
  // de columna ('GRUPO'/1, 0039), igual que antes de esta rebanada
  // (REQ-D7-1, no-regresión). Con `GROUPS_KNOCKOUT`, `groupedMatches` reparte
  // los lados con `groupSides` (hallazgo de diseño de esta rebanada, el
  // design PUNTO 7 no lo nombraba) y corre `buildFixture` UNA VEZ POR GRUPO —
  // `buildFixture` (core/fixture.ts) no se toca, sigue operando sobre
  // índices numéricos, ahora dentro de cada grupo.
  //
  // Lo que hace HONESTO este doble cast es el check `matchdays_formato_kind`
  // (0040), no la confianza: con `GROUPS_KNOCKOUT` la base ya exige
  // `groups`/`qualifiersPerGroup` numéricos y dentro de lo que
  // `knockoutMatchups` sabe armar (G∈{1,2,4}, P=2) — una fila que llega hasta
  // acá no puede tener la forma incompleta que reventaba `groupSides` con
  // `groups=undefined` DESPUÉS de haber borrado y reinsertado las parejas.
  const formato = matchday.formato as unknown as MatchdayFormat

  // W84 (verify-report-pre-contract #4026): el guard de `setMatchdayFormat`
  // (más arriba en este archivo) es de MOMENTO DE ESCRITURA — valida contra
  // los presentes de CUANDO SE ELIGE el formato, y nadie revalida si la
  // asistencia cambia DESPUÉS. Medido: FIFA de 12 acepta "4 grupos", bajan 4
  // ausentes (8 presentes), y sin este guard `generatePairs` armaba igual 4
  // grupos de 2 — tasa de eliminación CERO, lo que la decisión #4014
  // excluye "SIEMPRE, sin excepción". Acá es el lugar correcto para
  // revalidar: `sides` recién se calculó con la asistencia de HOY (misma
  // cuenta que ya usa `setMatchdayFormat`), y todavía no se tocó ninguna
  // fila — un rechazo acá no deja la fecha a medio armar (S69,
  // `generatePairs` no corre en una transacción).
  //
  // Idem la revalidación de arriba: cubre ROUND_ROBIN también. Es el ÚLTIMO
  // lugar donde se puede frenar una fecha de 66 partidos, porque la fila puede
  // haber llegado con el `formato` DEFAULT de columna ('ROUND_ROBIN', 0040) sin
  // que `setMatchdayFormat` haya corrido nunca — nadie eligió round robin, y
  // sin embargo es lo que se va a armar.
  if (!formatoOfrecible(formato, sides.length, maxMatchesOf(config, pairSize))) {
    throw new EdgeError(
      formato.kind === 'GROUPS_KNOCKOUT'
        ? `Con ${sides.length} lados, ${formato.groups} grupos no es un formato ofrecible. Volvé al armado y elegí otro formato.`
        : `Con ${sides.length} lados, todos contra todos son demasiados partidos para una fecha. Volvé al armado y elegí grupos + llave.`,
    )
  }

  // ponytail: S69 — de acá hasta `insertMatches` son TRES escrituras sueltas
  // (`deletePairs`, `insertPairs`, `insertMatches`) sin transacción que las
  // ate. Un fallo en el medio deja la fecha a medio armar; medido, la forma
  // que sale es `pairs=4, matches=0`, y el armado se rehace y ya.
  //
  // Los dos guards de arriba —el del formato ofrecible y el del techo de
  // partidos— rechazan ANTES de la primera escritura, así que el caso
  // frecuente (elegiste un formato que ya no entra) nunca llega acá. Lo que
  // queda sin cubrir es un fallo de RED o de la base entre las tres.
  //
  // El upgrade es mover las tres a una función `security definer`, que corre
  // en una sola transacción. No se hizo porque desde el push eso pide su
  // propia migración y porque el estado roto es VISIBLE y se arregla
  // rearmando: no se pierde un resultado, la fecha está en DRAFT.
  //
  // Deleting the pairs cascades to matches and match_sets. A DRAFT matchday
  // usually has no results to lose, but `redraft_matchday` can land one here
  // WITH results already loaded — it goes back from OPEN without deleting
  // anything, on purpose (spec: the transition itself deletes nothing).
  // Regenerating from that state deliberately discards them; the confirm
  // panel in the UI warns before this runs. The status guard above only
  // blocks OPEN/CLOSED, it does not promise DRAFT is always a clean slate.
  await deletePairs(supabase, matchdayId)

  const stored = await insertPairs(supabase, matchdayId, sides)

  const matches: MatchRow[] =
    formato.kind === 'GROUPS_KNOCKOUT'
      ? groupedMatches(matchdayId, matchday.allows_draw, sides, stored, formato.groups)
      : roundRobinMatches(matchdayId, matchday.allows_draw, sides, stored)

  await insertMatches(supabase, matches)
}

/** El camino de siempre: un round robin sobre TODOS los lados de la fecha. */
function roundRobinMatches(
  matchdayId: string,
  allowsDraw: boolean,
  sides: Side[],
  stored: string[],
): MatchRow[] {
  const fixture = buildFixture(sides.length)
  return fixture.flatMap((round, index) =>
    round.map(([left, right]) => {
      const pairA = stored[left]
      const pairB = stored[right]
      if (pairA === undefined || pairB === undefined) {
        throw new Error(
          `El fixture nombró la pareja ${left} o ${right} y sólo hay ${stored.length}. Esto es un bug.`,
        )
      }
      return {
        matchday_id: matchdayId,
        round: index + 1,
        pair_a: pairA,
        pair_b: pairB,
        allows_draw: allowsDraw,
      }
    }),
  )
}

/**
 * Reparte `sides` en `groups` grupos con `groupSides` y corre `buildFixture`
 * una vez por grupo, con `fase='GRUPO'` y `grupo=groupIndex+1` explícitos en
 * cada fila: es el argumento que tiene que llegar hasta la fila real de
 * `matches`, no sólo el nombre del helper (#3957, la regla de las seis veces).
 */
function groupedMatches(
  matchdayId: string,
  allowsDraw: boolean,
  sides: Side[],
  stored: string[],
  groups: number,
): MatchRow[] {
  const storedSides = sides.map((side, index) => {
    const pairId = stored[index]
    if (pairId === undefined) {
      throw new Error(
        `El armado por grupos nombró el lado ${index} y sólo hay ${stored.length}. Esto es un bug.`,
      )
    }
    return { side, pairId }
  })

  return groupSides(storedSides, groups).flatMap((group, groupIndex) => {
    const fixture = buildFixture(group.length)
    return fixture.flatMap((round, index) =>
      round.map(([left, right]) => {
        const pairA = group[left]
        const pairB = group[right]
        if (pairA === undefined || pairB === undefined) {
          throw new Error(
            `El fixture del grupo ${groupIndex + 1} nombró la pareja ${left} o ${right} y sólo hay ${group.length}. Esto es un bug.`,
          )
        }
        return {
          matchday_id: matchdayId,
          round: index + 1,
          pair_a: pairA.pairId,
          pair_b: pairB.pairId,
          allows_draw: allowsDraw,
          fase: 'GRUPO',
          grupo: groupIndex + 1,
        }
      }),
    )
  })
}

/**
 * Cierra la fase actual y arma la siguiente (REQ-D7-2): la llave se genera al
 * cerrar la fase anterior, nunca queda un partido "a definir". Sólo aplica a
 * `formato.kind === 'GROUPS_KNOCKOUT'` — una fecha `ROUND_ROBIN` es una sola
 * fase GRUPO de punta a punta, sin nada que avanzar.
 *
 * El riesgo que el design (#3801, PUNTO 7 y `riesgos`) anota desde el día
 * uno se vuelve código acá: `computeStandings` es PURA y tabula lo que se le
 * pase. `matchupsAfterGroups` (abajo) filtra por `fase==='GRUPO'` (ya
 * garantizado por `inPhase`, ver más abajo) Y por `grupo===groupNumber` — sin
 * el segundo filtro, un partido de otra fase entre los mismos dos lados
 * (`grupo` cae siempre en 1 ahí, `matches_group_only_in_groups`, 0039) puede
 * colarse en la tabla del grupo 1 y decidir su mano a mano.
 */
export async function advancePhase(supabase: Client, matchdayId: string): Promise<void> {
  const { matchday, config, snapshot } = await matchdayContextFor(supabase, matchdayId)
  if (matchday.status !== 'OPEN') {
    throw new EdgeError('Sólo se puede avanzar de fase con la fecha abierta.')
  }
  const formato = matchday.formato as unknown as MatchdayFormat
  if (formato.kind !== 'GROUPS_KNOCKOUT') {
    throw new EdgeError('Esta fecha no tiene fases: se juega entera en una ronda.')
  }

  const { matches } = await resultsOf(supabase, matchdayId)
  const phase = currentPhase(matches)
  if (phase === null) throw new EdgeError('La fecha todavía no tiene partidos generados.')
  if (phase === 'FINAL') throw new EdgeError('La llave ya llegó a la final: no hay fase siguiente.')
  if (!phaseIsComplete(matches, phase)) {
    throw new EdgeError('Todavía hay partidos sin jugar en la fase actual.')
  }

  // Sólo los partidos de la fase que se está cerrando — el primer filtro del
  // riesgo de arriba. `matchupsAfterGroups`/`matchupsAfterKnockout` reciben
  // YA garantizado que todo acá adentro es `fase === phase`.
  const inPhase = matches.filter((match) => match.fase === phase)

  // C32 (verify-report-pr21-cierre, #4016): `changeMatchdayFormat` puede
  // guardar un `formato` nuevo DESPUÉS de que `generatePairs` ya armó el
  // fixture con el viejo — `openMatchday` no lo nota (compara sólo quién
  // vino, nunca la forma del fixture contra `formato`). Con `groups=2` y un
  // fixture que sigue siendo el `ROUND_ROBIN` de antes, TODOS los partidos
  // caen en `grupo=1` (default de columna, 0039) y el grupo 2 llega acá sin
  // un solo lado — `qualifierAt` (core/knockout.ts) tira un `Error` PELADO
  // que `onMatchday` (actions.ts) no sabe convertir en un rechazo prolijo:
  // HTTP 500 y la fecha queda sin poder cerrarse nunca. Se chequea ACÁ,
  // antes de `matchupsAfterGroups`, con la misma forma que exige
  // `knockoutMatchups`: cada grupo declarado necesita al menos
  // `qualifiersPerGroup` lados jugados — no "al menos un partido", porque un
  // partido plantado en un grupo ajeno (ver el test de fase+grupo, arriba)
  // no cuenta como que ESE grupo esté armado.
  if (phase === 'GRUPO') {
    for (let groupNumber = 1; groupNumber <= formato.groups; groupNumber++) {
      const ofGroup = inPhase.filter((match) => match.grupo === groupNumber)
      if (uniqueSides(ofGroup).length < formato.qualifiersPerGroup) {
        throw new EdgeError('El formato cambió después de armar la fecha: hay que volver a sortearla.')
      }
    }
  }

  const nextMatchups = knockoutBoundary(() =>
    phase === 'GRUPO'
      ? matchupsAfterGroups(inPhase, formato, config, snapshot, matchday.allows_draw)
      : matchupsAfterKnockout(phase, inPhase),
  )

  const pairs = await pairsBySide(supabase, matchdayId)
  const rows: MatchRow[] = nextMatchups.map(({ fase, sideA, sideB }) => ({
    matchday_id: matchdayId,
    round: 1,
    pair_a: pairIdOf(pairs, sideA),
    pair_b: pairIdOf(pairs, sideB),
    allows_draw: matchday.allows_draw,
    fase,
    grupo: 1, // matches_group_only_in_groups (0039): sólo GRUPO puede tener grupo > 1
  }))
  await insertMatches(supabase, rows)
}

/**
 * De GRUPO a la primera ronda de la llave: una tabla POR GRUPO (el filtro que
 * hace real el riesgo del design), y `knockoutMatchups` arma los cruces.
 */
function matchupsAfterGroups(
  groupMatches: readonly MatchResult[],
  formato: Extract<MatchdayFormat, { kind: 'GROUPS_KNOCKOUT' }>,
  config: SeasonConfig,
  snapshot: EntryId[],
  allowsDraw: boolean,
): Array<{ fase: Phase; sideA: Side; sideB: Side }> {
  const groupTables: SideStanding[][] = []
  for (let groupNumber = 1; groupNumber <= formato.groups; groupNumber++) {
    // El filtro que hace real el riesgo: SOLO los partidos de ESTE grupo,
    // nunca la fase entera. `groupMatches` ya viene filtrado a `fase==='GRUPO'`
    // por `advancePhase` — acá falta el segundo eje, `grupo`.
    const ofGroup = groupMatches.filter((match) => match.grupo === groupNumber)
    groupTables.push(computeStandings(uniqueSides(ofGroup), [...ofGroup], config, snapshot, allowsDraw))
  }
  const matchups = knockoutMatchups(groupTables, formato.qualifiersPerGroup)
  const fase = faseForCount(matchups.length)
  return matchups.map(([sideA, sideB]) => ({ fase, sideA, sideB }))
}

/**
 * De una ronda de llave YA JUGADA a la siguiente: `nextRoundMatchups` empareja
 * ganadores. Si la fase que se cierra es SEMI, la FINAL no es la única fase
 * nueva — TERCER_PUESTO se genera en el mismo momento, con los perdedores
 * (decisión #3979: existe aunque después nadie la juegue).
 */
function matchupsAfterKnockout(
  phase: Phase,
  played: readonly MatchResult[],
): Array<{ fase: Phase; sideA: Side; sideB: Side }> {
  const matchups = nextRoundMatchups(played)
  const fase = faseForCount(matchups.length)
  const next = matchups.map(([sideA, sideB]) => ({ fase, sideA, sideB }))
  if (phase === 'SEMI') {
    const [thirdSideA, thirdSideB] = losingMatchup(played)
    next.push({ fase: 'TERCER_PUESTO', sideA: thirdSideA, sideB: thirdSideB })
  }
  return next
}

/**
 * W78, "aparte" (verify-report-pr21-cierre, #4016): `qualifierAt`/`winnerOf`/
 * `loserOf` (privadas de `core/knockout.ts`, llamadas por `knockoutMatchups`/
 * `nextRoundMatchups`/`losingMatchup`/`knockoutPositions`) tiran `Error`
 * PELADOS cuando la llave llega en una forma que no esperan — es la familia
 * que ya causó C30, C32 y C33: cada vez que se coló hasta el error boundary
 * de Next.js, salió "Algo se rompió" (HTTP 500) en vez de un rechazo
 * prolijo. `core/` no puede importar `EdgeError` (vive acá, una capa
 * arriba) así que la conversión pasa en el BORDE, en los dos puntos donde
 * `db/matchday.ts` llama a esas funciones (`advancePhase` y
 * `standingsFromBracket`) — no una por una dentro de `core/knockout.ts`.
 */
function knockoutBoundary<T>(work: () => T): T {
  try {
    return work()
  } catch (error) {
    if (error instanceof EdgeError) throw error
    if (error instanceof Error) throw new EdgeError(error.message)
    throw error
  }
}

/** Los lados distintos que aparecen en `matches`, en orden de primera aparición. */
function uniqueSides(matches: readonly MatchResult[]): Side[] {
  const sides: Side[] = []
  for (const match of matches) {
    if (!sides.some((side) => sameSide(side, match.sideA))) sides.push(match.sideA)
    if (!sides.some((side) => sameSide(side, match.sideB))) sides.push(match.sideB)
  }
  return sides
}

/**
 * Las parejas de la fecha con su lado, para traducir el `Side` que devuelven
 * `knockoutMatchups`/`nextRoundMatchups`/`losingMatchup` al `pair_id` que
 * `matches.pair_a`/`pair_b` necesitan. Los lados no cambian entre fases —
 * la llave reutiliza las MISMAS parejas de la fase de grupos, no arma unas
 * nuevas.
 */
async function pairsBySide(
  supabase: Client,
  matchdayId: string,
): Promise<Array<{ id: string; side: Side }>> {
  const { data, error } = await supabase
    .from('pairs')
    .select('id, entry_a, entry_b, pair_size')
    .eq('matchday_id', matchdayId)
  if (error) throw new EdgeError(`No se pudieron leer las parejas: ${error.message}`)
  return (data ?? []).map((row) => ({
    id: row.id,
    side: sideOfRow(row.pair_size as SideSize, row.entry_a, row.entry_b),
  }))
}

function pairIdOf(pairs: readonly { id: string; side: Side }[], side: Side): string {
  const found = pairs.find((row) => sameSide(row.side, side))
  if (found === undefined) {
    throw new Error('Un lado de la llave no tiene pareja guardada en esta fecha. Esto es un bug.')
  }
  return found.id
}

/**
 * Arma la jornada del Masters: los 4 primeros del año, 6 parejas y 3 partidos.
 *
 * No pasa por `buildPairs` y no puede: el Masters tiene su propio fixture (spec
 * 2.7), donde cada uno juega una vez con cada uno para separar a los dos que se
 * pasaron el año ganando juntos y terminaron con los mismos puntos.
 */
export async function generateMastersPairs(supabase: Client, matchdayId: string): Promise<void> {
  const matchday = await requireMatchday(supabase, matchdayId)
  if (matchday.kind !== 'MASTERS') {
    throw new EdgeError('Esta fecha no es el Masters.')
  }
  if (matchday.status !== 'DRAFT') {
    throw new EdgeError('El Masters ya está armado.')
  }
  // Sin este guard, una disciplina pair_size=1
  // llegaba hasta el insert y `pairs_matchday_size` (FK real, no `season_id`
  // suelta — ver el comentario de `insertPairs` más abajo) la rebotaba con el
  // mensaje genérico de carrera de W34/S35: "El plantel o la fecha cambiaron
  // mientras armabas las parejas. Volvé a intentar." — falso acá, porque el
  // Masters es estructuralmente de a dos (mastersFixture/assertValidConfig
  // más abajo, siempre `size: 2`) y reintentar falla siempre igual.
  if (matchday.pair_size !== 2) {
    throw new EdgeError('El Masters se juega de a parejas: una disciplina de a uno no lo arma.')
  }

  const { config } = await disciplineConfig(supabase, matchday.discipline_id)
  // 2, no un placeholder: el Masters arma 6 PAREJAS por diseño de formato
  // (mastersFixture), sideSize=1 no tiene sentido acá sin importar qué
  // dispone la disciplina.
  assertValidConfig(config, 2)
  const seedOrder = await squadSeedOrder(supabase, matchday.discipline_id)
  const awardsByMatchday = await awardsBefore(supabase, matchday.discipline_id, matchday.number)
  const snapshot = snapshotForMatchday(matchday.number, seedOrder, awardsByMatchday, config)

  const ranking = computeRanking(awardsByMatchday, seedOrder, config, snapshot)
  const fixture = mastersFixture(mastersQualifiers(ranking))

  await deletePairs(supabase, matchdayId)

  // Las 6 parejas van en el orden del fixture, y los partidos las nombran por
  // índice: pareja 0 contra 1 en la ronda 1, 2 contra 3 en la 2, y así.
  // `insertPairs` pide `Side[]` (PR18a) y desde PR18b `mastersFixture` ya los
  // devuelve como `Side` de dos: el literal `{ size: 2 }` que había acá lo
  // construye ahora `pair()` adentro de `core/masters.ts`, donde vive la razón
  // (el Masters SIEMPRE se juega de a parejas).
  const sides = fixture.flatMap((match) => [match.sideA, match.sideB])
  const stored = await insertPairs(supabase, matchdayId, sides)

  const matches = fixture.map((_, index) => {
    const pairA = stored[index * 2]
    const pairB = stored[index * 2 + 1]
    if (pairA === undefined || pairB === undefined) {
      throw new Error(`Faltan parejas para el partido ${index + 1} del Masters. Esto es un bug.`)
    }
    return {
      matchday_id: matchdayId,
      round: index + 1,
      pair_a: pairA,
      pair_b: pairB,
      allows_draw: matchday.allows_draw,
    }
  })
  await insertMatches(supabase, matches)
}

/**
 * Crea la fecha del Masters DE UNA DISCIPLINA. `kind` no está en el grant de
 * columnas de `matchdays`, así que sólo la función de la base la puede crear.
 *
 * Recibe la disciplina, no la temporada (C36, decisión #4035): cada
 * disciplina juega su propio Masters. Antes llamaba a `create_masters`, que
 * resolvía la primaria ella misma — y con eso la SEGUNDA disciplina de un
 * torneo no podía armar el suyo, no podía llegar a FINISHED, y la temporada
 * no podía terminar nunca.
 */
export async function createMasters(
  supabase: Client,
  disciplineId: DisciplineId,
  playedOn: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('create_discipline_masters', {
    p_discipline: disciplineId,
    p_played_on: playedOn,
  })
  if (error !== null) {
    // `matchdays_one_masters` y `matchdays_one_live` levantan las dos un 23505,
    // y el mensaje crudo de Postgres nombra un índice que nadie conoce. Los
    // dos son unique sobre `discipline_id`, así que el mensaje dice "en esta
    // disciplina" — decía "en esta temporada", que era falso desde PR 7 y
    // habría mandado a buscar el Masters de otra disciplina.
    if (error.code === '23505') {
      throw new EdgeError('Ya hay un Masters, o una fecha sin cerrar en esta disciplina.')
    }
    throw new EdgeError(error.message)
  }
  return data as unknown as string
}

export async function openMatchday(supabase: Client, matchdayId: string): Promise<void> {
  // El Masters no tiene asistencias: son 4 clasificados, no de 8 a 12
  // confirmados. `pairingContextFor` correría `assertMatchdaySize` sobre un
  // `present` vacío y tiraría "Con 0 no hay fecha" en una jornada perfectamente
  // armada. Lo único que hay que verificar acá ya lo verifica `open_matchday`:
  // que existan parejas.
  const masters = await requireMatchday(supabase, matchdayId)
  if (masters.kind === 'MASTERS') {
    const { error } = await supabase.rpc('open_matchday', { p_matchday: matchdayId })
    if (error !== null) throw new EdgeError(error.message)
    return
  }

  const { input, guests } = await pairingContextFor(supabase, matchdayId)
  assertGuestsNamed(guests)

  // Las asistencias se pueden seguir tocando mientras la fecha está en DRAFT,
  // así que las parejas guardadas pueden haber quedado viejas. Éste es el
  // único momento en que la igualdad se puede exigir: una vez OPEN no se
  // regenera, y una fecha con más presentes que jugadores no tiene arreglo.
  const inPairs = new Set((await pairEntryIds(supabase, matchdayId)).flat())
  const present = new Set(input.present)
  const sameSet =
    inPairs.size === present.size && [...present].every((entryId) => inPairs.has(entryId))

  if (!sameSet) {
    throw new EdgeError('Cambió quién viene desde que armaste las parejas. Volvé a generarlas.')
  }

  const { error } = await supabase.rpc('open_matchday', { p_matchday: matchdayId })
  if (error !== null) throw new EdgeError(error.message)
}

/**
 * Freezes the points and shuts the matchday. The table itself is never stored:
 * it is recomputed from match_sets every time, which is what lets an old
 * matchday be replayed and come out the same.
 */
export async function closeMatchday(supabase: Client, matchdayId: string): Promise<void> {
  // MatchdayContextFor, NO pairingContextFor: cerrar no es sortear. Pasar por
  // el contexto del sorteo correría las validaciones de asistencia y de tamaño
  // sobre quién viene HOY en vez de sobre quiénes jugaron, y previousContext
  // podría tirar por un problema de la fecha anterior mientras cerrás ésta.
  const { matchday, config, guests, snapshot } = await matchdayContextFor(supabase, matchdayId)
  const { sides, matches } = await resultsOf(supabase, matchdayId)

  for (const match of matches) {
    // El partido de TERCER_PUESTO puede quedar SIN JUGAR a propósito
    // (decisión #3979): el guard de `standingsFromBracket`, más abajo, sólo
    // exige que la FINAL esté completa. Sin esta excepción el loop de abajo
    // rechazaría CUALQUIER llave que se saltee ese partido con "Falta cargar
    // el resultado", antes incluso de llegar al guard que a propósito lo
    // permite. No-op para ROUND_ROBIN: esa fecha nunca tiene un match en fase
    // TERCER_PUESTO (siempre 'GRUPO', REQ-D7-1). `isUnplayedThirdPlace`
    // (core/knockout.ts) — la misma regla vive también en page.tsx
    // (remainingMatches) y en 0041 (SQL); refactor sobre PR21 D2.
    if (isUnplayedThirdPlace(match)) continue
    // `matchday.allows_draw`, no la disciplina: es el valor CONGELADO en la
    // fecha (`matchdays_discipline_draw` es `on update no action`, así que
    // una vez creada la fecha la disciplina ya no puede cambiarlo). Cerrar
    // tiene que juzgar los resultados con la misma regla con la que se
    // guardaron, no con la de hoy.
    //
    // `drawIsLegal` (C30, decisión #4005): el empate sólo es legal en GRUPO,
    // sin importar `allows_draw` — fuera de GRUPO una llave necesita un
    // ganador. Sin este filtro, un empate colado en una fase de llave
    // pasaba este loop y reventaba después, en `winnerOf`
    // (`nextRoundMatchups`/`losingMatchup`, más abajo).
    const problem = matchError(match.sets, config.matchFormat, drawIsLegal(match.fase, matchday.allows_draw))
    if (problem !== null) throw new EdgeError(problem)
  }

  // `matchday.allows_draw` por lo MISMO que el `matchError` de arriba: es el
  // valor congelado en la fecha. Cerrar una fecha vieja tiene que tabularla
  // con la regla con la que se jugó, no con la que la disciplina tenga hoy.
  //
  // `formato.kind` bifurca la posición del día (REQ-D7-4): con
  // `GROUPS_KNOCKOUT` la arma la llave (`standingsFromBracket`); con
  // `ROUND_ROBIN` es EXACTAMENTE el camino de siempre, sin tocar una línea
  // (segundo GIVEN de REQ-D7-4, no-regresión) — `computeAwards`, dos líneas
  // más abajo, no cambia de firma en ninguno de los dos casos.
  const formato = matchday.formato as unknown as MatchdayFormat

  // W79 (verify-report-pr21-cierre, #4016): la mitad de C31 que 0044 no
  // cerró. `redraft_matchday` no borra `matches` (0011) y `setMatchdayFormat`
  // deja volver a `ROUND_ROBIN` en DRAFT con una llave completa todavía
  // puesta — sin este guard, la rama de abajo tabula GRUPO + SEMI + FINAL +
  // TERCER_PUESTO con `computeStandings` como si fuera un round robin, y
  // cierra con awards mezclados (medido: 8 awards, `CLOSED`). Se corta ACÁ,
  // antes de tabular nada: `ROUND_ROBIN` sólo puede tener partidos de
  // `fase='GRUPO'`/`grupo=1` (REQ-D7-1) — cualquier otra fila es la marca de
  // una llave anterior que sobrevivió al redraft.
  if (formato.kind === 'ROUND_ROBIN' && matches.some((match) => match.fase !== 'GRUPO' || match.grupo !== 1)) {
    throw new EdgeError('El formato cambió después de armar la fecha: hay que volver a sortearla.')
  }

  const standings =
    formato.kind === 'GROUPS_KNOCKOUT'
      ? standingsFromBracket(matches, config, snapshot, matchday.allows_draw)
      : computeStandings(sides, matches, config, snapshot, matchday.allows_draw)
  // El Masters define al campeón del año, no reparte puntos (spec 2.7), y
  // `close_matchday` rechaza un `p_awards` no vacío cuando kind = 'MASTERS'.
  // Sin esta rama el Masters no se puede cerrar: `computeAwards` devolvería seis
  // premios y la función SQL los rebotaría.
  const awards =
    matchday.kind === 'MASTERS'
      ? []
      : computeAwards(standings, config, guests.map((guest) => guest.entryId))

  const { error } = await supabase.rpc('close_matchday', {
    p_matchday: matchdayId,
    p_awards: awards as unknown as Json,
  })
  if (error !== null) throw new EdgeError(error.message)
}

/**
 * Posición del día para una fecha `GROUPS_KNOCKOUT` (REQ-D7-4, primer
 * GIVEN): la arma `knockoutPositions` a partir de la LLAVE, no de la tabla
 * de grupos plana. `computeAwards` sigue recibiendo `SideStanding[]` sin
 * cambiar de firma.
 *
 * Guard (decisión #3979, cerrada con el número a la vista: la curva de
 * pádel paga 5 al 3º y 3 al 4º, dos puntos de campeonato reales): sólo
 * exige que `FINAL` esté completa. NO exige `TERCER_PUESTO` jugado — a
 * propósito, no un descuido. Si ese partido no se jugó, `knockoutPositions`
 * (Rebanada B2, `core/knockout.ts`) ya hace fallback a la tabla de grupos
 * para decidir 3º/4º.
 *
 * AGUJERO DE DISEÑO cerrado acá, surfaceado en el reporte de esta rebanada
 * (`apply-progress-pr21d1`), no inventado en silencio: `knockoutPositions`
 * pide UNA `groupTable`, pero `GROUPS_KNOCKOUT` arma G tablas, una por grupo
 * (ver `matchupsAfterGroups`) — ninguna decide sola quién es 5º entre el 3º
 * del grupo A y el 3º del grupo B, y el spec (REQ-D7-4) tampoco lo dice.
 *
 * Decisión tomada acá: se REUTILIZA `computeStandings` —la MISMA función
 * que arma la tabla de una fecha `ROUND_ROBIN` entera— sobre TODOS los
 * lados y TODOS los partidos de la fase `GRUPO` juntos, no separados por
 * grupo. No es una regla nueva: es el mismo criterio de siempre (puntos del
 * día → diferencia → mano a mano → snapshot) aplicado al universo completo
 * de la fase de grupos, el mismo orden que hubiera salido si todos hubieran
 * jugado entre sí. `headToHead` ya devuelve `NOT_PLAYED` para dos lados de
 * grupos distintos que nunca se cruzaron (no inventa un resultado), así que
 * cae al snapshot como cualquier otro empate sin cruce — el mismo mecanismo
 * que ya resuelve empates DENTRO de un grupo. Es la misma convención que
 * usan los torneos reales para ordenar a quien no clasificó (p.ej. "mejores
 * terceros"): por los números de la fase de grupos, no por el número de
 * grupo. Distinto de `matchupsAfterGroups` (Rebanada C2), que SÍ separa por
 * grupo — ahí el objetivo es decidir quién clasifica DENTRO de su propio
 * grupo, acá el objetivo es ordenar a TODOS entre sí.
 */
function standingsFromBracket(
  matches: readonly MatchResult[],
  config: SeasonConfig,
  snapshot: EntryId[],
  allowsDraw: boolean,
): SideStanding[] {
  const phase = currentPhase(matches)
  if (phase !== 'FINAL' || !phaseIsComplete(matches, 'FINAL')) {
    throw new EdgeError('La llave todavía no llegó a la final: no se puede cerrar la fecha.')
  }
  const groupMatches = groupPhaseMatches(matches)
  const bracket = matches.filter((match) => match.fase !== 'GRUPO')
  const groupTable = computeStandings(uniqueSides(groupMatches), [...groupMatches], config, snapshot, allowsDraw)
  return knockoutBoundary(() => knockoutPositions(bracket, groupTable))
}

/**
 * Reabre la última fecha cerrada: borra sus awards y la vuelve a OPEN. Las
 * parejas quedan como estaban — no se rearman. `reopen_matchday` valida todo
 * (admin, que esté CLOSED, que sea la última) del lado de la base.
 */
export async function reopenMatchday(supabase: Client, matchdayId: string): Promise<void> {
  const { error } = await supabase.rpc('reopen_matchday', { p_matchday: matchdayId })
  if (error !== null) throw new EdgeError(error.message)
}

/**
 * Devuelve una fecha en juego al armado. No toca parejas, partidos ni
 * asistencias: corregir quién viene es del armado, y `generatePairs` rearma
 * cuando se lo pide. `redraft_matchday` valida admin y estado del lado de la base.
 */
export async function redraftMatchday(supabase: Client, matchdayId: string): Promise<void> {
  const { error } = await supabase.rpc('redraft_matchday', { p_matchday: matchdayId })
  if (error !== null) throw new EdgeError(error.message)
}

/**
 * Borra la fecha entera: DRAFT u OPEN, con todo lo que tiene cargado adentro
 * (asistencias, invitados, parejas, partidos, resultados). CLOSED se
 * rechaza — `cancel_matchday` valida admin y estado del lado de la base.
 */
export async function cancelMatchday(supabase: Client, matchdayId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_matchday', { p_matchday: matchdayId })
  if (error !== null) throw new EdgeError(error.message)
}

/** Guarda el resultado de un partido. Reemplaza cualquier set anterior en vez de acumularlo. */
export async function saveResult(
  supabase: Client,
  matchId: string,
  sets: SetScore[],
): Promise<void> {
  const { format, allowsDraw, fase } = await matchFormatOf(supabase, matchId)
  // `drawIsLegal` (C30, decisión #4005): el empate sólo es legal en GRUPO —
  // sin este filtro, la pantalla dejaba guardar un 2-2 en cualquier fase de
  // la llave y el 500 salía recién al avanzar de fase o cerrar la fecha
  // (`winnerOf`, core/knockout.ts). Acá, con el mensaje claro que `setError`
  // ya sabe dar para un empate no permitido.
  const problem = matchError(sets, format, drawIsLegal(fase, allowsDraw))
  if (problem !== null) throw new EdgeError(problem)

  // La política match_sets_write ya exige que la fecha esté OPEN: acá alcanza
  // con traducir el error de RLS a un mensaje que se pueda leer.
  const { error: deleteError } = await supabase.from('match_sets').delete().eq('match_id', matchId)
  if (deleteError !== null) {
    throw new EdgeError(`No se pudo guardar el resultado: ${deleteError.message}`)
  }

  //`match_sets_match_draw` (0034) exige que
  // `allows_draw` coincida con el del PARTIDO. Sin mandarlo, el default de
  // columna (`false`) rebotaba cada resultado de una disciplina con empates
  // —medido incluso con un 4-2, que no es empate ninguno—, o sea el guard no
  // protegía nada y mataba todo.
  //
  // `fase` por el MISMO motivo, ahora con `match_sets_match_fase` (0042,
  // C30): el default de columna (`'GRUPO'`) no coincide con la `fase` real
  // de un partido de llave, y la FK compuesta rebota CUALQUIER resultado de
  // una fase distinta de GRUPO — medido: hasta un 3-0 en una SEMI, que no es
  // empate ninguno, quedaba bloqueado sin este campo.
  const rows = sets.map((set, index) => ({
    match_id: matchId,
    set_number: index + 1,
    games_a: set.gamesA,
    games_b: set.gamesB,
    allows_draw: allowsDraw,
    fase,
  }))
  const { error: insertError } = await supabase.from('match_sets').insert(rows)
  if (insertError !== null) {
    throw new EdgeError(`No se pudo guardar el resultado: ${insertError.message}`)
  }
}

async function requireMatchday(supabase: Client, matchdayId: string): Promise<MatchdayRow> {
  const { data, error } = await supabase
    .from('matchdays')
    .select('*')
    .eq('id', matchdayId)
    .maybeSingle()
  if (error) throw new EdgeError(`No se pudo leer la fecha: ${error.message}`)
  if (data === null) throw new EdgeError('La fecha no existe.')
  // Único cast de todo el archivo (ver el comentario de `MatchdayRow` arriba):
  // acá es donde `discipline_id` pasa de `string` crudo a `DisciplineId`.
  return data as MatchdayRow
}

async function guestsOf(supabase: Client, matchdayId: string): Promise<GuestSeat[]> {
  const { data, error } = await supabase
    .from('entries')
    .select('id, display_name')
    .eq('matchday_id', matchdayId)
    .eq('kind', 'GUEST')
    .order('seed_position', { ascending: true })
  if (error) throw new EdgeError(`No se pudieron leer los invitados: ${error.message}`)
  return (data ?? []).map((row) => ({ entryId: row.id, displayName: row.display_name }))
}

/**
 * Los equipos fijos de la disciplina — `discipline_teams` (0068,
 * docs/tipos-de-torneo.md §1).
 *
 * Mismo lugar y misma forma que `locksOf`, y la diferencia es de QUÉ dependen:
 * un lock es de una FECHA y muere con ella; un equipo es de la DISCIPLINA y
 * sobrevive a todas. Por eso la clave es `discipline_id` y no `matchday_id`.
 */
async function teamsOf(supabase: Client, disciplineId: string): Promise<PairLock[]> {
  const { data, error } = await supabase
    .from('discipline_teams')
    .select('entry_a, entry_b')
    .eq('discipline_id', disciplineId)
    .order('id', { ascending: true })
  if (error) throw new EdgeError(`No se pudieron leer los equipos fijos: ${error.message}`)
  return (data ?? []).map((row) => ({ a: row.entry_a, b: row.entry_b }))
}

async function locksOf(supabase: Client, matchdayId: string): Promise<PairLock[]> {
  const { data, error } = await supabase
    .from('pair_locks')
    .select('entry_a, entry_b')
    .eq('matchday_id', matchdayId)
    .order('id', { ascending: true })
  if (error) throw new EdgeError(`No se pudieron leer las parejas fijas: ${error.message}`)
  return (data ?? []).map((row) => ({ a: row.entry_a, b: row.entry_b }))
}

/**
 * Quién juega esta fecha, EN EL ORDEN DE LA DISCIPLINA.
 *
 * El orden salía de `entries.seed_position` (C37), y era la numeración
 * equivocada por dos motivos a la vez: es la de LA TEMPORADA —el orden real
 * del plantel de una disciplina vive en `discipline_entries` desde PR 7, el
 * mismo defecto que C9 arregló en `entriesOf` sin llegar hasta acá— y encima
 * esa columna se relaja para el SQUAD en el contract, así que su `?? 0` iba a
 * dejar el orden de entrada al sorteo al azar SIN un solo error.
 *
 * El `.filter` no puede perder a nadie: `attendances_entry_discipline` es una
 * FK a `discipline_entries(discipline_id, entry_id)`, así que todo presente
 * tiene fila en la disciplina de su fecha. Es la base la que lo garantiza, no
 * esta función.
 */
async function playingEntryIds(
  supabase: Client,
  matchdayId: string,
  disciplineId: DisciplineId,
): Promise<EntryId[]> {
  const { data: attendances, error: attendancesError } = await supabase
    .from('attendances')
    .select('entry_id')
    .eq('matchday_id', matchdayId)
    .eq('status', 'PLAYING')
  if (attendancesError) {
    throw new EdgeError(`No se pudo leer el presentismo: ${attendancesError.message}`)
  }
  const playing = new Set((attendances ?? []).map((row) => row.entry_id))
  if (playing.size === 0) return []

  return (await squadSeedOrder(supabase, disciplineId)).filter((entryId) => playing.has(entryId))
}

/** Borra las parejas de la fecha. Cascadea a matches y match_sets. */
async function deletePairs(supabase: Client, matchdayId: string): Promise<void> {
  const { error } = await supabase.from('pairs').delete().eq('matchday_id', matchdayId)
  if (error) throw new EdgeError(`No se pudieron borrar las parejas: ${error.message}`)
}

/**
 * Inserta los lados y devuelve sus ids EN EL MISMO ORDEN en que se pasaron:
 * el fixture habla por índice, e `insert ... returning` no lo promete.
 * Insertando de a uno lo garantiza sin tener que reordenar nada después.
 *
 * Manda `pair_size: side.size` en cada fila (PR18a) — hasta acá el insert no
 * lo mandaba (W34) y el default de columna (2)
 * chocaba con `pairs_matchday_size` en una disciplina `pair_size=1`. `side`
 * viene de `buildSides({ sideSize: pairSize, ... })`, así que `side.size`
 * coincide siempre con el `pair_size` de la fecha — no hay un tercer valor
 * posible que pueda desalinearlos.
 */
async function insertPairs(
  supabase: Client,
  matchdayId: string,
  sides: Side[],
): Promise<string[]> {
  const matchday = await requireMatchday(supabase, matchdayId)
  const ids: string[] = []
  for (const side of sides) {
    const { data, error } = await supabase
      .from('pairs')
      .insert({
        matchday_id: matchdayId,
        season_id: matchday.season_id,
        entry_a: side.a,
        entry_b: side.size === 2 ? side.b : null,
        pair_size: side.size,
      })
      .select('id')
      .single()
    if (error || data === null) {
      // Traducía acá un mensaje fijo de
      // "disciplina de a uno todavía no puede armar parejas automáticamente"
      // para el rebote de `pairs_matchday_size` — correcto en ese momento,
      // porque este insert no mandaba `pair_size`. Ahora lo manda (arriba), y
      // el mensaje se BORRA en vez de reescribirse: una disciplina de a uno
      // SÍ arma sola desde acá, así que no queda nada honesto que decir sobre
      // ese caso EN EL DRAW. S35 sigue vigente para
      // las otras tres FK reales del mismo insert (`pairs_entry_a_season_id_fkey`,
      // `pairs_entry_b_season_id_fkey`, `pairs_matchday_id_season_id_fkey` —
      // no hay FK de `season_id` sola sobre `pairs`, corregido W39 verify-
      // report ronda 12): esas sí son una carrera real —alguien tocó el
      // plantel o la fecha mientras se armaba— y comparten este único mensaje
      // genérico. `pairs_matchday_size` SIGUE pudiendo disparar acá, pero sólo
      // por el camino de `generateMastersPairs`, que ahora corta antes con su
      // propio guard (W39, arriba) en vez de llegar a este insert.
      if (error?.code === '23503') {
        throw new EdgeError('El plantel o la fecha cambiaron mientras armabas las parejas. Volvé a intentar.')
      }
      throw new EdgeError(`No se pudo guardar una pareja: ${error?.message}`)
    }
    ids.push(data.id)
  }
  return ids
}

interface MatchRow {
  matchday_id: string
  round: number
  pair_a: string
  pair_b: string
  /**
   * W61. `matches_matchday_draw` (0034) exige que
   * coincida con el de SU fecha; sin mandarlo, el default de columna (`false`)
   * rebota cada fixture de una disciplina con empates — y lo hace DESPUÉS de
   * que `insertPairs` ya escribió los lados, dejando la fecha con parejas y
   * sin partidos (medido: `pairs=4, matches=0`) sin transacción que lo
   * envuelva.
   *
   * Va OBLIGATORIO en esta interfaz, no como opcional con default: el `Insert`
   * generado en `db/database.types.ts` lo declara opcional porque la columna
   * tiene default, así que el typecheck NO puede cazar a un escritor que se lo
   * olvide (N44). Exigirlo acá es la única red de compilación posible, y es la
   * que faltaba las dos veces que este bug apareció.
   */
  allows_draw: boolean
  /**
   * Opcionales a propósito (Rebanada C1, REQ-D7-1): `roundRobinMatches` no
   * los manda nunca, así que esa fila cae en el default de columna
   * ('GRUPO'/1, 0039) — el mismo comportamiento que tenía este insert antes
   * de esta rebanada. `groupedMatches` los manda siempre explícitos: `grupo`
   * es lo que separa una fase de grupos real de "todos contra todos con otro
   * nombre" (matches_group_only_in_groups, 0039, ya lo exige del lado de la
   * base).
   */
  fase?: Phase
  grupo?: number
}

/** Inserta el fixture. */
async function insertMatches(supabase: Client, rows: MatchRow[]): Promise<void> {
  const { error } = await supabase.from('matches').insert(rows)
  if (error) throw new EdgeError(`No se pudo guardar el fixture: ${error.message}`)
}

/**
 * Los `entry_id` de cada pareja de la fecha, sin importar la aridad: sólo se
 * usa para el chequeo de conjunto de `openMatchday` (¿quién está en una
 * pareja == quién está presente?), que no le pide forma a nada. Con
 * `members(sideOfRow(...))` un lado de uno YA no tira acá (antes de PR18a,
 * `requirePartner` tiraba siempre con `entry_b` nulo, sin importar si la fila
 * estaba rota o si el lado era de uno legítimo) — es la mitad de la
 * migración que sí se completa en esta PR.
 */
async function pairEntryIds(supabase: Client, matchdayId: string): Promise<string[][]> {
  const { data, error } = await supabase
    .from('pairs')
    .select('entry_a, entry_b, pair_size')
    .eq('matchday_id', matchdayId)
  if (error) throw new EdgeError(`No se pudieron leer las parejas: ${error.message}`)
  return (data ?? []).map((row) => [
    ...members(sideOfRow(row.pair_size as SideSize, row.entry_a, row.entry_b)),
  ])
}

/**
 * Los lados y los partidos de la fecha, con los sets de cada partido ordenados
 * por `set_number`.
 *
 * W40 CERRADO acá igual que en `db/read.ts`: componía `pairFromRow`, que
 * tiraba con una fila `pair_size=1`, así que `closeMatchday()` —el wrapper TS,
 * no el RPC— no podía cerrar una fecha de a uno. `sideOfRow` devuelve el lado
 * con su forma y `computeStandings` ya lo tabula (S39).
 *
 * Exportada (#3957, PR21 B1): `fase`/`grupo` de cada `MatchResult` tienen hoy
 * un solo consumidor de producción — este `select` — y `closeMatchday` no los
 * usa todavía (llega con D1), así que ningún test que pase por el wrapper
 * público puede notar si alguien los hardcodea a `'GRUPO'`/`1`. El test de
 * `db/match-phase.db.test.ts` llama esta función directo.
 */
export async function resultsOf(
  supabase: Client,
  matchdayId: string,
): Promise<{ sides: Side[]; matches: MatchResult[] }> {
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

  const matches: MatchResult[] = (matchRows ?? []).map((row) => {
    const sideA = sideById.get(row.pair_a)
    const sideB = sideById.get(row.pair_b)
    if (sideA === undefined || sideB === undefined) {
      throw new Error(
        `El partido ${row.id} referencia una pareja que no está en la fecha. Esto es un bug.`,
      )
    }
    return {
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

/**
 * El `matchFormat` de la configuración de la disciplina dueña de este partido,
 * MÁS su `allows_draw` y su `fase`.
 *
 * `allows_draw` sale de la fila de `matches`, no de la disciplina, y es a
 * propósito: es el valor que `match_sets_match_draw` va a verificar contra
 * ESTE partido. La cadena de FK compuestas garantiza que sean el mismo
 * (`matches → matchdays → disciplines`), así que leerlo del partido no es una
 * segunda fuente de verdad — es la MISMA, un salto más cerca, y sin un select
 * extra: ya se estaba leyendo esta fila.
 *
 * `fase` por el mismo motivo, agregada para C30 (decisión #4005): el
 * caller la combina con `allows_draw` vía `drawIsLegal` — el empate sólo es
 * legal en GRUPO, sin importar lo que diga la disciplina.
 */
async function matchFormatOf(
  supabase: Client,
  matchId: string,
): Promise<{ format: MatchFormat; allowsDraw: boolean; fase: Phase }> {
  const { data: match, error: fetchError } = await supabase
    .from('matches')
    .select('matchday_id, allows_draw, fase')
    .eq('id', matchId)
    .maybeSingle()
  if (fetchError) throw new EdgeError(`No se pudo leer el partido: ${fetchError.message}`)
  if (match === null) throw new EdgeError('El partido no existe.')

  const matchday = await requireMatchday(supabase, match.matchday_id)
  const { config } = await disciplineConfig(supabase, matchday.discipline_id)
  return { format: config.matchFormat, allowsDraw: match.allows_draw, fase: match.fase as Phase }
}
