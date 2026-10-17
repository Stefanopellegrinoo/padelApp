import { describe, it, expect } from 'vitest'
import { buildPairs, defaultConfig, pair, validateConfig, type MatchFormat } from '@/core'
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
    expect(() => assertValidConfig(defaultConfig(8), 2)).not.toThrow()
  })

  it('rejects tiebreakSnapshotEvery at 0, which would hang the snapshot chain', () => {
    const config = { ...defaultConfig(8), tiebreakSnapshotEvery: 0 }
    expect(() => assertValidConfig(config, 2)).toThrow(EdgeError)
  })

  it('joins every error into one message', () => {
    const config = { ...defaultConfig(8), tiebreakSnapshotEvery: 0, regularMatchdays: 0 }
    try {
      assertValidConfig(config, 2)
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(EdgeError)
      const message = (error as Error).message
      expect(message).toContain('El torneo tiene que tener al menos 1 fecha.')
      expect(message).toContain('El orden de desempate se tiene que refrescar cada 1 fecha o más.')
    }
  })

  // REQ-D2-2: un plantel impar es válido con sideSize=1 — la paridad
  // es una regla de la pareja, no del plantel. 9 es un impar cualquiera por
  // encima del piso derivado (`minSquadFor(1) = 2`, docs/tipos-de-torneo.md
  // §3.3): no hay ningún número de cabeza planera que lo filtre antes de
  // llegar a la paridad.
  //
  //`points` tiene 9 valores, no 4: con
  // sideSize=1 `expectedPoints` es `squadSize / sideSize`, no siempre
  // `squadSize / 2` — 9 presentes de a uno son 9 lados. Sigue aislando SÓLO
  // la paridad: el fixture de antes (4 valores) satisfacía la fórmula
  // vieja, no la correcta, y esta prueba nunca fue sobre el conteo de
  // puntos.
  it('lets an odd squad through when the side is a single', () => {
    const config = {
      ...defaultConfig(8),
      squadSize: 9,
      points: [10, 9, 8, 7, 6, 5, 4, 3, 2],
    }
    expect(() => assertValidConfig(config, 1)).not.toThrow()
  })
})

describe('setError — a 4-game set with tie-break', () => {
  const format: MatchFormat = { setsToWin: 1, gamesPerSet: 4, tieBreak: true, openScore: false }

  it.each([[4, 0], [4, 1], [4, 2], [4, 3], [0, 4], [3, 4]])(
    'accepts %i-%i',
    (gamesA, gamesB) => {
      expect(setError({ gamesA, gamesB }, format, false)).toBeNull()
    },
  )

  it('rejects 4-4, which does not win anyone the set', () => {
    expect(setError({ gamesA: 4, gamesB: 4 }, format, false)).toMatch(/no hay empates/)
  })

  it('rejects 5-2, which is not a possible score in a set to 4', () => {
    expect(setError({ gamesA: 5, gamesB: 2 }, format, false)).toMatch(/no es un resultado posible/)
  })

  it('rejects 3-1, an unfinished set', () => {
    expect(setError({ gamesA: 3, gamesB: 1 }, format, false)).not.toBeNull()
  })

  it('rejects negative and non-integer games', () => {
    expect(setError({ gamesA: -1, gamesB: 4 }, format, false)).not.toBeNull()
    expect(setError({ gamesA: 4.5, gamesB: 2 }, format, false)).not.toBeNull()
  })
})

describe('setError — no tie-break, must win by two', () => {
  const format: MatchFormat = { setsToWin: 1, gamesPerSet: 4, tieBreak: false, openScore: false }

  it.each([[4, 0], [4, 1], [4, 2], [5, 3], [6, 4]])('accepts %i-%i', (gamesA, gamesB) => {
    expect(setError({ gamesA, gamesB }, format, false)).toBeNull()
  })

  it.each([[4, 3], [6, 3], [5, 4]])('rejects %i-%i', (gamesA, gamesB) => {
    expect(setError({ gamesA, gamesB }, format, false)).not.toBeNull()
  })
})

