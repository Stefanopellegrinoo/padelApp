import type { DisciplineId } from '@/core'
import type { Client } from './client'
import { EdgeError } from './errors'

/** Un equipo fijo, con su `id` de fila — hace falta para poder deshacerlo. */
export interface FixedTeam {
  id: string
  entryA: string
  entryB: string
}

/**
 * Los equipos fijos de esta disciplina (0068, docs/tipos-de-torneo.md §1) —
 * único lector de `discipline_teams` de toda la app (ronda de fix, M-3:
 * `db/matchday.ts` tenía su propia copia privada del mismo select, sólo con
 * otro orden y sin `id`; `pairingContextFor` ahora llama a ÉSTA y mapea al
 * `{a, b}` que necesita, en vez de mantener dos consultas contra la misma
 * tabla divergiendo en silencio en el próximo cambio).
 */
export async function teamsOf(supabase: Client, disciplineId: DisciplineId): Promise<FixedTeam[]> {
  const { data, error } = await supabase
    .from('discipline_teams')
    .select('id, entry_a, entry_b')
    .eq('discipline_id', disciplineId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw new EdgeError(`No se pudieron leer los equipos: ${error.message}`)
  return (data ?? []).map((row) => ({ id: row.id, entryA: row.entry_a, entryB: row.entry_b }))
}

/**
 * Arma un equipo fijo. Sin nombre (decisión del dueño, docs/tipos-de-torneo.md
 * §1.2: "por ahora Pedro y Juan") y sin exigir que el resto del plantel ya
 * esté emparejado — equipos parciales están permitidos, quien queda suelto
 * cae al sorteo normal.
 *
 * RPC, no `insert` directo (ronda de fix — BLOQUEA 1, review a ciegas). La
 * versión anterior hacía el chequeo de "quién ya tiene equipo" (`taken`,
 * armado leyendo `teamsOf`) y el `insert` en DOS viajes separados — medido,
 * 7/7 rondas, 100% reproducible: `createTeam(a,b)` y `createTeam(b,c)` en
 * paralelo para la MISMA disciplina resuelven LAS DOS, porque las dos leen
 * `taken = []` antes de que cualquiera inserte y ningún `unique` de
 * `0068_fixed_teams.sql` cruza `entry_a` de una fila con `entry_b` de otra
 * (`:56-58`). `b` terminaba en dos equipos, alcanzable por el mismo admin en
 * dos pestañas. `create_discipline_team` (`0079_create_discipline_team.sql`)
 * hace el mismo chequeo y el `insert` en una única transacción, serializada
 * con un `select ... for update` sobre la disciplina — ver esa migración
 * para las alternativas declarativas que se descartaron y por qué.
 *
 * Los códigos que un `insert` normal ya tira siguen traduciéndose ACÁ, no
 * en la función de base — mismo criterio que toda RPC de este repo
 * (`addSquadSeat`, `db/entries.ts:44-58`, es la excepción que SÍ pasa el
 * mensaje derecho porque la función sólo levanta texto propio; acá el
 * `insert` de adentro puede tirar constraints reales):
 *
 * - `discipline_teams_check` (23514, `entry_a <> entry_b`): la misma persona
 *   de los dos lados.
 * - `discipline_teams_discipline_id_entry_a_fkey` / `..._entry_b_fkey`
 *   (23503): alguien que no juega esta disciplina.
 * - `discipline_teams_discipline_id_season_id_fkey` / `..._pair_size_fkey`
 *   (23503 también, pero DISTINTO motivo — ronda de fix, LOW-2: antes
 *   compartía mensaje con el de arriba, y ese mensaje no lo nombra):
 *   `seasonId` no es el dueño real de `disciplineId` — mismo cruce que
 *   `removeFromDiscipline` (`db/discipline-entries.ts`, "ronda de fix 2 —
 *   BLOQUEA 1") ya cierra del otro lado, pero acá la RPC recibe los DOS por
 *   parámetro separados (`p_discipline`, `p_season`) sin que nada los
 *   ate entre sí antes del `insert` -- alcanzable con un POST directo a la
 *   RPC (`grant execute`, `0079`), no sólo en teoría.
 * - `discipline_teams_discipline_id_entry_a_key` / `..._entry_b_key`
 *   (23505): con el `for update` serializando toda alta de esta disciplina,
 *   debería ser inalcanzable en la práctica — se deja el `if` de todos
 *   modos, cinturón y tirantes, mismo motivo que `addToDiscipline`
 *   (`db/discipline-entries.ts`) traduce su propio 23505 pese a tener RLS.
 *
 * Todo lo demás — "Esta disciplina no es de equipos fijos.", "Alguien de los
 * dos ya tiene equipo en esta disciplina." bajo el lock, "Sólo quien
 * organiza puede armar equipos." — ya sale en castellano del propio `raise
 * exception` de la función, así que pasa derecho (mismo criterio que
 * `addSquadSeat`, `db/entries.ts:54-58`: prefijarlo daría dos oraciones
 * peleadas).
 */
export async function createTeam(
  supabase: Client,
  disciplineId: DisciplineId,
  seasonId: string,
  entryA: string,
  entryB: string,
): Promise<void> {
  const { error } = await supabase.rpc('create_discipline_team', {
    p_discipline: disciplineId,
    p_season: seasonId,
    p_entry_a: entryA,
    p_entry_b: entryB,
  })
  if (error === null) return

  if (error.code === '23514') {
    throw new EdgeError('Un equipo no puede ser la misma persona dos veces.')
  }
  if (error.code === '23505') {
    throw new EdgeError('Alguien de los dos ya tiene equipo en esta disciplina.')
  }
  if (error.code === '23503') {
    if (
      error.message.includes('discipline_teams_discipline_id_entry_a_fkey') ||
      error.message.includes('discipline_teams_discipline_id_entry_b_fkey')
    ) {
      throw new EdgeError('Los dos tienen que jugar esta disciplina para poder armar un equipo.')
    }
    throw new EdgeError('La disciplina o la temporada no son válidas.')
  }
  throw new EdgeError(error.message)
}

/**
 * Deshace un equipo. Sin guarda de "ya jugó" a propósito: a diferencia de
 * sacar a alguien de la disciplina entera (`removeFromDiscipline`), esto no
 * borra ni `pairs` ni `discipline_entries` — el equipo es sólo la ETIQUETA de
 * que dos juegan juntos (`discipline_teams`), no borra nada de lo que ya se
 * jugó. Deshacerlo a mitad de temporada sólo cambia cómo se arma la PRÓXIMA
 * fecha (`pairingContextFor`, `db/matchday.ts:199-201`), nunca las que ya pasaron.
 *
 * `count: 'exact'`, mismo motivo que `removeFromDiscipline`
 * (`db/discipline-entries.ts`) y `db/entries.ts`: un delete que no toca
 * ninguna fila no es un error en PostgREST, y la única guarda real es RLS
 * (`discipline_teams_write`, `is_season_admin`, `0068_fixed_teams.sql:85-87`).
 */
export async function deleteTeam(supabase: Client, teamId: string): Promise<void> {
  const { error, count } = await supabase.from('discipline_teams').delete({ count: 'exact' }).eq('id', teamId)
  if (error) throw new EdgeError(`No se pudo deshacer el equipo: ${error.message}`)
  if (count === 0) {
    throw new EdgeError('No se pudo deshacer el equipo: sólo puede hacerlo quien organiza.')
  }
}
