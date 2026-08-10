import { orderByPoints } from './order'
import type { Award, EntryId, RankingRow, SeasonConfig } from './types'

/**
 * The season table. Only each player's best countBestOf results count, so
 * missing a date or two does not knock anyone out of the race.
 *
 * Anyone outside the squad is ignored: guests collect no awards, and awards
 * that name them are dropped here as a second line of defence.
 */
export function computeRanking(
  awardsByMatchday: Map<number, Award[]>,
  squad: EntryId[],
  config: SeasonConfig,
  snapshot: EntryId[],
): RankingRow[] {
  const inSquad = new Set(squad)
  const collected = new Map<EntryId, number[]>(squad.map((id) => [id, []]))

  for (const awards of awardsByMatchday.values()) {
    for (const award of awards) {
      if (!inSquad.has(award.entryId)) continue
      collected.get(award.entryId)?.push(award.points)
    }
  }

  const rows = new Map<EntryId, RankingRow>()
  for (const entryId of squad) {
    const all = [...(collected.get(entryId) ?? [])].sort((left, right) => right - left)
    const counted = all.slice(0, config.countBestOf)
    const discarded = all.slice(config.countBestOf)
    rows.set(entryId, {
      entryId,
      points: counted.reduce((sum, value) => sum + value, 0),
      counted,
      discarded,
    })
  }

  const points = new Map([...rows].map(([entryId, row]) => [entryId, row.points]))
  return orderByPoints(squad, points, snapshot).map((entryId) => {
    const row = rows.get(entryId)
    if (row === undefined) {
      throw new Error(`Falta la fila del ranking de ${entryId}.`)
    }
    return row
  })
}
