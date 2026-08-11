import type { Award, EntryId } from './types'

/** How many matchdays in a row a player has finished champion. */
export interface Streak {
  entryId: EntryId
  /** The longest run of the whole season. */
  longest: number
  /** The run still open at the last closed matchday. Zero if it is broken. */
  current: number
}

/**
 * The title streak, per player.
 *
 * It is per PLAYER and not per pair on purpose: a champion pair plays exactly
 * two matchdays together and then splits (spec 2.5), so a pair can defend at
 * most once and its "streak" would only ever be 0 or 1. A player, on the other
 * hand, can keep winning with a different partner each time.
 *
 * Missing a matchday breaks the run: if you did not play you did not win.
 * Only closed matchdays carry awards, so only they can appear in the map.
 */
export function titleStreaks(
  awardsByMatchday: Map<number, Award[]>,
  squad: readonly EntryId[],
): Streak[] {
  // Se ordena por número de fecha y no por orden de inserción: un Map conserva
  // el orden en que le metieron las claves, y quien lo arme desde la base no
  // tiene por qué haberlas puesto en orden.
  const numbers = [...awardsByMatchday.keys()].sort((left, right) => left - right)

  const championsOf = (number: number): Set<EntryId> =>
    new Set(
      (awardsByMatchday.get(number) ?? [])
        .filter((award) => award.position === 1)
        .map((award) => award.entryId),
    )
  const champions = numbers.map(championsOf)

  return squad.map((entryId) => {
    let longest = 0
    let run = 0
    for (const winners of champions) {
      run = winners.has(entryId) ? run + 1 : 0
      if (run > longest) longest = run
    }
    return { entryId, longest, current: run }
  })
}
