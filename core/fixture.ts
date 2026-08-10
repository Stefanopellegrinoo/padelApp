const BYE = -1

/**
 * Round robin with the circle method: pair 0 stays put and the rest rotate one
 * step each round, so every pair meets every other exactly once.
 *
 * With an odd number of pairs a phantom BYE joins the circle; whoever draws it
 * sits that round out, and the match is simply left out of the result. That is
 * arithmetic, not a shortcut — five pairs cannot all play at the same time.
 *
 * Returns rounds of matches, each match a tuple of pair indices.
 */
export function buildFixture(pairCount: number): Array<Array<[number, number]>> {
  if (pairCount < 2) {
    throw new Error(`Hacen falta al menos 2 parejas para jugar, hay ${pairCount}.`)
  }

  const circle: number[] = Array.from({ length: pairCount }, (_, i) => i)
  if (circle.length % 2 !== 0) circle.push(BYE)

  const size = circle.length
  const rounds: Array<Array<[number, number]>> = []

  for (let round = 0; round < size - 1; round++) {
    const matches: Array<[number, number]> = []
    for (let i = 0; i < size / 2; i++) {
      const home = circle[i]
      const away = circle[size - 1 - i]
      if (home === undefined || away === undefined) continue
      if (home === BYE || away === BYE) continue
      matches.push([home, away])
    }
    rounds.push(matches)

    // Rotate everything but the first slot.
    const fixed = circle[0]
    const last = circle[size - 1]
    if (fixed === undefined || last === undefined) break
    circle.splice(0, size, fixed, last, ...circle.slice(1, size - 1))
  }

  return rounds
}
