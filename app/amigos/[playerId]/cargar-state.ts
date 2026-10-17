import type { MatchFormat, SetsSport } from '@/core'
import { EdgeError } from '@/db/errors'
import type { CasualPlayerInput } from '@/db/friends'
import { isComplete, type LoadState } from '@/app/torneo/[id]/[disciplina]/fechas/[n]/carga-state'

/** Quién ocupa un lugar del partido: un amigo con cuenta o un invitado con nombre. */
export type Slot = { kind: 'friend'; playerId: string } | { kind: 'guest'; name: string }
export type Mode = '1v1' | '2v2'
export type SlotKey = 'partner' | 'rival1' | 'rival2'
export type Slots = Partial<Record<SlotKey, Slot | null>>

const SLOT_KEYS: Record<Mode, SlotKey[]> = {
  '1v1': ['rival1'],
  '2v2': ['partner', 'rival1', 'rival2'],
}

/** Los lugares a completar en cada modo (yo ya estoy, del lado mine). */
export function slotsFor(mode: Mode): SlotKey[] {
  return SLOT_KEYS[mode]
}

/**
 * Primer problema de los lugares del modo, o `null` si se puede enviar.
 * `mustPlay` es el amigo de la pantalla: el historial es por amigo, así que un
 * partido sin él no aparecería en ningún lado (el servidor lo exige también,
 * `assertFriendPlays`).
 */
export function slotsError(mode: Mode, slots: Slots, mustPlay?: { playerId: string; name: string }): string | null {
  const seen = new Set<string>()
  for (const key of slotsFor(mode)) {
    const slot = slots[key]
    if (slot === null || slot === undefined) return 'Elegí a todos los jugadores.'
    if (slot.kind === 'guest') {
      if (slot.name.trim() === '') return 'Poné el nombre del invitado.'
    } else {
      if (seen.has(slot.playerId)) return 'No podés elegir al mismo amigo dos veces.'
      seen.add(slot.playerId)
    }
  }
  if (mustPlay !== undefined && !seen.has(mustPlay.playerId)) return `Tiene que jugar ${mustPlay.name}.`
  return null
}

/** Lo que consume `createCasualMatch`: sin mí (la base me pone en el lado A). */
export function playersFrom(mode: Mode, slots: Slots): CasualPlayerInput[] {
  return slotsFor(mode).flatMap((key): CasualPlayerInput[] => {
    const slot = slots[key]
    if (slot === null || slot === undefined) return []
    const side = key === 'partner' ? 'mine' : 'theirs'
    return slot.kind === 'friend'
      ? [{ side, playerId: slot.playerId, guestName: null }]
      : [{ side, playerId: null, guestName: slot.name.trim() }]
  })
}

const BAD_PLAYERS = new EdgeError('Los jugadores del partido no son válidos.')

/**
 * Borde de confianza: el campo `players` del FormData lo puede armar a mano
 * cualquiera. Valida la forma antes de que llegue a `createCasualMatch`.
 */
export function playersFromJson(raw: string): CasualPlayerInput[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw BAD_PLAYERS
  }
  if (!Array.isArray(parsed) || parsed.length === 0) throw BAD_PLAYERS
  const players = parsed.map((item: unknown): CasualPlayerInput => {
    if (typeof item !== 'object' || item === null) throw BAD_PLAYERS
    const { side, playerId, guestName } = item as Record<string, unknown>
    if (side !== 'mine' && side !== 'theirs') throw BAD_PLAYERS
    if (typeof playerId === 'string' && playerId !== '' && guestName === null) {
      return { side, playerId, guestName: null }
    }
    if (playerId === null && typeof guestName === 'string' && guestName.trim() !== '') {
      return { side, playerId: null, guestName: guestName.trim() }
    }
    throw BAD_PLAYERS
  })
  const ids = players.flatMap((player) => (player.playerId === null ? [] : [player.playerId]))
  if (new Set(ids).size !== ids.length) throw new EdgeError('No podés elegir al mismo amigo dos veces.')
  return players
}

type PadelSet = { mine: number; theirs: number }

/**
 * El formato que dejó un partido ya guardado (el que ganó cada set tiene
 * `gamesPerSet` games; `setsToWin` = los sets del ganador), para prellenar los
 * steppers al editar. La base no guarda el formato aparte.
 */
export function formatFromSets(sets: readonly PadelSet[]): Pick<MatchFormat, 'setsToWin' | 'gamesPerSet'> {
  const mine = sets.filter((set) => set.mine > set.theirs).length
  const theirs = sets.filter((set) => set.theirs > set.mine).length
  return {
    setsToWin: Math.max(mine, theirs),
    gamesPerSet: Math.max(...sets.map((set) => Math.max(set.mine, set.theirs))),
  }
}

/**
 * El formato a prellenar al editar: lo que se puede deducir de los sets, y lo
 * fijo del deporte. Lo fijo manda: un deuce 12-10 en ping pong daría 12 por
 * `formatFromSets`, pero el set sigue siendo a 11.
 */
export function formatForSport(sport: SetsSport, sets: readonly PadelSet[]): MatchFormat {
  if (sets.length === 0) return sport.format
  const format = { ...sport.format, ...formatFromSets(sets) }
  const { min, max } = sport.gamesPerSet
  return min === max ? { ...format, gamesPerSet: min } : format
}

/** Los sets cargados como los lee `parseCasualResult`: JSON en mi orientación (A = mío). */
export function setsField(state: LoadState): string {
  return JSON.stringify(state.sets.map((set) => ({ mine: set.gamesA, theirs: set.gamesB })))
}

/**
 * Botones extra del segundo toque cuando se gana por dos: el perdedor llegó a
 * `gamesPerSet - 1` o más (ping pong: 10..14 → 12-10 … 16-14). Con tie-break el
 * set corta en `gamesPerSet` exacto y con marcador abierto no hay sets: nada.
 * Acá y no en `carga-state.ts`: en el torneo `tieBreak` es siempre `true`.
 */
export function deuceOptions(format: MatchFormat): number[] {
  if (format.tieBreak || format.openScore) return []
  // ponytail: techo en 16-14; un 18-16 no se carga. Si aparece: un input numérico en vez de botones.
  return Array.from({ length: 5 }, (_, index) => format.gamesPerSet - 1 + index)
}

/** Cierra el set en curso con el ganador en perdedor+2. Mismas guardas que `chooseLoserGames`. */
export function chooseDeuce(state: LoadState, loser: number, format: MatchFormat): LoadState {
  if (state.pendingWinner === null || isComplete(state, format)) return state
  const set =
    state.pendingWinner === 'A' ? { gamesA: loser + 2, gamesB: loser } : { gamesA: loser, gamesB: loser + 2 }
  return { sets: [...state.sets, set], pendingWinner: null }
}
