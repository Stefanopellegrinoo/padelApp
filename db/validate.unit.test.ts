import { describe, it, expect } from 'vitest'
import { defaultConfig, type MatchFormat } from '@/core'
import { EdgeError } from './errors'
import {
  assertValidConfig,
  setError,
  matchError,
  assertMatchdaySize,
  assertLocksAndGuests,
  assertPointsCoverMatchday,
  assertGuestsNamed,
  type GuestSeat,
  type PairLock,
} from './validate'

function players(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `p${i}`)
}

describe('assertValidConfig', () => {
  it('lets the default config through', () => {
    expect(() => assertValidConfig(defaultConfig(8))).not.toThrow()
  })

  it('rejects tiebreakSnapshotEvery at 0, which would hang the snapshot chain', () => {
    const config = { ...defaultConfig(8), tiebreakSnapshotEvery: 0 }
    expect(() => assertValidConfig(config)).toThrow(EdgeError)
  })

  it('joins every error into one message', () => {
    const config = { ...defaultConfig(8), tiebreakSnapshotEvery: 0, regularMatchdays: 0 }
    try {
      assertValidConfig(config)
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(EdgeError)
      const message = (error as Error).message
      expect(message).toContain('El torneo tiene que tener al menos 1 fecha.')
      expect(message).toContain('El orden de desempate se tiene que refrescar cada 1 fecha o más.')
    }
  })
})

describe('setError — a 4-game set with tie-break', () => {
  const format: MatchFormat = { setsToWin: 1, gamesPerSet: 4, tieBreak: true }

  it.each([[4, 0], [4, 1], [4, 2], [4, 3], [0, 4], [3, 4]])(
    'accepts %i-%i',
    (gamesA, gamesB) => {
      expect(setError({ gamesA, gamesB }, format)).toBeNull()
    },
  )

  it('rejects 4-4, which does not win anyone the set', () => {
    expect(setError({ gamesA: 4, gamesB: 4 }, format)).toMatch(/no hay empates/)
  })

  it('rejects 5-2, which is not a possible score in a set to 4', () => {
    expect(setError({ gamesA: 5, gamesB: 2 }, format)).toMatch(/no es un resultado posible/)
  })

  it('rejects 3-1, an unfinished set', () => {
    expect(setError({ gamesA: 3, gamesB: 1 }, format)).not.toBeNull()
  })

  it('rejects negative and non-integer games', () => {
    expect(setError({ gamesA: -1, gamesB: 4 }, format)).not.toBeNull()
    expect(setError({ gamesA: 4.5, gamesB: 2 }, format)).not.toBeNull()
  })
})

describe('setError — no tie-break, must win by two', () => {
  const format: MatchFormat = { setsToWin: 1, gamesPerSet: 4, tieBreak: false }

  it.each([[4, 0], [4, 1], [4, 2], [5, 3], [6, 4]])('accepts %i-%i', (gamesA, gamesB) => {
    expect(setError({ gamesA, gamesB }, format)).toBeNull()
  })

  it.each([[4, 3], [6, 3], [5, 4]])('rejects %i-%i', (gamesA, gamesB) => {
    expect(setError({ gamesA, gamesB }, format)).not.toBeNull()
  })
})

describe('matchError', () => {
  const format: MatchFormat = { setsToWin: 2, gamesPerSet: 4, tieBreak: true }

  it('requires the match to be finished', () => {
    const sets = [{ gamesA: 4, gamesB: 2 }]
    expect(matchError(sets, format)).toMatch(/no lo cierra/)
  })

  it('accepts 2-1 in sets when setsToWin is 2', () => {
    const sets = [
      { gamesA: 4, gamesB: 2 },
      { gamesA: 1, gamesB: 4 },
      { gamesA: 4, gamesB: 0 },
    ]
    expect(matchError(sets, format)).toBeNull()
  })

  it('rejects 2-2 in sets: one too many', () => {
    const sets = [
      { gamesA: 4, gamesB: 2 },
      { gamesA: 1, gamesB: 4 },
      { gamesA: 4, gamesB: 3 },
      { gamesA: 2, gamesB: 4 },
    ]
    expect(matchError(sets, format)).toMatch(/Sobran sets/)
  })

  it('rejects a match with no sets', () => {
    expect(matchError([], format)).toMatch(/Falta cargar/)
  })
})

describe('assertMatchdaySize', () => {
  it.each([8, 10, 12])('accepts %i', (size) => {
    expect(() => assertMatchdaySize(players(size))).not.toThrow()
  })

  it('rejects 6 and says how many are missing', () => {
    expect(() => assertMatchdaySize(players(6))).toThrow(/hacen falta 2/)
  })

  it('rejects 14 and says how many are extra', () => {
    expect(() => assertMatchdaySize(players(14))).toThrow(/sobran 2/)
  })

  it('rejects an odd number', () => {
    expect(() => assertMatchdaySize(players(9))).toThrow(/de a pares/)
  })
})

