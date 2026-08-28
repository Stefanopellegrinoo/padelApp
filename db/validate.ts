import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  validateConfig,
  type MatchFormat,
  type SeasonConfig,
  type SetScore,
} from '@/core'
import { EdgeError } from './errors'

/** A guest seat as the database holds it. */
export interface GuestSeat {
  entryId: string
  displayName: string
}

/** A pair the admin settled before the draw — a row of `pair_locks`. */
export interface PairLock {
  a: string
  b: string
}

/**
 * `validateConfig` RETURNS its problems, it never throws, so it only protects
 * callers who read the result. This is the one place that reads it — skipping
 * it is not untidy, it is a hang: `tiebreakSnapshotEvery: 0` makes
 * `snapshotForMatchday` loop forever.
 */
export function assertValidConfig(config: SeasonConfig): void {
  const errors = validateConfig(config)
  if (errors.length > 0) throw new EdgeError(errors.join(' '))
}

/** Null when the set could have been played, a Spanish reason when it could not. */
export function setError(set: SetScore, format: MatchFormat): string | null {
  const { gamesA, gamesB } = set

  if (!Number.isInteger(gamesA) || !Number.isInteger(gamesB) || gamesA < 0 || gamesB < 0) {
    return 'Los games tienen que ser números enteros y no negativos.'
  }
  if (gamesA === gamesB) {
    return `Un set no puede terminar ${gamesA} a ${gamesB}: en padel no hay empates.`
  }

  const { gamesPerSet, tieBreak } = format
  const winner = Math.max(gamesA, gamesB)
  const loser = Math.min(gamesA, gamesB)

  if (tieBreak) {
    // El tie-break corta en gamesPerSet exacto: no existe el 5-3.
    if (winner !== gamesPerSet) {
      return `En un set a ${gamesPerSet} games con tie-break, ${gamesA}-${gamesB} no es un resultado posible.`
    }
    return null
  }

  const closed = winner >= gamesPerSet && (winner === gamesPerSet || winner - loser === 2)
  if (!closed || winner - loser < 2) {
    return `En un set a ${gamesPerSet} games sin tie-break hay que ganar por dos: ${gamesA}-${gamesB} no cierra el set.`
  }
  return null
}

/** Null when the match is a finished, legal match for the format. */
export function matchError(sets: readonly SetScore[], format: MatchFormat): string | null {
  if (sets.length === 0) return 'Falta cargar el resultado de este partido.'

  for (const set of sets) {
    const problem = setError(set, format)
    if (problem !== null) return problem
  }

  let wonA = 0
  let wonB = 0
  for (const set of sets) {
    // setError already ruled out a draw, so one of the two always took it.
    if (set.gamesA > set.gamesB) wonA++
    else wonB++
  }

  const { setsToWin } = format
  const winner = Math.max(wonA, wonB)
  const loser = Math.min(wonA, wonB)
  const sets_ = setsToWin === 1 ? 'set' : 'sets'

  if (winner !== setsToWin) {
    return `El partido se define en ${setsToWin} ${sets_}: ${wonA}-${wonB} no lo cierra.`
  }
  if (loser >= setsToWin) {
    return `Sobran sets: ${wonA}-${wonB} en un partido a ${setsToWin} ${sets_}.`
  }
  return null
}

export function assertMatchdaySize(present: readonly string[]): void {
  if (present.length < MIN_PLAYERS) {
    throw new EdgeError(
      `Con ${present.length} no hay fecha: hacen falta ${MIN_PLAYERS - present.length} más.`,
    )
  }
  if (present.length > MAX_PLAYERS) {
    throw new EdgeError(
      `Con ${present.length} no entra en una tarde: sobran ${present.length - MAX_PLAYERS}.`,
    )
  }
  if (present.length % 2 !== 0) {
    throw new EdgeError(`Son ${present.length} y sólo se juega de a pares. Falta uno.`)
  }
}

/**
 * What the admin is allowed to settle before the draw, and what they are not.
 *
 * Every lock must include a guest. Two squad players locked by hand would skip
 * the no-repeat rule, and that rule IS the format: it is the one thing the whole
 * pairing algorithm exists to enforce.
 *
 * How MANY guests may be left to the draw is NOT decided here. Every guest gets
 * both options — a partner picked by hand, or the draw (spec 2.6) — and how many
 * the draw can take is a count of who is playing, which this function never
 * sees. That count lives in `assertSquadCoversLooseGuests`, below.
 */
