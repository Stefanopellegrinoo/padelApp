import type { Client } from './client'
import { EdgeError } from './errors'
import { friendshipWith, historyWith, type FriendshipStatus } from './friends'
import { resumenAmigo, type AmigoInicio } from './inicio'

/**
 * El perfil de un jugador (odd/tasks/amigos-faciles.md, T9, S9): `/perfil/<id>`
 * y `/perfil`, el tuyo. Quién se ve lo decide la base (`player_profile`,
 * 0127): las mismas reglas que el nombre (`player_display_names`, 0103) o que
 * se lo pueda encontrar por el buscador. Acá se le suma lo que ya existe: la
 * amistad (`friendshipWith`), los torneos que comparten y, si son amigos, el
 * cara a cara (`historyWith` + `resumenAmigo`, el mismo conteo de Inicio).
 */

/** Un torneo que compartimos: se muestra con su deporte, sin fechas (S11). */
export interface TorneoCompartido {
  seasonId: string
  name: string
  /** Los `kind` de sus disciplinas, sin repetir, en el orden del torneo. */
  sports: string[]
}

export interface Perfil {
  playerId: string
  displayName: string
  /** `null` si todavía no eligió su @usuario. */
  username: string | null
  /** `false` si borró su cuenta (0108): queda su nombre, sin amistad posible. */
  hasAccount: boolean
  /** Es el tuyo: la página manda a `/perfil`. Sin amistad, torneos ni cara a cara. */
  esVos: boolean
  /** `null` si es el tuyo o si ya no tiene cuenta: no hay control de amistad. */
  amistad: FriendshipStatus | null
  /** El más nuevo primero, como en las sugerencias y los pedidos. */
  torneos: TorneoCompartido[]
  /** Sólo entre amigos. */
  caraACara: AmigoInicio | null
}

interface TemporadaFila {
  id: string
  name: string
  created_at: string
}

interface DisciplinaFila {
  season_id: string
  kind: string
}

/**
 * De los asientos de los dos, los torneos donde estamos los dos, ordenados
 * como `enOrdenDeTorneo` (`db/friends.ts`): el más nuevo primero, después por
 * nombre y por id. Las disciplinas tienen que venir ya en el orden del torneo
 * (`position, created_at`, como `mySeasons`).
 */
export function torneosEnComun(
  mios: Iterable<string>,
  suyos: Iterable<string>,
  temporadas: readonly TemporadaFila[],
  disciplinas: readonly DisciplinaFila[],
): TorneoCompartido[] {
  const misIds = new Set(mios)
  const comunes = new Set([...suyos].filter((id) => misIds.has(id)))
  const deportes = new Map<string, string[]>()
  for (const disciplina of disciplinas) {
    const lista = deportes.get(disciplina.season_id) ?? []
    if (!lista.includes(disciplina.kind)) lista.push(disciplina.kind)
    deportes.set(disciplina.season_id, lista)
  }
  return temporadas
    .filter((temporada) => comunes.has(temporada.id))
    .sort(
      (a, b) =>
        Date.parse(b.created_at) - Date.parse(a.created_at) ||
        a.name.localeCompare(b.name, 'es') ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .map((temporada) => ({ seasonId: temporada.id, name: temporada.name, sports: deportes.get(temporada.id) ?? [] }))
}

/** Una lectura entera o un error: PostgREST corta en 1000 filas sin avisar (`max_rows`). */
function completas<T>(
  result: { data: T[] | null; error: { message: string } | null; count: number | null },
  que: string,
): T[] {
  if (result.error !== null) throw new EdgeError(`No se pudieron leer ${que}: ${result.error.message}`)
  const filas = result.data ?? []
  if (result.count !== null && filas.length < result.count) {
    throw new EdgeError(`No se pudieron leer todos ${que}. Recargá la pantalla.`)
  }
  return filas
}

/**
 * Los torneos que comparto con `playerId`. Cuatro lecturas, ninguna por
 * torneo: mis asientos y los suyos (en paralelo; `entries_read` ya acota a
 * las temporadas que veo), y de los compartidos, el nombre y las disciplinas
 * (en paralelo). Compartir es tener los dos un asiento, como en
 * `torneosCompartidosCon`: un torneo que administro sin jugar no cuenta.
 */
async function torneosConmigo(supabase: Client, me: string, playerId: string): Promise<TorneoCompartido[]> {
  const asientos = (player: string) =>
    supabase.from('entries').select('season_id', { count: 'exact' }).eq('player_id', player).order('id')
  const [mios, suyos] = await Promise.all([asientos(me), asientos(playerId)])
  const misIds = completas(mios, 'tus torneos').map((fila) => fila.season_id)
  const misSet = new Set(misIds)
  const comunes = [...new Set(completas(suyos, 'sus torneos').map((fila) => fila.season_id))].filter((id) =>
    misSet.has(id),
  )
  if (comunes.length === 0) return []

  const [temporadas, disciplinas] = await Promise.all([
    supabase.from('seasons').select('id, name, created_at', { count: 'exact' }).in('id', comunes),
    supabase
      .from('disciplines')
      .select('season_id, kind', { count: 'exact' })
      .in('season_id', comunes)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true }),
  ])
  return torneosEnComun(
    misIds,
    comunes,
    completas(temporadas, 'los torneos'),
    completas(disciplinas, 'los deportes de los torneos'),
  )
}

/**
 * El perfil de `playerId`, o `null` si no se puede ver (la base no lo
 * devuelve) o el id ni es un uuid: la página muestra "no encontrado" en los
 * dos casos, sin decir cuál.
 */
export async function perfilDe(supabase: Client, playerId: string): Promise<Perfil | null> {
  const [perfil, yo] = await Promise.all([
    supabase.rpc('player_profile', { p_player: playerId }),
    supabase.rpc('my_player_id'),
  ])
  if (perfil.error?.code === '22P02') return null
  if (perfil.error !== null) throw new EdgeError(`No se pudo leer el perfil: ${perfil.error.message}`)
  if (yo.error !== null) throw new EdgeError(`No se pudo identificar tu cuenta: ${yo.error.message}`)
  const fila = perfil.data?.[0]
  if (fila === undefined) return null

  const base = {
    playerId: fila.id,
    displayName: fila.display_name,
    // El tipo generado dice `string`: las columnas de una función salen sin nullability. Es null sin @usuario.
    username: (fila.username as string | null) ?? null,
    hasAccount: fila.has_account,
  }
  const me = yo.data
  if (me === null || me === fila.id) {
    return { ...base, esVos: me === fila.id, amistad: null, torneos: [], caraACara: null }
  }

  const [amistad, torneos] = await Promise.all([
    fila.has_account ? friendshipWith(supabase, fila.id) : Promise.resolve(null),
    torneosConmigo(supabase, me, fila.id),
  ])
  const caraACara =
    amistad?.kind === 'friends' ? resumenAmigo(base, await historyWith(supabase, fila.id)) : null
  return { ...base, esVos: false, amistad, torneos, caraACara }
}
