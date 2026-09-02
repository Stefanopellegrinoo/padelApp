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
 * El nombre de un autor de partido casual, o un `EdgeError` si `nombrePorId`
 * no lo trae. Review final de 2b, Minor 8: antes era `?? ''` -- pero
 * `nombrePorId` sale de `players`, con `players_read: using (true)` (lectura
 * abierta a cualquier id real, 0002_rls.sql) y la consulta que la llena ya
 * pasa por `assertComplete`, así que un id de `autorIds` sin nombre acá sólo
 * puede ser la vista y la tabla en desacuerdo entre sí -- mismo criterio que
 * `requireColumn` arriba, nunca un dato ausente de verdad. Dejar pasar `''`
 * mostraba "Cargó " sin nombre, una oración a medias en vez de un error
 * legible.
 */
function requireName(nombrePorId: Map<string, string>, playerId: string): string {
  const nombre = nombrePorId.get(playerId)
  if (nombre === undefined) throw new EdgeError(`No se pudo leer el nombre de ${playerId}.`)
  return nombre
}

/**
 * El guard de truncado de `historyWith`, UNA vez para sus siete consultas
 * en vez de catorce bloques casi idénticos (uno por error y uno por corte, por
 * consulta). `consulta` nombra CUÁL de las siete fue -- sin eso, un corte
 * real en `seasons` o `match_sets` decía sólo "el historial", indistinguible
 * de un corte en `matchdays`, en `match_participants`, en `disciplines` (el
 * deporte de la fila de torneo), o en las dos de la parte casual (`casuales`,
 * `autores`).
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
  /**
   * `disciplines.kind` (0015_disciplines.sql:15, CHECK) de
   * `matchdays.discipline_id`. Literal, no `DisciplineKind` de
   * `wizard-state.ts` -- mismo motivo que `PublicFormat.kind`/
   * `DisciplineHeader.kind` (`db/read.ts:157-159`): `db/` no importa de
   * `app/`. El cast vive en `historyWith` (abajo), respaldado por el CHECK;
   * la pantalla traduce con `DISCIPLINE_LABELS` sin castear de nuevo, porque
   * el literal ya coincide con `DisciplineKind`.
   *
   * Reemplaza a `matchdayKind` ('REGULAR'/'MASTERS', nada fuera de los tests
   * lo leía -- `rg matchdayKind` lo confirmó antes de sacarlo):
   * "deporte-en-la-fila" (cierre de 2b) es lo que la fila de torneo
   * necesitaba para dejar de ser la única del historial que calla qué se
   * jugó (§4.4). NO nullable: `discipline_id` es `not null` en `matchdays`
   * desde `0016_matchday_scope.sql:12` (0015 lo agregó nullable para el
   * backfill, pero ese estado no sobrevivió a la migración siguiente) --
   * mismo patrón que `CasualMatch.playedOn` más abajo.
   */
  sport: 'PADEL' | 'FIFA'
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
  /** Nombres, para que la pantalla los muestre (diseño §3.2). */
  createdBy: string
  updatedBy: string
  /**
   * Los ids de quien cargó/tocó último, además de los nombres de arriba --
   * review final de 2b, Important 2: `display_name` es texto libre
   * (`players`, sin `unique`), así que dos amigos distintos pueden compartir
   * nombre. `autoriaDe` (`app/amigos/historial.tsx`) compara ESTOS dos para
   * decidir si cargó y editó "la misma persona" -- comparar `createdBy ===
   * updatedBy` (los nombres) colapsaba ese caso en el peor momento posible:
   * el mismo en que §3.2 existe para avisar que alguien más tocó el partido.
   */
  createdById: string
  updatedById: string
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
 * `playedOn: null`, la columna es `not null` (0072).
 *
 * El desempate por `matchdayNumber` vive ACÁ, no en la pantalla -- fix round
 * 1 de Task 3 (plan-historial-entre-amigos-2b). Antes vivía en el sort del
 * componente (`app/amigos/historial.tsx`), y se borró ahí sin reponerlo acá:
 * dos fechas de torneo compartidas, las dos sin jugar, quedaban en el orden
 * arbitrario de `match_id` de la consulta de participantes en vez de por
 * número de fecha -- un orden que depende de un campo nullable y no lo dice
 * es un orden inestable (2a). Sólo aplica cuando LAS DOS son de torneo:
 * `CasualMatch` no tiene `matchdayNumber` (diseño §7, ninguna migración de
 * este plan se lo agrega).
 *
 * Fuera de ese caso -- misma fecha, un torneo y un casual -- el desempate
 * sigue por `kind` (torneo antes que casual) y por último por `matchId`.
 * Review final de 2b, Minor 3: ANTES esa rama devolvía `0` a secas, confiada
 * en que `Array.prototype.sort` es estable. La estabilidad sólo salva un
 * comparador CONSISTENTE, y éste no lo era -- con un torneo T1(n=1), un
 * torneo T2(n=5) y un casual C, los tres con la misma fecha: T1==C y C==T2
 * (el `0` de esta rama), pero T1 != T2 (si se comparan directo, gana T2 por
 * `matchdayNumber`). Esa relación es intransitiva, y con un comparador así
 * el resultado de `sort` depende de qué pares llega a comparar el algoritmo
 * -- que depende del ORDEN DE ENTRADA, no de los datos (`[T1,C,T2]` quedaba
 * sin tocar; `[T1,T2,C]` sí reordenaba a `[T2,T1,C]`, mismo trío). Ahora la
 * cadena de desempate es total -- todo par de partidos distintos cae en una
 * rama que no devuelve `0` -- así que el resultado ya no depende del orden
 * en que llegaron.
 */
