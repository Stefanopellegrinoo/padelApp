import { isSportId, sportOf, type MatchFormat, type SetsSport, type SportId } from '@/core'
import { EdgeError } from '@/db/errors'
import { matchError } from '@/db/validate'
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
  if (min === max) return { ...format, gamesPerSet: min }
  if (format.ventaja !== true) return format
  // Con el set real el ganador puede tener N+1 (7-5, 7-6): el número es el del
  // deporte si los sets entran, si no el más alto o uno menos (un 4-3 viejo es
  // un set a 3 con tie-break en 3-3). Lo que ningún set real explica —un 6-5
  // de antes— se edita con la regla de antes, que lo sigue cerrando.
  const games = sets.map((set) => ({ gamesA: set.mine, gamesB: set.theirs }))
  const cierra = (candidate: MatchFormat) => matchError(games, candidate, false) === null
  const n = [sport.format.gamesPerSet, format.gamesPerSet, format.gamesPerSet - 1].find(
    (candidate) => candidate >= min && candidate <= max && cierra({ ...format, gamesPerSet: candidate }),
  )
  if (n !== undefined) return { ...format, gamesPerSet: n }
  const deAntes = { ...format, ventaja: false }
  return cierra(deAntes) ? deAntes : format
}

/** Los sets cargados como los lee `parseCasualResult`: JSON en mi orientación (A = mío). */
export function setsField(state: LoadState): string {
  return JSON.stringify(state.sets.map((set) => ({ mine: set.gamesA, theirs: set.gamesB })))
}

/**
 * Botones extra del segundo toque, los de ventaja: los resultados donde el
 * ganador pasa de `gamesPerSet`.
 *
 * - Se gana por dos (sin tie-break): el perdedor llegó a `gamesPerSet - 1` o
 *   más (ping pong: 10..14 → 12-10 … 16-14; fútbol tenis: 16-14 … 20-18).
 * - El set real (`ventaja`): N-1 y N, que el ganador cierra en N+1 (a 6: 7-5,
 *   y 7-6 con tie-break).
 * - Con tie-break el set corta en `gamesPerSet` exacto y con marcador abierto
 *   no hay sets: nada.
 *
 * Los games del ganador de cada botón los da `deuceWinnerGames`.
 */
export function deuceOptions(format: MatchFormat): number[] {
  if (format.openScore) return []
  if (format.ventaja === true) return [format.gamesPerSet - 1, format.gamesPerSet]
  if (format.tieBreak) return []
  // ponytail: techo en 16-14; un 18-16 no se carga. Si aparece: un input numérico en vez de botones.
  return Array.from({ length: 5 }, (_, index) => format.gamesPerSet - 1 + index)
}

/** Con cuánto cierra el ganador un botón de ventaja: N+1 en el set real, perdedor+2 si se gana por dos. */
export function deuceWinnerGames(format: MatchFormat, loser: number): number {
  return format.ventaja === true ? format.gamesPerSet + 1 : loser + 2
}

/** Cierra el set en curso con un botón de ventaja. Mismas guardas que `chooseLoserGames`. */
export function chooseDeuce(state: LoadState, loser: number, format: MatchFormat): LoadState {
  if (state.pendingWinner === null || isComplete(state, format)) return state
  const won = deuceWinnerGames(format, loser)
  const set = state.pendingWinner === 'A' ? { gamesA: won, gamesB: loser } : { gamesA: loser, gamesB: won }
  return { sets: [...state.sets, set], pendingWinner: null }
}

// ── lo que el formulario trae puesto (S8e) ──────────────────────────────────

