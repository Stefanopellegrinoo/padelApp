/**
 * La llave de una fecha con fases (design PUNTO 7, PR21). `buildFixture`
 * (core/fixture.ts) NO se toca: opera sobre índices numéricos y sigue
 * generando UNA ronda round-robin; con `GROUPS_KNOCKOUT` se lo llama una vez
 * por grupo. Este módulo es lo que sabe en qué fase está la fecha y cuándo
 * esa fase terminó — nada de esto se guarda en una columna nueva.
 */
import { sameSide } from './side'
import {
  PHASE_ORDER,
  type MatchResult,
  type MatchdayFormat,
  type Phase,
  type Side,
  type SideSize,
  type SideStanding,
} from './types'

/**
 * La fase actual: la más avanzada con partidos creados (REQ-D7-3). Sin
 * partidos, no hay fase — no `'GRUPO'` por default, porque eso confundiría
 * "fecha recién armada" con "fecha sin armar todavía".
 *
 * MISMO criterio que `matchday_phase` (`supabase/migrations/0039_match_phase.sql`):
 * `array_position` sobre `PHASE_ORDER` y el máximo. Acá no hace falta un SQL
 * `order by ... limit 1` — un solo recorrido alcanza.
 */
export function currentPhase(matches: readonly MatchResult[]): Phase | null {
  let latest: Phase | null = null
  let latestIndex = -1
  for (const match of matches) {
    const index = PHASE_ORDER.indexOf(match.fase)
    if (index > latestIndex) {
      latestIndex = index
      latest = match.fase
    }
  }
  return latest
}

/**
 * Si TODOS los partidos de `fase` ya se jugaron. Un partido "jugado" es el
 * mismo criterio que `headToHead` (`core/standings.ts`): tiene al menos un
 * set cargado. Sin partidos en esa fase, no está completa — no hay nada que
 * cerrar todavía, y sería vacuamente `true` si se devolviera lo contrario.
 */
export function phaseIsComplete(matches: readonly MatchResult[], fase: Phase): boolean {
  const inPhase = matches.filter((match) => match.fase === fase)
  return inPhase.length > 0 && inPhase.every((match) => match.sets.length > 0)
}

/**
 * La fase que le corresponde a una llave de `matchups` partidos. Sólo conoce
 * potencias de 2 hasta 8 (el techo real: `groupSides`/`knockoutMatchups`,
 * Rebanada B2, no arman llaves más grandes) — cualquier otro número es un bug
 * de quien arma la llave, no un caso a tolerar en silencio.
 */
export function faseForCount(matchups: number): Phase {
  switch (matchups) {
    case 8:
      return 'OCTAVOS'
    case 4:
      return 'CUARTOS'
    case 2:
      return 'SEMI'
    case 1:
      return 'FINAL'
    default:
      throw new Error(`Una llave de ${matchups} partidos no es una fase conocida.`)
  }
}

/**
 * Reparte `items` en `groups` grupos por SEED, en ZIGZAG (snake/serpentina):
 * seed 1 al grupo 0, seed 2 al 1, ..., seed G al G-1 — y ahí se da vuelta: la
 * siguiente tanda vuelve de atrás para adelante. Es el reparto de torneo
 * estándar para que ningún grupo se quede con los mejores seeds ni con los
 * peores; un corte secuencial (1,2,3,4 en un grupo y 5,6,7,8 en el otro)
 * NO cumple esto.
 *
 * Hallazgo de diseño de esta rebanada (C1.3-C1.4): `generatePairs`
 * (`db/matchday.ts`) necesita los lados YA repartidos en grupos para correr
 * `buildFixture` una vez por grupo, y el design (PUNTO 7) da la firma de
 * `generatePairs` con `GROUPS_KNOCKOUT` pero no nombra este helper.
 *
 * Genérico (no atado a `Side`): `generatePairs` lo usa sobre pares
 * `{ side, pairId }` para no perder el id ya insertado de cada lado —
 * `groupSides` en sí no necesita saber qué es un lado.
 */
