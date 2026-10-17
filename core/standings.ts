import { members, sameSide } from './side'
import type {
  DayScoring,
  EntryId,
  MatchFormat,
  MatchResult,
  SeasonConfig,
  SetScore,
  Side,
  SideStanding,
} from './types'

/**
 * Si la tabla del día corta por diferencia de SETS antes de llegar a la
 * diferencia de games.
 *
 * Exportada porque no la usa sólo `computeStandings`: la pantalla de la fecha
 * arma con ella la frase del desempate (`tiebreakNote`) y la página de Reglas
 * la narra (`describeTiebreak`). Eran TRES copias de `setsToWin > 1` en tres
 * archivos, y arreglar una sola las hacía discrepar — que es peor que dejar
 * las tres igual de viejas.
 *
 * Con marcador abierto es siempre `false`, y no por convención: un partido de
 * goles es UN resultado, así que hay exactamente un "set" y `setsDiff`
 * degenera en `ganados − perdidos`. Eso es una segunda opinión sobre el
 * criterio que ya corrió primero (los puntos del día), y encima tapa la
 * diferencia de gol, que es el desempate real de una liga de fútbol.
 *
 * (La frase que había acá decía que un empate "suma a `played` sin sumar a
 * ninguno de los dos". Era cierta cuando el primer criterio era `won` a secas
 * y dejó de serlo con PR20 rebanada B: desde REQ-D6-2 un empate suma a
 * `drawn` y paga. Corregida acá y no comentada aparte — mismo criterio que
 * N48, la frase falsa vive EN EL CÓDIGO y ahí se arregla.)
 */
export function usesSetsDiff(format: MatchFormat): boolean {
  return !format.openScore && format.setsToWin > 1
}

/**
 * El pádel de siempre, dicho como tabla de puntos: ganar paga 1 y empatar 0,
 * o sea `dayPoints === won` LITERALMENTE. No es una aproximación al criterio
 * viejo, es el mismo número — por eso una disciplina sin empates ordena
 * exactamente igual que antes de que estos puntos existieran, y hay un test
 * que lo fija en vez de un comentario que lo prometa.
 */
const PADEL_DAY_SCORING: DayScoring = { win: 1, draw: 0 }

/**
 * Donde el empate es un resultado legal, paga: 3 y 1, la tabla de toda liga
 * de fútbol. Antes de esto el primer criterio era `won` a secas y un empate
 * valía EXACTAMENTE lo mismo que una derrota — se vio en pantalla en la
 * primera liga de FIFA, con la pareja del `0-0` terminando sin crédito.
 *
 * No sale de la config y ésa es una decisión, no un olvido: ninguna pantalla
 * ofrece editarla, y meterla en el jsonb de `disciplines.config` costaría una
 * migración con backfill de dos tablas por un valor que nadie escribe. El día
 * que exista el control que lo edita, esto se vuelve un campo de config y el
 * comparador no se entera.
 */
const DRAW_DAY_SCORING: DayScoring = { win: 3, draw: 1 }

/**
 * Ephemeral tally for a single matchday's computation — never persisted,
 * never carried across matchdays. `side` replaces `pair` as the identity
 * (design #3801, decision #6): a side is a shape for a matchday's play, not
 * something that accumulates points across time. Points stay per person.
 */
interface Tally {
  side: Side
  played: number
  won: number
  drawn: number
  setsWon: number
  setsLost: number
  gamesWon: number
  gamesLost: number
}

/**
 * La ÚNICA definición de "quién ganó un set" —y con eso, un partido— en todo
 * el proyecto: gana el set quien hizo más games, gana el partido quien ganó
 * más sets, iguales es empate. Extraída de adentro de `computeStandings`
 * porque `db/friends.ts` necesita la misma respuesta desde afuera de `core/`,
 * y ese dato no se recalcula dos veces: el precedente ya está escrito en el
 * comentario de `usesSetsDiff` más arriba en este mismo archivo — eran TRES
 * copias de `setsToWin > 1` en tres archivos, y una segunda opinión sobre
 * quién ganó un partido sería peor todavía, porque las dos pantallas se ven
 * bien y dicen cosas distintas.
 */
export function tallySets(
  sets: readonly SetScore[],
): { setsA: number; setsB: number; gamesA: number; gamesB: number } {
  let setsA = 0
  let setsB = 0
  let gamesA = 0
  let gamesB = 0
  for (const set of sets) {
    gamesA += set.gamesA
    gamesB += set.gamesB
    if (set.gamesA > set.gamesB) setsA++
    else if (set.gamesB > set.gamesA) setsB++
  }
  return { setsA, setsB, gamesA, gamesB }
}