export function assertLocksAndGuests(
  guests: readonly GuestSeat[],
  locks: readonly PairLock[],
): void {
  const isGuest = new Set(guests.map((guest) => guest.entryId))
  const locked = new Set<string>()

  for (const lock of locks) {
    if (!isGuest.has(lock.a) && !isGuest.has(lock.b)) {
      throw new EdgeError(
        'Una pareja fijada a mano tiene que incluir a un invitado: dos jugadores del torneo no se pueden poner juntos.',
      )
    }
    for (const entryId of [lock.a, lock.b]) {
      if (locked.has(entryId)) {
        throw new EdgeError('Alguien está fijado en dos parejas a la vez.')
      }
      locked.add(entryId)
    }
  }
}

/**
 * How many guests can be left to the draw: as many as there are squad players
 * free to partner them, and not one more.
 *
 * The draw hands out exactly one squad player per loose guest, by construction.
 * `orderPool` sends the guests to the TAIL of the pool and `buildPairs` picks
 * the matching of lowest imbalance, which is the one pairing position `i` with
 * position `n+1-i`. A guest sitting at position `p` only draws another guest
 * when `p > S` AND `n+1-p > S`, and both hold only if `G > S`. So while the
 * loose guests do not outnumber the free squad players, every one of them comes
 * out with a different squad player — that is the mechanism, not luck, and
 * `core/pairing.test.ts:186` pins it.
 *
 * Past that line the pigeonhole takes over and at least one pair comes out
 * guest-guest. That pair is unpaid (`computeAwards` drops it) and
 * `assertPointsCoverMatchday` cannot see it: it counts guest-only pairs over
 * `pair_locks`, so a pair the DRAW produced is invisible to it. Holding the
 * line here is what keeps that lock-only count exact.
 *
 * Lives apart from `assertLocksAndGuests` because it needs the attendance, and
 * that is only read on the draw path (`pairingContextFor`): asking for it in
 * `matchdayContextFor` would run a draw validation while CLOSING a matchday,
 * which is how a matchday gets stuck.
 */
export function assertSquadCoversLooseGuests(
  present: readonly string[],
  guests: readonly GuestSeat[],
  locks: readonly PairLock[],
): void {
  const isGuest = new Set(guests.map((guest) => guest.entryId))
  const locked = new Set(locks.flatMap((lock) => [lock.a, lock.b]))

  const loose = guests.filter((guest) => !locked.has(guest.entryId)).length
  const free = present.filter(
    (entryId) => !isGuest.has(entryId) && !locked.has(entryId),
  ).length
  if (loose <= free) return

  throw new EdgeError(
    `Hay ${loose} invitados sueltos y quedan ${free} jugadores del torneo libres para acompañarlos. Poné en pareja invitada a los que sobran, o sacalos de la fecha.`,
  )
}

/**
 * `points` holds exactly squadSize / 2 values, so a matchday padded with a guest
 * team can end up with more championship pairs than there are positions to pay.
 * With a squad of eight and a visiting team, eight players plus two guests make
 * five pairs and only four values exist.
 *
 * A lock made of two guests is the only kind of pair that does not get paid, so
 * it is the only one subtracted. A lock of guest plus squad player does get
 * paid — the partner played and earned it.
 *
 * Counting over `pair_locks` alone is exact only because
 * `assertSquadCoversLooseGuests` already ruled out a guest-guest pair coming out
 * of the DRAW, which has no lock to be counted by.
 */
export function assertPointsCoverMatchday(
  present: readonly string[],
  guests: readonly GuestSeat[],
  locks: readonly PairLock[],
  config: SeasonConfig,
): void {
  const isGuest = new Set(guests.map((guest) => guest.entryId))
  const guestOnlyPairs = locks.filter(
    (lock) => isGuest.has(lock.a) && isGuest.has(lock.b),
  ).length
  const championshipPairs = present.length / 2 - guestOnlyPairs

  if (championshipPairs > config.points.length) {
    throw new EdgeError(
      `La fecha deja ${championshipPairs} parejas del torneo y la temporada sólo definió puntos para ${config.points.length} posiciones. Agregá valores en Ajustes o sacá un invitado.`,
    )
  }
}

/** Spec 2.6: pairs can be drawn with a nameless guest, but the matchday cannot open. */
export function assertGuestsNamed(guests: readonly GuestSeat[]): void {
  const unnamed = guests.filter((guest) => guest.displayName.trim().length === 0)
  if (unnamed.length === 0) return

  throw new EdgeError(
    unnamed.length === 1
      ? 'Falta ponerle nombre al invitado. Sin eso, nadie sabe quién es el que falta.'
      : `Faltan los nombres de ${unnamed.length} invitados. Sin eso, nadie sabe quiénes son.`,
  )
}
