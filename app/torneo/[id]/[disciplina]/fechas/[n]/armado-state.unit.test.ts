import { describe, expect, it } from 'vitest'
import { applySeatTick, matchdayShape, type SeatVM } from './armado-state'

const squad: SeatVM[] = [
  { entryId: 'a', name: 'Ana', playing: true },
  { entryId: 'b', name: 'Beto', playing: true },
  { entryId: 'c', name: 'Cami', playing: false },
]

describe('applySeatTick', () => {
  it('marca que un asiento no viene, sin tocar a los demás', () => {
    const next = applySeatTick(squad, { entryId: 'a', playing: false })

    expect(next.map((seat) => seat.playing)).toEqual([false, true, false])
  })

  it('marca que un asiento vuelve a venir', () => {
    const next = applySeatTick(squad, { entryId: 'c', playing: true })

    expect(next.map((seat) => seat.playing)).toEqual([true, true, true])
  })

  /**
   * El test que existe por el bug que NO ocurre.
   *
   * React vuelve a aplicar la lista de acciones pendientes contra la base más
   * nueva cada vez que llegan props del servidor. Si el toque dijera "dalo
   * vuelta" en lugar de "queda así", este replay sobre una base que ya trae el
   * cambio lo invertiría, y el asiento volvería solo a mitad de la espera.
   *
   * Con un toggle esta aserción da `true` y el test falla.
   */
  it('reaplicado sobre una base que ya trae el cambio, no lo da vuelta', () => {
    const tick = { entryId: 'a', playing: false }
    const baseDelServidor = applySeatTick(squad, tick)

    const replay = applySeatTick(baseDelServidor, tick)

    expect(replay[0]?.playing).toBe(false)
  })

  it('dos toques al mismo asiento terminan en el último que se pidió', () => {
    const apagado = applySeatTick(squad, { entryId: 'b', playing: false })
    const prendido = applySeatTick(apagado, { entryId: 'b', playing: true })

    expect(prendido[1]?.playing).toBe(true)
  })

  it('no muta el plantel que recibe', () => {
    applySeatTick(squad, { entryId: 'a', playing: false })

    expect(squad[0]?.playing).toBe(true)
  })

  it('deja el plantel igual si el asiento no existe', () => {
    const next = applySeatTick(squad, { entryId: 'fantasma', playing: false })

    expect(next.map((seat) => seat.playing)).toEqual([true, true, false])
  })
})

/**
 * S31 (verify-report ronda 9): `armado.tsx` tenía `confirmed % 2` y
 * `{size / 2} parejas` hardcodeados — los espejos en la pantalla de los bugs
 * de aridad que la base ya tiene arreglados (`assertMatchdaySize` condiciona
 * la paridad por `sideSize` desde PR14/W24). Con una disciplina de a uno, esa
 * pantalla pedía un invitado que no hace falta y dividía por 2 un número que
 * no se divide.
 *
 * La cuenta se saca de la pantalla para poder probarla, mismo motivo y mismo
 * patrón que `sumar-state.ts`: `armado.tsx` es `'use client'` e importa
 * acciones `'use server'`.
 *
 * `matches` es nuevo y no es cosmético: la pantalla decía "La fecha es de 12"
 * sin que nadie pudiera saber que eso son 66 partidos de a uno contra 15 de a
 * dos. Ese es el número que hace pedir el formato de grupos (REQ-D8-1, PR21),
 * que es la respuesta real al techo — W32 NO se cierra con una constante.
 */