export function porFechaDescendente(a: SharedMatch, b: SharedMatch): number {
  if (a.playedOn !== b.playedOn) {
    if (a.playedOn === null) return 1
    if (b.playedOn === null) return -1
    return a.playedOn < b.playedOn ? 1 : -1
  }
  if (a.kind !== b.kind) return a.kind === 'tournament' ? -1 : 1
  if (a.kind === 'tournament' && b.kind === 'tournament' && a.matchdayNumber !== b.matchdayNumber) {
    return b.matchdayNumber - a.matchdayNumber
  }
  return a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 : 0
}

/**
 * Todos los partidos entre el caller y `friendPlayerId`, de las DOS fuentes
 * que el diseño manda mezclar (docs/historial-entre-amigos.md §1.1, §4.4): los
 * de torneo y los casuales del sillón, con el detalle que la pantalla necesita
 * para listarlos en orden -- fecha, de dónde salió y resultado -- y no sólo
 * agregarlos en dos contadores. El resultado sale ya mezclado y ordenado por
 * fecha descendente entre las dos fuentes (`porFechaDescendente`, arriba).
 *
 * SIETE consultas, no una por partido: participantes → fechas → temporadas →
 * disciplinas → sets (torneo), casuales → autores (casual). `pairsAndMatchesOf`
 * (db/read.ts:985) se llama hoy adentro de un loop por fecha; acá eso sería un
 * N+1 que crece con cada temporada que jugaron juntos.
 *
 * Las CINCO de torneo NO son de tamaño acotado por una constante: cada una
 * trae de una sola vez TODO el historial compartido del par, así que su techo
 * real es cuánto jugaron juntos, no un número fijo. Ese techo también llega
 * antes que el de `assertComplete` (1000 filas) -- ver el `ponytail:` en la
 * consulta de sets, más abajo, con la medición. `disciplinas` comparte el
 * mismo argumento que `temporadas`, a la misma escala -- crece con cuántas
 * disciplinas jugaron juntos, como mucho una o dos por temporada compartida
 * (este branch ya admite más de una disciplina por temporada, `0018` bajó el
 * tripwire `disciplines_one_per_season`) -- mucho más lento que
 * `matchIds`/`matchdayIds`. Las dos de casual comparten el mismo argumento,
 * pero a otra escala: `casuales` no tiene ningún `.in()` (es un `.eq()` sobre
 * el par exacto), y `autores` crece a lo sumo dos ids por partido casual --
 * mucho más lento que `matchIds`/`matchdayIds`, que crecen con toda una
 * temporada de torneo por vez.
 *
 * Fechas, temporadas, disciplinas y autores van por IN + Map, no por un embed
 * (`.select('..., seasons(name)')`): ningún `db/*.ts` de este repo arma un
 * embed con hint de FK, por el mismo motivo que ya explica `friendsOf` más
 * abajo -- es más aparato que una IN y un Map para el mismo resultado.
 *
 * No hace falta chequear que sean amigos ni que el caller sea quien dice para
 * el lado de torneo: la vista es `security_invoker`, así que la RLS de
 * `matches` ya limita esto a las temporadas en las que el caller participa
 * (0071); `matchdays`, `seasons`, `disciplines` y `match_sets` tienen su
 * propia RLS acotada al participante (`matchdays_read`, `seasons_read`,
 * `disciplines_read`, `match_sets_read` -- las cuatro sobre
 * `is_participant(season_id)` o equivalente, 0002_rls.sql y
 * 0015_disciplines.sql), así que esas cuatro consultas heredan el mismo
 * límite sin pedirlo. Del lado casual, `casual_matches_read` (0072) acota
 * igual a `my_player_id() in (player_a, player_b)` -- tampoco hace falta
 * repetir el chequeo acá.
 *
 * Las siete pasan por `assertComplete` (arriba, con el porqué del guard). La
 * de participantes es la más delicada de las cinco de torneo: sin `.order()`
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
      .select('id, number, played_on, season_id, discipline_id', { count: 'exact' })
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

    // Consulta 4: el deporte de esas fechas -- "deporte-en-la-fila" (cierre de
    // 2b). `discipline_id` es NOT NULL en `matchdays` (0016_matchday_scope.sql:12),
    // así que no hace falta filtrar nulls antes del `.in()` -- a diferencia de
    // `match_participants` (una VISTA que erosiona el `not null` de sus
    // columnas base, ver `requireColumn` arriba), `matchdays` es una tabla y
    // Postgres SÍ conserva su `not null` en el tipo generado
    // (`db/database.types.ts`: `discipline_id: string`, sin `| null`).
    const disciplineIds = [...new Set(matchdayRows.map((row) => row.discipline_id))]
    const disciplinesResult = await supabase
      .from('disciplines')
      .select('id, kind', { count: 'exact' })
      .in('id', disciplineIds)
      .order('id', { ascending: true })
    const disciplineRows = assertComplete(disciplinesResult, 'disciplinas')
    // El cast está respaldado por el CHECK de `disciplines.kind`
    // (0015_disciplines.sql:15): mismo criterio que `toDisciplineHeader`
    // (`db/read.ts:270-285`), que castea en el mismo punto por el mismo motivo.
    const disciplineKindById = new Map(
      disciplineRows.map((row) => [row.id, row.kind as 'PADEL' | 'FIFA']),
    )

    // Consulta 5: los sets de los partidos compartidos. Sin sets, el partido
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
      // `matchdays_read`/`seasons_read`/`disciplines_read`/`match_sets_read`
      // filtran con el MISMO `is_participant(season)` (o equivalente) que las
      // tablas base de `match_participants` (`supabase/migrations/
      // 0002_rls.sql:146,169,219`, `0015_disciplines.sql:56-57`): una fecha
      // que salió de la vista ya pasó ese filtro, así que ninguna de las
      // cuatro puede esconderla acá. Que no aparezca sería la vista y las
      // tablas en desacuerdo entre sí, no un dato ausente -- mismo criterio que
      // `requireColumn` arriba en este archivo.
      if (matchday === undefined) {
        throw new EdgeError(`No se pudo leer la fecha del partido ${matchId}.`)
      }
      const seasonName = seasonNameById.get(matchday.season_id)
      if (seasonName === undefined) {
        throw new EdgeError(`No se pudo leer el torneo de la fecha ${matchdayId}.`)
      }
      const sport = disciplineKindById.get(matchday.discipline_id)
      if (sport === undefined) {
        throw new EdgeError(`No se pudo leer la disciplina de la fecha ${matchdayId}.`)
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
        sport,
        seasonName,
        outcome,
        score,
      }
    })
  }

  // Consulta 6: los partidos casuales entre el caller y el amigo -- TODOS los
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

  // Consulta 7: los nombres de quien cargó y quien tocó último cada partido
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
      createdBy: requireName(nombrePorId, row.created_by),
      updatedBy: requireName(nombrePorId, row.updated_by),
      createdById: row.created_by,
      updatedById: row.updated_by,
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

// ── el partido casual: cargar, editar, borrar (docs/historial-entre-amigos.md
// §3, §4) ───────────────────────────────────────────────────────────────────

export type CasualOutcome = 'won' | 'lost' | 'drew'

const CASUAL_DATE = /^\d{4}-\d{2}-\d{2}$/

// El regex de arriba sólo valida la FORMA (`\d{4}-\d{2}-\d{2}`) -- deja pasar
// "2026-02-31" y "2026-13-45", que Postgres rechaza recién al insertar con
// `date/time field value out of range`, un mensaje crudo de la base en la
// cara de quien carga el partido -- exactamente lo que este validador existe
// para evitar. `Date.UTC` normaliza los desbordes (el día 31 de un mes de 28
// días se corre al mes siguiente) en vez de rechazarlos, así que la vuelta
// atrás a texto (`toISOString().slice(0, 10)`) es lo que expone la
// normalización: si no matchea el string original, la fecha no era real.
// Verificado: `<input type="date">` nunca puede mandar esto (el picker
// nativo no ofrece un 31 de febrero) -- sólo llega por un POST armado a mano.
function esFechaReal(value: string): boolean {
  if (!CASUAL_DATE.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/**
 * Los siete campos del formulario de cargar/editar un partido casual, tal
 * cual los entrega `FormData.get()` -- todo texto, incluidos los números y el
 * marcador vacío (`''`, no `null`). La validación vive en `parseCasualInput`
 * de acá abajo, no en `app/amigos/actions.ts`: mismo reparto que el resto de
 * este archivo (`requestFriendship` valida "no podés agregarte a vos mismo"
 * acá, no en la action), para que un test pueda ejercitar el camino completo
 * sin pasar por `FormData` ni por Next.
 *
 * `outcome` es `string`, no `CasualOutcome`: un valor fuera de las tres
 * opciones (un formulario manipulado a mano, no el radio real) tiene que dar
 * un `EdgeError` legible en tiempo de ejecución, y este archivo no puede
 * exigírselo al tipo de un string que viene de un `<form>`.
 */
