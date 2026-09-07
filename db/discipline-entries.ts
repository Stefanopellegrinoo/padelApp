import type { DisciplineId } from '@/core'
import type { Client } from './client'
import { EdgeError } from './errors'

/**
 * Los `id` de TODAS las fechas de esta disciplina, cualquier status.
 * Compartido por `hasPlayedDiscipline` y por la guarda de parejas fijas de
 * `removeFromDiscipline`, para no repetir el mismo select dos veces en la
 * misma llamada.
 */
async function matchdayIdsOf(supabase: Client, disciplineId: DisciplineId): Promise<string[]> {
  const { data, error } = await supabase.from('matchdays').select('id').eq('discipline_id', disciplineId)
  if (error) throw new EdgeError(`No se pudo leer las fechas de la disciplina: ${error.message}`)
  return (data ?? []).map((row) => row.id)
}

/**
 * ¿Cuántas disciplinas tiene esta temporada? Guarda compartida de
 * `addToDiscipline` y `removeFromDiscipline` — ronda de fix, decisión del
 * dueño 2 revisitada: con una sola disciplina, el plantel del CONTENEDOR YA
 * ES la membresía de esa disciplina (§5 del diseño), y tocar
 * `discipline_entries` ahí rompería esa invariante sin forma de volver por
 * la UI — la sección que lo arreglaría (`QuienJuega`) está escondida
 * (`multiDiscipline`, `[disciplina]/ajustes/page.tsx`) justo por tener una
 * sola disciplina. Ocultar el botón en el cliente no alcanza: una Server
 * Action es un endpoint POST, no una sugerencia — de ahí que la guarda viva
 * ACÁ, del lado del server, en un solo lugar por el que pasan las dos
 * acciones.
 */
async function assertMultiDiscipline(supabase: Client, seasonId: string): Promise<void> {
  const { count, error } = await supabase
    .from('disciplines')
    .select('id', { count: 'exact', head: true })
    .eq('season_id', seasonId)
  if (error) throw new EdgeError(`No se pudo leer las disciplinas de la temporada: ${error.message}`)
  if ((count ?? 0) <= 1) {
    throw new EdgeError(
      'Esta temporada tiene una sola disciplina: el plantel del torneo ya es la membresía de esa disciplina, no hay nada que agregar o sacar acá.',
    )
  }
}

/**
 * Suma un asiento del plantel a esta disciplina (§2.6 del diseño): la
 * membresía por disciplina no tenía superficie — `discipline_entries` se
 * llenaba al crear el torneo y en "+ Agregar disciplina" (`db/discipline.ts`)
 * y de ahí en más no había forma de tocarla.
 *
 * Va al FINAL — `coalesce(max(seed_position), -1) + 1`, mismo cálculo que
 * `add_squad_seat` sin `p_before` (0061_add_squad_seat_no_entries_seed.sql).
 * A diferencia de esa RPC, acá no hace falta que el cálculo y el insert
 * viajen en una transacción: `add_squad_seat` es atómica porque además CREA
 * el asiento; acá el asiento ya existe y sólo se agrega una fila. Una
 * carrera entre dos altas a la MISMA disciplina en el mismo instante choca
 * contra `discipline_entries_seed` (unique (discipline_id, seed_position),
 * 0023:28) y la segunda tira un 23505, que se traduce más abajo.
 */
export async function addToDiscipline(
  supabase: Client,
  disciplineId: DisciplineId,
  seasonId: string,
  entryId: string,
): Promise<void> {
  await assertMultiDiscipline(supabase, seasonId)

  const { data: seats, error: seatsError } = await supabase
    .from('discipline_entries')
    .select('seed_position')
    .eq('discipline_id', disciplineId)
    .order('seed_position', { ascending: false })
    .limit(1)
  if (seatsError) throw new EdgeError(`No se pudo leer el orden de la disciplina: ${seatsError.message}`)
  const nextSeed = (seats?.[0]?.seed_position ?? -1) + 1

  const { error } = await supabase
    .from('discipline_entries')
    .insert({ discipline_id: disciplineId, entry_id: entryId, season_id: seasonId, seed_position: nextSeed })
  if (error === null) return

  // 23505 (`unique_violation`) tiene DOS constraints posibles acá, y son dos
  // causas distintas — mismo criterio que `removeSeat` (`db/entries.ts:191`)
  // traduciendo el 23503 en vez de dejarlo pasar crudo. Medido contra la base
  // real: una pestaña vieja (o un doble click, ver `disabled={pending}` en
  // `QuienJuega` — protege el click pero no dos pestañas) repite el alta y
  // pega contra la PK; dos altas a la MISMA disciplina en el mismo instante
  // pegan contra el unique de `seed_position` en cambio.
  if (error.code === '23505') {
    if (error.message.includes('discipline_entries_pkey')) {
      throw new EdgeError('Este jugador ya juega esta disciplina.')
    }
    throw new EdgeError('Otra alta ocupó ese lugar justo ahora. Probá de nuevo.')
  }
  throw new EdgeError(`No se pudo agregar a la disciplina: ${error.message}`)
}

