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

/**
 * Null when the set could have been played, a Spanish reason when it could not.
 *
 * `allowsDraw` es OBLIGATORIO y no tiene default (W61,
 * y design #3801 `validaciones generalizadas`: `setError(set, format,
 * allowsDraw)`). Un default `false` compilaría en todos los call sites de hoy y
 * dejaría a cualquiera futuro rechazando empates sin enterarse — que es
 * EXACTAMENTE la asimetría que N44 describe para las columnas con default y la
 * que produjo este bug dos veces (`pair_size` en PR18a, `allows_draw` acá). Sin
 * default, el compilador obliga a decidir en cada llamada.
 */
export function setError(set: SetScore, format: MatchFormat, allowsDraw: boolean): string | null {
  const { gamesA, gamesB } = set

  if (!Number.isInteger(gamesA) || !Number.isInteger(gamesB) || gamesA < 0 || gamesB < 0) {
    return 'Los games tienen que ser números enteros y no negativos.'
  }
  // El empate es una regla ORTOGONAL al marcador abierto y se decide acá, para
  // los dos caminos: `match_sets_no_draw` (0034) lo sigue exigiendo del lado de
  // la base con `check (allows_draw or games_a <> games_b)`. Si `openScore`
  // aflojara el empate por su cuenta, la app aceptaría un `0-0` que la base
  // rechaza y el mensaje legible se cambiaría por una violación de constraint.
  if (gamesA === gamesB && !allowsDraw) {
    return format.openScore
      ? `Un partido no puede terminar ${gamesA} a ${gamesB}: esta disciplina no admite empates.`
      : `Un set no puede terminar ${gamesA} a ${gamesB}: en padel no hay empates.`
  }

  // Marcador abierto: no hay número objetivo. Cualquier par de enteros >= 0 es
  // legal —`3-1`, `0-0`, `7-2`— y eso es todo lo que queda por decir después de
  // los dos guards de arriba, que son bordes de confianza y NO se aflojan.
  // `gamesPerSet` y `tieBreak` describen un set de pádel y no significan nada
  // en un marcador de goles.
  if (format.openScore) return null

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

/**
 * Null when the match is a finished, legal match for the format.
 *
 * `allowsDraw` obligatorio por la misma razón que en `setError`.
 */
export function matchError(
  sets: readonly SetScore[],
  format: MatchFormat,
  allowsDraw: boolean,
): string | null {
  if (sets.length === 0) return 'Falta cargar el resultado de este partido.'

  for (const set of sets) {
    const problem = setError(set, format, allowsDraw)
    if (problem !== null) return problem
  }

  // Un marcador abierto es UN PARTIDO, no una serie de sets: el resultado es el
  // par de números y ahí termina. No hay `setsToWin` que exigir ni ganador que
  // declarar — un `0-0` está tan terminado como un `3-1`, y quién ganó lo
  // deduce quien tabula, no quien valida.
  if (format.openScore) {
    return sets.length === 1
      ? null
      : `Un partido con marcador abierto se carga con un solo resultado, no ${sets.length}.`
  }

  let wonA = 0
  let wonB = 0
  for (const set of sets) {
    // Con `allowsDraw` un set puede quedar sin dueño; sin él, `setError` ya
    // descartó el empate y la tercera rama es inalcanzable.
    if (set.gamesA > set.gamesB) wonA++
    else if (set.gamesB > set.gamesA) wonB++
  }

  const { setsToWin } = format
  const winner = Math.max(wonA, wonB)
  const loser = Math.min(wonA, wonB)
  const sets_ = setsToWin === 1 ? 'set' : 'sets'

  // Un partido EMPATADO no lo cierra nadie, así que `setsToWin` no se puede
  // exigir. Pero un empate sólo TERMINA el partido cuando el formato es de UN
  // set: ahí se jugó todo lo que había para jugar. Con `setsToWin > 1` se juega
  // hasta que alguien LLEGUE a N, así que un 1-1 en un partido a 2 sets está a
  // mitad de camino y no cierra nada.
  //
  // Esto antes devolvía `null` para ese 1-1
  // —dando por terminado un partido sin terminar, que es la clase de cosa que
  // congela puntos mal—, amparado en un comentario que declaraba el caso
  // "inalcanzable porque el modelo de formato sólo puede expresar disciplinas
  // de un solo set". Medido, era falso: `validateConfig` acepta `setsToWin: 2`
  // sobre una disciplina con empates devolviendo `[]`, y `config` SÍ está en el
  // grant de UPDATE de `authenticated`. Ese mismo comentario nombraba a
  // `openScore` como su resolución, y acá está: el modelo ya distingue "partido
  // a N sets" de "partido a un marcador abierto", el segundo se fue arriba con
  // su propio `return`, y a éste le queda decir la verdad sobre el primero.
  if (allowsDraw && wonA === wonB) {
    return setsToWin === 1 && sets.length === 1
      ? null
      : `El partido se define en ${setsToWin} ${sets_}: ${sets.length} no lo cierra.`
  }

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
 * partidos, no jugadores (W32), y esa unidad SÍ
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
 * Un lado NO COBRA cuando TODOS sus miembros son invitados — la misma
 * definición que usa `computeAwards` (`championshipMembers`), y la única que
 * no depende de la aridad. Cómo se cuentan esos lados sí depende:
 *
 *   · de a DOS, un lock de dos invitados es exactamente un lado sin pagar, y
 *     un lock de invitado + alguien del plantel SÍ cobra (el compañero jugó y
 *     se lo ganó), así que sólo se restan los locks de dos invitados;
 *   · de a UNO, cada invitado ES su propio lado y ninguno cobra, así que se
 *     restan TODOS los invitados. Los locks no significan nada acá:
 *     `buildSides` con `sideSize === 1` ignora `fixedPairs` entero.
 *
 * C16: dividía siempre por 2 — el guard que existe
 * justo para avisar "faltan valores de puntos" ANTES del sorteo quedaba
 * ciego con `sideSize=1` y encima imprimía una FRACCIÓN en el mensaje
 * ("4.5 parejas") con un headcount impar.
 *
 * W41: C16 arregló el divisor y dejó el sustraendo.
 * Con `sideSize=1` restaba UN lado por lock donde son DOS, así que un plantel
 * completo de a uno más una pareja invitada rebotaba con un número inflado en
 * uno — y `addGuestPair` es hoy el único camino para sumar un invitado a una
 * fecha de a uno, así que ese camino quedaba muerto.
 */
export function assertPointsCoverMatchday(
  present: readonly string[],
  guests: readonly GuestSeat[],
  locks: readonly PairLock[],
  config: SeasonConfig,
  sideSize: SideSize,
): void {
  const isGuest = new Set(guests.map((guest) => guest.entryId))
  const unpaidSides =
    sideSize === 1
      ? guests.filter((guest) => present.includes(guest.entryId)).length
      : locks.filter((lock) => isGuest.has(lock.a) && isGuest.has(lock.b)).length
  const championshipSides = present.length / sideSize - unpaidSides

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
