import {
  defaultConfig, disciplineProfile, isSportId, SPORT_IDS, sportFamily, sportLabel, sportOf, tallySets,
  type GoalsSport, type MatchFormat, type ResultSport, type SetScore, type SetsSport, type SportId, type TournamentSport,
} from '@/core'
import { EdgeError } from './errors'
import { matchError } from './validate'
import { playerNames } from './read'
import type { Client } from './client'
import type { Database } from './database.types'

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
 * El guard de truncado de `historyWith`, UNA vez para todas sus consultas en
 * vez de dos bloques casi idénticos por consulta (uno por error y uno por
 * corte). `consulta` nombra CUÁL fue -- sin eso, un corte real en `seasons` o
 * `match_sets` decía sólo "el historial", indistinguible de un corte en
 * `matchdays`, en `match_participants`, en `disciplines` (el deporte de la
 * fila de torneo), o en cualquiera de las cinco de la parte casual.
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
  sport: TournamentSport
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
  /**
   * El id tal cual vino de la fila. Sin CHECK de lista en `casual_matches.sport`
   * (0093) puede ser un deporte que el registro ya no tiene: quien lo muestra
   * usa `sportLabel`, que devuelve el id si no lo conoce.
   */
  sport: string
  /**
   * `true` si el amigo de la pantalla jugó de TU lado; `false` si en contra.
   * Un casual puede ser 2v2 (0072), así que como en el torneo los dos casos
   * existen.
   */
  together: boolean
  /** Tu lado, sin vos: nombre de cuenta o del invitado (`guest_name`). */
  partners: string[]
  /** El otro lado, mismos nombres. */
  rivals: string[]
  /**
   * Qué le pasó a TU lado. `casual_matches.winner_side` no se deduce del
   * marcador (diseño §4.2/§4.3): `null` en la fila es empate, no "sin
   * resultado todavía" -- un casual siempre se carga con su resultado puesto.
   */
  outcome: 'won' | 'lost' | 'drew'
  /** Goles (sólo FIFA), orientados por tu lado. `null` si no se cargaron. */
  score: { mine: number; theirs: number } | null
  /** Con qué equipo jugó cada lado ("Boca", "Real Madrid"). `null` si no se cargó. */
  teams: { mine: string | null; theirs: string | null }
  /** Los sets (sólo PADEL), en orden de `set_number`, orientados por tu lado. */
  sets: Array<{ mine: number; theirs: number }> | null
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
 * mezcla. Las dos tienen `together`: desde que el casual puede ser 2v2
 * (plan-amigos-deporte-y-2v2, 0072), el amigo de la pantalla también puede
 * haber jugado de tu lado en un casual.
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
 * Hasta DIEZ consultas, no una por partido: participantes → fechas →
 * temporadas → disciplinas → sets (torneo), y las cinco de `casualesEntre`
 * (casual, ver ahí). `pairsAndMatchesOf`
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
 * `matchIds`/`matchdayIds`. Las de casual crecen un id por partido casual
 * compartido -- cargado de a uno, a mano, nunca en el volumen de un torneo
 * entero.
 *
 * Fechas, temporadas, disciplinas y nombres van por IN + Map, no por un embed
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
 * límite sin pedirlo. Del lado casual, la RLS de las tres tablas (0090) acota
 * igual a los partidos que el caller jugó -- tampoco hace falta repetir el
 * chequeo acá.
 *
 * Todas pasan por `assertComplete` (arriba, con el porqué del guard). La
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
      disciplineRows.map((row) => [row.id, row.kind as TournamentSport]),
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

  const casuales = await casualesEntre(supabase, me, friendPlayerId)

  return [...torneo, ...casuales].sort(porFechaDescendente)
}

type CasualPlayerRow = { match_id: string; side: string; player_id: string | null; guest_name: string | null }

/** Nombre de cuenta o de invitado -- `casual_player_xor` (0072) garantiza uno de los dos. */
function nombreDeJugador(nombrePorId: Map<string, string>, fila: CasualPlayerRow): string {
  if (fila.player_id !== null) return requireName(nombrePorId, fila.player_id)
  if (fila.guest_name !== null) return fila.guest_name
  throw new EdgeError(`Un jugador del partido ${fila.match_id} no tiene cuenta ni nombre.`)
}

/**
 * La parte casual de `historyWith`: hasta cinco consultas, todas por
 * `assertComplete`. Sin chequeo de amistad ni de membresía: la RLS de las tres
 * tablas (0090) ya acota todo a partidos que el caller jugó.
 *
 * 6. `casual_match_players` donde juega el amigo -- con la RLS, eso ES "los
 *    partidos casuales donde jugamos los dos". Vacío: no hay casuales.
 * 7. `casual_matches` de esos ids.
 * 8. `casual_match_players` de esos ids: todos los jugadores, para saber de
 *    qué lado jugó cada uno y nombrar compañeros y rivales.
 * 9. `players.display_name` de los jugadores con cuenta y de los autores.
 * 10. `casual_match_sets` de los que fueron PADEL -- sólo si hay alguno.
 */
