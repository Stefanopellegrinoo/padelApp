/**
 * El plantel, desde Ajustes: agregar, renombrar, sacar y desvincular asientos.
 *
 * Ninguna de estas funciones toca `config.squadSize` ni `config.points`. Eso se
 * edita en la sección Formato, y mientras las dos cosas no coincidan la pantalla
 * lo dice llamando a `validateConfig` con la cantidad real de asientos. Ajustar
 * la config desde acá dejaría una config inválida a mitad de camino, que es lo
 * que `assertValidConfig` existe para impedir.
 *
 * La guardia real es RLS: `entries_write` (0002_rls.sql) pide
 * `is_season_admin(season_id)` para insert, update y delete.
 */
import type { Client } from './client'
import { EdgeError } from './errors'

/**
 * Agrega un asiento al plantel. `beforeEntryId` es "antes de este asiento": el
 * default `null` agrega al final, y el RESULTADO es el mismo de siempre para
 * quien ignora el selector nuevo. El camino no: la autorización se mudó de RLS
 * al `is_season_admin` explícito de la función (que corre `security definer`),
 * los viajes a la base pasaron de dos a uno, y por eso mismo los mensajes de
 * error cambian — una denegación que antes leía "No se pudo agregar el
 * jugador: new row violates row-level security policy…" ahora es "Sólo quien
 * organiza la temporada puede agregar un asiento."
 *
 * No es una posición numérica: `removeSeat` deja huecos en `seed_position` a
 * propósito, así que "posición 3" es ambigua y queda vieja apenas alguien más
 * entra o sale. "Antes de Juan" no.
 *
 * Elegir el lugar y correr la cola son dos pasos que tienen que viajar juntos
 * en UNA transacción, y el cliente de Supabase no tiene eso — por eso los dos
 * pasos viven en `add_squad_seat` (0013_squad_seat_position.sql) y acá queda
 * una sola llamada.
 */
export async function addSquadSeat(
  supabase: Client,
  seasonId: string,
  displayName: string,
  beforeEntryId: string | null = null,
): Promise<string> {
  const name = displayName.trim()
  if (name.length === 0) throw new EdgeError('El asiento necesita un nombre.')

  const { data, error } = await supabase.rpc('add_squad_seat', {
    p_season: seasonId,
    p_name: name,
    // `p_before` es opcional en el tipo generado (tiene default en SQL), no
    // nullable: `undefined` omite la clave y deja que el default de la
    // función decida, que es exactamente "al final".
    p_before: beforeEntryId ?? undefined,
  })
  // El mensaje pasa DERECHO, sin prefijo, igual que el resto de las llamadas a
  // RPC (`claim_seat` acá abajo, todo `db/matchday.ts`): los `raise` de
  // `add_squad_seat` ya están escritos en castellano y para que los lea el
  // admin. Prefijarlos daba "No se pudo agregar el jugador: Ese jugador no
  // está en el plantel." — dos oraciones peleadas — y, cuando el error no era
  // uno de los nuestros, pegaba el inglés crudo de Postgres atrás de una
  // frase en castellano.
  if (error !== null) throw new EdgeError(error.message)
  // `data === null` con `error === null` no debería pasar —la función devuelve
  // el uuid del asiento— pero interpolarlo daba literalmente "undefined".
  if (data === null) throw new EdgeError('No se pudo agregar el jugador.')
  return data
}

/**
 * Promueve al invitado que ya jugó a un asiento del plantel, sin recalcular
 * nada: si su pareja de esa fecha tiene un award congelado, se lo copia
 * entero; si no —pareja toda invitada, o nunca quedó en ninguna pareja—, no
 * se inventa ni se saltea nada más que eso.
 *
 * `beforeEntryId` es el mismo mecanismo de posicionamiento que
 * `addSquadSeat`: "antes de este asiento", default `null` = al final. Los dos
 * pasos —trabar la fecha CLOSED, correr la cola si hace falta, y sólo
 * entonces copiar el award— tienen que viajar en UNA transacción, y por eso
 * viven en `promote_guest` (0014_promote_guest.sql) y acá queda una sola
 * llamada.
 */
export async function promoteGuest(
  supabase: Client,
  entryId: string,
  beforeEntryId: string | null = null,
): Promise<void> {
  const { error } = await supabase.rpc('promote_guest', {
    p_entry: entryId,
    // Mismo motivo que en `addSquadSeat`: `p_before` es opcional en el tipo
    // generado (tiene default en SQL), no nullable — `undefined` omite la
    // clave y deja que el default de la función decida.
    p_before: beforeEntryId ?? undefined,
  })
  // Sin prefijo, igual que `addSquadSeat` y el resto de las llamadas a RPC de
  // este archivo: los `raise` de `promote_guest` ya están en castellano y
  // pensados para que los lea el admin.
  if (error !== null) throw new EdgeError(error.message)
}

/**
 * Reclama un asiento para quien llama, desde adentro del torneo.
 *
 * Es el mismo `claim_seat` que usa Unirse y no un update propio: ahí vive la
 * atomicidad (el `player_id is null` adentro del where), la regla de un asiento
 * por persona y los mensajes. Un update desde acá sería una segunda forma de
 * reclamar, y la que no se probó es la que se rompe.
 *
 * Existe porque el que crea el torneo no pasa por Unirse: no tiene por qué
 * pegarse su propio link de invitación para jugar el torneo que armó.
 */
export async function claimOwnSeat(
  supabase: Client,
  seasonId: string,
  entryId: string,
): Promise<void> {
  const { data: season, error: seasonError } = await supabase
    .from('seasons')
    .select('invite_token')
    .eq('id', seasonId)
    .maybeSingle()
  if (seasonError) throw new EdgeError(`No se pudo leer el torneo: ${seasonError.message}`)
  if (season === null) throw new EdgeError('El torneo no existe.')

  const { error } = await supabase.rpc('claim_seat', {
    p_token: season.invite_token,
    p_entry: entryId,
  })
  if (error !== null) throw new EdgeError(error.message)
}