export interface CasualMatchInput {
  sport: string
  playedOn: string
  outcome: string
  scoreMine: string
  scoreTheirs: string
  teamMine: string
  teamTheirs: string
}

interface ParsedCasualInput {
  sport: string
  playedOn: string
  outcome: CasualOutcome
  scoreMine: number | null
  scoreTheirs: number | null
  teamMine: string | null
  teamTheirs: string | null
}

// `''` → `null`: mismo criterio que el CHECK de la base (`team_a is null or
// length(trim(team_a)) > 0`, 0072) -- "sin equipo" tiene una sola forma de
// decirse. Sin esto, el caso MÁS común del formulario (nadie carga equipo en
// pádel) manda `''` y el CHECK lo rechaza con un 23514 crudo.
function normalizeTeam(raw: string): string | null {
  const trimmed = raw.trim()
  return trimmed.length === 0 ? null : trimmed
}

/**
 * Valida en el borde (task-4-brief.md, "Server actions"): deporte no vacío,
 * fecha real, marcador con los dos números o ninguno. La tabla (0072) ya
 * exige lo mismo con sus CHECK, pero un `23514` crudo en la cara de quien
 * carga un partido no es manejo de errores -- éste es el único lugar que
 * traduce esas reglas a un mensaje para una persona, para `createCasualMatch`
 * y `updateCasualMatch` por igual.
 */