/**
 * ¿Este asiento ya jugó ESTA disciplina? Sube por la misma cadena que
 * `closedHistoryAll` (`db/read.ts:940-962`, disciplina → sus `matchdays` por
 * `discipline_id`), pero a diferencia de esa función NO filtra por
 * `status = 'CLOSED'` ni por `kind = 'REGULAR'`: lo que de verdad bloquea
 * sacar a alguien no es que la fecha haya cerrado, es que `pairs` ya lo
 * referencia — la misma tabla que `removeSeat` (`db/entries.ts:191`) deja
 * que Postgres rebote con `23503` (`on delete no action`,
 * `0001_schema.sql:170-171`). Esas filas existen desde que la fecha arranca
 * (`generatePairs`, `db/matchday.ts:757`), mucho antes de CLOSED, y tanto en
 * REGULAR como en MASTERS (las dos cierran por el mismo camino).
 *
 * Sólo `pairs`, no `awards` — verificado, no supuesto: `close_matchday`
 * (`0067_close_matchday_regular_guard.sql:56-64`) rechaza el cierre ENTERO
 * si algún `entryId` del payload de premios no aparece ya en
 * `pairs.entry_a`/`entry_b` de esa misma fecha ("Hay puntos para alguien que
 * no jugó esta fecha"), y `reopen_matchday`
 * (`0057_reopen_matchday_no_season_status_write.sql:64`) borra `awards` al
 * reabrir pero nunca `pairs`. `promote_guest` (las seis migraciones que lo
 * tocan) copia el award de un invitado que YA tenía su propia fila en
 * `pairs` desde que jugó como invitado. No hay, medido, ningún camino de
 * escritura donde `awards` tenga una fila para (entry_id, matchday_id) sin
 * que `pairs` ya la tenga para el mismo par — chequear las dos es cinturón
 * sobre una invariante que ninguna FK sostiene, y que ningún test puede
 * ejercitar en la rama que lo haría necesario (probado por mutación: sacar
 * el `awards` de un `||` anterior acá no movía un solo test). Se saca en vez
 * de dejarlo sin cubrir.
 */
export async function hasPlayedDiscipline(
  supabase: Client,
  disciplineId: DisciplineId,
  entryId: string,
): Promise<boolean> {
  const matchdayIds = await matchdayIdsOf(supabase, disciplineId)
  if (matchdayIds.length === 0) return false

  const { count, error } = await supabase
    .from('pairs')
    .select('id', { count: 'exact', head: true })
    .in('matchday_id', matchdayIds)
    .or(`entry_a.eq.${entryId},entry_b.eq.${entryId}`)
  if (error) throw new EdgeError(`No se pudo comprobar si ya jugó: ${error.message}`)
  return (count ?? 0) > 0
}

/**
 * Saca un asiento de ESTA disciplina — distinto de `removeSeat`
 * (`db/entries.ts`), que saca del PLANTEL entero. El asiento sigue en el
 * torneo y en las demás disciplinas que juegue; sólo deja de jugar ésta.
 *
 * NO es un espejo exacto de la guarda de `removeSeat`: allá el `23503` de
 * `pairs`/`awards` lo tira Postgres DENTRO de la sentencia de `delete`, sin
 * ventana entre preguntar y borrar. Acá son varias consultas seguidas —
 * ninguna FK protege `discipline_entries` de un borrado mientras esa persona
 * ya jugó (ver `hasPlayedDiscipline`) — así que hay TOCTOU en teoría entre el
 * último chequeo y el `delete`. No se cierra con un lock: el caso real es un
 * admin con dos pestañas, no dos admins compitiendo, y el costo de un lock
 * no se justifica para esa ventana.
 *
 * Ronda de fix — la guarda cubre lo que se PERDERÍA o quedaría COLGADO en
 * ESTA disciplina, no sólo "ya jugó":
 * - `pairs` (`hasPlayedDiscipline`): partidos reales, no se puede perder.
 * - `pair_locks`: no cuelga de `discipline_entries` (cuelga de `entries`,
 *   `0001_schema.sql:142-143`), así que SOBREVIVE al borrado sin este
 *   chequeo — medido: `generatePairs` (`db/matchday.ts:757`) revienta después
 *   con "Una pareja fija incluye a alguien que no juega esta fecha", y la
 *   salida que ese mensaje sugiere ("volvé a tildar...") es IMPOSIBLE una vez
 *   que `attendances_entry_discipline` (ver abajo) ya borró la asistencia.
 *   Se chequea ANTES de que eso pase, con un mensaje que nombra la pareja
 *   fija, no el síntoma de más adelante.
 * - `attendances`: SÍ cuelga de `discipline_entries`
 *   (`attendances_entry_discipline`, `0024_attendances_discipline_fk.sql:23-24`,
 *   `on delete cascade`) — se borraría en silencio, sin error, sin aviso.
 *   Acotado a fechas en DRAFT y `status = 'PLAYING'`: un ABSENT o una fecha
 *   ya abierta/cerrada no se pierde nada real (si esa fecha llegó a jugarse,
 *   `hasPlayedDiscipline` ya bloqueó más arriba).
 *
 * Lo que se buscó y se decidió NO cubrir: `discipline_teams` (equipos
 * fijos, `0068_fixed_teams.sql:70-71`) también cuelga de
 * `discipline_entries` con `on delete cascade` — pero ningún camino de
 * producción escribe una FILA ahí hoy (`db/matchday.ts` sólo la LEE,
 * `teamsOf`); no hay nada real que este delete pueda perder ahí todavía.
 * `disciplines.fixed_teams` (el flag) ya tiene escritor desde la puerta de
 * creación (`createSeason`/`addDiscipline`) — sigue sin importar acá porque
 * una disciplina recién creada con el flag prendido nace con CERO equipos.
 * Si `discipline_teams` suma un escritor de FILAS (la pantalla para armar
 * equipos, todavía sin construir), esto necesita revisarse.
 */
