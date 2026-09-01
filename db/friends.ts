import { tallySets, type SetScore } from '@/core'
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
  /** `matchdays.played_on`. `null` si la fecha no lo tiene cargado. */
  playedOn: string | null
  /** El número de fecha, para ordenar cuando `playedOn` es null. */
  matchdayNumber: number
  /** `'REGULAR'` o `'MASTERS'`. */
  matchdayKind: string
  /** El nombre del torneo, para que la fila diga de dónde salió. */
  seasonName: string
  /**
   * Qué te pasó A VOS en ese partido. `null` cuando todavía no se cargó el
   * resultado -- una fecha abierta tiene partidos sin sets. `together` y
   * `outcome` conviven sin pisarse: de compañeros, es lo que le pasó a la
   * PAREJA de los dos; enfrentados, es lo que te pasó a VOS contra él.
   */
  outcome: 'won' | 'lost' | 'drew' | null
  /** Games tuyos y del otro lado, en el orden en que los mira quien consulta. */
  score: { mine: number; theirs: number } | null
}

/**
 * Todos los partidos de torneo entre el caller y `friendPlayerId`, con el
 * detalle que la pantalla necesita para listarlos en orden -- fecha, torneo
 * y resultado -- y no sólo agregarlos en dos contadores.
 *
 * CUATRO consultas de tamaño acotado, no una por partido:
 * participantes → fechas → temporadas → sets. `pairsAndMatchesOf`
 * (db/read.ts:985) se llama hoy adentro de un loop por fecha; acá eso sería
 * un N+1 que crece con cada temporada que jugaron juntos.
 *
 * Fechas y temporadas van por IN + Map, no por un embed
 * (`.select('..., seasons(name)')`): ningún `db/*.ts` de este repo arma un
 * embed con hint de FK, por el mismo motivo que ya explica `friendsOf` más
 * abajo -- es más aparato que una IN y un Map para el mismo resultado.
 *
 * No hace falta chequear que sean amigos ni que el caller sea quien dice: la
 * vista es `security_invoker`, así que la RLS de `matches` ya limita esto a
 * las temporadas en las que el caller participa (0071); `matchdays`,
 * `seasons` y `match_sets` tienen su propia RLS acotada al participante
 * (`matchdays_read`, `seasons_read`, `match_sets_read`, 0002_rls.sql), así
 * que las tres consultas nuevas heredan el mismo límite sin pedirlo.
 *
 * `count: 'exact'` y el guard de abajo, en LAS CUATRO consultas -- mismo
 * tripwire que `mySeasons` (`db/read.ts:341-374`): PostgREST corta cada
 * select en `PGRST_DB_MAX_ROWS` (1000, `supabase/config.toml`) y no avisa.
 * En la primera es peor que en `mySeasons` en dos sentidos: sin `.order()`
 * no había ningún criterio para decidir qué filas sobreviven el corte -- era
 * arbitrario, corrida a corrida -- y el filtro de abajo
 * (`v.mio !== undefined && v.suyo !== undefined`) exige LAS DOS filas de un
 * partido; perder una sola (la del caller o la del amigo) borra el partido
 * entero del historial en silencio. El resultado ya no se agrega sólo en
 * "Juntos N · En contra M" -- Task 3 lo lista fila por fila --, así que un
 * corte silencioso ahora también sería una fecha, un torneo o un resultado
 * mal, con toda la confianza de uno bien.
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

  // Consulta 1: participantes. Trae las filas del caller y las del amigo, y
  // el cruce se hace acá: PostgREST no expresa un self-join, y hacer una
  // consulta por partido sería el N+1 que `pairsAndMatchesOf` (db/read.ts:985)
  // ya tiene y que acá crecería con cada temporada compartida. El `.order()`
  // no elige qué partido "importa más" -- sólo hace que, SI hay corte, sea
  // el mismo corte en cada corrida, para que el guard de abajo sea
  // reproducible.
  const {
    data,
    error,
    count,
  } = await supabase
    .from('match_participants')
    .select('match_id, matchday_id, side, player_id', { count: 'exact' })
    .in('player_id', [me, friendPlayerId])
    .order('match_id', { ascending: true })
    .order('player_id', { ascending: true })
  if (error !== null) throw new EdgeError(`No se pudo leer el historial: ${error.message}`)
  // Falla RUIDOSO en vez de devolver un historial recortado: un error en
  // pantalla se ve y se recarga, un "Juntos 3" que en realidad son 5 no.
  if (count !== null && (data ?? []).length < count) {
    throw new EdgeError(
      `No se pudo leer el historial completo (${(data ?? []).length} de ${count}). Recargá la pantalla.`,
    )
  }

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
  const compartidos = [...porPartido.entries()]
    .filter(([, v]) => v.mio !== undefined && v.suyo !== undefined)
    .map(([matchId, v]) => ({
      matchId,
      matchdayId: v.matchdayId,
      // El `.filter()` de arriba ya garantiza que `mio` está definido; el
      // cast es sobre ESE hecho, no sobre un dato sin validar.
      mySide: v.mio as string,
      together: v.mio === v.suyo,
    }))
  if (compartidos.length === 0) return []

  // Consulta 2: las fechas de esos partidos, con su temporada y su número
  // -- `matchdayNumber` es lo único que ordena una fecha sin `played_on`
  // cargado (columna nullable, 0001_schema.sql).
  const matchdayIds = [...new Set(compartidos.map((c) => c.matchdayId))]
  const {
    data: matchdayRows,
    error: matchdaysError,
    count: matchdaysCount,
  } = await supabase
    .from('matchdays')
    .select('id, number, kind, played_on, season_id', { count: 'exact' })
    .in('id', matchdayIds)
    .order('id', { ascending: true })
  if (matchdaysError !== null) {
    throw new EdgeError(`No se pudo leer el historial: ${matchdaysError.message}`)
  }
  if (matchdaysCount !== null && (matchdayRows ?? []).length < matchdaysCount) {
    throw new EdgeError(
      `No se pudo leer el historial completo (${(matchdayRows ?? []).length} de ${matchdaysCount}). Recargá la pantalla.`,
    )
  }
  const matchdayById = new Map((matchdayRows ?? []).map((row) => [row.id, row]))

  // Consulta 3: las temporadas de esas fechas -- ídem `friendsOf` más abajo,
  // segunda consulta y cruce en JS en vez de un embed.
  const seasonIds = [...new Set((matchdayRows ?? []).map((row) => row.season_id))]
  const {
    data: seasonRows,
    error: seasonsError,
    count: seasonsCount,
  } = await supabase
    .from('seasons')
    .select('id, name', { count: 'exact' })
    .in('id', seasonIds)
    .order('id', { ascending: true })
  if (seasonsError !== null) throw new EdgeError(`No se pudo leer el historial: ${seasonsError.message}`)
  if (seasonsCount !== null && (seasonRows ?? []).length < seasonsCount) {
    throw new EdgeError(
      `No se pudo leer el historial completo (${(seasonRows ?? []).length} de ${seasonsCount}). Recargá la pantalla.`,
    )
  }
  const seasonNameById = new Map((seasonRows ?? []).map((row) => [row.id, row.name]))

  // Consulta 4: los sets de los partidos compartidos. Sin sets, el partido
  // es una fecha abierta todavía sin resultado -- `outcome`/`score` quedan
  // en null, no en un 0-0 inventado.
  const matchIds = compartidos.map((c) => c.matchId)
  const {
    data: setRows,
    error: setsError,
    count: setsCount,
  } = await supabase
    .from('match_sets')
    .select('match_id, games_a, games_b', { count: 'exact' })
    .in('match_id', matchIds)
    .order('match_id', { ascending: true })
    .order('set_number', { ascending: true })
  if (setsError !== null) throw new EdgeError(`No se pudo leer el historial: ${setsError.message}`)
  if (setsCount !== null && (setRows ?? []).length < setsCount) {
    throw new EdgeError(
      `No se pudo leer el historial completo (${(setRows ?? []).length} de ${setsCount}). Recargá la pantalla.`,
    )
  }
  const setsByMatch = new Map<string, SetScore[]>()
  for (const row of setRows ?? []) {
    const set = { gamesA: row.games_a, gamesB: row.games_b }
    const bucket = setsByMatch.get(row.match_id)
    if (bucket === undefined) setsByMatch.set(row.match_id, [set])
    else bucket.push(set)
  }

  return compartidos.map(({ matchId, matchdayId, mySide, together }) => {
    const matchday = matchdayById.get(matchdayId)
    // Las tres consultas de arriba ya vinieron completas (los guards de
    // arriba lo garantizan): que una fecha de `compartidos` no aparezca acá
    // sería la vista o las tablas en desacuerdo entre sí, no un dato
    // ausente -- mismo criterio que `requireColumn` arriba en este archivo.
    if (matchday === undefined) {
      throw new EdgeError(`No se pudo leer la fecha del partido ${matchId}.`)
    }
    const seasonName = seasonNameById.get(matchday.season_id)
    if (seasonName === undefined) {
      throw new EdgeError(`No se pudo leer el torneo de la fecha ${matchdayId}.`)
    }

    const sets = setsByMatch.get(matchId) ?? []
    let outcome: SharedMatch['outcome'] = null
    let score: SharedMatch['score'] = null
    if (sets.length > 0) {
      // `tallySets` (core/standings.ts): la ÚNICA definición de quién ganó
      // un set y, con eso, un partido -- no se recalcula acá.
      const { setsA, setsB, gamesA, gamesB } = tallySets(sets)
      const mine = mySide === 'A' ? gamesA : gamesB
      const theirs = mySide === 'A' ? gamesB : gamesA
      score = { mine, theirs }
      const misSets = mySide === 'A' ? setsA : setsB
      const susSets = mySide === 'A' ? setsB : setsA
      outcome = misSets > susSets ? 'won' : misSets < susSets ? 'lost' : 'drew'
    }

    return {
      matchId,
      matchdayId,
      together,
      playedOn: matchday.played_on,
      matchdayNumber: matchday.number,
      matchdayKind: matchday.kind,
      seasonName,
      outcome,
      score,
    }
  })
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
    // 23503: uuid bien formado que no referencia ningún `players.id` -- el
    // camino más probable acá no es un ataque, es un ID mal copiado o
    // truncado, la única escritura que este feature tiene. Sin esta rama el
    // mensaje trae crudo el nombre del constraint (`friendships_player_a_fkey`
    // o `_player_b_fkey`, según el orden), que no dice nada a quien lo lee.
    if (error.code === '23503') {
      throw new EdgeError('No existe ningún jugador con ese ID.')
    }
    // 22P02: ni siquiera castea a uuid -- un typo, no un id truncado. Postgres
    // lo rechaza antes de tocar la tabla, así que ni el 23503 de arriba llega
    // a evaluarse.
    if (error.code === '22P02') {
      throw new EdgeError('Ese ID no es válido.')
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