function parseCasualInput(input: CasualMatchInput): ParsedCasualInput {
  const sport = input.sport.trim()
  if (sport.length === 0) throw new EdgeError('Escribí qué deporte jugaron.')

  if (!esFechaReal(input.playedOn)) throw new EdgeError('Elegí una fecha real.')

  if (input.outcome !== 'won' && input.outcome !== 'lost' && input.outcome !== 'drew') {
    throw new EdgeError('Decinos quién ganó, o si empataron.')
  }

  const scoreMineRaw = input.scoreMine.trim()
  const scoreTheirsRaw = input.scoreTheirs.trim()
  if ((scoreMineRaw === '') !== (scoreTheirsRaw === '')) {
    throw new EdgeError('Cargá los dos números del marcador, o dejalos los dos vacíos.')
  }
  let scoreMine: number | null = null
  let scoreTheirs: number | null = null
  if (scoreMineRaw !== '') {
    scoreMine = Number(scoreMineRaw)
    scoreTheirs = Number(scoreTheirsRaw)
    // `Number.isFinite` dejaba pasar `3.5` hacia una columna `int` (0072) --
    // `Number.isInteger` es el mismo chequeo, sin ese agujero.
    if (!Number.isInteger(scoreMine) || !Number.isInteger(scoreTheirs)) {
      throw new EdgeError('El marcador tiene que ser un número entero.')
    }
  }

  return {
    sport,
    playedOn: input.playedOn,
    outcome: input.outcome,
    scoreMine,
    scoreTheirs,
    teamMine: normalizeTeam(input.teamMine),
    teamTheirs: normalizeTeam(input.teamTheirs),
  }
}

