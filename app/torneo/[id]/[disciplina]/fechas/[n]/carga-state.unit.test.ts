import { describe, expect, it } from 'vitest'
import type { MatchFormat } from '@/core'
import { matchError, setError } from '@/db/validate'
import {
  chooseLoserGames,
  chooseWinner,
  goalsError,
  goalsRejected,
  isComplete,
  loserGamesOptions,
  openScoreSet,
  startLoad,
} from './carga-state'

const ONE_SET_TO_4: MatchFormat = { setsToWin: 1, gamesPerSet: 4, tieBreak: true, openScore: false }
const TWO_SETS_TO_6: MatchFormat = { setsToWin: 2, gamesPerSet: 6, tieBreak: true, openScore: false }
const NO_TIEBREAK: MatchFormat = { setsToWin: 1, gamesPerSet: 4, tieBreak: false, openScore: false }
/** FIFA: los dos números de pádel siguen puestos y NO se leen — ésa es la prueba. */
const FIFA_OPEN: MatchFormat = { setsToWin: 1, gamesPerSet: 4, tieBreak: true, openScore: true }

/** The two taps of one set, from an empty load. */
function play(winner: 'A' | 'B', loserGames: number, format: MatchFormat) {
  return chooseLoserGames(chooseWinner(startLoad(), winner), loserGames, format)
}

