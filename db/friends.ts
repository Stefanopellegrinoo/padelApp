import { EdgeError } from './errors'
import type { Client } from './client'

/**
 * Postgres genera todas las columnas de una VISTA como nullable, sin
 * importar el `not null` de las tablas base (medido acá con
 * `match_participants`, 0071). Un null real acá es la vista rota, no un dato
 * ausente -- se falla fuerte en vez de dejar pasar un `string | null` como
 * `string` con un `as`.
 */
function requireColumn<T>(value: T | null, column: string): T {
  if (value === null) throw new EdgeError(`match_participants trajo "${column}" en null.`)
  return value
}

export interface SharedMatch {
  matchId: string
  matchdayId: string
  /** `true` si jugaron del mismo lado; `false` si se enfrentaron. */
  together: boolean
}

/**
 * Todos los partidos de torneo entre el caller y `friendPlayerId`.
 *
 * UNA consulta, no una por fecha. `pairsAndMatchesOf` (db/read.ts:985) se
 * llama hoy adentro de un loop por fecha; acá eso sería un N+1 que crece con
 * cada temporada que jugaron juntos.
 *
 * No hace falta chequear que sean amigos ni que el caller sea quien dice: la
 * vista es `security_invoker`, así que la RLS de `matches` ya limita esto a
 * las temporadas en las que el caller participa (0071).
 */
export async function historyWith(
  supabase: Client,
  friendPlayerId: string,
): Promise<SharedMatch[]> {
  // La identidad del caller se DERIVA, no se recibe. Recibirla por parámetro
  // es el agujero que la vista evita: con dos ids libres, cualquiera pediría
  // el historial de dos terceros.
  const { data: me, error: idError } = await supabase.rpc('my_player_id')
  if (idError !== null) throw new EdgeError(`No se pudo identificar tu cuenta: ${idError.message}`)
  if (me === null) throw new EdgeError('Entrá con tu cuenta para ver el historial.')

  // UNA consulta. Trae las filas del caller y las del amigo, y el cruce se
  // hace acá: PostgREST no expresa un self-join, y hacer una consulta por
  // partido sería el N+1 que `pairsAndMatchesOf` (db/read.ts:985) ya tiene y
  // que acá crecería con cada temporada compartida.
  const { data, error } = await supabase
    .from('match_participants')
    .select('match_id, matchday_id, side, player_id')
    .in('player_id', [me, friendPlayerId])
  if (error !== null) throw new EdgeError(`No se pudo leer el historial: ${error.message}`)

  const porPartido = new Map<string, { matchdayId: string; mio?: string; suyo?: string }>()
  for (const fila of data ?? []) {
    // `match_participants` es una VISTA (0071): el generador de tipos no
    // conserva el `not null` de sus columnas base, así que las cuatro llegan
    // tipadas `string | null` aunque en los datos nunca lo estén -- la vista
    // filtra `player_id is not null` y el resto sale de columnas NOT NULL de
    // `matches`/`pairs`. Si alguna viniera null de verdad sería la vista
    // rota, no un dato ausente: se falla fuerte, no se descarta la fila.
    const matchId = requireColumn(fila.match_id, 'match_id')
    const matchdayId = requireColumn(fila.matchday_id, 'matchday_id')
    const side = requireColumn(fila.side, 'side')
    const playerId = requireColumn(fila.player_id, 'player_id')

    const entrada = porPartido.get(matchId) ?? { matchdayId }
    if (playerId === me) entrada.mio = side
    if (playerId === friendPlayerId) entrada.suyo = side
    porPartido.set(matchId, entrada)
  }

  // Sólo los partidos donde están LOS DOS. Un partido donde jugué yo y el
  // amigo no, o al revés, no es un partido entre nosotros.
  return [...porPartido.entries()]
    .filter(([, v]) => v.mio !== undefined && v.suyo !== undefined)
    .map(([matchId, v]) => ({
      matchId,
      matchdayId: v.matchdayId,
      together: v.mio === v.suyo,
    }))
}

// Un caso que este código maneja y conviene no "simplificar" después: con
// `friendPlayerId === me` todo partido saldría con `together: true`. No puede
// pasar —la tabla prohíbe la amistad con uno mismo (`friendships_ordered`)—
// pero la función es pública y no depende de esa tabla. Si alguien la llama
// así, devuelve todos tus partidos marcados como "juntos", que es una
// respuesta rara pero no una fuga.

/**
 * Pide amistad con `friendPlayerId`. Nace SIEMPRE pendiente
 * (`friendships_request`, 0070): la RLS ya lo exige, pero el error crudo de
 * la base ("new row violates row-level security policy") no es un mensaje
 * para una persona.
 *
 * El orden canónico del par (`player_a < player_b`) lo calcula esta función
 * antes de insertar. `friendships_ordered` (0070) lo exige con un CHECK, y
 * comparar los dos uuid como texto acá da el mismo orden que Postgres:
 * los dos vienen con el mismo formato (36 caracteres, guiones en las mismas
 * posiciones), así que la comparación posición a posición coincide con la
 * de sus bytes -- es el mismo criterio que ya usa `friends.db.test.ts`
 * (`uno.playerId < dos.playerId`) para las mismas filas.
 */