/**
 * Carga un partido casual con `friendPlayerId` (docs/historial-entre-amigos.md
 * §4). La identidad de quien carga se DERIVA de `my_player_id()`, nunca se
 * recibe -- mismo argumento que `historyWith` arriba: recibirla por parámetro
 * es el agujero que la RLS de `casual_matches_insert` (0072) ya cierra del
 * lado de la base, pero esta función no se apoya en eso para decidir quién es
 * el caller, lo deriva igual.
 *
 * `outcome`/`score`/`team` llegan en la MISMA convención "mío/suyo" que
 * `CasualMatch` en lectura (`historyWith`) -- así que lo que el caller ve al
 * volver a leer el partido es exactamente lo que acaba de escribir, sin una
 * segunda traducción. `winner` se calcula desde `outcome` relativo al CALLER,
 * no desde `player_a`/`player_b`: si se calculara al revés, "ganaste vos"
 * grabaría el ganador equivocado la mitad de las veces (cuando el caller
 * resulta ser `player_b`).
 *
 * Devuelve el id de la fila creada -- no lo necesita ningún camino de la
 * pantalla (la redirección post-carga vuelve a `historyWith`), pero sí los
 * tests: sin él, pinchar `updated_by`/`created_by` de la fila recién creada
 * exigiría un segundo query por un campo no-único.
 */