/** Cambia el nombre del asiento. No toca `player_id`: renombrar no desvincula. */
/**
 * Cambia el nombre de un asiento.
 *
 * `count: 'exact'` por el mismo motivo que `setMatchdayDate` (W49):
 * un update que no toca ninguna fila NO es un error
 * en PostgREST. Estas escrituras se apoyan en RLS y no chequean admin por su
 * cuenta, así que a un participante que no organiza le decían que guardó y al
 * recargar volvía el valor viejo. La ronda 15 lo midió con un participante
 * real en las cuatro.
 */
export async function renameSeat(
  supabase: Client,
  entryId: string,
  displayName: string,
): Promise<void> {
  const name = displayName.trim()
  if (name.length === 0) throw new EdgeError('El asiento necesita un nombre.')

  const { error, count } = await supabase
    .from('entries')
    .update({ display_name: name }, { count: 'exact' })
    .eq('id', entryId)
  if (error !== null) throw new EdgeError(`No se pudo cambiar el nombre: ${error.message}`)
  if (count === 0) {
    throw new EdgeError('No se pudo cambiar el nombre: sólo puede hacerlo quien organiza.')
  }
}

/**
 * Suelta el asiento de quien lo reclamó, dejándolo libre para otro. El nombre
 * se queda.
 *
 * `count: 'exact'` por el mismo motivo que `setMatchdayDate` (W49):
 * un update que no toca ninguna fila NO es un error
 * en PostgREST. Estas escrituras se apoyan en RLS y no chequean admin por su
 * cuenta, así que a un participante que no organiza le decían que guardó y al
 * recargar volvía el valor viejo. La ronda 15 lo midió con un participante
 * real en las cuatro.
 */
export async function unlinkSeat(supabase: Client, entryId: string): Promise<void> {
  const { error, count } = await supabase
    .from('entries')
    .update({ player_id: null }, { count: 'exact' })
    .eq('id', entryId)
  if (error !== null) throw new EdgeError(`No se pudo desvincular el asiento: ${error.message}`)
  if (count === 0) {
    throw new EdgeError('No se pudo desvincular el asiento: sólo puede hacerlo quien organiza.')
  }
}

/**
 * Saca un asiento del plantel.
 *
 * Falla —y tiene que fallar— cuando el asiento ya jugó: `pairs` y `awards`
 * referencian `entries` con `on delete no action` (0001_schema.sql) justamente
 * para que dar de baja a alguien no borre las fechas que ya se jugaron. El
 * 23503 se traduce; no se borra en cascada y no se inventa un borrado lógico.
 *
 * El hueco que queda en `seed_position` no molesta: `squadSeedOrder` ordena por
 * esa columna y el índice pide único, no consecutivo. Renumerar sería reescribir
 * el orden de desempate inicial de todos los demás por sacar a uno.
 *
 * **WU5 (tanda 7): clase de deadlock pre-existente, conocida y NO arreglada
 * acá — registrada, no resuelta.** Este `delete` es un round trip crudo,
 * sin advisory lock ni `for update` propio: no coordina con nada. Cuando
 * corre a la vez que `add_squad_seat`/`promote_guest` están corriendo el
 * corrimiento de cola de OTRO asiento (`shift_seeds_up`, 0023, o su
 * gemelo a nivel temporada `shift_season_seeds_up`, 0080), la cascada de
 * este `delete` (`entries` → `discipline_entries` y `entries` →
 * `season_seed_order`, las dos `on delete cascade`, en el orden que fije
 * el OID del trigger — no el de esta lista) puede cruzarse con el `for
 * update` que el corrimiento ya tiene tomado sobre otra fila de esa misma
 * tabla, y las dos transacciones esperarse en círculo.
 *
 * Medido: `removeSeat` ‖ `shift_seeds_up` (la carrera original, documentada
 * como "techo conocido y aceptado" desde 0013/0023) da 30/200 deadlocks;
 * `removeSeat` ‖ `shift_season_seeds_up` (la gemela nueva, a nivel
 * temporada, que nace con 0080/0081) da 29/200 — básicamente la misma
 * probabilidad, porque es la MISMA causa en dos tablas distintas. El
 * advisory lock de WU1/WU2 (esta misma tanda) no la toca: serializa
 * `add_squad_seat`/`promote_guest` ENTRE SÍ, nunca contra `removeSeat`,
 * que no lo pide (ver el comentario corregido en
 * `0085_add_squad_seat_fixes_lock_comment.sql`).
 *
 * El owner decidió explícitamente no perseguirla en esta rama: el arreglo
 * real es que `removeSeat` tome el mismo advisory lock por temporada
 * ANTES de su `delete` — un cambio de comportamiento (una escritura hoy
 * instantánea empieza a esperar) que no entra en el alcance de esta tanda.
 * Que quede escrito ACÁ para el que la persiga después: el síntoma en
 * producción es `deadlock detected` o `lock timeout` sin traducir al
 * castellano (deuda aparte, tampoco de esta tanda).
 */
export async function removeSeat(supabase: Client, entryId: string): Promise<void> {
  const { error } = await supabase.from('entries').delete().eq('id', entryId)
  if (error === null) return

  if (error.code === '23503') {
    throw new EdgeError(
      'Este jugador ya jugó alguna fecha, así que no se puede sacar: sus resultados quedarían colgados. Podés desvincular el reclamo y cambiarle el nombre.',
    )
  }
  throw new EdgeError(`No se pudo sacar al jugador: ${error.message}`)
}