export async function requestFriendship(supabase: Client, friendPlayerId: string): Promise<void> {
  const { data: me, error: idError } = await supabase.rpc('my_player_id')
  if (idError !== null) throw new EdgeError(`No se pudo identificar tu cuenta: ${idError.message}`)
  if (me === null) throw new EdgeError('Entrá con tu cuenta para pedir una amistad.')
  if (me === friendPlayerId) {
    throw new EdgeError('No te podés agregar a vos mismo como amigo.')
  }

  const [playerA, playerB] = me < friendPlayerId ? [me, friendPlayerId] : [friendPlayerId, me]
  // Sin `count: 'exact'` acá: a diferencia de un UPDATE, un INSERT que viola
  // su `with check` no matchea 0 filas en silencio -- tira un error de
  // verdad (42501), que ya cae en la rama de abajo. El `count` que sí importa
  // es el de `acceptFriendship`, un UPDATE (ver ahí).
  const { error } = await supabase
    .from('friendships')
    .insert({ player_a: playerA, player_b: playerB, requested_by: me })
  if (error !== null) {
    if (error.code === '23505') {
      throw new EdgeError('Ya hay una amistad, o una solicitud, con esa persona.')
    }
    throw new EdgeError(`No se pudo enviar la solicitud: ${error.message}`)
  }
}

/**
 * Acepta una solicitud recibida. Sólo la contraparte puede: `friendships_accept`
 * (0070) lo exige con su `using`, y quien pidió (o un tercero) no matchea
 * ninguna fila -- un UPDATE que no toca ninguna fila NO es un error en
 * PostgREST, así que hace falta `count: 'exact'` para distinguirlo de un
 * éxito silencioso. Mismo registro que `updateDisciplineHasMasters`
 * (`db/discipline.ts:193-202`).
 */
export async function acceptFriendship(supabase: Client, friendshipId: string): Promise<void> {
  const { error, count } = await supabase
    .from('friendships')
    .update({ accepted_at: new Date().toISOString() }, { count: 'exact' })
    .eq('id', friendshipId)
  if (error !== null) throw new EdgeError(`No se pudo aceptar la amistad: ${error.message}`)
  if (count === 0) {
    throw new EdgeError('No se pudo aceptar: la solicitud no existe o no te corresponde aceptarla.')
  }
}

export interface Friend {
  friendshipId: string
  playerId: string
  displayName: string
  accepted: boolean
  theyAsked: boolean
}

/**
 * Los amigos del caller, aceptados y pendientes. `friendships_read` (0070) ya
 * acota la lectura a las filas donde el caller es `player_a` o `player_b`, así
 * que acá no hace falta filtrar por eso -- sólo resolver cuál de las dos
 * columnas es "el otro".
 *
 * `friendships` no tiene nombre de nadie (0070 sólo modela la amistad ya
 * resuelta entre dos cuentas, no el "amigo sin cuenta" de §2.1 del diseño,
 * que ninguna migración de este plan trae todavía) -- el nombre sale de
 * `players.display_name`, abierto a lectura (`players_read: using (true)`,
 * diseño §5.5). Segunda consulta y cruce en JS, mismo estilo que
 * `historyWith` arriba: PostgREST no arma un self-join sobre `player_a`/
 * `player_b`, y un embed con hint de FK por columna es más aparato para el
 * mismo resultado que una IN y un Map.
 */
export async function friendsOf(supabase: Client): Promise<Friend[]> {
  const { data: me, error: idError } = await supabase.rpc('my_player_id')
  if (idError !== null) throw new EdgeError(`No se pudo identificar tu cuenta: ${idError.message}`)
  if (me === null) throw new EdgeError('Entrá con tu cuenta para ver tus amigos.')

  const { data: filas, error } = await supabase
    .from('friendships')
    .select('id, player_a, player_b, requested_by, accepted_at')
  if (error !== null) throw new EdgeError(`No se pudieron leer tus amigos: ${error.message}`)

  const otroDe = (fila: { player_a: string; player_b: string }): string =>
    fila.player_a === me ? fila.player_b : fila.player_a

  const otros = (filas ?? []).map(otroDe)
  const nombrePor = new Map<string, string>()
  if (otros.length > 0) {
    const { data: jugadores, error: jugadoresError } = await supabase
      .from('players')
      .select('id, display_name')
      .in('id', otros)
    if (jugadoresError !== null) {
      throw new EdgeError(`No se pudieron leer tus amigos: ${jugadoresError.message}`)
    }
    for (const jugador of jugadores ?? []) nombrePor.set(jugador.id, jugador.display_name)
  }

  return (filas ?? []).map((fila) => {
    const playerId = otroDe(fila)
    return {
      friendshipId: fila.id,
      playerId,
      displayName: nombrePor.get(playerId) ?? '',
      accepted: fila.accepted_at !== null,
      theyAsked: fila.requested_by !== me,
    }
  })
}