/**
 * The matchday table. Ranks sides by the day's POINTS, then games difference,
 * then the head to head between the tied sides, and finally the snapshot.
 *
 * "Puntos del día" y no "partidos ganados" desde PR20 rebanada B (REQ-D6-2).
 * No es un criterio nuevo encima del viejo: es el MISMO, generalizado. Sin
 * empates permitidos `dayPoints === won` por álgebra, así que una disciplina
 * de pádel ordena exactamente igual que antes.
 *
 * `allowsDraw` es OBLIGATORIO y sin default, por la misma razón que en
 * `setError`/`matchError` (W61) y que `openScore` en `MatchFormat` (D1): un
 * default permisivo esconde a los llamadores que no lo pasan. Sin default,
 * `tsc` marca cada call site y obliga a decidir en la línea exacta de quién
 * sale ese booleano — que no es una pregunta menor, porque la respuesta
 * correcta es el valor CONGELADO en la fecha y no el de la disciplina de hoy.
 *
 * That last step almost never fires, but it has to exist: in a three-way 2-2-2
 * the head to head is circular and resolves nothing, and without a final cut
 * three pairs would be left arguing over first place.
 *
 * El límite `sideOf`/`pairOf` que esta función tenía en la entrada y en el
 * retorno SE FUE (PR18b): `MatchResult`/`SideStanding` hablan `Side`, así que
 * un lado de uno entra y sale con su forma. Por dentro no cambió una línea —
 * ya trabajaba entera sobre `Side` vía `sameSide`/`members` desde PR15, y por
 * eso `bestPlayerRank` y la búsqueda de tally salieron correctas para un lado
 * de un miembro sin tocarlas.
 */
export function computeStandings(
  sides: Side[],
  matches: MatchResult[],
  config: SeasonConfig,
  snapshot: EntryId[],
  allowsDraw: boolean,
): SideStanding[] {
  const tallies = sides.map<Tally>((side) => ({
    side,
    played: 0,
    won: 0,
    drawn: 0,
    setsWon: 0,
    setsLost: 0,
    gamesWon: 0,
    gamesLost: 0,
  }))

  const find = (side: Side): Tally | undefined =>
    tallies.find((tally) => sameSide(tally.side, side))

  for (const match of matches) {
    if (match.sets.length === 0) continue // not played yet
    const left = find(match.sideA)
    const right = find(match.sideB)
    if (left === undefined || right === undefined) continue

    const { setsA, setsB, gamesA, gamesB } = tallySets(match.sets)

    left.played++
    right.played++
    left.setsWon += setsA
    left.setsLost += setsB
    right.setsWon += setsB
    right.setsLost += setsA
    left.gamesWon += gamesA
    left.gamesLost += gamesB
    right.gamesWon += gamesB
    right.gamesLost += gamesA
    if (setsA > setsB) left.won++
    else if (setsB > setsA) right.won++
    // La rama que hasta acá no existía. En una disciplina sin empates es
    // inalcanzable con un resultado GUARDADO —lo prohíbe la base—, pero sí se
    // pisa en vivo con un partido a dos sets todavía 1-1: con `allowsDraw`
    // en `false` paga 0, que es exactamente lo que pagaba antes.
    else {
      left.drawn++
      right.drawn++
    }
  }

  const snapshotRank = new Map(snapshot.map((id, index) => [id, index]))
  const OUTSIDE = Number.MAX_SAFE_INTEGER
  const bestPlayerRank = (side: Side): number =>
    Math.min(...members(side).map((entryId) => snapshotRank.get(entryId) ?? OUTSIDE))

  const bySetsDiff = usesSetsDiff(config.matchFormat)
  const scoring = allowsDraw ? DRAW_DAY_SCORING : PADEL_DAY_SCORING

  // Step one: the objective criteria, which are transitive and safe to sort with.
  const byObjective = [...tallies].sort((left, right) =>
    compareObjective(left, right, bySetsDiff, scoring),
  )

  // Step two: group whatever came out exactly level.
  const groups: Tally[][] = []
  for (const tally of byObjective) {
    const current = groups[groups.length - 1]
    const head = current?.[0]
    if (
      current !== undefined &&
      head !== undefined &&
      compareObjective(head, tally, bySetsDiff, scoring) === 0
    ) {
      current.push(tally)
    } else {
      groups.push([tally])
    }
  }

  // Step three: break each group. The head to head only applies to a group of
  // exactly two — with three it is circular and resolves nothing, so the
  // snapshot cuts. Never feed the head to head into a comparator: it is not
  // transitive, and sort would return garbage.
  const sorted = groups.flatMap((group) => {
    if (group.length === 1) return group
    if (group.length === 2) {
      const [first, second] = group
      if (first !== undefined && second !== undefined) {
        const head = headToHead(first.side, second.side, matches)
        // `DRAW` y `NOT_PLAYED` caen al snapshot, igual que el `0` que cubría
        // los dos antes. La diferencia es que ahora es una decisión escrita:
        // un empate entre ellos NO desempata nada, y no haberse enfrentado
        // tampoco, pero por razones distintas.
        if (head === 'LEFT') return [first, second]
        if (head === 'RIGHT') return [second, first]
      }
    }
    return [...group].sort((left, right) => bestPlayerRank(left.side) - bestPlayerRank(right.side))
  })

  return sorted.map((tally, index) => ({
    side: tally.side,
    played: tally.played,
    won: tally.won,
    drawn: tally.drawn,
    dayPoints: dayPointsOf(tally, scoring),
    setsDiff: tally.setsWon - tally.setsLost,
    gamesDiff: tally.gamesWon - tally.gamesLost,
    position: index + 1,
  }))
}