/** Hoy en `YYYY-MM-DD` con la fecha local: `played_on` no tiene hora. */
export function hoyISO(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** Dónde queda lo último que se usó para cargar un partido con un amigo (`localStorage`). */
export const RECUERDO_KEY = 'padel:partido-con-amigo'

type FormatoRecordado = Pick<MatchFormat, 'setsToWin' | 'gamesPerSet'>

/** Lo último que se usó: el deporte, el modo y, por deporte de sets, el formato. */
export interface Recuerdo {
  sport: SportId
  mode: Mode
  formats: Partial<Record<SportId, FormatoRecordado>>
}

/**
 * Lee lo recordado. Es un borde como cualquier otro: lo pudo escribir otra
 * versión de la app, así que lo que no sirve (JSON roto, un deporte que ya no
 * está, un formato fuera del rango del deporte) se descarta pedazo a pedazo y
 * nunca tira.
 */
export function leerRecuerdo(raw: string | null): Recuerdo | null {
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const { sport, mode, formats } = parsed as Record<string, unknown>
  if (typeof sport !== 'string' || !isSportId(sport)) return null
  const limpios: Recuerdo['formats'] = {}
  if (typeof formats === 'object' && formats !== null) {
    for (const [id, format] of Object.entries(formats)) {
      if (!isSportId(id) || typeof format !== 'object' || format === null) continue
      const info = sportOf(id)
      if (info.family !== 'sets') continue
      const { setsToWin, gamesPerSet } = format as Record<string, unknown>
      const dentro = (n: unknown, r: { min: number; max: number }) =>
        typeof n === 'number' && Number.isInteger(n) && n >= r.min && n <= r.max
      if (dentro(setsToWin, info.setsToWin) && dentro(gamesPerSet, info.gamesPerSet)) {
        limpios[id] = { setsToWin: setsToWin as number, gamesPerSet: gamesPerSet as number }
      }
    }
  }
  return { sport, mode: mode === '2v2' ? '2v2' : '1v1', formats: limpios }
}

/** El formato con el que arranca un deporte de sets: el recordado, o el del deporte. */
export function formatoInicial(sport: SetsSport, id: SportId, recuerdo: Recuerdo | null): MatchFormat {
  const recordado = recuerdo?.formats[id]
  return recordado === undefined ? sport.format : { ...sport.format, ...recordado }
}

/** Quién ganó según el marcador, o `null` si no lo dice (vacío o empatado: puede haber penales). */
export function outcomeDelMarcador(mine: string, theirs: string): 'won' | 'lost' | null {
  if (!/^\d+$/.test(mine.trim()) || !/^\d+$/.test(theirs.trim())) return null
  const a = Number(mine)
  const b = Number(theirs)
  return a > b ? 'won' : a < b ? 'lost' : null
}

const VERBO = {
  '1v1': { won: 'Ganaste', lost: 'Perdiste', drew: 'Empataste' },
  '2v2': { won: 'Ganaron', lost: 'Perdieron', drew: 'Empataron' },
} as const

/**
 * Lo que dice el aviso después de guardar: "Ganaste 6-4 6-3", desde tu lado y
 * como se canta. Con sets, el resultado sale de los sets; con goles, del
 * "quién ganó" y el marcador si lo hay.
 */
export function resumenPartido(
  mode: Mode,
  resultado:
    | { family: 'sets'; sets: readonly PadelSet[] }
    | { family: 'goals'; outcome: 'won' | 'lost' | 'drew'; scoreMine: string; scoreTheirs: string },
): string {
  if (resultado.family === 'sets') {
    const mine = resultado.sets.filter((set) => set.mine > set.theirs).length
    const theirs = resultado.sets.filter((set) => set.theirs > set.mine).length
    const outcome = mine > theirs ? 'won' : mine < theirs ? 'lost' : 'drew'
    return `${VERBO[mode][outcome]} ${resultado.sets.map((set) => `${set.mine}-${set.theirs}`).join(' ')}`
  }
  const { outcome, scoreMine, scoreTheirs } = resultado
  const marcador = scoreMine.trim() !== '' && scoreTheirs.trim() !== '' ? ` ${scoreMine.trim()}-${scoreTheirs.trim()}` : ''
  return `${VERBO[mode][outcome]}${marcador}`
}