export function groupSides<T>(items: readonly T[], groups: number): T[][] {
  if (groups < 1) {
    throw new Error(`No se puede repartir en ${groups} grupos.`)
  }
  const buckets: T[][] = Array.from({ length: groups }, () => [])
  let index = 0
  let direction = 1
  for (const item of items) {
    const bucket = buckets[index]
    if (bucket === undefined) throw new Error(`El grupo ${index} no existe. Esto es un bug.`)
    bucket.push(item)
    const next = index + direction
    if (next < 0 || next >= groups) {
      direction = -direction
    } else {
      index = next
    }
  }
  return buckets
}

function sortedByPosition(group: readonly SideStanding[]): readonly SideStanding[] {
  return [...group].sort((left, right) => left.position - right.position)
}

/**
 * Cuenta sets ganados por cada lado, mismo criterio que `computeStandings`
 * (`core/standings.ts`) y `headToHead`: comparar `gamesA`/`gamesB` set a set.
 */
function setsTally(match: MatchResult): { setsA: number; setsB: number } {
  let setsA = 0
  let setsB = 0
  for (const set of match.sets) {
    if (set.gamesA > set.gamesB) setsA++
    else if (set.gamesB > set.gamesA) setsB++
  }
  return { setsA, setsB }
}

/**
 * Si un empate es un resultado LEGAL para un partido de esta fase (C30,
 * verify-report-pr21 #4004 / decisión #4005): sólo en GRUPO, sin importar si
 * la disciplina admite empates. Fuera de GRUPO —OCTAVOS, CUARTOS, SEMI,
 * TERCER_PUESTO, FINAL— una llave necesita un ganador para avanzar o para
 * cerrar; un empate ahí deja de significar algo y es exactamente lo que
 * `winnerOf`/`loserOf` (abajo) no saben resolver.
 *
 * Con `fase='GRUPO'` es LITERALMENTE `allowsDraw`, la regla de siempre
 * (`match_sets_no_draw` con `allows_draw=false` antes de esta decisión) —
 * mismo criterio que la migración `0043` (SQL) sigue del lado de la base.
 * Causa raíz que este guard cierra: `phaseIsComplete` ("tiene sets
 * cargados") y `winnerOf` ("tiene un ganador") no acordaban qué es un
 * partido resuelto; con el empate prohibido fuera de GRUPO, un partido con
 * sets SIEMPRE tiene ganador ahí, y las dos definiciones vuelven a
 * coincidir.
 */
export function drawIsLegal(fase: Phase, allowsDraw: boolean): boolean {
  return allowsDraw && fase === 'GRUPO'
}

function winnerOf(match: MatchResult): Side {
  const { setsA, setsB } = setsTally(match)
  if (setsA === setsB) throw new Error('Un partido de llave sin definir no tiene ganador.')
  return setsA > setsB ? match.sideA : match.sideB
}

function loserOf(match: MatchResult): Side {
  const { setsA, setsB } = setsTally(match)
  if (setsA === setsB) throw new Error('Un partido de llave sin definir no tiene perdedor.')
  return setsA > setsB ? match.sideB : match.sideA
}

/** `group[index]`, o error legible en vez de `undefined` silencioso. */
function qualifierAt(group: readonly SideStanding[] | undefined, index: number): SideStanding {
  const row = group?.[index]
  if (row === undefined) {
    throw new Error(`knockoutMatchups necesita al menos ${index + 1} clasificados en cada grupo.`)
  }
  return row
}

