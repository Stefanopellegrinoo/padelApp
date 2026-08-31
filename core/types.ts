/** A seat in a season. Matches always reference this, never a player. */
export type EntryId = string

/**
 * Distinto NOMINALMENTE de un season id (N2 de
 * torneo-multi-disciplina): son dos strings con la misma forma (uuid) pero
 * significados que no se pueden confundir sin que el compilador lo note.
 * `awardsBefore`/`closedHistory` (db/season.ts) cambiaron su 2º parámetro de
 * "season" a "discipline" con el MISMO tipo (`string`) — un caller que
 * pasara el id equivocado compilaba limpio. La marca se aplica en la FUENTE
 * (`db/read.ts: toMatchdaySummary`, `db/matchday.ts: requireMatchday`,
 * `db/season.ts: defaultDisciplineId`): de ahí en más `disciplineId` ya es
 * `DisciplineId` y `seasonId` sigue siendo `string` a secas, así que pasar
 * uno por el otro es error de compilación en el call site, sin necesitar un
 * cast repetido en cada uno.
 */
export type DisciplineId = string & { readonly __brand: 'DisciplineId' }

export interface MatchFormat {
  setsToWin: number
  gamesPerSet: number
  tieBreak: boolean
  /**
   * Sin marcador objetivo: cualquier par de enteros >= 0 es legal (goles FIFA).
   * `3-1`, `0-0`, `2-2`. No hay tope de games ni "quién ganó", y el partido es
   * UN resultado, no una serie de sets — `setsToWin`, `gamesPerSet` y
   * `tieBreak` describen un set de pádel y NO se leen cuando esto es `true`.
   *
   * OBLIGATORIO y sin default a propósito (decisión #3933, y la lección de
   * `pair_size` en PR18a y `allows_draw` en W61, dos veces la misma trampa): un
   * campo nuevo con default permisivo esconde a los escritores que no lo
   * escriben. Sin default, `tsc` marca cada literal de `MatchFormat` que falta
   * y obliga a decidir en la línea exacta.
   *
   * El empate es una regla ORTOGONAL y vive aparte, en `disciplines.allows_draw`:
   * `match_sets_no_draw` (0034) lo sigue exigiendo del lado de la base, así que
   * un marcador abierto SIN empates rechaza un `0-0` igual.
   */
  openScore: boolean
}

export interface SeasonConfig {
  /**
   * Squad size, not matchday size. Between MIN_PLAYERS and MAX_PLAYERS.
   * Even only when the discipline's side size is 2 (N21,
   * ronda 9) — with sideSize=1 an odd squad is perfectly playable.
   */
  squadSize: number
  matchFormat: MatchFormat
  /** Exactly squadSize / sideSize values, strictly descending, all above zero. */
  points: number[]
  regularMatchdays: number
  countBestOf: number
  tiebreakSnapshotEvery: number
  /**
   * Cuántos partidos como mucho puede tener una fecha de esta disciplina.
   * OPCIONAL: sin la clave rige `defaultMaxMatches(sideSize)` — 15 de a dos,
   * 36 de a uno. Es el techo que `MAX_PLAYERS` intentaba ser y no podía, por
   * medir jugadores en vez de partidos: 12 jugadores son 15 partidos de a dos
   * y 66 de a uno.
   */
  maxMatches?: number
}

/**
 * Cuántas entries hacen un lado. Elegido AL CONFIGURAR la disciplina, no
 * derivado de `kind` (decisión de producto #5): FIFA es 1v1 Y 2v2. La base lo
 * hace cumplir con una FK compuesta (`disciplines_size_anchor`), no un `if`.
 */
export type SideSize = 1 | 2

