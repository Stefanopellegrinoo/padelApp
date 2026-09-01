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

/**
 * El guard de truncado de `historyWith`, UNA vez para sus seis consultas
 * en vez de doce bloques casi idénticos (uno por error y uno por corte, por
 * consulta). `consulta` nombra CUÁL de las seis fue -- sin eso, un corte
 * real en `seasons` o `match_sets` decía sólo "el historial", indistinguible
 * de un corte en `matchdays`, en `match_participants`, o en las dos nuevas de
 * la parte casual (`casuales`, `autores`).
 *
 * `count: 'exact'` y este guard son el mismo tripwire que `mySeasons`
 * (`db/read.ts:341-374`): PostgREST corta cada select en `PGRST_DB_MAX_ROWS`
 * (1000, `supabase/config.toml`) y no avisa -- un corte silencioso acá sería
 * una fecha, un torneo o un resultado mal, con toda la confianza de uno bien.
 */
function assertComplete<T>(
  result: { data: T[] | null; error: { message: string } | null; count: number | null },
  consulta: string,
): T[] {
  if (result.error !== null) {
    throw new EdgeError(`No se pudo leer el historial (${consulta}): ${result.error.message}`)
  }
  const filas = result.data ?? []
  if (result.count !== null && filas.length < result.count) {
    throw new EdgeError(
      `No se pudo leer el historial completo de ${consulta} (${filas.length} de ${result.count}). Recargá la pantalla.`,
    )
  }
  return filas
}