export async function createCasualMatch(
  supabase: Client,
  friendPlayerId: string,
  input: CasualMatchInput,
): Promise<string> {
  const { data: me, error: idError } = await supabase.rpc('my_player_id')
  if (idError !== null) throw new EdgeError(`No se pudo identificar tu cuenta: ${idError.message}`)
  if (me === null) throw new EdgeError('Entrá con tu cuenta para cargar un partido.')
  // Mismo guard que `requestFriendship` más arriba, y por el mismo motivo:
  // sin esto, `/amigos/{miPropioId}` -- una URL que cualquiera puede tipear,
  // y donde `page.tsx` monta este formulario igual -- falla contra la base
  // (`casual_ordered` o la falta de amistad con uno mismo) con un mensaje que
  // no describe lo que pasó.
  if (me === friendPlayerId) throw new EdgeError('No podés cargar un partido con vos mismo.')

  const parsed = parseCasualInput(input)
  // Mismo cálculo de orden canónico que `requestFriendship` más arriba --
  // `casual_ordered` (0072) exige `player_a < player_b`, y comparar los uuid
  // como texto da el mismo orden que Postgres.
  const [a, b] = me < friendPlayerId ? [me, friendPlayerId] : [friendPlayerId, me]
  const meEsA = me === a
  const winner = parsed.outcome === 'drew' ? null : parsed.outcome === 'won' ? me : friendPlayerId

  const { data, error } = await supabase
    .from('casual_matches')
    .insert({
      player_a: a,
      player_b: b,
      sport: parsed.sport,
      played_on: parsed.playedOn,
      winner,
      score_a: meEsA ? parsed.scoreMine : parsed.scoreTheirs,
      score_b: meEsA ? parsed.scoreTheirs : parsed.scoreMine,
      team_a: meEsA ? parsed.teamMine : parsed.teamTheirs,
      team_b: meEsA ? parsed.teamTheirs : parsed.teamMine,
      created_by: me,
      updated_by: me,
    })
    .select('id')
    .single()
  if (error !== null) {
    // 42501: la política de insert (0072) exige una amistad ACEPTADA entre
    // los dos (§4.5) -- el caso más probable acá no es un ataque, es que
    // todavía no se aceptó la solicitud.
    if (error.code === '42501') {
      throw new EdgeError('Para cargar un partido con esta persona, tienen que ser amigos aceptados.')
    }
    // 22P02: `friendPlayerId` no castea a uuid -- mismo caso que
    // `requestFriendship` más arriba, verificado igual acá (`friendPlayerId`
    // viaja en un input oculto, así que sólo llega por un POST armado a
    // mano, no por el flujo real). NO se traduce `23503` (uuid bien formado
    // sin jugador): verificado en vivo que un `friendPlayerId` inexistente
    // da 42501 primero, nunca 23503 -- no puede existir una amistad
    // aceptada con un jugador que no existe, así que esa rama de la política
    // de arriba ya lo frena antes de llegar al FK.
    if (error.code === '22P02') throw new EdgeError('Ese ID no es válido.')
    throw new EdgeError(`No se pudo cargar el partido: ${error.message}`)
  }
  if (data === null) throw new EdgeError('No se pudo cargar el partido: no llegó ninguna fila.')
  return data.id
}

/**
 * Edita un partido casual que YA existe. Cualquiera de los dos jugadores
 * puede (§3.1) -- no sólo quien lo cargó -- y quien edita queda asentado en
 * `updated_by` (§3.2), el riesgo entero de esta tarea.
 *
 * A diferencia de `createCasualMatch`, NO recibe `friendPlayerId`: en vez de
 * pedírselo al caller (que tendría que pasarlo de memoria, sin que la base lo
 * valide), lo LEE de la propia fila -- `player_a`/`player_b` están congelados
 * por el grant de columna (0072: no están en el `update (...)`), así que leer
 * esta fila y creer lo que dice nunca puede quedar desalineado con lo que el
 * UPDATE de abajo puede escribir. La misma lectura además hace de chequeo de
 * pertenencia: `casual_matches_read` (0072) ya acota a
 * `my_player_id() in (player_a, player_b)`, así que un tercero recibe cero
 * filas ACÁ, antes de intentar ningún UPDATE.
 *
 * Devuelve el `friendPlayerId` que dedujo -- lo necesita `editCasualMatch`
 * (`app/amigos/actions.ts`) para el redirect: usar el valor del `<form>` ahí
 * en vez de éste sería tener DOS fuentes para el mismo dato (una para
 * escribir, otra para redirigir), y las dos podrían divergir con un formulario
 * armado a mano -- consecuencia menor (redirect a la página equivocada
 * después de una escritura correcta) pero evitable con esto.
 */