/**
 * Los tres hechos de una disciplina que `narrateRules` no puede leer de
 * `SeasonConfig`: viven en columnas de `disciplines` (`has_masters`,
 * `pair_size`, `allows_draw`), no en su jsonb. Copiarlos AL jsonb crearía una
 * segunda fuente de verdad para columnas que la base ya vigila con FKs
 * compuestas (`disciplines_size_anchor`, `disciplines_draw_anchor`,
 * `0015_disciplines.sql:25-26`) — el mismo problema que `seasons.config`
 * (`db/read.ts:73-80`).
 *
 * Segundo argumento OBLIGATORIO de `narrateRules`, sin default a propósito
 * (misma razón que `MatchFormat.openScore`, arriba: un default permisivo
 * esconde al llamador que no lo piensa, y esto ya mordió dos veces —
 * `pair_size` en PR18a, `allows_draw` en W61).
 */
export interface DisciplineShape {
  hasMasters: boolean
  pairSize: SideSize
  allowsDraw: boolean
}

/**
 * Unión DISCRIMINADA sobre `size`: leer `.b` de un `Side` sin haber
 * angostado `size` a `2` es error de COMPILACIÓN, no un `undefined` en
 * runtime. Antes de este tipo, `pair.a === guestId ? pair.b : pair.a`
 * (sumar-state.ts:92) devolvía `undefined` en silencio para un lado que no
 * tenía `.b` — con `Side` ese mismo código no compila.
 */
export type Side =
  | { readonly size: 1; readonly a: EntryId }
  | { readonly size: 2; readonly a: EntryId; readonly b: EntryId }

/**
 * Orden de las fases de una fecha, de la primera a la última. `matchday_phase`
 * (`supabase/migrations/0039_match_phase.sql`) deduce la fase actual con
 * `array_position` sobre el MISMO array, en el MISMO orden — `TERCER_PUESTO`
 * va ANTES de `FINAL` a propósito, porque las dos se generan juntas y el
 * máximo tiene que dar `FINAL`. Si este array diverge del de la migración,
 * `currentPhase` (acá) y `matchday_phase` (SQL) dejan de acordar sobre la
 * fase de una misma fecha.
 */
export const PHASE_ORDER = ['GRUPO', 'OCTAVOS', 'CUARTOS', 'SEMI', 'TERCER_PUESTO', 'FINAL'] as const
export type Phase = (typeof PHASE_ORDER)[number]

/**
 * Cómo se arma una fecha (design PUNTO 7, PR21). `ROUND_ROBIN` es el de
 * siempre: todos contra todos, una sola fase `GRUPO`. `GROUPS_KNOCKOUT`
 * reparte los lados en `groups` grupos y clasifica `qualifiersPerGroup` de
 * cada uno a una llave (REQ-D8-1). Vive en `matchdays.formato`, NO en
 * `disciplines`: se elige por fecha, no queda fijo para toda la disciplina.
 */
export type MatchdayFormat =
  | { readonly kind: 'ROUND_ROBIN' }
  | { readonly kind: 'GROUPS_KNOCKOUT'; readonly groups: number; readonly qualifiersPerGroup: number }

export interface SetScore {
  gamesA: number
  gamesB: number
}

/**
 * `sideA`/`sideB` y no `pairA`/`pairB` (design #3801, "Renombrado desde
 * pairA/pairB: fuerza al compilador por cada consumidor"): el rename no es
 * cosmético, es lo que obliga a cada lector a declarar en su línea exacta qué
 * hace ahí un lado de uno. Un cambio de tipo solo dejaría compilando a la
 * mitad de los consumidores que indexan `.b` sin angostar.
 */
export interface MatchResult {
  round: number
  /**
   * OBLIGATORIOS y sin default (REQ-D7-1/D7-3, design PUNTO 7) — la misma
   * lección que `pair_size` (PR18a) y `openScore` (0037): un default
   * permisivo esconde al escritor que no lo puebla. En la base `fase` nace
   * `'GRUPO'` por default, pero acá el compilador obliga a decidirlo en cada
   * literal. `grupo` sólo significa algo cuando `fase === 'GRUPO'` — la base
   * lo fija con `matches_group_only_in_groups` (0039).
   */
  fase: Phase
  grupo: number
  sideA: Side
  sideB: Side
  /** Empty while the match has not been played. */
  sets: SetScore[]
}