describe('matchError', () => {
  const format: MatchFormat = { setsToWin: 2, gamesPerSet: 4, tieBreak: true, openScore: false }

  it('requires the match to be finished', () => {
    const sets = [{ gamesA: 4, gamesB: 2 }]
    expect(matchError(sets, format, false)).toMatch(/no lo cierra/)
  })

  it('accepts 2-1 in sets when setsToWin is 2', () => {
    const sets = [
      { gamesA: 4, gamesB: 2 },
      { gamesA: 1, gamesB: 4 },
      { gamesA: 4, gamesB: 0 },
    ]
    expect(matchError(sets, format, false)).toBeNull()
  })

  it('rejects 2-2 in sets: one too many', () => {
    const sets = [
      { gamesA: 4, gamesB: 2 },
      { gamesA: 1, gamesB: 4 },
      { gamesA: 4, gamesB: 3 },
      { gamesA: 2, gamesB: 4 },
    ]
    expect(matchError(sets, format, false)).toMatch(/Sobran sets/)
  })

  it('rejects a match with no sets', () => {
    expect(matchError([], format, false)).toMatch(/Falta cargar/)
  })
})

// La FK de `0034` deja PERSISTIR el empate; estas dos funciones son el otro
// guard que lo rechazaba, y lo hacían sin mirar la disciplina. `allowsDraw` no
// tiene default a propósito: el compilador obliga a decidir en cada llamada.
//
// El formato es `gamesPerSet: 2` porque con marcador CERRADO el empate legal
// es el que llega al corte: con tie-break el set termina en `gamesPerSet`
// exacto, así que el único empate representable es `N-N` (S68, 
// ronda 20 — la regla es para cualquier `gamesPerSet`, no sólo el 2, y el
// formato de pádel por defecto ya admite un `4-4`; sin tie-break no hay
// ninguno).
//
// `openScore: false` A PROPÓSITO: este bloque describe el marcador de pádel y
// tiene que seguir describiéndolo. El camino abierto está más abajo, en su
// propio `describe`.
describe('setError / matchError con allowsDraw', () => {
  const format: MatchFormat = { setsToWin: 1, gamesPerSet: 2, tieBreak: true, openScore: false }

  it('acepta un 2-2 cuando la disciplina permite empate', () => {
    expect(setError({ gamesA: 2, gamesB: 2 }, format, true)).toBeNull()
  })

  it('sigue rechazando el MISMO 2-2 cuando no lo permite', () => {
    expect(setError({ gamesA: 2, gamesB: 2 }, format, false)).toMatch(/no hay empates/)
  })

  it('no afloja el resto del marcador: un 3-3 no llega a un set a 2', () => {
    expect(setError({ gamesA: 3, gamesB: 3 }, format, true)).toMatch(
      /no es un resultado posible/,
    )
  })

  it('un partido empatado está terminado y no le falta un set', () => {
    expect(matchError([{ gamesA: 2, gamesB: 2 }], format, true)).toBeNull()
  })

  it('pero dos sets no cierran un partido a uno, ni empatados', () => {
    const sets = [
      { gamesA: 2, gamesB: 2 },
      { gamesA: 2, gamesB: 2 },
    ]
    expect(matchError(sets, format, true)).toMatch(/no lo cierra/)
  })

  it('y un partido con ganador sigue midiéndose por sets ganados', () => {
    expect(matchError([{ gamesA: 2, gamesB: 0 }], format, true)).toBeNull()
    expect(matchError([{ gamesA: 2, gamesB: 1 }], format, true)).toBeNull()
  })
})