export interface TournamentMatch {
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

export interface CasualMatch {
  matchId: string
  /** `casual_matches.played_on` -- `not null` en la tabla (0072): a diferencia
   * del torneo, un casual nunca sale sin fecha. */
  playedOn: string
  sport: string
  /**
   * Qué te pasó A VOS. `casual_matches.winner` no se deduce del marcador
   * (diseño §4.2/§4.3): `null` en la fila es empate, no "sin resultado
   * todavía" -- un casual siempre se carga con su resultado puesto.
   */
  outcome: 'won' | 'lost' | 'drew'
  score: { mine: number; theirs: number } | null
  /** Con qué equipo jugó cada uno ("Boca", "Real Madrid"). `null` si no se cargó. */
  teams: { mine: string | null; theirs: string | null }
  /** Nombres, no ids: la pantalla los muestra (diseño §3.2). */
  createdBy: string
  updatedBy: string
}

/**
 * Un partido compartido, de cualquiera de las dos fuentes que `historyWith`
 * mezcla. `together` sólo existe en el de torneo a propósito: un casual son
 * SIEMPRE dos personas enfrentadas (diseño §7) -- un `together: false` fijo
 * ahí sería un campo que nunca cambia de valor, ruido que alguien después lee
 * como si dijera algo.
 */
export type SharedMatch =
  | ({ kind: 'tournament' } & TournamentMatch)
  | ({ kind: 'casual' } & CasualMatch)

/**
 * Orden final de `historyWith`: fecha descendente ENTRE las dos fuentes, no
 * cada una ordenada por su lado. Un torneo sin jugar todavía (`playedOn:
 * null`, fecha abierta) queda al final -- un casual nunca llega con
 * `playedOn: null`, la columna es `not null` (0072). No desempata con
 * `matchdayNumber` como sí hace la pantalla (`compararDescendente`,
 * `app/amigos/historial.tsx`): ese desempate sólo tiene sentido DENTRO del
 * torneo, y una vez mezcladas las dos fuentes ya no hay un `matchdayNumber`
 * común a las dos con qué desempatar. Una MISMA fecha exacta entre las dos
 * fuentes devuelve `0`: `Array.prototype.sort` es estable, así que quedan en
 * el orden en que ya venían concatenadas más abajo (torneo antes que
 * casual) -- determinista, pero no es un desempate elegido a propósito.
 */
function porFechaDescendente(a: SharedMatch, b: SharedMatch): number {
  if (a.playedOn === b.playedOn) return 0
  if (a.playedOn === null) return 1
  if (b.playedOn === null) return -1
  return a.playedOn < b.playedOn ? 1 : -1
}

/**
 * Todos los partidos entre el caller y `friendPlayerId`, de las DOS fuentes
 * que el diseño manda mezclar (docs/historial-entre-amigos.md §1.1, §4.4): los
 * de torneo y los casuales del sillón, con el detalle que la pantalla necesita
 * para listarlos en orden -- fecha, de dónde salió y resultado -- y no sólo
 * agregarlos en dos contadores. El resultado sale ya mezclado y ordenado por
 * fecha descendente entre las dos fuentes (`porFechaDescendente`, arriba).
 *
 * SEIS consultas, no una por partido: participantes → fechas → temporadas →
 * sets (torneo), casuales → autores (casual). `pairsAndMatchesOf`
 * (db/read.ts:985) se llama hoy adentro de un loop por fecha; acá eso sería un
 * N+1 que crece con cada temporada que jugaron juntos.
 *
 * Las cuatro de torneo NO son de tamaño acotado por una constante: cada una
 * trae de una sola vez TODO el historial compartido del par, así que su techo
 * real es cuánto jugaron juntos, no un número fijo. Ese techo también llega
 * antes que el de `assertComplete` (1000 filas) -- ver el `ponytail:` en la
 * consulta de sets, más abajo, con la medición. Las dos de casual comparten el
 * mismo argumento, pero a otra escala: `casuales` no tiene ningún `.in()` (es
 * un `.eq()` sobre el par exacto), y `autores` crece a lo sumo dos ids por
 * partido casual -- mucho más lento que `matchIds`/`matchdayIds`, que crecen
 * con toda una temporada de torneo por vez.
 *
 * Fechas, temporadas y autores van por IN + Map, no por un embed
 * (`.select('..., seasons(name)')`): ningún `db/*.ts` de este repo arma un
 * embed con hint de FK, por el mismo motivo que ya explica `friendsOf` más
 * abajo -- es más aparato que una IN y un Map para el mismo resultado.
 *
 * No hace falta chequear que sean amigos ni que el caller sea quien dice para
 * el lado de torneo: la vista es `security_invoker`, así que la RLS de
 * `matches` ya limita esto a las temporadas en las que el caller participa
 * (0071); `matchdays`, `seasons` y `match_sets` tienen su propia RLS acotada
 * al participante (`matchdays_read`, `seasons_read`, `match_sets_read`,
 * 0002_rls.sql), así que esas tres consultas heredan el mismo límite sin
 * pedirlo. Del lado casual, `casual_matches_read` (0072) acota igual a
 * `my_player_id() in (player_a, player_b)` -- tampoco hace falta repetir el
 * chequeo acá.
 *
 * Las seis pasan por `assertComplete` (arriba, con el porqué del guard). La
 * de participantes es la más delicada de las cuatro de torneo: sin `.order()`
 * no había ningún criterio para decidir qué filas sobreviven un corte -- era
 * arbitrario, corrida a corrida -- y el filtro de abajo
 * (`v.mio !== undefined && v.suyo !== undefined`) exige LAS DOS filas de un
 * partido; perder una sola (la del caller o la del amigo) borra el partido
 * entero del historial. El resultado ya no se agrega sólo en "Juntos N · En
 * contra M" -- Task 3 lo lista fila por fila --, así que un corte silencioso
 * ahora también sería una fecha, un torneo, un casual o un resultado mal, con
 * toda la confianza de uno bien.
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
  const participantesResult = await supabase
    .from('match_participants')
    .select('match_id, matchday_id, side, player_id', { count: 'exact' })
    .in('player_id', [me, friendPlayerId])
    .order('match_id', { ascending: true })
    .order('player_id', { ascending: true })
  const participantes = assertComplete(participantesResult, 'participantes')

  const porPartido = new Map<string, { matchdayId: string; mio?: string; suyo?: string }>()
  for (const fila of participantes) {
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

  // A diferencia de la versión anterior, acá NO hay `return []` temprano: un
  // par sin ningún partido de torneo compartido puede tener igual partidos
  // casuales (son dos fuentes independientes), así que cortar acá borraría
  // esos del historial. Sólo se saltean las tres consultas de abajo, que no
  // tendrían nada que traer.
  let torneo: SharedMatch[] = []
  if (compartidos.length > 0) {
    // Consulta 2: las fechas de esos partidos, con su temporada y su número
    // -- `matchdayNumber` es lo único que ordena una fecha sin `played_on`
    // cargado (columna nullable, 0001_schema.sql).
    const matchdayIds = [...new Set(compartidos.map((c) => c.matchdayId))]
    const matchdaysResult = await supabase
      .from('matchdays')
      .select('id, number, kind, played_on, season_id', { count: 'exact' })
      .in('id', matchdayIds)
      .order('id', { ascending: true })
    const matchdayRows = assertComplete(matchdaysResult, 'fechas')
    const matchdayById = new Map(matchdayRows.map((row) => [row.id, row]))

    // Consulta 3: las temporadas de esas fechas -- ídem `friendsOf` más abajo,
    // segunda consulta y cruce en JS en vez de un embed.
    const seasonIds = [...new Set(matchdayRows.map((row) => row.season_id))]
    const seasonsResult = await supabase
      .from('seasons')
      .select('id, name', { count: 'exact' })
      .in('id', seasonIds)
      .order('id', { ascending: true })
    const seasonRows = assertComplete(seasonsResult, 'temporadas')
    const seasonNameById = new Map(seasonRows.map((row) => [row.id, row.name]))

    // Consulta 4: los sets de los partidos compartidos. Sin sets, el partido
    // es una fecha abierta todavía sin resultado -- `outcome`/`score` quedan
    // en null, no en un 0-0 inventado.
    //
    // ponytail: `matchIds` (y `matchdayIds` arriba) crecen un id por partido
    // compartido, sin techo -- medido contra este mismo proxy, un
    // `match_id=in.(N uuids)` da 200 hasta N=218 (~8 KB de query string) y 414
    // "URI too long" en N=219. A ~2 partidos compartidos por fecha y ~12
    // fechas por temporada, dos amigos en la misma liga cruzan los 219 en unas
    // 9 temporadas -- ese día el historial deja de cargar. Si alguna vez
    // importa: partir `matchIds`/`matchdayIds` en tandas de ~150 y unir los
    // resultados, o consultar `match_sets` por `matchday_id` en vez de por
    // `match_id`.
    const matchIds = compartidos.map((c) => c.matchId)
    const setsResult = await supabase
      .from('match_sets')
      .select('match_id, games_a, games_b', { count: 'exact' })
      .in('match_id', matchIds)
      .order('match_id', { ascending: true })
      .order('set_number', { ascending: true })
    const setRows = assertComplete(setsResult, 'sets')
    const setsByMatch = new Map<string, SetScore[]>()
    for (const row of setRows) {
      const set = { gamesA: row.games_a, gamesB: row.games_b }
      const bucket = setsByMatch.get(row.match_id)
      if (bucket === undefined) setsByMatch.set(row.match_id, [set])
      else bucket.push(set)
    }

    torneo = compartidos.map(({ matchId, matchdayId, mySide, together }) => {
      const matchday = matchdayById.get(matchdayId)
      // No es el guard de truncado el que hace esto inalcanzable -- ESE sólo
      // detecta que PostgREST cortó la respuesta, y una fila que RLS esconde
      // reduce `count` y `filas.length` EN LA MISMA MEDIDA, así que pasa el
      // guard igual de limpia. Lo que de verdad lo hace inalcanzable es que
      // `matchdays_read`/`seasons_read`/`match_sets_read` filtran con el MISMO
      // `is_participant(season)` que las tablas base de `match_participants`
      // (`supabase/migrations/0002_rls.sql:146,169,219`): una fecha que salió
      // de la vista ya pasó ese filtro, así que `matchdays_read` no puede
      // esconderla acá. Que no aparezca sería la vista y las tablas en
      // desacuerdo entre sí, no un dato ausente -- mismo criterio que
      // `requireColumn` arriba en este archivo.
      if (matchday === undefined) {
        throw new EdgeError(`No se pudo leer la fecha del partido ${matchId}.`)
      }
      const seasonName = seasonNameById.get(matchday.season_id)
      if (seasonName === undefined) {
        throw new EdgeError(`No se pudo leer el torneo de la fecha ${matchdayId}.`)
      }

      const sets = setsByMatch.get(matchId) ?? []
      let outcome: TournamentMatch['outcome'] = null
      let score: TournamentMatch['score'] = null
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
        kind: 'tournament',
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

  // Consulta 5: los partidos casuales entre el caller y el amigo -- TODOS los
  // que jugaron, no uno solo: `0072` no tiene ningún unique (ni índice ni
  // constraint) sobre `(player_a, player_b)`, sólo el CHECK `casual_ordered`
  // -- es un historial, muchas filas por par son el caso normal, no una
  // excepción. Lo que SÍ da `casual_ordered` es que cualquier par de uuids
  // tiene un ÚNICO arreglo posible de columnas (nunca las dos): por eso dos
  // `.eq()` alcanzan para traer las filas de ese par, sin un `.or()` sobre
  // las dos combinaciones -- mismo cálculo de orden canónico que ya hace
  // `requestFriendship` más abajo. El filtro queda de tamaño constante
  // (a diferencia de `matchIds`/`matchdayIds` arriba, esta consulta no
  // agrega ningún `.in()` nuevo) sin importar cuántas filas devuelva. No hace
  // falta chequear amistad ni membresía acá: `casual_matches_read` (0072) ya
  // acota la lectura a `my_player_id() in (player_a, player_b)`.
  const [ladoA, ladoB] = me < friendPlayerId ? [me, friendPlayerId] : [friendPlayerId, me]
  const casualesResult = await supabase
    .from('casual_matches')
    .select(
      'id, played_on, sport, winner, score_a, score_b, team_a, team_b, created_by, updated_by',
      { count: 'exact' },
    )
    .eq('player_a', ladoA)
    .eq('player_b', ladoB)
    .order('id', { ascending: true })
  const casualRows = assertComplete(casualesResult, 'casuales')
  const meEsA = me === ladoA

  // Consulta 6: los nombres de quien cargó y quien tocó último cada partido
  // casual -- MISMO camino que ya usa `friendsOf` más abajo para
  // `display_name` (una consulta a `players` + Map), no un segundo camino ni
  // un embed. Este `.in()` sí puede crecer, pero mucho más lento que
  // `matchIds` arriba: como mucho dos autores por partido casual, deduplicados
  // -- y un casual se carga de a uno, a mano, nunca en el volumen de un
  // torneo entero. Sólo corre si hay algo que nombrar.
  const autorIds = [...new Set(casualRows.flatMap((row) => [row.created_by, row.updated_by]))]
  const nombrePorId = new Map<string, string>()
  if (autorIds.length > 0) {
    const autoresResult = await supabase
      .from('players')
      .select('id, display_name', { count: 'exact' })
      .in('id', autorIds)
      .order('id', { ascending: true })
    const autores = assertComplete(autoresResult, 'autores')
    for (const autor of autores) nombrePorId.set(autor.id, autor.display_name)
  }

  const casuales: SharedMatch[] = casualRows.map((row) => {
    // `winner` es un dato PROPIO (diseño §4.2), no algo que se calcule de
    // lado A/B como el torneo -- por eso compara contra `me` directamente y
    // no contra `ladoA`/`ladoB`.
    const outcome: CasualMatch['outcome'] =
      row.winner === null ? 'drew' : row.winner === me ? 'won' : 'lost'
    // `casual_score_pair` (0072) garantiza que los dos números son null
    // juntos -- chequear uno alcanza.
    const score: CasualMatch['score'] =
      row.score_a === null || row.score_b === null
        ? null
        : meEsA
          ? { mine: row.score_a, theirs: row.score_b }
          : { mine: row.score_b, theirs: row.score_a }
    const teams: CasualMatch['teams'] = meEsA
      ? { mine: row.team_a, theirs: row.team_b }
      : { mine: row.team_b, theirs: row.team_a }

    return {
      kind: 'casual',
      matchId: row.id,
      playedOn: row.played_on,
      sport: row.sport,
      outcome,
      score,
      teams,
      createdBy: nombrePorId.get(row.created_by) ?? '',
      updatedBy: nombrePorId.get(row.updated_by) ?? '',
    }
  })

  return [...torneo, ...casuales].sort(porFechaDescendente)
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
