import { describe, expect, it } from 'vitest'
import type { MatchFormat } from '@/core'
import { matchError, setError } from '@/db/validate'
import {
  chooseLoserGames,
  chooseWinner,
  isComplete,
  loserGamesOptions,
  startLoad,
} from './carga-state'

const ONE_SET_TO_4: MatchFormat = { setsToWin: 1, gamesPerSet: 4, tieBreak: true }
const TWO_SETS_TO_6: MatchFormat = { setsToWin: 2, gamesPerSet: 6, tieBreak: true }
const NO_TIEBREAK: MatchFormat = { setsToWin: 1, gamesPerSet: 4, tieBreak: false }

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