/**
 * Arma los cruces de la primera ronda de la llave a partir de las tablas de
 * grupo (REQ-D7-4). El design (PUNTO 7) da la FIRMA pero no la regla de
 * cruce — no está escrita en ningún requisito. Regla elegida acá (agujero
 * (a), surfaceado en el reporte de esta rebanada, no inventado en silencio):
 *
 * cruzar grupos para que los DOS primeros de dos grupos distintos no puedan
 * encontrarse antes de la instancia que combina sus dos mitades del cuadro,
 * y para que ningún grupo se enfrente a su propio 2º puesto en el primer
 * cruce (evita una revancha inmediata del mismo grupo).
 *
 * - 1 grupo: el 1º y el 2º arman el único cruce posible (es la final).
 * - 2 grupos: A1-B2 y B1-A2 (el cruce estándar para que los dos primeros
 *   sólo puedan verse en la final).
 * - 4 grupos: [A1-B2, C1-D2, B1-A2, D1-C2]. `nextRoundMatchups` empareja de
 *   a dos EN ORDEN ([0]+[1], [2]+[3]) — este orden deja a A1/C1 de un lado
 *   del cuadro y a B1/D1 del otro, así que los 4 primeros quedan separados
 *   en las dos mitades y sólo pueden cruzarse en semifinal o más tarde.
 *
 * Sólo soporta 2 clasificados por grupo y G∈{1,2,4} grupos (riesgo conocido
 * del design, "knockoutMatchups sólo soporta G∈{1,2,4} y P=2"): cualquier
 * otra combinación tira, no se tolera en silencio.
 */
export function knockoutMatchups(
  groups: readonly (readonly SideStanding[])[],
  qualifiersPerGroup: number,
): Array<[Side, Side]> {
  if (qualifiersPerGroup !== 2) {
    throw new Error(`knockoutMatchups sólo arma cruces con 2 clasificados por grupo, pidieron ${qualifiersPerGroup}.`)
  }
  const sorted = groups.map(sortedByPosition)
  switch (sorted.length) {
    case 1: {
      const group = sorted[0]
      return [[qualifierAt(group, 0).side, qualifierAt(group, 1).side]]
    }
    case 2: {
      const a = sorted[0]
      const b = sorted[1]
      return [
        [qualifierAt(a, 0).side, qualifierAt(b, 1).side],
        [qualifierAt(b, 0).side, qualifierAt(a, 1).side],
      ]
    }
    case 4: {
      const a = sorted[0]
      const b = sorted[1]
      const c = sorted[2]
      const d = sorted[3]
      return [
        [qualifierAt(a, 0).side, qualifierAt(b, 1).side],
        [qualifierAt(c, 0).side, qualifierAt(d, 1).side],
        [qualifierAt(b, 0).side, qualifierAt(a, 1).side],
        [qualifierAt(d, 0).side, qualifierAt(c, 1).side],
      ]
    }
    default:
      throw new Error(`knockoutMatchups no sabe armar cruces para ${sorted.length} grupos.`)
  }
}

/**
 * Arma la ronda siguiente a partir de una ronda YA JUGADA: empareja al
 * ganador del partido `[0]` con el del `[1]`, el de `[2]` con el `[3]`, etc.
 * El ORDEN del array de entrada es lo que define la topología del cuadro —
 * es la misma convención que usa `knockoutMatchups` al armar la primera
 * ronda (ver su doc).
 */
export function nextRoundMatchups(played: readonly MatchResult[]): Array<[Side, Side]> {
  if (played.length % 2 !== 0) {
    throw new Error(`Una ronda de ${played.length} partidos no arma parejas completas para la siguiente.`)
  }
  const winners = played.map(winnerOf)
  const winnerAt = (index: number): Side => {
    const side = winners[index]
    if (side === undefined) throw new Error(`Falta el ganador del partido ${index}.`)
    return side
  }
  const next: Array<[Side, Side]> = []
  for (let index = 0; index < winners.length; index += 2) {
    next.push([winnerAt(index), winnerAt(index + 1)])
  }
  return next
}

/**
 * El cruce por el tercer puesto: los DOS perdedores de las semifinales, uno
 * contra el otro. `nextRoundMatchups` sólo empareja GANADORES — esto es su
 * espejo para el partido que la decisión #3979 asume que EXISTE (aunque el
 * grupo después lo salteé): SEMI genera FINAL y TERCER_PUESTO juntas, y
 * `advancePhase` (Rebanada C2, `db/matchday.ts`) necesita las dos.
 */