describe('assertMatchdaySize', () => {
  // Hasta 12 acepta libre — el techo de PLANTEL plano se borró
  // (docs/plan-piso-y-techo-del-plantel.md Task 3).
  it.each([4, 8, 10, 12])('accepts %i on a side of two', (size) => {
    expect(() => assertMatchdaySize(players(size), 2)).not.toThrow()
  })

  // Fix round 1 (Task 3): borrar el techo de PLANTEL destapó un techo
  // DISTINTO que estaba tapado por coincidencia — `MAX_PAIRING_POOL`, el
  // límite de CPU del sorteo por fuerza bruta (`core/matchings.ts`). Antes
  // era inalcanzable porque el viejo techo de plantel (12) coincidía con
  // `MAX_PAIRING_POOL` (12) y nunca dejaba pasar tantos presentes. 13, 14 y
  // 20 tienen que seguir rechazando, con un mensaje que un humano entienda —
  // no el `Error` crudo de `core/matchings.ts`.
  it.each([13, 14, 20])('rejects %i on a side of two — the pairing CPU ceiling (MAX_PAIRING_POOL)', (size) => {
    expect(() => assertMatchdaySize(players(size), 2)).toThrow(/no se puede sortear/)
  })

  // El piso de a dos ahora es `minSquadFor(2) = 4` (docs/tipos-de-torneo.md
  // §3.3), no un plano de 8: 6 alcanza para una fecha (3 parejas).
  it('rejects below the derived floor on a side of two and says how many are missing', () => {
    expect(() => assertMatchdaySize(players(2), 2)).toThrow(/hacen falta 2/)
  })

  it('rejects an odd number on a side of two', () => {
    expect(() => assertMatchdaySize(players(9), 2)).toThrow(/de a pares/)
  })

  // REQ-D5-2: FIFA (sideSize=1) con 7 presentes no tiene error de paridad —
  // cada presente es su propio lado.
  it('accepts an odd number on a side of one (REQ-D5-2)', () => {
    expect(() => assertMatchdaySize(players(9), 1)).not.toThrow()
  })

  // El piso de a uno es `minSquadFor(1) = 2`: dos amigos ya son un partido de
  // FIFA, no un plano de 8 heredado del 2v2.
  it('lets a matchday of 2 pass on a side of one, and still rejects 1', () => {
    expect(() => assertMatchdaySize(players(2), 1)).not.toThrow()
    expect(() => assertMatchdaySize(players(1), 1)).toThrow(/hacen falta 1/)
  })

  // El techo plano tampoco existía para lados de uno (docs/plan-piso-y-techo-
  // del-plantel.md Task 3): 20 presentes, todos su propio lado, no tienen
  // ningún número de cabeza que los rechace.
  it('no longer enforces any ceiling on a side of one', () => {
    expect(() => assertMatchdaySize(players(20), 1)).not.toThrow()
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
      assertSquadCoversLooseGuests(present, guests, [], pair('p0', 'p1')),
    ).toThrow(EdgeError)
  })

  it('counts the defenders as free when one of them is not playing', () => {
    // Mismo criterio que `resolveDefenders` en core/pairing.ts: si falta uno,
    // la pareja se disuelve y el que sí vino vuelve al pool.
    const guests = guestSeats(6)
    const present = [...players(6), ...guests.map((guest) => guest.entryId)]
    expect(() =>
      assertSquadCoversLooseGuests(present, guests, [], pair('p0', 'ausente')),
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
    const defenders = pair('p0', 'p1')

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
    expect(drawn).toContainEqual(pair('g1', 'g2'))

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
    expect(() => assertPointsCoverMatchday(present, guests, [], config, 2)).toThrow(EdgeError)
  })

  it('does not count the guest-only pair, which is unpaid', () => {
    const present = players(10)
    const guests: GuestSeat[] = [
      { entryId: 'g1', displayName: 'G1' },
      { entryId: 'g2', displayName: 'G2' },
    ]
    const locks: PairLock[] = [{ a: 'g1', b: 'g2' }]
    expect(() => assertPointsCoverMatchday(present, guests, locks, config, 2)).not.toThrow()
  })

  it('does count a guest paired with a squad player, which is paid', () => {
    const present = players(10)
    const guests: GuestSeat[] = [
      { entryId: 'g1', displayName: 'G1' },
      { entryId: 'g2', displayName: 'G2' },
    ]
    const locks: PairLock[] = [{ a: 'g1', b: 'p0' }]
    expect(() => assertPointsCoverMatchday(present, guests, locks, config, 2)).toThrow(EdgeError)
  })

  // Dividía siempre por 2 — con sideSize=1, 10
  // presentes son 10 lados, no 5, y el guard que existe para avisar "faltan
  // valores de puntos" ANTES del sorteo quedaba ciego.
  it('divides by the real side size, not always by 2', () => {
    const tenPoints = { ...config, points: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1] }
    expect(() => assertPointsCoverMatchday(players(10), [], [], tenPoints, 1)).not.toThrow()
    expect(() => assertPointsCoverMatchday(players(10), [], [], config, 1)).toThrow(
      /10 competidores del torneo/,
    )
  })

  /*
   * W41. C16 arregló el DIVISOR y dejó el
   * SUSTRAENDO: un lock de dos invitados se restaba como UN lado que no cobra,
   * sea cual sea la aridad. De a dos eso es exacto — los dos invitados son un
   * lado solo. De a uno son DOS lados, porque cada invitado juega solo
   * (`buildSides` con `sideSize === 1` ignora `fixedPairs` entero).
   *
   * La consecuencia medida por la auditoría: plantel de 8 de a uno con los 8
   * valores de puntos + una pareja invitada rebotaba con "La fecha deja 9
   * competidores... sólo 8 posiciones". Son 8 competidores, no 9. Y como
   * `addGuestPair` es HOY el único camino para sumar un invitado a una fecha
   * de a uno, ese camino quedaba muerto con el plantel completo — un plantel
   * de 8, el tamaño de siempre en esta suite, es exactamente ese caso.
   */
  const soloConfig = { ...config, points: [8, 7, 6, 5, 4, 3, 2, 1] } // 8 valores

  it('un lock de dos invitados son DOS lados sin pagar cuando se juega de a uno', () => {
    // 8 del plantel + 2 invitados trabados = 10 lados, 8 del torneo.
    const present = [...players(8), 'g1', 'g2']
    const guests: GuestSeat[] = [
      { entryId: 'g1', displayName: 'G1' },
      { entryId: 'g2', displayName: 'G2' },
    ]
    const locks: PairLock[] = [{ a: 'g1', b: 'g2' }]
    expect(() => assertPointsCoverMatchday(present, guests, locks, soloConfig, 1)).not.toThrow()
  })

  it('el mensaje cuenta los competidores reales, no uno de más', () => {
    // Un invitado más de los que la lista de puntos aguanta: 9 del plantel + 2
    // invitados = 9 competidores contra 8 posiciones. Tiene que decir 9, no 10.
    const present = [...players(9), 'g1', 'g2']
    const guests: GuestSeat[] = [
      { entryId: 'g1', displayName: 'G1' },
      { entryId: 'g2', displayName: 'G2' },
    ]
    const locks: PairLock[] = [{ a: 'g1', b: 'g2' }]
    expect(() => assertPointsCoverMatchday(present, guests, locks, soloConfig, 1)).toThrow(
      /9 competidores del torneo/,
    )
  })

  it('de a uno un invitado no cobra aunque nadie lo haya trabado', () => {
    // Sin lock: de a uno el lock no significa nada igual, cada invitado ES su
    // propio lado y ninguno cobra. Restar por locks dejaba esto sin contar.
    const present = [...players(8), 'g1']
    const guests: GuestSeat[] = [{ entryId: 'g1', displayName: 'G1' }]
    expect(() => assertPointsCoverMatchday(present, guests, [], soloConfig, 1)).not.toThrow()
  })

  it('de a dos sigue restando UN lado por lock de invitados (W41, no-regresión)', () => {
    const present = players(10)
    const guests: GuestSeat[] = [
      { entryId: 'g1', displayName: 'G1' },
      { entryId: 'g2', displayName: 'G2' },
    ]
    const locks: PairLock[] = [{ a: 'g1', b: 'g2' }]
    expect(() => assertPointsCoverMatchday(present, guests, locks, config, 2)).not.toThrow()
    // Y un invitado trabado con alguien del plantel SÍ cobra: se sigue contando.
    expect(() =>
      assertPointsCoverMatchday(present, guests, [{ a: 'g1', b: 'p0' }], config, 2),
    ).toThrow(EdgeError)
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

// ── PR20 rebanada D1 — MARCADOR ABIERTO (decisión #3933, design #3801 `tipos`)
//
// Un partido de FIFA se carga con goles: cualquier par de enteros >= 0. Sin
// número objetivo, sin tope de games, sin "quién ganó". `3-1`, `0-0` y `2-2`
// son resultados legales del MISMO formato — que es exactamente lo que el
// modelo de pádel NO puede expresar (ronda 20, medido: "podés tener empates o
// podés tener un rango de marcadores, nunca las dos cosas").
describe('setError / matchError con openScore (marcador abierto)', () => {
  // `gamesPerSet: 4` y `tieBreak: true` siguen ahí porque `MatchFormat` los
  // declara obligatorios — y son EXACTAMENTE los dos que hoy prohíben un 3-1
  // (con tie-break el set corta en `gamesPerSet` exacto). Que el 3-1 pase con
  // estos mismos números es la prueba de que el camino abierto no los lee.
  const fifa: MatchFormat = { setsToWin: 1, gamesPerSet: 4, tieBreak: true, openScore: true }
  const padel: MatchFormat = { setsToWin: 1, gamesPerSet: 4, tieBreak: true, openScore: false }

  it.each([
    [3, 1],
    [0, 0],
    [2, 2],
    [7, 0],
    [1, 4],
  ])('acepta un %i-%i', (gamesA, gamesB) => {
    expect(setError({ gamesA, gamesB }, fifa, true)).toBeNull()
  })

  it('el MISMO 3-1 sigue rebotando con el marcador de pádel, palabra por palabra', () => {
    expect(setError({ gamesA: 3, gamesB: 1 }, padel, true)).toBe(
      'En un set a 4 games con tie-break, 3-1 no es un resultado posible.',
    )
  })

  it('no afloja los enteros ni los negativos: eso es un borde de confianza', () => {
    expect(setError({ gamesA: -1, gamesB: 0 }, fifa, true)).not.toBeNull()
    expect(setError({ gamesA: 2.5, gamesB: 1 }, fifa, true)).not.toBeNull()
  })

  // El empate es una regla ORTOGONAL al marcador abierto, y tiene que serlo:
  // `match_sets_no_draw` (0034) lo sigue exigiendo del lado de la base
  // (`check (allows_draw or games_a <> games_b)`). Si `openScore` aflojara el
  // empate por su cuenta, la app aceptaría algo que la base rechaza y el
  // mensaje legible se cambiaría por una violación de constraint.
  it('el empate lo sigue decidiendo allowsDraw, no openScore', () => {
    expect(setError({ gamesA: 0, gamesB: 0 }, fifa, false)).not.toBeNull()
    expect(setError({ gamesA: 3, gamesB: 1 }, fifa, false)).toBeNull()
  })

  it('y el rechazo del empate abierto no nombra al pádel', () => {
    expect(setError({ gamesA: 0, gamesB: 0 }, fifa, false)).not.toMatch(/padel/)
    expect(setError({ gamesA: 4, gamesB: 4 }, padel, false)).toMatch(/en padel no hay empates/)
  })

  it('un marcador abierto es UN partido, no una serie de sets', () => {
    expect(matchError([{ gamesA: 3, gamesB: 1 }], fifa, true)).toBeNull()
    expect(matchError([{ gamesA: 0, gamesB: 0 }], fifa, true)).toBeNull()
    expect(matchError([], fifa, true)).toMatch(/Falta cargar/)
    expect(
      matchError(
        [
          { gamesA: 3, gamesB: 1 },
          { gamesA: 1, gamesB: 0 },
        ],
        fifa,
        true,
      ),
    ).not.toBeNull()
  })
})

//
// `matchError` daba por TERMINADO un partido empatado a mitad de camino: 1-1
// en sets en un formato a 2, que en pádel seguiría con un tercero. El
// comentario que lo amparaba decía que el caso era "inalcanzable —la única
// disciplina con empates que el modelo de formato puede expresar es de un solo
// set—", y la ronda 20 midió que eso es FALSO: `validateConfig` acepta
// `setsToWin: 2` sobre una disciplina con empates devolviendo `[]`, y `config`
// SÍ está en el grant de UPDATE de `authenticated`.
//
// Se cierra con `openScore` porque el propio comentario lo nombraba como su
// resolución: ahora el modelo distingue "partido a N sets" de "partido a un
// marcador abierto", y el empate que TERMINA un partido es el del segundo
// —o el del primero cuando N = 1, que es todo lo que hay para jugar—.
describe('W62 — un empate a mitad de camino no cierra el partido', () => {
  const twoSets: MatchFormat = { setsToWin: 2, gamesPerSet: 4, tieBreak: true, openScore: false }

  it('la config que lo hace alcanzable pasa validateConfig sin una queja', () => {
    expect(validateConfig({ ...defaultConfig(8), matchFormat: twoSets }, 2)).toEqual([])
  })

  it('1-1 en un partido a 2 sets NO está terminado', () => {
    const sets = [
      { gamesA: 4, gamesB: 0 },
      { gamesA: 0, gamesB: 4 },
    ]
    expect(matchError(sets, twoSets, true)).toMatch(/no lo cierra/)
  })

  // El pin del otro lado: `REQ-D6-1` (el 2-2 que dejó andando la rebanada C)
  // no se mueve. Con `setsToWin: 1` se jugó todo lo que había para jugar.
  it('pero un set empatado en un formato a UN set sí cierra (REQ-D6-1)', () => {
    const oneSet: MatchFormat = { setsToWin: 1, gamesPerSet: 2, tieBreak: true, openScore: false }
    expect(matchError([{ gamesA: 2, gamesB: 2 }], oneSet, true)).toBeNull()
  })
})