export async function updateCasualMatch(
  supabase: Client,
  matchId: string,
  input: CasualMatchInput,
): Promise<string> {
  const { data: me, error: idError } = await supabase.rpc('my_player_id')
  if (idError !== null) throw new EdgeError(`No se pudo identificar tu cuenta: ${idError.message}`)
  if (me === null) throw new EdgeError('Entrá con tu cuenta para editar un partido.')

  const { data: fila, error: filaError } = await supabase
    .from('casual_matches')
    .select('player_a, player_b')
    .eq('id', matchId)
    .maybeSingle()
  // 22P02: `matchId` no castea a uuid -- llega en un input oculto, así que
  // sólo un POST armado a mano lo manda mal formado (verificado igual que en
  // `createCasualMatch`: mismo código, mismo mensaje).
  if (filaError !== null) {
    if (filaError.code === '22P02') throw new EdgeError('Ese ID no es válido.')
    throw new EdgeError(`No se pudo leer el partido: ${filaError.message}`)
  }
  if (fila === null) {
    throw new EdgeError('No se pudo editar: el partido no existe o no te corresponde.')
  }

  const parsed = parseCasualInput(input)
  const meEsA = fila.player_a === me
  const friendPlayerId = meEsA ? fila.player_b : fila.player_a
  const winner = parsed.outcome === 'drew' ? null : parsed.outcome === 'won' ? me : friendPlayerId

  // `count: 'exact'` para distinguir "no tocó ninguna fila" de un éxito
  // silencioso -- mismo registro que `acceptFriendship` más arriba. En la
  // práctica, con el `fila` de arriba ya filtrando a un no-miembro, esta
  // rama sólo se alcanza si el partido se borró ENTRE esa lectura y este
  // update (una carrera, no el caso normal) -- pero es la misma cobertura
  // barata que ya paga `acceptFriendship`, no una construida de más para
  // esta función.
  //
  // NO manda `updated_at`: la escribe el trigger de la base (0072), nunca el
  // cliente -- el tipo generado (`db/database.types.ts`) todavía la ofrece
  // como escribible porque `supabase gen types` no lee el `grant` por
  // columna, y mandarla acá daría un 42501 en tiempo de ejecución sin ningún
  // aviso de `tsc`.
  const { error, count } = await supabase
    .from('casual_matches')
    .update(
      {
        sport: parsed.sport,
        played_on: parsed.playedOn,
        winner,
        score_a: meEsA ? parsed.scoreMine : parsed.scoreTheirs,
        score_b: meEsA ? parsed.scoreTheirs : parsed.scoreMine,
        team_a: meEsA ? parsed.teamMine : parsed.teamTheirs,
        team_b: meEsA ? parsed.teamTheirs : parsed.teamMine,
        updated_by: me,
      },
      { count: 'exact' },
    )
    .eq('id', matchId)
  if (error !== null) throw new EdgeError(`No se pudo editar el partido: ${error.message}`)
  if (count === 0) {
    throw new EdgeError('No se pudo editar: el partido no existe o no te corresponde.')
  }
  return friendPlayerId
}

/**
 * Borra un partido casual. Cualquiera de los dos puede, en cualquier momento
 * (§3.3) -- "si tu amigo te borra los partidos que perdió, tenés un problema
 * de amigo, no de software".
 *
 * Devuelve el `friendPlayerId`, leído de la fila ANTES de borrarla -- mismo
 * argumento y misma forma que `updateCasualMatch` de arriba (leer primero,
 * escribir después): `removeCasualMatch` (`app/amigos/actions.ts`) lo
 * necesita para el redirect, y usar el valor del `<form>` en vez de éste es
 * la misma segunda fuente para el mismo dato que ya se sacó de editar (fix
 * round 1) -- review final de 2b, Minor 4, la repone acá. La lectura previa
 * hace además de chequeo de pertenencia, como en `updateCasualMatch`:
 * `casual_matches_read` (0072) ya acota a `my_player_id() in (player_a,
 * player_b)`, así que un tercero recibe `null` ACÁ, antes de intentar ningún
 * DELETE.
 */