export function losingMatchup(played: readonly MatchResult[]): [Side, Side] {
  if (played.length !== 2) {
    throw new Error(`El tercer puesto necesita exactamente 2 semifinales, hay ${played.length}.`)
  }
  const [first, second] = played
  if (first === undefined || second === undefined) {
    throw new Error('Faltan las semifinales para armar el tercer puesto.')
  }
  return [loserOf(first), loserOf(second)]
}

function statsOf(side: Side, groupTable: readonly SideStanding[]): SideStanding {
  const row = groupTable.find((candidate) => sameSide(candidate.side, side))
  if (row === undefined) {
    throw new Error('Un lado de la llave no aparece en la tabla de grupos.')
  }
  return row
}

/**
 * Agujero (b) del design, cerrado acá — surfaceado en el reporte de esta
 * rebanada, no inventado en silencio. `REQ-D7-4` dice a secas "3º/4º
 * semifinalistas perdedores", pero `PHASE_ORDER` tiene una fase
 * `TERCER_PUESTO` que el design (PUNTO 7) genera junto con `FINAL` cuando
 * cierra `SEMI` — si existe, alguien la va a jugar.
 *
 * Regla elegida:
 * - Si el partido de `TERCER_PUESTO` se JUGÓ, SU resultado decide: gana 3º,
 *   pierde 4º. Es lo que la fase existe para resolver.
 * - Si NO se jugó (nada en esta rebanada obliga a jugarlo — riesgo para
 *   quien escriba el guard de `closeMatchday` en la Rebanada D1, ver
 *   `apply-progress-pr21b2`), cae al texto LITERAL del requisito: son
 *   "semifinalistas perdedores" a secas, desempatados por el mismo criterio
 *   que ordena el resto de la tabla — su posición en la fase de grupos.
 * - Sin fase SEMI en la llave (llave de 1 grupo, `knockoutMatchups` dio un
 *   único cruce que ES la final), no hay 3º/4º que definir: no existieron
 *   semifinalistas.
 */
function thirdAndFourth(bracket: readonly MatchResult[], groupTable: readonly SideStanding[]): Side[] {
  const semis = bracket.filter((match) => match.fase === 'SEMI')
  if (semis.length === 0) return []
  const losers = semis.map(loserOf)

  const playoff = bracket.find((match) => match.fase === 'TERCER_PUESTO')
  if (playoff !== undefined && playoff.sets.length > 0) {
    return [winnerOf(playoff), loserOf(playoff)]
  }

  return [...losers].sort((left, right) => statsOf(left, groupTable).position - statsOf(right, groupTable).position)
}

/**
 * Si el 3º/4º de esta llave se resolvió por la tabla de grupos en vez de
 * jugarse (decisión #3979, la mitad que D2 tiene que contar: #3990). MISMA
 * regla que `thirdAndFourth` de arriba, pero expuesta sola: hay semis en la
 * llave (si no, no hay 3º/4º que resolver de ninguna forma) y el partido de
 * `TERCER_PUESTO` o no existe, o existe sin sets cargados.
 */
export function thirdPlaceByGroupTable(matches: readonly MatchResult[]): boolean {
  const hasSemis = matches.some((match) => match.fase === 'SEMI')
  if (!hasSemis) return false
  const playoff = matches.find((match) => match.fase === 'TERCER_PUESTO')
  return playoff === undefined || playoff.sets.length === 0
}

/**
 * Un `TERCER_PUESTO` sin jugar (decisiones #3979/#3988): la rendija exacta
 * que `close_matchday` (0041, SQL) tolera y que `closeMatchday` (db/matchday.ts)
 * salta en su loop de validación. Extraído porque la regla vivía repetida en
 * los dos call sites de TypeScript — mismo remedio que `usesSetsDiff`/
 * `scoreDiffLabel` (design #3801, decisión #12): al aparecer la tercera copia
 * se extrae. El espejo en SQL (0041) NO se puede compartir —otra capa— pero
 * su comentario nombra esta función para que quien toque una encuentre la
 * otra.
 */