/**
 * Cuánto paga cada resultado en la TABLA DEL DÍA. No confundir con los puntos
 * del CAMPEONATO, que son `Award.points` y salen de `config.points`.
 *
 * Existe para que haya UNA sola estrategia de orden y no dos (design #3801,
 * decisión #12): con `{ win: 1, draw: 0 }` los puntos del día son exactamente
 * los partidos ganados, así que el pádel de siempre es el caso DEGENERADO del
 * mismo comparador y no una segunda rama que haya que mantener sincronizada.
 *
 * SIN campo `loss`: el design lo listaba, pero ninguna regla de liga paga por
 * perder y ningún camino lo escribiría en otra cosa que 0. Sumar un tercer
 * término que siempre aporta cero es un valor especulativo, no una
 * generalización. El día que haga falta una penalización, es un campo más acá
 * y un término más en `dayPointsOf`.
 */
export interface DayScoring {
  win: number
  draw: number
}

/** Una fila de la tabla del día. Su identidad es el LADO, de uno o de dos. */
export interface SideStanding {
  side: Side
  played: number
  won: number
  /**
   * Partidos que terminaron iguales. Sólo puede pasar de 0 en una disciplina
   * con `allows_draw`: sin ella la base rechaza el resultado
   * (`match_sets_no_draw`, 0034).
   */
  drawn: number
  /**
   * Los puntos de la fecha: `won * scoring.win + drawn * scoring.draw`. Es el
   * PRIMER criterio de orden de la tabla, y por eso está en la fila — quien
   * quiera explicar por qué un lado quedó arriba de otro necesita mirar el
   * mismo número que miró el sort, no una reconstrucción parecida.
   */
  dayPoints: number
  setsDiff: number
  gamesDiff: number
  /** 1-based final position within the matchday. */
  position: number
}

/**
 * Una porción de `Award.points`, con la razón por la que se sumó (REQ-D10-1,
 * design #3801 PUNTO 8). Persiste 1:1 en `award_lines`.
 */
export interface AwardLine {
  reason: string
  points: number
}

export interface Award {
  entryId: EntryId
  /**
   * Position in the championship, not in the matchday table. A pair made only
   * of guests is skipped, so the two can differ: with a guest pair second, the
   * championship pair that came third is award position two.
   */
  position: number
  points: number
  /**
   * El desglose de `points`. Hoy siempre UNA línea —hay una sola fuente de
   * puntos, la posición del día— y su suma es siempre igual a `points`
   * (REQ-D10-1, `close_matchday` lo valida al cerrar). OBLIGATORIO y no `?`:
   * un campo opcional es invisible para el compilador y para los tests
   * (#3994) — acá el ripple de tipo es la señal que marca cada productor de
   * `Award` que todavía no decide su desglose.
   *
   * `readonly` (S99): S89 cerró el bug del array COMPARTIDO —`const lines`
   * vivía afuera del loop y los dos miembros de una pareja terminaban con la
   * MISMA instancia— moviendo la declaración adentro. Correcto, pero la
   * garantía la sostenía la disciplina y no el compilador: el día que
   * aparezca una segunda fuente de puntos, un `award.lines.push(...)` vuelve
   * a mutar lo que otro esté mirando. Con `readonly` eso es un error de
   * `tsc`, que es el mismo remedio que #3994 aplicó a `sideSize`.
   */
  readonly lines: readonly AwardLine[]
}

export interface RankingRow {
  entryId: EntryId
  points: number
  /** Points that counted toward the total, best first. */
  counted: number[]
  /** Points dropped because only the best countBestOf results count. */
  discarded: number[]
}
