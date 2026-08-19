import { MASTERS_SIZE } from './constants'
import { members, pair } from './side'
import type { EntryId, MatchResult, RankingRow, Side } from './types'

export type MastersFour = [EntryId, EntryId, EntryId, EntryId]

/** The top four of the annual ranking, in ranking order. */
export function mastersQualifiers(ranking: RankingRow[]): MastersFour {
  if (ranking.length < MASTERS_SIZE) {
    throw new Error(`Hacen falta ${MASTERS_SIZE} jugadores para el Masters, hay ${ranking.length}.`)
  }
  const [first, second, third, fourth] = ranking
  if (
    first === undefined ||
    second === undefined ||
    third === undefined ||
    fourth === undefined
  ) {
    throw new Error('El ranking no tiene suficientes filas para el Masters.')
  }
  return [first.entryId, second.entryId, third.entryId, fourth.entryId]
}

/**
 * Three matches with rotating partners, so everyone plays once with everyone.
 * This is what separates two players who spent the season winning together and
 * therefore finished on identical points.
 */
/*
 * El Masters se juega SIEMPRE de a parejas: son las tres formas de repartir
 * los mismos cuatro clasificados. Por eso `pair()` con literal `size: 2` y no
 * un `Side` de tamaño variable — una disciplina de a uno no arma Masters, y
 *`generateMastersPairs` la corta antes con su propio guard (W39, ronda 12).
 */
export function mastersFixture(four: MastersFour): Array<{ sideA: Side; sideB: Side }> {
  const [one, two, three, fourth] = four
  return [
    { sideA: pair(one, fourth), sideB: pair(two, three) },
    { sideA: pair(one, three), sideB: pair(two, fourth) },
    { sideA: pair(one, two), sideB: pair(three, fourth) },
  ]
}

/**
 * The champion of the year.
 *
 * The format only allows two outcomes: someone wins all three, or three players
 * tie on two and one is left on zero. The head to head cannot break that tie —
 * everyone played with and against everyone — so the cut is the annual ranking:
 * finishing higher does not hand you the title, but it settles any tie in your
 * favour, which is what makes the regular season worth something.
 */
export function mastersChampion(four: MastersFour, matches: MatchResult[]): EntryId {
  const wins = new Map<EntryId, number>(four.map((id) => [id, 0]))
  const rank = new Map<EntryId, number>(four.map((id, index) => [id, index]))

  for (const match of matches) {
    if (match.sets.length === 0) continue
    let setsA = 0
    let setsB = 0
    for (const set of match.sets) {
      if (set.gamesA > set.gamesB) setsA++
      else if (set.gamesB > set.gamesA) setsB++
    }
    if (setsA === setsB) continue
    const winner = setsA > setsB ? match.sideA : match.sideB
    for (const id of members(winner)) {
      if (!wins.has(id)) continue
      wins.set(id, (wins.get(id) ?? 0) + 1)
    }
  }

  const OUTSIDE = Number.MAX_SAFE_INTEGER
  const champion = [...four].sort((left, right) => {
    const winDiff = (wins.get(right) ?? 0) - (wins.get(left) ?? 0)
    if (winDiff !== 0) return winDiff
    return (rank.get(left) ?? OUTSIDE) - (rank.get(right) ?? OUTSIDE)
  })[0]

  if (champion === undefined) {
    throw new Error('No se pudo determinar el campeón del Masters.')
  }
  return champion
}