export async function removeFromDiscipline(
  supabase: Client,
  disciplineId: DisciplineId,
  seasonId: string,
  entryId: string,
): Promise<void> {
  await assertMultiDiscipline(supabase, seasonId)

  if (await hasPlayedDiscipline(supabase, disciplineId, entryId)) {
    throw new EdgeError('Este jugador ya jugó, así que no se puede sacar de esta disciplina: sus resultados quedarían colgados.')
  }

  const matchdayIds = await matchdayIdsOf(supabase, disciplineId)
  if (matchdayIds.length > 0) {
    const { count: lockCount, error: lockError } = await supabase
      .from('pair_locks')
      .select('id', { count: 'exact', head: true })
      .in('matchday_id', matchdayIds)
      .or(`entry_a.eq.${entryId},entry_b.eq.${entryId}`)
    if (lockError) throw new EdgeError(`No se pudo comprobar las parejas fijas: ${lockError.message}`)
    if ((lockCount ?? 0) > 0) {
      // "en una fecha de esta disciplina", sin acotar a "sin cerrar": la
      // query de arriba mira TODOS los `matchdayIds` (cualquier status,
      // `matchdayIdsOf` no filtra) y `lockPair` (`db/matchday.ts:726`) no
      // exige que la fecha esté en DRAFT -- decir "sin cerrar" prometería un
      // acotamiento que el código no hace.
      throw new EdgeError(
        'Este jugador tiene una pareja fija armada en una fecha de esta disciplina: destrabala o cambiale el compañero al invitado antes de sacarlo.',
      )
    }
  }

  // Sólo fechas en DRAFT: una vez armada (pairs generados), `hasPlayedDiscipline`
  // ya bloqueó más arriba, y una fecha vieja CLOSED con este jugador ABSENT
  // no pierde nada real al perder esa fila.
  const { data: draftMatchdays, error: draftError } = await supabase
    .from('matchdays')
    .select('id')
    .eq('discipline_id', disciplineId)
    .eq('status', 'DRAFT')
  if (draftError) throw new EdgeError(`No se pudo leer las fechas en armado: ${draftError.message}`)
  const draftIds = (draftMatchdays ?? []).map((row) => row.id)
  if (draftIds.length > 0) {
    const { count: attendanceCount, error: attendanceError } = await supabase
      .from('attendances')
      .select('id', { count: 'exact', head: true })
      .in('matchday_id', draftIds)
      .eq('entry_id', entryId)
      .eq('status', 'PLAYING')
    if (attendanceError) throw new EdgeError(`No se pudo comprobar el presentismo: ${attendanceError.message}`)
    if ((attendanceCount ?? 0) > 0) {
      throw new EdgeError(
        'Este jugador está marcado presente en una fecha sin armar de esta disciplina: destildalo ahí antes de sacarlo.',
      )
    }
  }

  const { error, count } = await supabase
    .from('discipline_entries')
    .delete({ count: 'exact' })
    .eq('discipline_id', disciplineId)
    .eq('entry_id', entryId)
    // `season_id`, no sólo `discipline_id`+`entry_id` (ronda de fix 2,
    // BLOQUEA 1): `assertMultiDiscipline` cuenta las disciplinas de
    // `seasonId` (el argumento), pero sin este `.eq()` el delete no lo usa
    // para nada más -- un `seasonId` que NO es el dueño real de
    // `disciplineId` igual autorizaba (RLS valida `is_season_admin` contra
    // el `season_id` de LA FILA, no contra el argumento) y borraba la fila
    // de la temporada equivocada. Con esto, ese cruce no encuentra ninguna
    // fila y cae en la rama `count === 0` de abajo.
    .eq('season_id', seasonId)
  if (error) throw new EdgeError(`No se pudo sacar de la disciplina: ${error.message}`)
  // `count: 'exact'`, mismo motivo documentado en `db/entries.ts`
  // (`unlinkSeat`, `renameSeat`, W49): un delete que no toca ninguna fila NO
  // es un error en PostgREST, y la única guarda real es RLS
  // (`discipline_entries_write`, `is_season_admin`, `0023:60-62`).
  if (count === 0) {
    throw new EdgeError('No se pudo sacar de la disciplina: sólo puede hacerlo quien organiza.')
  }
}
