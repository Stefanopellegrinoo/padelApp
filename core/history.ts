import { members, sameSide, type Duo } from './side'
import type { Award, Side } from './types'

/** One closed matchday, as it was stored. */
export interface MatchdayHistory {
  /** Los lados de esa fecha, de uno o de dos según la disciplina. */
  sides: Side[]
  /** Frozen at close. Empty for a matchday that never closed. */
  awards: Award[]
}

/** What the draw of the next matchday needs to know about the ones before it. */
export interface PreviousContext {
  defenders: Duo | null
  defendersAlreadyRepeated: boolean
  previousPairs: Duo[]
}

/**
 * The champion-defender rule, derived from the two matchdays before this one.
 *
 * Nothing about it is stored (spec 3.3): `pairs` carries no defender flag,
 * because that would be duplicated state waiting to drift the first time
 * somebody reopens a matchday. Whether the defenders actually stay together is
 * not decided here — `buildPairs` decides that, since it is the one that knows
 * who turned up.
 *
 * `last` and `beforeLast` are the two matchdays immediately before, in that
 * order, or null when the season has not played that many — closed or not; a
 * matchday that never closed simply carries no awards, so it yields no
 * defenders while still contributing its pairs.
 */
export function previousContext(
  last: MatchdayHistory | null,
  beforeLast: MatchdayHistory | null,
): PreviousContext {
  if (last === null) {
    return { defenders: null, defendersAlreadyRepeated: false, previousPairs: [] }
  }

  const defenders = championsOf(last)
  // Defensores, repetición y parejas previas son restricciones DEL SORTEO DE
  // PAREJAS, y el sorteo de a uno no tiene ninguna (`buildSides` con
  // `sideSize === 1` las ignora enteras, core/pairing.ts). Por eso los lados de
  // uno se filtran: con una historia de a uno esto devuelve el mismo triple
  // neutro que `last === null`, que es lo que el guard de C19 hardcodea en
  // `pairingContextFor` — ahora derivado en vez de repetido.
  const previousPairs = duosOnly(last.sides)
  const alreadyRepeated =
    defenders !== null && duosOnly(beforeLast?.sides ?? []).some((side) => sameSide(side, defenders))

  return { defenders, defendersAlreadyRepeated: alreadyRepeated, previousPairs }
}

/**
 * Sólo los lados de dos. Un lado de uno no es una pareja y se cae acá.
 *
 * S43: filtrar en silencio es lo contrario del
 * criterio que S37 impuso en `sideOfRow` —que TIRA cuando la forma no cierra—,
 * y la asimetría es deliberada porque acá el silencio no puede perder nada:
 * una historia con lados MIXTOS es inalcanzable, y lo impide la BASE, no un
 * `if`. `pairs_matchday_size` clava cada fila de `pairs` al `pair_size` de su
 * fecha, `matchdays_discipline_size` impide que una disciplina cambie de
 * aridad con fechas ya creadas (probado con un `update` real en la ronda 13:
 * lo rechaza la FK), y las dos entradas de `previousContext` salen del mismo
 * `discipline_id`. O sea: o vienen todos de uno, o todos de dos.
 */
function duosOnly(sides: readonly Side[]): Duo[] {
  return sides.filter((side): side is Duo => side.size === 2)
}

/**
 * The champions are whichever pair took championship position one in the frozen
 * awards. A pair made only of guests collects no award, so it can never come out
 * of here — which is the rule, not an accident.
 */
function championsOf(matchday: MatchdayHistory): Duo | null {
  const winners = new Set(
    matchday.awards.filter((award) => award.position === 1).map((award) => award.entryId),
  )
  if (winners.size === 0) {
    if (matchday.awards.length > 0) {
      throw new Error('La fecha anterior tiene awards pero ninguno en la posición 1.')
    }
    return null
  }

  // `members(side)` y no `pair.a`/`pair.b`: "¿hay un ganador de este lado?" no
  // depende de la aridad, así que esta línea vale igual para uno o para dos.
  const champions = matchday.sides.filter((side) =>
    members(side).some((entryId) => winners.has(entryId)),
  )
  if (champions.length !== 1) {
    throw new Error(
      `La fecha anterior tiene ${champions.length} parejas en la posición 1; tiene que haber exactamente una.`,
    )
  }
  const champion = champions[0]
  // Un lado de uno NO es una pareja defensora: la regla del campeón que
  // defiende es una restricción del sorteo de parejas, y en una disciplina de
  // a uno no hay con quién repetir. Devolver `null` acá es la misma respuesta
  // que da el caso "no hubo fecha anterior", que es la correcta.
  if (champion === undefined || champion.size === 1) return null
  return champion
}