async function casualesEntre(supabase: Client, me: string, friendPlayerId: string): Promise<SharedMatch[]> {
  const delAmigoResult = await supabase
    .from('casual_match_players')
    .select('match_id', { count: 'exact' })
    .eq('player_id', friendPlayerId)
    .order('match_id', { ascending: true })
  const ids = assertComplete(delAmigoResult, 'partidos casuales del amigo').map((fila) => fila.match_id)
  if (ids.length === 0) return []

  const partidosResult = await supabase
    .from('casual_matches')
    .select(
      'id, played_on, sport, winner_side, score_a, score_b, team_a, team_b, created_by, updated_by',
      { count: 'exact' },
    )
    .in('id', ids)
    .order('id', { ascending: true })
  const partidos = assertComplete(partidosResult, 'casuales')

  // El `.order()` sólo hace que un corte, si lo hay, sea el mismo en cada
  // corrida; y que compañeros y rivales salgan siempre en el mismo orden.
  const jugadoresResult = await supabase
    .from('casual_match_players')
    .select('match_id, side, player_id, guest_name', { count: 'exact' })
    .in('match_id', ids)
    .order('match_id', { ascending: true })
    .order('side', { ascending: true })
    .order('player_id', { ascending: true })
    .order('guest_name', { ascending: true })
  const jugadores: CasualPlayerRow[] = assertComplete(jugadoresResult, 'jugadores casuales')
  const jugadoresPorPartido = new Map<string, CasualPlayerRow[]>()
  for (const fila of jugadores) {
    const bucket = jugadoresPorPartido.get(fila.match_id)
    if (bucket === undefined) jugadoresPorPartido.set(fila.match_id, [fila])
    else bucket.push(fila)
  }

  // S3 (security-hardening): los nombres salen de `player_display_names`
  // (security definer, 0103), no de `players` directo. Todos estos ids son el
  // propio usuario, su amigo o alguien de un partido casual compartido.
  const nombreIds = [
    ...new Set([
      ...jugadores.flatMap((fila) => (fila.player_id === null ? [] : [fila.player_id])),
      ...partidos.flatMap((row) => [row.created_by, row.updated_by]),
    ]),
  ]
  const nombrePorId = await playerNames(supabase, nombreIds)

  const setsPorPartido = new Map<string, Array<{ games_a: number; games_b: number }>>()
  const setsResult = await supabase
    .from('casual_match_sets')
    .select('match_id, games_a, games_b', { count: 'exact' })
    .in('match_id', ids)
    .order('match_id', { ascending: true })
    .order('set_number', { ascending: true })
  for (const set of assertComplete(setsResult, 'sets casuales')) {
    const bucket = setsPorPartido.get(set.match_id)
    if (bucket === undefined) setsPorPartido.set(set.match_id, [set])
    else bucket.push(set)
  }

  return partidos.map((row) => {
    const filas = jugadoresPorPartido.get(row.id) ?? []
    const miLado = filas.find((fila) => fila.player_id === me)?.side
    const suLado = filas.find((fila) => fila.player_id === friendPlayerId)?.side
    // Inalcanzable salvo inconsistencia: el partido salió de la consulta 6
    // (juega el amigo) filtrada por la RLS (juego yo), y la 8 trae TODOS sus
    // jugadores -- mismo criterio que `requireColumn`.
    if (miLado === undefined || suLado === undefined) {
      throw new EdgeError(`No se pudo leer de qué lado jugó cada uno en el partido ${row.id}.`)
    }
    const soyA = miLado === 'A'
    // Un id fuera del registro no tiene familia: la forma de los datos decide
    // (si tiene sets, se leen como sets).
    const family = sportFamily(row.sport) ?? (setsPorPartido.has(row.id) ? 'sets' : 'goals')
    const nombre = (fila: CasualPlayerRow) => nombreDeJugador(nombrePorId, fila)

    return {
      kind: 'casual',
      matchId: row.id,
      playedOn: row.played_on,
      sport: row.sport,
      together: suLado === miLado,
      partners: filas.filter((fila) => fila.side === miLado && fila.player_id !== me).map(nombre),
      rivals: filas.filter((fila) => fila.side !== miLado).map(nombre),
      // `winner_side` es un dato PROPIO (diseño §4.2), no algo que se calcule
      // de los goles o los sets.
      outcome: row.winner_side === null ? 'drew' : row.winner_side === miLado ? 'won' : 'lost',
      // `casual_score_pair` (0072) garantiza que los dos números son null
      // juntos -- chequear uno alcanza.
      score:
        row.score_a === null || row.score_b === null
          ? null
          : soyA
            ? { mine: row.score_a, theirs: row.score_b }
            : { mine: row.score_b, theirs: row.score_a },
      teams: soyA ? { mine: row.team_a, theirs: row.team_b } : { mine: row.team_b, theirs: row.team_a },
      sets:
        family === 'sets'
          ? (setsPorPartido.get(row.id) ?? []).map((set) =>
              soyA ? { mine: set.games_a, theirs: set.games_b } : { mine: set.games_b, theirs: set.games_a },
            )
          : null,
      createdBy: requireName(nombrePorId, row.created_by),
      updatedBy: requireName(nombrePorId, row.updated_by),
      createdById: row.created_by,
      updatedById: row.updated_by,
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

// ── la amistad con UNA persona, por el par (odd/tasks/amigos-faciles.md, S2) ──
// El perfil del torneo conoce a la persona, no la fila: todo va por
// `friendPlayerId`. El par se arma con `.eq` sobre las dos columnas, nunca con
// un `.or()` de texto -- el id viene de un formulario, y meterlo en un filtro
// armado a mano dejaría colar comas y paréntesis en la consulta.

/** En qué está la amistad entre el caller y otra persona. `requestedAt` es el `created_at` del pedido. */
export type FriendshipStatus =
  | { kind: 'none' }
  | { kind: 'sent'; friendshipId: string }
  | { kind: 'received'; friendshipId: string; requestedAt: string }
  | { kind: 'friends'; friendshipId: string }

function parCon(me: string, friendPlayerId: string): [string, string] {
  return me < friendPlayerId ? [me, friendPlayerId] : [friendPlayerId, me]
}

/**
 * Si `playerId` es alguien con quien tengo contexto (el de
 * `player_display_names`, 0103) y no tiene cuenta: la borró (0108) o es un
 * jugador tipeado que nadie reclamó. De un extraño `players_with_account`
 * (0117) no responde, así que para él da false y todo queda como antes.
 */
async function yaNoTieneCuenta(supabase: Client, playerId: string): Promise<boolean> {
  const [nombres, conCuenta] = await Promise.all([
    playerNames(supabase, [playerId]),
    playersWithAccount(supabase, [playerId]),
  ])
  return nombres.has(playerId) && !conCuenta.has(playerId)
}

/**
 * `friendshipWith` sin juntar los casos sin amistad posible: `addFriend`
 * necesita saber si es porque la persona ya no tiene cuenta. Sin fila entre
 * los dos es el único caso que lo pregunta: borrar la cuenta (0108) se lleva
 * las amistades y los pedidos.
 */
async function amistadCon(
  supabase: Client,
  friendPlayerId: string,
): Promise<FriendshipStatus | 'sin cuenta' | null> {
  const { data: me, error: idError } = await supabase.rpc('my_player_id')
  if (idError !== null) throw new EdgeError(`No se pudo identificar tu cuenta: ${idError.message}`)
  if (me === null || me === friendPlayerId) return null

  const [playerA, playerB] = parCon(me, friendPlayerId)
  const { data: fila, error } = await supabase
    .from('friendships')
    .select('id, requested_by, accepted_at, created_at')
    .eq('player_a', playerA)
    .eq('player_b', playerB)
    .maybeSingle()
  if (error?.code === '22P02') throw new EdgeError('Ese ID no es válido.')
  if (error !== null) throw new EdgeError(`No se pudo leer la amistad: ${error.message}`)

  if (fila === null) return (await yaNoTieneCuenta(supabase, friendPlayerId)) ? 'sin cuenta' : { kind: 'none' }
  if (fila.accepted_at !== null) return { kind: 'friends', friendshipId: fila.id }
  if (fila.requested_by === me) return { kind: 'sent', friendshipId: fila.id }
  return { kind: 'received', friendshipId: fila.id, requestedAt: fila.created_at }
}

/**
 * La amistad con `friendPlayerId`, vista desde el caller. `null` si no hay
 * sesión, si es uno mismo o si la persona ya no tiene cuenta (la borró,
 * 0108): ahí no hay amistad posible, y la pantalla no muestra nada. Un
 * tercero no ve filas ajenas (`friendships_read`, 0070), así que para él la
 * respuesta es `none`.
 */
export async function friendshipWith(supabase: Client, friendPlayerId: string): Promise<FriendshipStatus | null> {
  const estado = await amistadCon(supabase, friendPlayerId)
  return estado === 'sin cuenta' ? null : estado
}

/**
 * "Agregar" en el perfil: manda el pedido. Si el otro ya me había pedido,
 * acepta SU pedido en vez de crear otro (decisión del orquestador en
 * odd/tasks/amigos-faciles.md) -- en la pantalla no pasa, porque ahí va la
 * tarjeta, pero una pantalla vieja sí puede mandarlo. Con el pedido ya hecho,
 * o ya amigos, no toca nada. Devuelve en qué quedó. A quien ya no tiene
 * cuenta no le manda nada: el pedido no lo vería nadie.
 */
export async function addFriend(supabase: Client, friendPlayerId: string): Promise<'sent' | 'friends'> {
  const estado = await amistadCon(supabase, friendPlayerId)
  if (estado === 'sin cuenta') throw new EdgeError('Esa persona ya no tiene cuenta.')
  if (estado?.kind === 'received') {
    await acceptFriendship(supabase, estado.friendshipId)
    return 'friends'
  }
  if (estado?.kind === 'sent' || estado?.kind === 'friends') return estado.kind
  // `null` (uno mismo o sin sesión) también cae acá: `requestFriendship` ya
  // tiene el mensaje de cada caso.
  await requestFriendship(supabase, friendPlayerId)
  return 'sent'
}

/** "Aceptar" en la tarjeta del perfil: el pedido que me hizo `friendPlayerId`. Ya amigos no es un error. */
export async function acceptFriendRequestFrom(supabase: Client, friendPlayerId: string): Promise<void> {
  const estado = await friendshipWith(supabase, friendPlayerId)
  if (estado?.kind === 'friends') return
  if (estado?.kind !== 'received') throw new EdgeError('No se pudo aceptar: el pedido ya no está.')
  await acceptFriendship(supabase, estado.friendshipId)
}

/**
 * Borra un pedido PENDIENTE del par: el mío ("Deshacer") o el del otro (✕,
 * rechazar). `friendships_delete` (0070) deja borrar a cualquiera de los dos
 * en cualquier momento, así que acotar a pendiente y a quién lo pidió es
 * cosa de esta función: "Deshacer" un segundo tarde no puede borrar una
 * amistad que el otro acaba de aceptar. `count: 'exact'` porque un DELETE que
 * no toca ninguna fila no es un error en PostgREST.
 */
async function borrarPedido(supabase: Client, friendPlayerId: string, de: 'mio' | 'suyo'): Promise<void> {
  const verbo = de === 'mio' ? 'deshacer' : 'rechazar'
  const me = await myPlayerId(supabase, `${verbo} un pedido`)
  const [playerA, playerB] = parCon(me, friendPlayerId)
  const { error, count } = await supabase
    .from('friendships')
    .delete({ count: 'exact' })
    .eq('player_a', playerA)
    .eq('player_b', playerB)
    .eq('requested_by', de === 'mio' ? me : friendPlayerId)
    .is('accepted_at', null)
  if (error?.code === '22P02') throw new EdgeError('Ese ID no es válido.')
  if (error !== null) throw new EdgeError(`No se pudo ${verbo}: ${error.message}`)
  if (count === 0) throw new EdgeError(`No se pudo ${verbo}: el pedido ya no está pendiente.`)
}

/** "Deshacer" en el aviso: borra MI pedido pendiente a `friendPlayerId`. */
export async function cancelFriendRequest(supabase: Client, friendPlayerId: string): Promise<void> {
  await borrarPedido(supabase, friendPlayerId, 'mio')
}

/** ✕ en la tarjeta: rechaza (borra) el pedido pendiente que me hizo `friendPlayerId`. Sin aviso al otro. */
export async function rejectFriendRequest(supabase: Client, friendPlayerId: string): Promise<void> {
  await borrarPedido(supabase, friendPlayerId, 'suyo')
}

// ── el link de amistad (odd/tasks/amigos-faciles.md, S5; 0112-0116) ─────────────
// Todo por funciones `security definer` que sacan la identidad de `auth.uid()`:
// ninguna recibe el jugador de quien llama. Sus errores para una persona salen
// con `raise exception` (P0001) y viajan tal cual; cualquier otro es un fallo
// de verdad y lleva su contexto.

function errorDelLink(error: { code?: string; message: string }, queHacia: string): EdgeError {
  return new EdgeError(error.code === 'P0001' ? error.message : `No se pudo ${queHacia}: ${error.message}`)
}

/** Tu link de amistad (el token): lo crea la primera vez y después devuelve siempre el mismo. */
export async function myFriendInvite(supabase: Client): Promise<string> {
  const { data, error } = await supabase.rpc('my_friend_invite')
  if (error !== null) throw errorDelLink(error, 'leer tu link de amistad')
  return data
}

/** "Cambiar el link": uno nuevo, y el de ahora deja de andar. Las amistades hechas siguen. */
export async function rotateFriendInvite(supabase: Client): Promise<string> {
  const { data, error } = await supabase.rpc('rotate_friend_invite')
  if (error !== null) throw errorDelLink(error, 'cambiar el link')
  return data
}

/** Cómo estás con quien te pasó el link: vos mismo, ya amigos, un pedido pendiente (de cualquiera de los dos) o nada. */
export type FriendInviteRelation = 'self' | 'friends' | 'pending' | 'none'

export interface FriendInvitePreview {
  inviterId: string
  displayName: string
  relation: FriendInviteRelation
}

const RELACIONES: readonly FriendInviteRelation[] = ['self', 'friends', 'pending', 'none']

/**
 * Lo que muestra `/amigo/[token]`: quién invita y cómo estás con esa persona.
 * `null` si el link no existe o se cambió; la base no dice cuál de las dos.
 */
export async function friendInvitePreview(supabase: Client, token: string): Promise<FriendInvitePreview | null> {
  const { data, error } = await supabase.rpc('friend_invite_preview', { p_token: token })
  if (error !== null) throw errorDelLink(error, 'leer el link de amistad')
  const fila = data?.[0]
  if (fila === undefined) return null
  const relation = RELACIONES.find((r) => r === fila.relation)
  if (relation === undefined) throw new EdgeError(`El link de amistad trajo una relación desconocida: ${fila.relation}.`)
  return { inviterId: fila.inviter_id, displayName: fila.display_name, relation }
}

/**
 * "Sumarme como amigo": quedan amigos al toque, o acepta el pedido pendiente
 * que hubiera entre los dos. Ya amigos no es un error. Devuelve el jugador que
 * invitó, para ir a su historial.
 */
export async function acceptFriendInvite(supabase: Client, token: string): Promise<string> {
  const { data, error } = await supabase.rpc('accept_friend_invite', { p_token: token })
  if (error !== null) throw errorDelLink(error, 'sumarte como amigo')
  return data
}

export interface Friend {
  friendshipId: string
  playerId: string
  displayName: string
  accepted: boolean
  theyAsked: boolean
  /** Cuándo se pidió (`created_at` de la fila): el "hace 3 días" de "Pedidos enviados". */
  createdAt: string
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
    .select('id, player_a, player_b, requested_by, accepted_at, created_at')
  if (error !== null) throw new EdgeError(`No se pudieron leer tus amigos: ${error.message}`)

  const otroDe = (fila: { player_a: string; player_b: string }): string =>
    fila.player_a === me ? fila.player_b : fila.player_a

  const otros = (filas ?? []).map(otroDe)
  const nombrePor = await playerNames(supabase, otros)

  return (filas ?? []).map((fila) => {
    const playerId = otroDe(fila)
    return {
      friendshipId: fila.id,
      playerId,
      displayName: nombrePor.get(playerId) ?? '',
      accepted: fila.accepted_at !== null,
      theyAsked: fila.requested_by !== me,
      createdAt: fila.created_at,
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

// `''` → `null`: mismo criterio que el CHECK de la base (`team_a is null or
// length(trim(team_a)) > 0`, 0072) -- "sin equipo" tiene una sola forma de
// decirse. Sin esto, el caso MÁS común del formulario (nadie carga equipo en
// pádel) manda `''` y el CHECK lo rechaza con un 23514 crudo.
function normalizeTeam(raw: string): string | null {
  const trimmed = raw.trim()
  return trimmed.length === 0 ? null : trimmed
}

// El formato con el que se valida un marcador de goles/puntos: la expresión de siempre, con nombre.
const GOALS_FORMAT = disciplineProfile('FIFA', defaultConfig(4)).config.matchFormat
const TEAM_SPORTS = SPORT_IDS.filter((id) => {
  const s = sportOf(id)
  return s.family === 'goals' && s.teams
})
const TEAMS_ONLY = `Los equipos son sólo para ${TEAM_SPORTS.map(sportLabel).join(', ')}.`

/** Los campos del formulario del resultado casual, en crudo y en "mío/suyo". */
export interface CasualResultInput {
  sport: string
  playedOn: string
  outcome: string
  scoreMine: string
  scoreTheirs: string
  teamMine: string
  teamTheirs: string
  /** Sólo PADEL. */
  setsToWin: string
  gamesPerSet: string
  /** Sólo PADEL: JSON `[{mine, theirs}, ...]`. */
  sets: string
}

export interface CasualResult {
  sport: SportId
  playedOn: string
  outcome: 'won' | 'lost' | 'drew'
  scoreMine: number | null
  scoreTheirs: number | null
  teamMine: string | null
  teamTheirs: string | null
  /** Familia sets, sólo para validar: no se guarda. */
  format: MatchFormat | null
  sets: Array<{ mine: number; theirs: number }> | null
}

function intInRange(raw: string, range: { min: number; max: number }, what: string): number {
  const n = raw.trim() === '' ? NaN : Number(raw)
  if (!Number.isInteger(n) || n < range.min || n > range.max) {
    throw new EdgeError(`${what} tiene que ser un entero entre ${range.min} y ${range.max}.`)
  }
  return n
}

function parseSets(raw: string): Array<{ mine: number; theirs: number }> {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new EdgeError('Los sets no son válidos.')
  }
  const ok =
    Array.isArray(value) &&
    value.every(
      (s) =>
        typeof s === 'object' && s !== null && Number.isInteger((s as { mine?: unknown }).mine) &&
        Number.isInteger((s as { theirs?: unknown }).theirs),
    )
  if (!ok) throw new EdgeError('Los sets no son válidos.')
  return (value as Array<{ mine: number; theirs: number }>).map(({ mine, theirs }) => ({ mine, theirs }))
}

function parseSetsResult(sport: SetsSport, input: CasualResultInput) {
  if (
    input.scoreMine.trim() !== '' || input.scoreTheirs.trim() !== '' ||
    normalizeTeam(input.teamMine) !== null || normalizeTeam(input.teamTheirs) !== null
  ) {
    throw new EdgeError(TEAMS_ONLY)
  }
  const format: MatchFormat = {
    ...sport.format,
    setsToWin: intInRange(input.setsToWin, sport.setsToWin, 'Los sets por partido'),
    gamesPerSet: intInRange(input.gamesPerSet, sport.gamesPerSet, `Los ${sport.unit} por set`),
  }
  const sets = parseSets(input.sets)
  const games = sets.map((s) => ({ gamesA: s.mine, gamesB: s.theirs }))
  const problem = matchError(games, format, false)
  // Con el set real (odd/tasks/mas-deportes.md, S6), un partido cargado con la
  // regla de antes (un 6-5) se tiene que poder volver a guardar.
  const deAntes = format.ventaja === true ? matchError(games, { ...format, ventaja: false }, false) : problem
  if (problem !== null && deAntes !== null) throw new EdgeError(problem)
  const mine = sets.filter((s) => s.mine > s.theirs).length
  const theirs = sets.filter((s) => s.theirs > s.mine).length
  return { outcome: mine > theirs ? ('won' as const) : ('lost' as const), format, sets }
}

function parseGoalsResult(sport: GoalsSport, input: CasualResultInput) {
  const raw = input.outcome
  if (raw !== 'won' && raw !== 'lost' && !(raw === 'drew' && sport.allowsDraw)) {
    throw new EdgeError(sport.allowsDraw ? 'Decinos quién ganó, o si empataron.' : 'Decinos quién ganó.')
  }
  const outcome: CasualOutcome = raw
  const mineRaw = input.scoreMine.trim()
  const theirsRaw = input.scoreTheirs.trim()
  if ((mineRaw === '') !== (theirsRaw === '')) {
    throw new EdgeError('Cargá los dos números del marcador, o dejalos los dos vacíos.')
  }
  const teamMine = normalizeTeam(input.teamMine)
  const teamTheirs = normalizeTeam(input.teamTheirs)
  if (!sport.teams && (teamMine !== null || teamTheirs !== null)) throw new EdgeError(TEAMS_ONLY)
  const teams = { teamMine, teamTheirs }
  if (mineRaw === '') return { outcome, scoreMine: null, scoreTheirs: null, ...teams }
  const scoreMine = Number(mineRaw)
  const scoreTheirs = Number(theirsRaw)
  const problem = matchError([{ gamesA: scoreMine, gamesB: scoreTheirs }], GOALS_FORMAT, sport.allowsDraw)
  if (problem !== null) throw new EdgeError(problem)
  // Con marcador empatado cualquier `outcome` vale (penales).
  const derived = scoreMine > scoreTheirs ? 'won' : scoreMine < scoreTheirs ? 'lost' : null
  if (derived !== null && derived !== outcome) {
    throw new EdgeError('El marcador dice otra cosa sobre quién ganó.')
  }
  return { outcome, scoreMine, scoreTheirs, ...teams }
}

/**
 * Gana, pierde o tablas (ajedrez, odd/tasks/mas-deportes.md S3): sólo el
 * `outcome`. Las tablas se guardan como cualquier empate casual, con
 * `winner_side` null (`saveArgs`); sin marcador ni sets que guardar.
 */
function parseResultResult(sport: ResultSport, input: CasualResultInput) {
  const raw = input.outcome
  if (raw !== 'won' && raw !== 'lost' && raw !== 'drew') {
    throw new EdgeError('Decinos quién ganó, o si fueron tablas.')
  }
  if (normalizeTeam(input.teamMine) !== null || normalizeTeam(input.teamTheirs) !== null) throw new EdgeError(TEAMS_ONLY)
  const sets = input.sets.trim()
  if (input.scoreMine.trim() !== '' || input.scoreTheirs.trim() !== '' || (sets !== '' && sets !== '[]')) {
    throw new EdgeError(`El ${sport.label.toLowerCase()} se carga con gana, pierde o tablas: sin marcador.`)
  }
  const outcome: CasualOutcome = raw
  return { outcome }
}

/** Valida el resultado de un partido casual según la familia de marcador de su deporte. */
export function parseCasualResult(input: CasualResultInput): CasualResult {
  if (!isSportId(input.sport)) throw new EdgeError('Elegí un deporte de la lista.')
  if (!esFechaReal(input.playedOn)) throw new EdgeError('Elegí una fecha real.')
  const sport = sportOf(input.sport)
  switch (sport.family) {
    case 'sets': {
      const { outcome, format, sets } = parseSetsResult(sport, input)
      return {
        sport: input.sport, playedOn: input.playedOn, outcome,
        scoreMine: null, scoreTheirs: null, teamMine: null, teamTheirs: null, format, sets,
      }
    }
    case 'goals':
      return { sport: input.sport, playedOn: input.playedOn, format: null, sets: null, ...parseGoalsResult(sport, input) }
    case 'result':
      return {
        sport: input.sport, playedOn: input.playedOn, ...parseResultResult(sport, input),
        scoreMine: null, scoreTheirs: null, teamMine: null, teamTheirs: null, format: null, sets: null,
      }
    default: {
      const never: never = sport
      throw new Error(`familia desconocida: ${String(never)}`)
    }
  }
}

/** Un jugador más del partido, visto desde quien carga: de su lado o del otro. */
export interface CasualPlayerInput {
  side: 'mine' | 'theirs'
  /** Con cuenta: su `players.id`. Invitado: `null`. */
  playerId: string | null
  /** Invitado: sólo un nombre. Con cuenta: `null`. */
  guestName: string | null
}

type CasualPlayerArg = { side: 'A' | 'B'; player_id: string | null; guest_name: string | null }

/**
 * Los argumentos de `save_casual_match` (0092) con sus nulls de verdad.
 * `supabase gen types` tipa TODO argumento de una función como no-nulo
 * (`p_id: string`), aunque Postgres acepte `null` en cualquiera -- sin
 * defaults no hay forma de que el generador lo sepa. Este tipo dice lo cierto,
 * y el único cast (en `saveCasualMatch`, abajo) vive en un solo lugar.
 */
interface SaveCasualMatchArgs {
  p_id: string | null
  p_sport: SportId
  p_played_on: string
  p_winner_side: 'A' | 'B' | null
  p_score_a: number | null
  p_score_b: number | null
  p_team_a: string | null
  p_team_b: string | null
  p_players: CasualPlayerArg[]
  p_sets: Array<{ set_number: number; games_a: number; games_b: number }>
}

/**
 * Traduce un resultado en "mío/suyo" (`parseCasualResult`) a lados A/B, con
 * `miLado` como el lado de quien escribe. Goles, equipos, el ganador y los
 * games de CADA set se orientan juntos acá, en un solo lugar.
 */
function saveArgs(
  id: string | null,
  miLado: 'A' | 'B',
  result: CasualResult,
  players: CasualPlayerArg[],
): SaveCasualMatchArgs {
  const soyA = miLado === 'A'
  const otroLado = soyA ? 'B' : 'A'
  return {
    p_id: id,
    p_sport: result.sport,
    p_played_on: result.playedOn,
    p_winner_side: result.outcome === 'drew' ? null : result.outcome === 'won' ? miLado : otroLado,
    p_score_a: soyA ? result.scoreMine : result.scoreTheirs,
    p_score_b: soyA ? result.scoreTheirs : result.scoreMine,
    p_team_a: soyA ? result.teamMine : result.teamTheirs,
    p_team_b: soyA ? result.teamTheirs : result.teamMine,
    p_players: players,
    p_sets: (result.sets ?? []).map((set, i) => ({
      set_number: i + 1,
      games_a: soyA ? set.mine : set.theirs,
      games_b: soyA ? set.theirs : set.mine,
    })),
  }
}

type SaveCasualMatchGenerated = Database['public']['Functions']['save_casual_match']['Args']

function saveCasualMatch(supabase: Client, args: SaveCasualMatchArgs) {
  // El cast es sobre los nulls que el tipo generado no sabe expresar (ver
  // `SaveCasualMatchArgs`), no sobre datos sin validar.
  return supabase.rpc('save_casual_match', args as SaveCasualMatchGenerated)
}

async function myPlayerId(supabase: Client, paraQue: string): Promise<string> {
  const { data: me, error } = await supabase.rpc('my_player_id')
  if (error !== null) throw new EdgeError(`No se pudo identificar tu cuenta: ${error.message}`)
  if (me === null) throw new EdgeError(`Entrá con tu cuenta para ${paraQue}.`)
  return me
}

/**
 * Carga un partido casual (docs/historial-entre-amigos.md §4): 1v1 o 2v2, con
 * amigos o invitados. `players` son los OTROS jugadores -- quien carga se suma
 * acá, nunca lo manda la pantalla, y su identidad se DERIVA de
 * `my_player_id()`: recibirla por parámetro es el agujero que la RLS (0090)
 * cierra del lado de la base, pero esta función no se apoya en eso para
 * decidir quién es el caller.
 *
 * Quien carga es SIEMPRE el lado A -- ya no hay orden canónico entre los
 * jugadores --, así que "mío" es A y "suyo" es B sin traducción.
 *
 * Devuelve el id del partido -- lo usan los tests para releer la fila.
 */
export async function createCasualMatch(
  supabase: Client,
  players: CasualPlayerInput[],
  input: CasualResultInput,
): Promise<string> {
  const me = await myPlayerId(supabase, 'cargar un partido')
  // Sin esto, `/amigos/{miPropioId}` -- una URL que cualquiera puede tipear --
  // choca contra el `unique (match_id, player_id)` con un mensaje crudo.
  if (players.some((player) => player.playerId === me)) {
    throw new EdgeError('No podés cargar un partido con vos mismo.')
  }
  const filas: CasualPlayerArg[] = [
    { side: 'A', player_id: me, guest_name: null },
    ...players.map((player): CasualPlayerArg => {
      const guestName = player.playerId === null ? normalizeTeam(player.guestName ?? '') : null
      if (player.playerId === null && guestName === null) {
        throw new EdgeError('Cada invitado necesita un nombre.')
      }
      return { side: player.side === 'mine' ? 'A' : 'B', player_id: player.playerId, guest_name: guestName }
    }),
  ]
  const result = parseCasualResult(input)

  const { data, error } = await saveCasualMatch(supabase, saveArgs(null, 'A', result, filas))
  if (error !== null) {
    // 42501: `casual_match_players_insert` (0090) exige amistad ACEPTADA con
    // cada jugador con cuenta (§4.5) -- lo más probable no es un ataque, es
    // una solicitud sin aceptar. Un uuid bien formado que no es de nadie
    // también cae acá: no hay amistad posible con un jugador que no existe.
    if (error.code === '42501') {
      throw new EdgeError('Para cargar un partido con alguien, tienen que ser amigos aceptados.')
    }
    // 23514: el trigger de forma (0091) -- su mensaje ya es para una persona.
    if (error.code === '23514') throw new EdgeError(error.message)
    // 22P02: un id que ni castea a uuid -- sólo un POST armado a mano.
    if (error.code === '22P02') throw new EdgeError('Ese ID no es válido.')
    throw new EdgeError(`No se pudo cargar el partido: ${error.message}`)
  }
  return data
}

/**
 * Los jugadores de un partido, para editar o borrar: de ahí sale MI lado (con
 * qué orientar lo que escribo) y el amigo al que vuelve la pantalla. La misma
 * lectura hace de chequeo de pertenencia: `casual_match_players_read` (0090)
 * le devuelve cero filas a quien no jugó, ANTES de intentar ninguna escritura.
 */
async function miLadoEn(
  supabase: Client,
  matchId: string,
  verbo: string,
): Promise<{ miLado: 'A' | 'B'; friendPlayerId: string | null }> {
  const me = await myPlayerId(supabase, `${verbo} un partido`)
  const result = await supabase
    .from('casual_match_players')
    .select('side, player_id', { count: 'exact' })
    .eq('match_id', matchId)
    .order('side', { ascending: true })
    .order('player_id', { ascending: true })
  // 22P02: `matchId` llega en un input oculto -- sólo un POST armado a mano
  // lo manda mal formado.
  if (result.error !== null && result.error.code === '22P02') throw new EdgeError('Ese ID no es válido.')
  const filas = assertComplete(result, 'jugadores del partido')

  const mia = filas.find((fila) => fila.player_id === me)
  if (mia === undefined) {
    throw new EdgeError(`No se pudo ${verbo}: el partido no existe o no te corresponde.`)
  }
  // El amigo al que vuelve la pantalla: el primer otro jugador CON cuenta.
  // `null` si todos los demás eran invitados -- la action vuelve a `/amigos`.
  const otro = filas.find((fila) => fila.player_id !== null && fila.player_id !== me)
  return { miLado: mia.side === 'A' ? 'A' : 'B', friendPlayerId: otro?.player_id ?? null }
}

/**
 * Edita el resultado de un partido casual. Cualquiera de los que jugaron
 * puede (§3.1) -- no sólo quien lo cargó -- y quien edita queda asentado en
 * `updated_by` (§3.2): la RPC lo pone desde `my_player_id()`. El plantel no
 * se toca (es fijo): sólo deporte, fecha, resultado y equipos.
 *
 * Devuelve el amigo al que vuelve la pantalla (`miLadoEn`) -- leído de la
 * base, no del `<form>`: dos fuentes para el mismo dato podrían divergir con
 * un formulario armado a mano.
 */
export async function updateCasualMatch(
  supabase: Client,
  matchId: string,
  input: CasualResultInput,
): Promise<string | null> {
  const { miLado, friendPlayerId } = await miLadoEn(supabase, matchId, 'editar')
  const result = parseCasualResult(input)

  const { error } = await saveCasualMatch(supabase, saveArgs(matchId, miLado, result, []))
  if (error !== null) {
    // 42501: la RPC no tocó ninguna fila -- el partido se borró entre la
    // lectura de arriba y esta escritura (una carrera, no el caso normal).
    if (error.code === '42501') {
      throw new EdgeError('No se pudo editar: el partido no existe o no te corresponde.')
    }
    throw new EdgeError(`No se pudo editar el partido: ${error.message}`)
  }
  return friendPlayerId
}

/**
 * Borra un partido casual. Cualquiera de los que jugaron, en cualquier
 * momento (§3.3) -- "si tu amigo te borra los partidos que perdió, tenés un
 * problema de amigo, no de software". Jugadores y sets se van con él
 * (`on delete cascade`, 0072).
 *
 * Devuelve el amigo al que vuelve la pantalla, leído ANTES de borrar -- mismo
 * argumento que `updateCasualMatch`.
 */
export async function deleteCasualMatch(supabase: Client, matchId: string): Promise<string | null> {
  const { friendPlayerId } = await miLadoEn(supabase, matchId, 'borrar')

  // `count: 'exact'`: un DELETE que no toca ninguna fila no es un error en
  // PostgREST -- sin esto, una carrera con otro borrado sería un éxito mudo.
  const { error, count } = await supabase.from('casual_matches').delete({ count: 'exact' }).eq('id', matchId)
  if (error !== null) throw new EdgeError(`No se pudo borrar el partido: ${error.message}`)
  if (count === 0) {
    throw new EdgeError('No se pudo borrar: el partido no existe o no te corresponde.')
  }
  return friendPlayerId
}

/**
 * Las cuentas que juegan el partido, leídas ANTES de escribir (al borrar, las
 * filas ya no existen después): alimenta `redirectTarget`
 * (`app/amigos/casual-form-data.ts`). Un `matchId` vacío no es un partido: `[]`.
 */
export async function casualParticipantIds(supabase: Client, matchId: string): Promise<string[]> {
  if (matchId === '') return []
  const result = await supabase
    .from('casual_match_players')
    .select('player_id', { count: 'exact' })
    .eq('match_id', matchId)
  // 22P02: un id que ni castea a uuid -- sólo un POST armado a mano.
  if (result.error?.code === '22P02') throw new EdgeError('Ese ID no es válido.')
  return assertComplete(result, 'jugadores del partido').flatMap((fila) =>
    fila.player_id === null ? [] : [fila.player_id],
  )
}

// ── gente de tus torneos (odd/tasks/amigos-faciles.md, T2, S3) ──────────────

/** Alguien con cuenta que jugó un torneo conmigo y todavía no es mi amigo ni tiene un pedido conmigo. */
export interface GenteDeTorneo {
  playerId: string
  displayName: string
  /**
   * Los nombres de los torneos que compartimos, el más nuevo primero
   * (`enOrdenDeTorneo`): el formato de S11 muestra el primero. Nunca vacío.
   */
  torneos: string[]
  /** Los ids de esos torneos, en el mismo orden que `torneos`: el filtro de "Ver todas" (S10). */
  seasonIds: string[]
  /** En cuántas fechas de torneo jugamos los dos (decisión del orquestador). Puede ser 0. */
  fechasJuntos: number
}

/** El techo de filas de PostgREST (`max_rows`, `supabase/config.toml`): una página. */
const PAGINA = 1000

/**
 * Cuántos uuids van en una IN. Medido (ver el `ponytail:` de `historyWith`):
 * 218 entran en la URL, 219 dan 414. 150 deja margen.
 */
const TANDA_IN = 150

/** Cuántos ids por llamada a `player_display_names`: la función también corta en `max_rows`. */
const TANDA_NOMBRES = 500

/** Lo que hace falta de una temporada para nombrarla y ordenarla. */
interface TemporadaCompartida {
  id: string
  name: string
  created_at: string
}

/**
 * Los torneos compartidos, siempre en el mismo orden (S11, el primero es el
 * que se nombra): el más nuevo primero (`created_at`), y con la misma fecha
 * por nombre y después por id, así el orden es total. El más nuevo es el que
 * estás jugando o jugaste último: de ahí lo tenés más presente. Lo usan
 * `genteDeTusTorneos` y `torneosCompartidosCon`, así las sugerencias y los
 * pedidos nombran el mismo torneo.
 */
function enOrdenDeTorneo(
  seasonIds: Iterable<string>,
  temporadaPorId: ReadonlyMap<string, TemporadaCompartida>,
): TemporadaCompartida[] {
  return [...seasonIds]
    .map((seasonId) => {
      const temporada = temporadaPorId.get(seasonId)
      if (temporada === undefined) throw new EdgeError(`No se pudo leer el torneo ${seasonId}.`)
      return temporada
    })
    .sort(
      (a, b) =>
        Date.parse(b.created_at) - Date.parse(a.created_at) ||
        a.name.localeCompare(b.name, 'es') ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
}

function enTandas<T>(items: readonly T[], tamaño: number): T[][] {
  const tandas: T[][] = []
  for (let i = 0; i < items.length; i += tamaño) tandas.push(items.slice(i, i + tamaño))
  return tandas
}

/**
 * De `playerIds`, los que siguen teniendo cuenta (`players_with_account`,
 * 0117). Sólo responde por gente con la que tengo contexto, como
 * `player_display_names`: un extraño nunca sale, tenga cuenta o no. De a
 * `TANDA_NOMBRES` ids por llamada, por el mismo techo de filas.
 */
export async function playersWithAccount(supabase: Client, playerIds: readonly string[]): Promise<Set<string>> {
  const tandas = await Promise.all(
    enTandas([...new Set(playerIds)], TANDA_NOMBRES).map(async (tanda) => {
      const { data, error } = await supabase.rpc('players_with_account', { p_ids: tanda })
      if (error !== null) throw new EdgeError(`No se pudo saber quién tiene cuenta: ${error.message}`)
      return data.map((fila) => fila.id)
    }),
  )
  return new Set(tandas.flat())
}

/**
 * Todas las filas de una consulta, de a páginas de 1000 con `.range()`. La
 * consulta tiene que traer `count: 'exact'` y un orden total (termina en una
 * clave única): sin orden, dos páginas pueden repetir o saltear filas. Si el
 * total cambia entre páginas (alguien escribió en el medio), falla en vez de
 * contar sobre una mezcla de dos fotos -- mismo criterio que `assertComplete`.
 */
async function todasLasFilas<T>(
  consulta: string,
  pagina: (desde: number, hasta: number) => PromiseLike<{
    data: T[] | null
    error: { message: string } | null
    count: number | null
  }>,
  que = 'la gente de tus torneos',
): Promise<T[]> {
  const filas: T[] = []
  let total: number | null = null
  for (;;) {
    const result = await pagina(filas.length, filas.length + PAGINA - 1)
    if (result.error !== null) {
      throw new EdgeError(`No se pudo leer ${que} (${consulta}): ${result.error.message}`)
    }
    const data = result.data ?? []
    if (result.count === null || (total !== null && result.count !== total)) {
      throw new EdgeError(`No se pudo leer completa ${que} (${consulta}). Recargá la pantalla.`)
    }
    total = result.count
    filas.push(...data)
    if (filas.length >= total) return filas
    if (data.length === 0) {
      throw new EdgeError(`No se pudo leer completa ${que} (${consulta}). Recargá la pantalla.`)
    }
  }
}

/** `todasLasFilas` para una IN larga: una consulta por tanda de `TANDA_IN` ids, en paralelo. */
async function todasLasFilasPorTandas<T>(
  consulta: string,
  ids: readonly string[],
  pagina: (tanda: string[], desde: number, hasta: number) => PromiseLike<{
    data: T[] | null
    error: { message: string } | null
    count: number | null
  }>,
  que?: string,
): Promise<T[]> {
  const tandas = await Promise.all(
    enTandas(ids, TANDA_IN).map((tanda) => todasLasFilas(consulta, (desde, hasta) => pagina(tanda, desde, hasta), que)),
  )
  return tandas.flat()
}

/**
 * La gente de mis torneos a la que todavía no agregué (S3): con cuenta, que
 * tiene un asiento en alguna de mis temporadas, que no soy yo y que no tiene
 * ninguna fila en `friendships` conmigo -- ni amistad ni pedido, en ninguna
 * dirección (esos van en "Te pidieron" y "Pedidos enviados"). Un pedido
 * rechazado se borra (`rejectFriendRequest`), así que esa persona vuelve a
 * aparecer, como pide S3. Primero los que más fechas jugaron conmigo; con
 * las mismas, por nombre y después por id, así el orden es total.
 *
 * Todo arranca de MIS filas, así que crece con lo que yo jugué y no con el
 * tamaño de la base. La RLS ya acota cada lectura a mis temporadas
 * (`entries_read`, `seasons_read` y `match_participants`, 0002/0071):
 *
 * 1. `my_player_id`.
 * 2. Mis asientos (`entries` mías): mis temporadas.
 * 3. En paralelo: los asientos con cuenta de esas temporadas, las fechas en
 *    las que jugué (`match_participants` míos), mis filas de `friendships`
 *    y los nombres de las temporadas.
 * 4. Quién más jugó en esas fechas (`match_participants` por `matchday_id`).
 * 5. Los nombres (`player_display_names`, 0103: `players` ya no se lee directo)
 *    y quién tiene cuenta (`players_with_account`, 0117): quien la borró
 *    (0108) conserva su asiento, pero no va, porque la sección promete
 *    "tienen cuenta".
 *
 * Cada lectura pagina con `.range()` sobre un orden total (`todasLasFilas`):
 * pasar de 1000 filas no corta nada en silencio. Las IN van de a 150 ids
 * (`TANDA_IN`) y los nombres de a 500: ninguna lista larga llega a la URL ni
 * al techo de filas de la función. Para alguien con una temporada de 12
 * personas y 12 fechas son 8 pedidos; cada 1000 filas o cada 150 temporadas o
 * fechas más suma uno por consulta.
 */
export async function genteDeTusTorneos(supabase: Client): Promise<GenteDeTorneo[]> {
  const me = await myPlayerId(supabase, 'ver la gente de tus torneos')

  const misAsientos = await todasLasFilas('tus torneos', (desde, hasta) =>
    supabase
      .from('entries')
      .select('id, season_id', { count: 'exact' })
      .eq('player_id', me)
      .order('id', { ascending: true })
      .range(desde, hasta),
  )
  const seasonIds = [...new Set(misAsientos.map((fila) => fila.season_id))]
  if (seasonIds.length === 0) return []

  const [asientos, misPartidos, amistades, temporadas] = await Promise.all([
    todasLasFilasPorTandas('asientos', seasonIds, (tanda, desde, hasta) =>
      supabase
        .from('entries')
        .select('id, season_id, player_id', { count: 'exact' })
        .in('season_id', tanda)
        .not('player_id', 'is', null)
        .neq('player_id', me)
        .order('id', { ascending: true })
        .range(desde, hasta),
    ),
    todasLasFilas('tus fechas', (desde, hasta) =>
      supabase
        .from('match_participants')
        .select('match_id, matchday_id', { count: 'exact' })
        .eq('player_id', me)
        .order('match_id', { ascending: true })
        .order('pair_id', { ascending: true })
        .range(desde, hasta),
    ),
    // `friendships_read` (0070) ya acota a mis filas.
    todasLasFilas('amigos', (desde, hasta) =>
      supabase
        .from('friendships')
        .select('id, player_a, player_b', { count: 'exact' })
        .order('id', { ascending: true })
        .range(desde, hasta),
    ),
    todasLasFilasPorTandas('torneos', seasonIds, (tanda, desde, hasta) =>
      supabase
        .from('seasons')
        .select('id, name, created_at', { count: 'exact' })
        .in('id', tanda)
        .order('id', { ascending: true })
        .range(desde, hasta),
    ),
  ])

  const conAlgo = new Set(amistades.map((fila) => (fila.player_a === me ? fila.player_b : fila.player_a)))
  const temporadaPorId = new Map(temporadas.map((fila) => [fila.id, fila]))

  const temporadasDe = new Map<string, Set<string>>()
  for (const asiento of asientos) {
    // El filtro de arriba ya saca los null; el tipo no lo sabe.
    const playerId = requireColumn(asiento.player_id, 'player_id')
    if (conAlgo.has(playerId)) continue
    const bucket = temporadasDe.get(playerId) ?? new Set<string>()
    bucket.add(asiento.season_id)
    temporadasDe.set(playerId, bucket)
  }
  if (temporadasDe.size === 0) return []

  // Una fila por partido mío: la fecha se repite. `match_participants` es una
  // vista, por eso `requireColumn`.
  const misFechas = [...new Set(misPartidos.map((fila) => requireColumn(fila.matchday_id, 'matchday_id')))]
  const [enMisFechas, nombres, conCuenta] = await Promise.all([
    todasLasFilasPorTandas('fechas juntos', misFechas, (tanda, desde, hasta) =>
      supabase
        .from('match_participants')
        .select('match_id, pair_id, matchday_id, player_id', { count: 'exact' })
        .in('matchday_id', tanda)
        .neq('player_id', me)
        .order('match_id', { ascending: true })
        .order('pair_id', { ascending: true })
        .order('player_id', { ascending: true })
        .range(desde, hasta),
    ),
    Promise.all(enTandas([...temporadasDe.keys()], TANDA_NOMBRES).map((tanda) => playerNames(supabase, tanda))),
    playersWithAccount(supabase, [...temporadasDe.keys()]),
  ])

  const fechasDe = new Map<string, Set<string>>()
  for (const fila of enMisFechas) {
    const playerId = requireColumn(fila.player_id, 'player_id')
    const bucket = fechasDe.get(playerId) ?? new Set<string>()
    bucket.add(requireColumn(fila.matchday_id, 'matchday_id'))
    fechasDe.set(playerId, bucket)
  }
  const nombrePorId = new Map(nombres.flatMap((mapa) => [...mapa]))

  return [...temporadasDe.entries()]
    .filter(([playerId]) => conCuenta.has(playerId))
    .map(([playerId, suyas]) => {
      const torneos = enOrdenDeTorneo(suyas, temporadaPorId)
      return {
        playerId,
        // Comparte una temporada conmigo: `player_display_names` siempre lo
        // resuelve. Que falte es un corte o la función rota -- falla fuerte.
        displayName: requireName(nombrePorId, playerId),
        torneos: torneos.map((temporada) => temporada.name),
        seasonIds: torneos.map((temporada) => temporada.id),
        fechasJuntos: fechasDe.get(playerId)?.size ?? 0,
      }
    })
    .sort(
      (a, b) =>
        b.fechasJuntos - a.fechasJuntos ||
        a.displayName.localeCompare(b.displayName, 'es') ||
        (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0),
    )
}

// ── de dónde lo conocés (odd/tasks/amigos-faciles.md, T3, S4) ───────────────

/**
 * Los torneos que comparto con cada una de `playerIds`: "De Los Pibes del
 * Martes" en un pedido. Por persona, los nombres en el orden de
 * `enOrdenDeTorneo`, como en `genteDeTusTorneos`; quien no comparte ninguno queda con `[]`, y la
 * pantalla no dice nada.
 *
 * Compartir es tener los dos un asiento: un torneo que administro sin jugar
 * lo veo (`is_participant`, 0002) pero no cuenta. Por eso arranca de mis
 * asientos, y los de ellos se filtran contra esas temporadas.
 *
 * Mismos techos que `genteDeTusTorneos`: cada lectura pagina con un orden
 * total, y los ids van de a `TANDA_IN` por IN. Sin nadie para buscar no lee
 * nada; con algunos pedidos son 4 consultas.
 */
export async function torneosCompartidosCon(
  supabase: Client,
  playerIds: readonly string[],
): Promise<Map<string, string[]>> {
  const personas = [...new Set(playerIds)]
  if (personas.length === 0) return new Map()
  const que = 'de dónde conocés a quien te pidió'
  const me = await myPlayerId(supabase, 'ver de dónde conocés a alguien')

  const [misAsientos, suyos] = await Promise.all([
    todasLasFilas(
      'tus torneos',
      (desde, hasta) =>
        supabase
          .from('entries')
          .select('id, season_id', { count: 'exact' })
          .eq('player_id', me)
          .order('id', { ascending: true })
          .range(desde, hasta),
      que,
    ),
    // `entries_read` ya acota a las temporadas que veo.
    todasLasFilasPorTandas(
      'sus torneos',
      personas,
      (tanda, desde, hasta) =>
        supabase
          .from('entries')
          .select('id, season_id, player_id', { count: 'exact' })
          .in('player_id', tanda)
          .order('id', { ascending: true })
          .range(desde, hasta),
      que,
    ),
  ])

  const mias = new Set(misAsientos.map((fila) => fila.season_id))
  const temporadasDe = new Map(personas.map((playerId) => [playerId, new Set<string>()]))
  for (const asiento of suyos) {
    if (!mias.has(asiento.season_id)) continue
    temporadasDe.get(requireColumn(asiento.player_id, 'player_id'))?.add(asiento.season_id)
  }

  const compartidas = [...new Set([...temporadasDe.values()].flatMap((ids) => [...ids]))]
  const temporadas =
    compartidas.length === 0
      ? []
      : await todasLasFilasPorTandas(
          'nombres de torneos',
          compartidas,
          (tanda, desde, hasta) =>
            supabase
              .from('seasons')
              .select('id, name, created_at', { count: 'exact' })
              .in('id', tanda)
              .order('id', { ascending: true })
              .range(desde, hasta),
          que,
        )
  const temporadaPorId = new Map(temporadas.map((fila) => [fila.id, fila]))

  return new Map(
    [...temporadasDe.entries()].map(([playerId, ids]) => [
      playerId,
      enOrdenDeTorneo(ids, temporadaPorId).map((temporada) => temporada.name),
    ]),
  )
}