export function isUnplayedThirdPlace(match: MatchResult): boolean {
  return match.fase === 'TERCER_PUESTO' && match.sets.length === 0
}

/**
 * Posición final de la fecha cuando hay llave (REQ-D7-4): 1º el ganador de
 * la final, 2º quien la pierde, 3º/4º según `thirdAndFourth` (agujero (b)
 * de arriba), y 5º en adelante en el orden que ya trae `groupTable` —
 * filtrando a quien ya haya salido en el top. `computeAwards` no cambia su
 * firma: sigue recibiendo `SideStanding[]`, así que las estadísticas de
 * fase de grupos (`played`/`won`/`dayPoints`/etc.) de cada lado viajan sin
 * tocar — sólo `position` se reescribe con el resultado de la llave.
 */
export function knockoutPositions(
  bracket: readonly MatchResult[],
  groupTable: readonly SideStanding[],
): SideStanding[] {
  const finals = bracket.filter((match) => match.fase === 'FINAL')
  if (finals.length !== 1) {
    throw new Error(`La llave necesita exactamente un partido de FINAL, hay ${finals.length}.`)
  }
  const [final] = finals
  if (final === undefined) throw new Error('La llave necesita exactamente un partido de FINAL.')

  const topSides = [winnerOf(final), loserOf(final), ...thirdAndFourth(bracket, groupTable)]
  const topRows = topSides.map((side) => statsOf(side, groupTable))
  const restRows = groupTable.filter((row) => !topSides.some((side) => sameSide(side, row.side)))

  return [
    ...topRows.map((row, index) => ({ ...row, position: index + 1 })),
    ...restRows.map((row, index) => ({ ...row, position: topRows.length + index + 1 })),
  ]
}

/**
 * Sugerencia de formato según cuántos lados entran (REQ-D8-1) — propone, no
 * decide: editable antes de armar.
 *
 * W77 (verify-report-pr21-cierre, #4016) / decisión #4022: ANTES tenía sus
 * propios umbrales (`sides > 8` → 4 grupos), copiados a mano de
 * `offerableFormats` y desalineados con ella entre 9 y 11 lados —
 * `suggestFormat` proponía 4 grupos ahí y el selector no los ofrecía. Ahora
 * DERIVA de `offerableFormats` (abajo): propone el `GROUPS_KNOCKOUT` con más
 * grupos que esté ofrecible para `sides`, o `ROUND_ROBIN` si ninguno lo está
 * — la contradicción deja de poder existir porque no hay dos umbrales que
 * puedan desalinearse, hay una sola fuente. `offerableFormats` ya ordena sus
 * candidatos de menos a más grupos (`[2, 4]`), así que el último elemento es
 * siempre el de más grupos.
 *
 * Es la salida real de W32 (decisión #3863): sin grupos, una fecha de 12
 * jugadores de a uno son C(12,2)=66 partidos de round robin puro. Con
 * `sides=12` esto sigue proponiendo `groups: 4`, y la llave completa (grupos
 * + cuartos + semis + final) da 19 partidos — verificado con las funciones
 * reales en el test "12 lados de a uno..." de `core/knockout.test.ts`, no
 * sólo en este comentario.
 */
export function suggestFormat(headcount: number, sideSize: SideSize): MatchdayFormat {
  const sides = Math.floor(headcount / sideSize)
  const groupFormats = offerableFormats(sides).filter(
    (format): format is Extract<MatchdayFormat, { kind: 'GROUPS_KNOCKOUT' }> => format.kind === 'GROUPS_KNOCKOUT',
  )
  return groupFormats.at(-1) ?? { kind: 'ROUND_ROBIN' }
}

function combinations(n: number): number {
  return (n * (n - 1)) / 2
}