function dayPointsOf(tally: Tally, scoring: DayScoring): number {
  return tally.won * scoring.win + tally.drawn * scoring.draw
}

/**
 * Puntos del día, después diferencia de sets cuando el formato tiene más de
 * uno, después games.
 *
 * El primer escalón era `won` a secas. Con `PADEL_DAY_SCORING` sigue siendo el
 * mismo número, así que esto no es una estrategia NUEVA para las disciplinas
 * con empate: es LA estrategia, y el pádel su caso degenerado (design #3801,
 * decisión #12). Dos comparadores condicionados por `allowsDraw` serían dos
 * verdades que alguien tendría que acordarse de sincronizar.
 */
function compareObjective(
  left: Tally,
  right: Tally,
  bySetsDiff: boolean,
  scoring: DayScoring,
): number {
  const leftPoints = dayPointsOf(left, scoring)
  const rightPoints = dayPointsOf(right, scoring)
  if (rightPoints !== leftPoints) return rightPoints - leftPoints
  if (bySetsDiff) {
    const leftSets = left.setsWon - left.setsLost
    const rightSets = right.setsWon - right.setsLost
    if (rightSets !== leftSets) return rightSets - leftSets
  }
  return right.gamesWon - right.gamesLost - (left.gamesWon - left.gamesLost)
}

/**
 * `REQ-D6-3`. Los CUATRO resultados posibles del enfrentamiento directo, cada
 * uno con su nombre.
 *
 * Antes eran tres: un `-1`, un `1` y un `0` que cubría DOS situaciones
 * distintas —empataron, y no se enfrentaron— que el tipo de retorno hacía
 * imposible distinguir. Las dos siguen cayendo al snapshot, así que el orden
 * no cambia; lo que cambia es que ahora quien lea esta función puede saber
 * cuál de las dos pasó.
 */
export type HeadToHead = 'LEFT' | 'RIGHT' | 'DRAW' | 'NOT_PLAYED'

/**
 * Quién ganó el enfrentamiento directo, si lo hubo.
 *
 * Exportada para su test (`REQ-D6-3` pide los cuatro valores por nombre) pero
 * NO desde el barrel de `core`, mismo criterio que `formatLabel` después de
 * S77: es un desempate NO TRANSITIVO y publicarlo es ofrecerle a una pantalla
 * un comparador que `sort` convierte en basura.
 */
export function headToHead(left: Side, right: Side, matches: MatchResult[]): HeadToHead {
  for (const match of matches) {
    if (match.sets.length === 0) continue
    const leftIsA = sameSide(match.sideA, left) && sameSide(match.sideB, right)
    const leftIsB = sameSide(match.sideA, right) && sameSide(match.sideB, left)
    if (!leftIsA && !leftIsB) continue

    let setsA = 0
    let setsB = 0
    for (const set of match.sets) {
      if (set.gamesA > set.gamesB) setsA++
      else if (set.gamesB > set.gamesA) setsB++
    }
    if (setsA === setsB) return 'DRAW'
    const aWon = setsA > setsB
    if (leftIsA) return aWon ? 'LEFT' : 'RIGHT'
    return aWon ? 'RIGHT' : 'LEFT'
  }
  return 'NOT_PLAYED'
}