describe('the two-tap load', () => {
  it('gives the winner the full set and the loser the games that were tapped', () => {
    expect(play('A', 2, ONE_SET_TO_4).sets).toEqual([{ gamesA: 4, gamesB: 2 }])
  })

  it('puts the games on the other side when B won', () => {
    expect(play('B', 2, ONE_SET_TO_4).sets).toEqual([{ gamesA: 2, gamesB: 4 }])
  })

  it('offers one button per possible loser score, 0 to gamesPerSet - 1', () => {
    expect(loserGamesOptions(ONE_SET_TO_4)).toEqual([0, 1, 2, 3])
    expect(loserGamesOptions(TWO_SETS_TO_6)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('drops the option that cannot close a set when there is no tie-break', () => {
    // 4-3 no cierra un set a 4 sin tie-break: hay que ganar por dos.
    expect(loserGamesOptions(NO_TIEBREAK)).toEqual([0, 1, 2])
  })

  it('produces a legal set for every button, on both sides', () => {
    for (const format of [ONE_SET_TO_4, TWO_SETS_TO_6, NO_TIEBREAK]) {
      for (const winner of ['A', 'B'] as const) {
        for (const loserGames of loserGamesOptions(format)) {
          const set = play(winner, loserGames, format).sets[0]
          expect(set).toBeDefined()
          expect(setError(set!, format, false)).toBeNull()
          // Y del lado correcto: quien ganó tiene más games que quien perdió.
          expect(winner === 'A' ? set!.gamesA > set!.gamesB : set!.gamesB > set!.gamesA).toBe(true)
        }
      }
    }
  })

  it('closes the match on the first set when the format asks for one', () => {
    const state = play('A', 0, ONE_SET_TO_4)
    expect(isComplete(state, ONE_SET_TO_4)).toBe(true)
    expect(matchError(state.sets, ONE_SET_TO_4, false)).toBeNull()
  })

  it('needs two sets from the same side when the format asks for two', () => {
    const first = play('A', 4, TWO_SETS_TO_6)
    expect(isComplete(first, TWO_SETS_TO_6)).toBe(false)

    const second = chooseLoserGames(chooseWinner(first, 'A'), 3, TWO_SETS_TO_6)
    expect(second.sets).toEqual([
      { gamesA: 6, gamesB: 4 },
      { gamesA: 6, gamesB: 3 },
    ])
    expect(isComplete(second, TWO_SETS_TO_6)).toBe(true)
  })

  it('does not close the match when the two sets went one each', () => {
    const split = chooseLoserGames(
      chooseWinner(play('A', 4, TWO_SETS_TO_6), 'B'),
      2,
      TWO_SETS_TO_6,
    )
    expect(isComplete(split, TWO_SETS_TO_6)).toBe(false)
  })

  it('refuses to grow a match that is already complete', () => {
    const done = chooseLoserGames(chooseWinner(play('A', 4, TWO_SETS_TO_6), 'A'), 3, TWO_SETS_TO_6)
    expect(isComplete(done, TWO_SETS_TO_6)).toBe(true)
    // El reintento después de un guardado fallido no puede apilar un tercer set:
    // 2-1 lo aceptaría `matchError` y `saveResult` lo escribiría encima del bueno.
    expect(chooseLoserGames(chooseWinner(done, 'B'), 2, TWO_SETS_TO_6).sets).toEqual(done.sets)
  })

  it('leaves no half-built set behind when the load is cancelled mid-way', () => {
    const halfway = chooseWinner(play('A', 4, TWO_SETS_TO_6), 'B')
    expect(halfway.pendingWinner).toBe('B')
    // Cancelar es volver a empezar: `startLoad` no hereda nada del intento anterior.
    expect(startLoad()).toEqual({ sets: [], pendingWinner: null })
  })

  it('asks who won again after every set', () => {
    expect(play('A', 1, TWO_SETS_TO_6).pendingWinner).toBeNull()
  })
})

// ── PR20 rebanada D2 — la carga de un marcador abierto ───────────────────────
//
// La máquina de dos toques de arriba NO cambia una línea: es la que sirve para
// el pádel y sus tests son el pin. Con `openScore` hace falta otra cosa
// entera, porque la de dos toques por construcción no puede producir ni un
// `3-1` (el ganador siempre se lleva `gamesPerSet`) ni un empate
// (`chooseWinner` pide `'A' | 'B'`).
//
// Dos entradas numéricas y nada más: cualquier par de enteros >= 0 es un
// resultado posible. Si el par no es legal para la disciplina —un `0-0` donde
// no se admiten empates— lo dice `matchError` del lado del servidor, que es
// donde vive esa regla. Esta función NO la duplica: una segunda opinión sobre
// el empate son dos verdades para sincronizar.
describe('el marcador abierto: dos números tipeados', () => {
  it('arma un 3-1', () => {
    expect(openScoreSet('3', '1')).toEqual({ gamesA: 3, gamesB: 1 })
  })

  it('arma un 0-0, que es el resultado más común del fútbol', () => {
    expect(openScoreSet('0', '0')).toEqual({ gamesA: 0, gamesB: 0 })
  })

  it('no arma nada mientras falte uno de los dos lados', () => {
    expect(openScoreSet('', '1')).toBeNull()
    expect(openScoreSet('2', '')).toBeNull()
    expect(openScoreSet('', '')).toBeNull()
  })

  it('no arma nada con lo que no es un entero >= 0', () => {
    expect(openScoreSet('-1', '0')).toBeNull()
    expect(openScoreSet('1.5', '0')).toBeNull()
    expect(openScoreSet('dos', '0')).toBeNull()
    expect(openScoreSet(' ', '0')).toBeNull()
  })

  it('corta en tres dígitos: `match_sets.games_a` es un `int` de Postgres', () => {
    expect(openScoreSet('999', '0')).toEqual({ gamesA: 999, gamesB: 0 })
    expect(openScoreSet('1000', '0')).toBeNull()
  })

  it('lo que devuelve lo acepta setError, incluido el 0-0 con empates', () => {
    const three_one = openScoreSet('3', '1')
    expect(three_one).not.toBeNull()
    expect(setError(three_one!, FIFA_OPEN, true)).toBeNull()

    const goalless = openScoreSet('0', '0')
    expect(goalless).not.toBeNull()
    expect(setError(goalless!, FIFA_OPEN, true)).toBeNull()
    // Y sin empates lo rechaza, que es la regla ortogonal de la disciplina.
    expect(setError(goalless!, FIFA_OPEN, false)).not.toBeNull()
  })
})

/**
 * S74 (verify-report ronda 21): tipear `abc`, `-5`, `1.5` o —lo más natural del
 * mundo— `3-1` en el primer campo deja el texto a la vista y "Guardar
 * resultado" muerto, sin decir por qué. El rechazo del servidor sí se explica;
 * el del cliente no explicaba nada.
 */
describe('goalsRejected', () => {
  it('lo vacío y lo que se está tipeando NO es un rechazo', () => {
    expect(goalsRejected('')).toBe(false)
    expect(goalsRejected('   ')).toBe(false)
    expect(goalsRejected('3')).toBe(false)
    expect(goalsRejected(' 7 ')).toBe(false)
  })

  it('lo que ya no puede ser un marcador, sí', () => {
    expect(goalsRejected('abc')).toBe(true)
    expect(goalsRejected('-5')).toBe(true)
    expect(goalsRejected('1.5')).toBe(true)
    // El `3-1` en un solo campo: es "el resultado", y es el error que la
    // auditoría nombró como el más probable de todos.
    expect(goalsRejected('3-1')).toBe(true)
    // Cuatro dígitos sólo llegan pegando por fuera del `maxLength`, pero
    // llegan: el panel los rechaza y ahora también lo dice.
    expect(goalsRejected('12345')).toBe(true)
  })
})

describe('goalsError', () => {
  it('no dice nada mientras no haya nada que explicar', () => {
    expect(goalsError('', '')).toBeNull()
    expect(goalsError('3', '')).toBeNull()
    expect(goalsError('3', '1')).toBeNull()
  })

  it('explica el rechazo, y nombra el caso del 3-1 en un solo campo', () => {
    const message = goalsError('3-1', '')
    expect(message).toContain('un número entero por lado')
    expect(message).toContain('3-1')
  })

  it('da igual de qué lado esté el error', () => {
    expect(goalsError('', 'abc')).toBe(goalsError('abc', ''))
  })
})
