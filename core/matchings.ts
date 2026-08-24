import { MAX_PAIRING_POOL } from './constants'
import { pair, type Duo } from './side'
import type { EntryId } from './types'

/**
 * Every perfect matching of the pool. The count is (n-1)!!, which stays tiny
 * for our sizes: 105 for eight players, 10395 for twelve. Brute force gives
 * the guaranteed optimum in milliseconds, so no heuristic is needed.
 *
 * The first player is fixed and paired with each of the rest in turn, which
 * is what keeps every matching unique instead of producing permutations.
 */
export function allMatchings(pool: EntryId[]): Duo[][] {
  if (pool.length % 2 !== 0) {
    throw new Error(`No se puede emparejar un pool impar: son ${pool.length} jugadores.`)
  }
  if (pool.length > MAX_PAIRING_POOL) {
    throw new Error(
      `El pool es demasiado grande para emparejar: son ${pool.length}, el máximo es ${MAX_PAIRING_POOL}.`,
    )
  }
  if (pool.length === 0) return [[]]

  const [first, ...rest] = pool
  // Unreachable: pool.length is even and not 0 at this point (checked
  // above), so pool has at least two elements and `first` is always set.
  // Only here to satisfy noUncheckedIndexedAccess.
  if (first === undefined) return [[]]

  const result: Duo[][] = []
  for (let i = 0; i < rest.length; i++) {
    const partner = rest[i]
    // Unreachable: i stays within rest's own bounds (0..rest.length-1), so
    // rest[i] is always set. Only here to satisfy noUncheckedIndexedAccess.
    if (partner === undefined) continue
    const remaining = rest.filter((_, index) => index !== i)
    for (const sub of allMatchings(remaining)) {
      result.push([pair(first, partner), ...sub])
    }
  }
  return result
}