/**
 * Cuántos partidos tiene la fase de grupos para `sides` lados repartidos en
 * `groups` grupos. `groupSides` (arriba) los reparte en ZIGZAG, no en partes
 * exactamente iguales: con `sides % groups !== 0`, `sides % groups` grupos
 * quedan con un lado de más. Sumar `C(sides/groups, 2) * groups` a secas
 * ignora ese resto — acá se suma el round robin de CADA tamaño real.
 */
function groupStageMatchCount(sides: number, groups: number): number {
  const base = Math.floor(sides / groups)
  const withExtra = sides % groups
  const withoutExtra = groups - withExtra
  return withExtra * combinations(base + 1) + withoutExtra * combinations(base)
}

/**
 * Cuántos partidos tiene la llave para un cuadro de `groups * qualifiersPerGroup`
 * lados. Un cuadro de N lados juega N-1 partidos para tener un único campeón
 * (la cuenta de siempre de una eliminación directa) — más el tercer puesto,
 * que `matchupsAfterKnockout` (db/matchday.ts) genera SIEMPRE al cerrar la
 * semifinal (decisión #3979), exista o no una fase SEMI: sin semifinal
 * (cuadro de 2, un solo cruce que YA es la final) no hay perdedores de semi
 * que enfrentar, así que no hay tercer puesto.
 */
function knockoutMatchCount(groups: number, qualifiersPerGroup: number): number {
  const bracketSize = groups * qualifiersPerGroup
  const hasThirdPlace = bracketSize >= 4 ? 1 : 0
  return bracketSize - 1 + hasThirdPlace
}

/**
 * El número REAL de partidos que promete un `MatchdayFormat` para `sides`
 * lados (W72, verify-report-pr21 #4004): el armado seguía usando
 * `(sides*(sides-1))/2` —la fórmula del round robin— incluso DESPUÉS de que
 * el admin ya hubiera elegido grupos, y con `GROUPS_KNOCKOUT` ese número no
 * describe nada real: promete 28 partidos donde de verdad se juegan 16.
 */
export function matchCountForFormat(format: MatchdayFormat, sides: number): number {
  if (format.kind === 'ROUND_ROBIN') return combinations(sides)
  return groupStageMatchCount(sides, format.groups) + knockoutMatchCount(format.groups, format.qualifiersPerGroup)
}

/** El tamaño de grupo MÁS CHICO que deja `sides` lados en `groups` grupos (reparto zigzag de `groupSides`). */
function smallestGroupSize(sides: number, groups: number): number {
  return Math.floor(sides / groups)
}

/**
 * Los formatos que el selector puede OFRECER para `sides` lados (W75,
 * verify-report-pr21 #4004 / decisión de Stefano en
 * `decisions/formatos-ofrecidos-en-el-armado`): `ROUND_ROBIN` siempre, más
 * cada `GROUPS_KNOCKOUT` de `groups ∈ {2, 4}` (`knockoutMatchups` sabe armar
 * también 1, ver abajo por qué queda afuera) donde CADA grupo tenga 3 lados o
 * más (`smallestGroupSize(sides, groups) >= 3`).
 *
 * Dos razones, no una:
 * 1. `groups = 1` queda afuera SIEMPRE, sin excepción: un grupo + llave es
 *    el mismo round robin de siempre más un partido extra
 *    (`matchCountForFormat` de 1 grupo = `combinations(sides) + 1`) — nunca
 *    ahorra nada, y `suggestFormat` tampoco lo propone jamás.
 * 2. Un grupo de 2 lados con `qualifiersPerGroup = 2` tiene tasa de
 *    eliminación CERO: pasan los dos, el grupo no decide nada. No es una
 *    regla estética, es aritmética.
 */
export function offerableFormats(sides: number): MatchdayFormat[] {
  const formats: MatchdayFormat[] = [{ kind: 'ROUND_ROBIN' }]
  for (const groups of [2, 4] as const) {
    if (smallestGroupSize(sides, groups) >= 3) {
      formats.push({ kind: 'GROUPS_KNOCKOUT', groups, qualifiersPerGroup: 2 })
    }
  }
  return formats
}