describe('matchdayShape', () => {
  describe('de a dos (pair_size=2)', () => {
    it('parte el plantel en parejas y cuenta el round robin', () => {
      const shape = matchdayShape({ confirmed: 12, looseGuests: 0, guestPairs: 0, sideSize: 2 })
      expect(shape.size).toBe(12)
      expect(shape.sides).toBe(6)
      expect(shape.matches).toBe(15)
      expect(shape.complete).toBe(true)
      expect(shape.needsLooseGuest).toBe(false)
    })

    it('con plantel impar pide el invitado suelto que empareja', () => {
      const shape = matchdayShape({ confirmed: 7, looseGuests: 0, guestPairs: 0, sideSize: 2 })
      expect(shape.needsLooseGuest).toBe(true)
      expect(shape.eventualSize).toBe(8)
      // 7 solos no bloquea por piso: van a ser 8.
      expect(shape.tooFew).toBe(false)
    })

    it('no vuelve a pedir un suelto cuando ya hay uno', () => {
      const shape = matchdayShape({ confirmed: 7, looseGuests: 1, guestPairs: 0, sideSize: 2 })
      expect(shape.needsLooseGuest).toBe(false)
      expect(shape.size).toBe(8)
      expect(shape.complete).toBe(true)
    })

    it('una pareja invitada suma dos y no cambia la paridad', () => {
      const shape = matchdayShape({ confirmed: 8, looseGuests: 0, guestPairs: 1, sideSize: 2 })
      expect(shape.size).toBe(10)
      expect(shape.sides).toBe(5)
      expect(shape.needsLooseGuest).toBe(false)
    })

    it('marca la fecha incompleta cuando queda alguien sin pareja', () => {
      // Plantel par con un suelto YA nombrado: `syncGuestSeat` lo conserva a
      // propósito y la fecha queda impar. Es el caso que el comentario de
      // `armado.tsx` nombraba como no dibujado.
      const shape = matchdayShape({ confirmed: 8, looseGuests: 1, guestPairs: 0, sideSize: 2 })
      expect(shape.size).toBe(9)
      expect(shape.complete).toBe(false)
    })
  })

  describe('de a uno (pair_size=1)', () => {
    it('cada jugador es su propio lado: la paridad no existe', () => {
      const shape = matchdayShape({ confirmed: 9, looseGuests: 0, guestPairs: 0, sideSize: 1 })
      expect(shape.sides).toBe(9)
      expect(shape.needsLooseGuest).toBe(false)
      expect(shape.complete).toBe(true)
      expect(shape.eventualSize).toBe(9)
    })

    it('nunca pide un invitado para emparejar, ni con plantel impar', () => {
      for (const confirmed of [7, 8, 9, 10, 11]) {
        const shape = matchdayShape({ confirmed, looseGuests: 0, guestPairs: 0, sideSize: 1 })
        expect(shape.needsLooseGuest).toBe(false)
        expect(shape.complete).toBe(true)
      }
    })

    it('cuenta los partidos que la fecha va a tener de verdad', () => {
      // El número que W32 nombra y la pantalla nunca mostró: 12 de a uno son
      // 66 partidos donde 12 de a dos son 15.
      expect(matchdayShape({ confirmed: 8, looseGuests: 0, guestPairs: 0, sideSize: 1 }).matches).toBe(28)
      expect(matchdayShape({ confirmed: 12, looseGuests: 0, guestPairs: 0, sideSize: 1 }).matches).toBe(66)
      expect(matchdayShape({ confirmed: 12, looseGuests: 0, guestPairs: 0, sideSize: 2 }).matches).toBe(15)
    })

    it('una pareja invitada suma dos jugadores que juegan solos (S42)', () => {
      // S42 (verify-report ronda 13): la matriz tenía `guestPairs` sólo con
      // `sideSize: 2`. Este es el caso que produjo W41 — el servidor rechazaba
      // esta misma fecha mientras la pantalla la mostraba armable.
      const shape = matchdayShape({ confirmed: 8, looseGuests: 0, guestPairs: 1, sideSize: 1 })
      expect(shape.size).toBe(10)
      expect(shape.sides).toBe(10)
      expect(shape.matches).toBe(45)
      expect(shape.complete).toBe(true)
      expect(shape.needsLooseGuest).toBe(false)
      // Y el servidor tiene que estar de acuerdo: con W41 arreglado,
      // `assertPointsCoverMatchday` cuenta 8 competidores del torneo para esta
      // misma fecha —los 2 invitados son dos lados que no cobran—, así que la
      // pantalla y la base dicen lo mismo. Antes de W41 el botón estaba
      // habilitado y el sorteo rebotaba.
      expect(shape.tooMany).toBe(false)
    })

    it('respeta el mismo piso y el mismo techo que la base enforcea hoy', () => {
      // `assertMatchdaySize` no condiciona MIN/MAX por `sideSize` (W32 sigue
      // abierto, reasignado a PR21/grupos): la pantalla no puede prometer un
      // límite distinto del que el servidor va a aplicar.
      expect(matchdayShape({ confirmed: 7, looseGuests: 0, guestPairs: 0, sideSize: 1 }).tooFew).toBe(true)
      expect(matchdayShape({ confirmed: 13, looseGuests: 0, guestPairs: 0, sideSize: 1 }).tooMany).toBe(true)
      expect(matchdayShape({ confirmed: 12, looseGuests: 0, guestPairs: 0, sideSize: 1 }).tooMany).toBe(false)
    })
  })
})
