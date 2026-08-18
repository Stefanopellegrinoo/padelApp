import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  validateConfig,
  type MatchFormat,
  type SeasonConfig,
  type SetScore,
  type SideSize,
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
export function assertValidConfig(config: SeasonConfig, sideSize: SideSize): void {
  const errors = validateConfig(config, sideSize)
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

/**
 * `sideSize` condiciona la paridad (W24, REQ-D5-2): con `sideSize=1` cada
 * presente es su propio lado, así que un headcount impar no le falta nada a
 * nadie. El piso/techo sigue sin condicionar: es cantidad, no paridad, y
 * REQ-D2-2 no lo toca directamente. Pero el TECHO (`MAX_PLAYERS`) mide
 * partidos, no jugadores (W32, verify-report ronda 9), y esa unidad SÍ
 * cambia con `sideSize` — dejarlo sin condicionar es deuda documentada, no
 * una decisión cerrada (ver el comentario de `MAX_PLAYERS`).
 */
export function assertMatchdaySize(present: readonly string[], sideSize: SideSize): void {
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
  if (sideSize === 2 && present.length % 2 !== 0) {
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
 * And at most one guest may be left to the draw — the one who fills in for
 * whoever was left without a partner. Everyone else came as a team, or was
 * placed next to somebody on purpose (spec 2.6).
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

  const loose = guests.filter((guest) => !locked.has(guest.entryId)).length
  if (loose > 1) {
    throw new EdgeError(
      `Hay ${loose} invitados sueltos. Sólo uno puede jugar con alguien del torneo: al resto hay que ponerlos en pareja.`,
    )
  }
}

/**
 * `points` holds exactly squadSize / sideSize values, so a matchday padded
 * with a guest team can end up with more championship sides than there are
 * positions to pay. With a squad of eight and a visiting pair, eight players
 * plus two guests make five sides and only four values exist.
 *
 * A lock made of two guests is the only kind of side that does not get paid, so
 * it is the only one subtracted. A lock of guest plus squad player does get
 * paid — the partner played and earned it.
 *
 * C16 (verify-report ronda 9): dividía siempre por 2 — el guard que existe
 * justo para avisar "faltan valores de puntos" ANTES del sorteo quedaba
 * ciego con `sideSize=1` y encima imprimía una FRACCIÓN en el mensaje
 * ("4.5 parejas") con un headcount impar.
 */
export function assertPointsCoverMatchday(
  present: readonly string[],
  guests: readonly GuestSeat[],
  locks: readonly PairLock[],
  config: SeasonConfig,
  sideSize: SideSize,
): void {
  const isGuest = new Set(guests.map((guest) => guest.entryId))
  const guestOnlyPairs = locks.filter(
    (lock) => isGuest.has(lock.a) && isGuest.has(lock.b),
  ).length
  const championshipSides = present.length / sideSize - guestOnlyPairs

  if (championshipSides > config.points.length) {
    throw new EdgeError(
      sideSize === 1
        ? `La fecha deja ${championshipSides} competidores del torneo y la temporada sólo definió puntos para ${config.points.length} posiciones. Agregá valores en Ajustes o sacá un invitado.`
        : `La fecha deja ${championshipSides} parejas del torneo y la temporada sólo definió puntos para ${config.points.length} posiciones. Agregá valores en Ajustes o sacá un invitado.`,
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
