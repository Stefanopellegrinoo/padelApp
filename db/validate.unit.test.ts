import { describe, it, expect } from 'vitest'
import { buildPairs, defaultConfig, type MatchFormat } from '@/core'
import { EdgeError } from './errors'
import {
  assertValidConfig,
  setError,
  matchError,
  assertMatchdaySize,
  assertLocksAndGuests,
  assertLocksArePlaying,
  assertSquadCoversLooseGuests,
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
  // estrena el botón "+ Agregar invitado".
  it('accepts two loose guests when one is locked to a squad player', () => {
    const guests: GuestSeat[] = [
      { entryId: 'g1', displayName: 'G1' },
      { entryId: 'g2', displayName: 'G2' },
    ]
    const locks: PairLock[] = [{ a: 'g1', b: 'player1' }]
    expect(() => assertLocksAndGuests(guests, locks)).not.toThrow()
  })

  // Las DOS opciones para cada invitado: elegirle compañero a mano, o tirarlo
  // al sorteo. Que dos vayan al sorteo es válido y el sorteo los separa —
  // `orderPool` los manda al fondo del pool y `buildPairs` empareja el fondo
  // con la cabeza (`core/pairing.test.ts:186`). Cuántos entran es una cuenta de
  // plantel, y la hace `assertSquadCoversLooseGuests`: acá no se cuenta nada.
  it('accepts two guests left to the draw: counting them is not this function', () => {
    const guests: GuestSeat[] = [
      { entryId: 'g1', displayName: 'G1' },
      { entryId: 'g2', displayName: 'G2' },
    ]
    expect(() => assertLocksAndGuests(guests, [])).not.toThrow()
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

describe('assertLocksArePlaying', () => {
  it('accepts a lock whose two entries are playing', () => {
    const locks: PairLock[] = [{ a: 'g1', b: 'p0' }]
    expect(() => assertLocksArePlaying(['p0', 'p1', 'g1'], locks)).not.toThrow()
  })

  it('rejects a lock whose partner was marked absent after it was made', () => {
    // `setAttendance` no toca `pair_locks`: el lock sobrevive apuntando a
    // alguien que ya no está en `present`.
    const locks: PairLock[] = [{ a: 'g1', b: 'p9' }]
    expect(() => assertLocksArePlaying(['p0', 'p1', 'g1'], locks)).toThrow(EdgeError)
  })

  it('names the two ways out instead of a bare id', () => {
    const locks: PairLock[] = [{ a: 'g1', b: 'p9' }]
    expect(() => assertLocksArePlaying(['g1'], locks)).toThrow(
      /Elegile otro compañero al invitado, o volvé a tildar que viene/,
    )
  })

  it('accepts a matchday with no locks at all', () => {
    expect(() => assertLocksArePlaying(['p0', 'p1'], [])).not.toThrow()
  })
})

describe('assertSquadCoversLooseGuests', () => {
  function guestSeats(count: number): GuestSeat[] {
    return Array.from({ length: count }, (_, i) => ({
      entryId: `g${i + 1}`,
      displayName: `G${i + 1}`,
    }))
  }

  it('accepts two guests left to the draw when the squad has players to spare', () => {
    // Seis del plantel y dos invitados: el sorteo saca DOS parejas mixtas, no
    // una pareja de invitados — está pinneado en `core/pairing.test.ts:186`.
    const guests = guestSeats(2)
    const present = [...players(6), 'g1', 'g2']
    expect(() => assertSquadCoversLooseGuests(present, guests, [], null)).not.toThrow()
  })

  it('rejects more loose guests than free squad players', () => {
    // Dos del torneo y seis invitados sueltos: por pigeonhole, al menos una
    // pareja sale invitado-invitado. Esa pareja no cobra y
    // `assertPointsCoverMatchday` no la ve, porque cuenta sobre `pair_locks`.
    const guests = guestSeats(6)
    const present = [...players(2), ...guests.map((guest) => guest.entryId)]
    expect(() => assertSquadCoversLooseGuests(present, guests, [], null)).toThrow(EdgeError)
  })

  it('accepts the same guests once the extras are locked into guest pairs', () => {
    // La salida que nombra el mensaje de error. Un lock invitado-invitado saca
    // DOS de la cuenta de sueltos y no consume ningún jugador del torneo.
    const guests = guestSeats(6)
    const present = [...players(2), ...guests.map((guest) => guest.entryId)]
    const locks: PairLock[] = [
      { a: 'g1', b: 'g2' },
      { a: 'g3', b: 'g4' },
    ]
    expect(() => assertSquadCoversLooseGuests(present, guests, locks, null)).not.toThrow()
  })

  // ── El borde, que es la única línea que esta función decide ────────────────
  // Los dos casos de arriba son 2-vs-6 y 6-vs-2: ninguno toca `loose === free`.
  // Sin estos dos, mutar `loose <= free` a `loose <= free + 1` deja la suite
  // entera en verde.

  it('accepts exactly as many loose guests as free squad players', () => {
    const guests = guestSeats(4)
    const present = [...players(4), ...guests.map((guest) => guest.entryId)]
    expect(() => assertSquadCoversLooseGuests(present, guests, [], null)).not.toThrow()
  })

  it('rejects one loose guest more than free squad players', () => {
    const guests = guestSeats(5)
    const present = [...players(4), ...guests.map((guest) => guest.entryId)]
    expect(() => assertSquadCoversLooseGuests(present, guests, [], null)).toThrow(EdgeError)
  })

  // ── Los defensores, que el sorteo saca del pool y la cuenta ignoraba ───────

  it('does not count the defending pair among the free squad players', () => {
    // `buildPairs` arma `settled` con los defensores ANTES de que exista el
    // pool, igual que con los locks. Los locks ya se descontaban; los
    // defensores no, y no están en `pair_locks` para que se noten.
    const guests = guestSeats(6)
    const present = [...players(6), ...guests.map((guest) => guest.entryId)]

    expect(() => assertSquadCoversLooseGuests(present, guests, [], null)).not.toThrow()
    expect(() =>
      assertSquadCoversLooseGuests(present, guests, [], { a: 'p0', b: 'p1' }),
    ).toThrow(EdgeError)
  })

  it('counts the defenders as free when one of them is not playing', () => {
    // Mismo criterio que `resolveDefenders` en core/pairing.ts: si falta uno,
    // la pareja se disuelve y el que sí vino vuelve al pool.
    const guests = guestSeats(6)
    const present = [...players(6), ...guests.map((guest) => guest.entryId)]
    expect(() =>
      assertSquadCoversLooseGuests(present, guests, [], { a: 'p0', b: 'ausente' }),
    ).not.toThrow()
  })

  it('rejects the matchday whose draw actually came out with a guest-guest pair', () => {
    // Ejecutado, no razonado. Seis del plantel, seis invitados sueltos y la
    // pareja defensora en pie: `loose === free` para la cuenta vieja, así que
    // la fecha entraba — y el sorteo devolvía {g1,g2}, que no cobra ninguno de
    // los dos y `assertPointsCoverMatchday` no ve porque cuenta sobre locks.
    const squad = players(6)
    const guests = guestSeats(6)
    const guestIds = guests.map((guest) => guest.entryId)
    const present = [...squad, ...guestIds]
    const defenders = { a: 'p0', b: 'p1' }

    const drawn = buildPairs({
      present,
      points: new Map(squad.map((entryId, index) => [entryId, 100 - index])),
      snapshot: squad,
      defenders,
      defendersAlreadyRepeated: false,
      previousPairs: [defenders],
      guestIds,
      fixedPairs: [],
    })
    expect(drawn).toContainEqual({ a: 'g1', b: 'g2' })

    expect(() => assertSquadCoversLooseGuests(present, guests, [], defenders)).toThrow(EdgeError)
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