export async function deleteCasualMatch(supabase: Client, matchId: string): Promise<string> {
  const { data: me, error: idError } = await supabase.rpc('my_player_id')
  if (idError !== null) throw new EdgeError(`No se pudo identificar tu cuenta: ${idError.message}`)
  if (me === null) throw new EdgeError('Entrá con tu cuenta para borrar un partido.')

  const { data: fila, error: filaError } = await supabase
    .from('casual_matches')
    .select('player_a, player_b')
    .eq('id', matchId)
    .maybeSingle()
  // 22P02: mismo caso que en `updateCasualMatch` -- `matchId` mal formado,
  // sólo alcanzable por un POST armado a mano.
  if (filaError !== null) {
    if (filaError.code === '22P02') throw new EdgeError('Ese ID no es válido.')
    throw new EdgeError(`No se pudo leer el partido: ${filaError.message}`)
  }
  if (fila === null) {
    throw new EdgeError('No se pudo borrar: el partido no existe o no te corresponde.')
  }
  const friendPlayerId = fila.player_a === me ? fila.player_b : fila.player_a

  const { error, count } = await supabase.from('casual_matches').delete({ count: 'exact' }).eq('id', matchId)
  if (error !== null) throw new EdgeError(`No se pudo borrar el partido: ${error.message}`)
  if (count === 0) {
    throw new EdgeError('No se pudo borrar: el partido no existe o no te corresponde.')
  }
  return friendPlayerId
}

/**
 * Los deportes de TODOS los partidos casuales que jugó el caller, para
 * sugerirlos en el `datalist` de "Cargar partido" (diseño §4.1) -- la
 * normalización la hace la PANTALLA, no un catálogo nuevo: sin esta
 * sugerencia, "Fifa" y "FIFA" parten el historial en dos sin que nadie lo
 * note.
 *
 * Dos cosas que el nombre de la función no dice, y que importa dejar
 * escritas:
 *
 * 1. **No es "lo que el caller ESCRIBIÓ"**, es "lo que aparece en un partido
 *    donde el caller jugó". El brief decía "los `sport` que ya CARGÓ quien
 *    escribe" -- pero un deporte que el AMIGO cargó, en un partido donde el
 *    caller también participa, sale igual acá. Es defendible (la consistencia
 *    de nombre entre partidos es justamente el problema que esto evita) y es
 *    la lectura más simple de la tabla, pero es una interpretación, no lo que
 *    decía el brief textualmente.
 * 2. Alcance: CUALQUIER amigo, no sólo `friendPlayerId` de la pantalla en la
 *    que está parado -- es lo que "ya usaste" quiere decir en la frase del
 *    diseño.
 *
 * ponytail: pasa TODAS las filas casuales del caller por `assertComplete`
 * (el guard de truncado, `db/friends.ts` arriba) antes de dedup+`sort` en JS
 * -- no hay `distinct` de PostgREST. El techo real es el mismo 1000 de
 * siempre (`PGRST_DB_MAX_ROWS`), heredado de `assertComplete`, no nuevo de
 * esta función. Pasado eso, la página del amigo entera revienta al pedir
 * `sportsUsedBy` en vez de degradar (sin sugerencias). Si un caller llega a
 * mil partidos casuales cargados: `select distinct sport` del lado de
 * Postgres, o cortar la consulta con un `.limit()`.
 *
 * Mismo `.or()` que ya usa este archivo en los tests (`friends.db.test.ts`)
 * para "amistades donde soy cualquiera de los dos lados" -- PostgREST no
 * tiene una forma de decir "esta columna O esta otra" sin él.
 */
export async function sportsUsedBy(supabase: Client): Promise<string[]> {
  const { data: me, error: idError } = await supabase.rpc('my_player_id')
  if (idError !== null) throw new EdgeError(`No se pudo identificar tu cuenta: ${idError.message}`)
  if (me === null) return []

  const result = await supabase
    .from('casual_matches')
    .select('sport', { count: 'exact' })
    .or(`player_a.eq.${me},player_b.eq.${me}`)
  const rows = assertComplete(result, 'deportes ya usados')
  return [...new Set(rows.map((row) => row.sport))].sort()
}