describe('assertLocksAndGuests', () => {
  it('accepts a lone guest', () => {
    const guests: GuestSeat[] = [{ entryId: 'g1', displayName: 'G1' }]
    expect(() => assertLocksAndGuests(guests, [])).not.toThrow()
  })

  it('accepts two guests locked to each other', () => {
    const guests: GuestSeat[] = [
      { entryId: 'g1', displayName: 'G1' },
      { entryId: 'g2', displayName: 'G2' },
    ]
    const locks: PairLock[] = [{ a: 'g1', b: 'g2' }]
    expect(() => assertLocksAndGuests(guests, locks)).not.toThrow()
  })

  it('accepts a guest locked with a squad player', () => {
    const guests: GuestSeat[] = [{ entryId: 'g1', displayName: 'G1' }]
    const locks: PairLock[] = [{ a: 'g1', b: 'player1' }]
    expect(() => assertLocksAndGuests(guests, locks)).not.toThrow()
  })

  it('accepts a guest pair plus a lone guest', () => {
    const guests: GuestSeat[] = [
      { entryId: 'g1', displayName: 'G1' },
      { entryId: 'g2', displayName: 'G2' },
      { entryId: 'g3', displayName: 'G3' },
    ]
    const locks: PairLock[] = [{ a: 'g1', b: 'g2' }]
    expect(() => assertLocksAndGuests(guests, locks)).not.toThrow()
  })

  // El caso canónico de "más de un invitado suelto": dos invitados en la fecha,
  // uno con compañero elegido a mano y el otro librado al sorteo. Es lo que
  // estrena el botón "+ Agregar invitado", y el único arreglo del sorteo que
  // NO es endurecer `loose > 1` a `loose > 0` — sin este test, hacerlo mata la
  // feature entera sin que nada se ponga en rojo.
  it('accepts two loose guests when one is locked to a squad player', () => {
    const guests: GuestSeat[] = [
      { entryId: 'g1', displayName: 'G1' },
      { entryId: 'g2', displayName: 'G2' },
    ]
    const locks: PairLock[] = [{ a: 'g1', b: 'player1' }]
    expect(() => assertLocksAndGuests(guests, locks)).not.toThrow()
  })

  it('rejects two lone guests', () => {
    const guests: GuestSeat[] = [
      { entryId: 'g1', displayName: 'G1' },
      { entryId: 'g2', displayName: 'G2' },
    ]
    expect(() => assertLocksAndGuests(guests, [])).toThrow(EdgeError)
  })

  it('rejects locking two squad players together', () => {
    // This is the rule that protects the format: two squad players locked by
    // hand would skip the no-repeat rule, the one thing the draw exists to
    // enforce.
    const locks: PairLock[] = [{ a: 'player1', b: 'player2' }]
    expect(() => assertLocksAndGuests([], locks)).toThrow(/incluir a un invitado/)
  })

  it('rejects someone locked into two pairs', () => {
    const guests: GuestSeat[] = [{ entryId: 'g1', displayName: 'G1' }]
    const locks: PairLock[] = [
      { a: 'g1', b: 'player1' },
      { a: 'g1', b: 'player2' },
    ]
    expect(() => assertLocksAndGuests(guests, locks)).toThrow(/fijado en dos parejas/)
  })
})

describe('assertPointsCoverMatchday', () => {
  const config = defaultConfig(8) // points.length === 4

  it('rejects a matchday of 5 championship pairs with points for 4', () => {
    const present = players(10)
    const guests: GuestSeat[] = [
      { entryId: 'g1', displayName: 'G1' },
      { entryId: 'g2', displayName: 'G2' },
    ]
    expect(() => assertPointsCoverMatchday(present, guests, [], config)).toThrow(EdgeError)
  })

  it('does not count the guest-only pair, which is unpaid', () => {
    const present = players(10)
    const guests: GuestSeat[] = [
      { entryId: 'g1', displayName: 'G1' },
      { entryId: 'g2', displayName: 'G2' },
    ]
    const locks: PairLock[] = [{ a: 'g1', b: 'g2' }]
    expect(() => assertPointsCoverMatchday(present, guests, locks, config)).not.toThrow()
  })

  it('does count a guest paired with a squad player, which is paid', () => {
    const present = players(10)
    const guests: GuestSeat[] = [
      { entryId: 'g1', displayName: 'G1' },
      { entryId: 'g2', displayName: 'G2' },
    ]
    const locks: PairLock[] = [{ a: 'g1', b: 'p0' }]
    expect(() => assertPointsCoverMatchday(present, guests, locks, config)).toThrow(EdgeError)
  })
})

describe('assertGuestsNamed', () => {
  it('rejects an unnamed guest', () => {
    const guests: GuestSeat[] = [{ entryId: 'g1', displayName: '' }]
    expect(() => assertGuestsNamed(guests)).toThrow(/nombre/)
  })

  it('accepts when everyone has a name', () => {
    const guests: GuestSeat[] = [{ entryId: 'g1', displayName: 'Juan' }]
    expect(() => assertGuestsNamed(guests)).not.toThrow()
  })
})
