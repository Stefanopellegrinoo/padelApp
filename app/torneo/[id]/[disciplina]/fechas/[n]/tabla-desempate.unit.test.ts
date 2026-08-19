import { describe, it, expect } from 'vitest'
import { pair, single, type SeasonConfig, type Side, type SideStanding } from '@/core'
import { tiebreakNote } from './tabla-desempate'

/**
 * `tiebreakNote` vivía adentro de `page.tsx` —un server component `async` que
 * la suite pura no puede importar— y por eso NO TENÍA UNA SOLA ASERCIÓN,
 * mientras espejaba a mano el primer criterio de `computeStandings`.
 *
 * Eso es la regla que este proyecto ya aprendió tres veces (W59, el aviso de
 * D1, W66): extraer a un módulo puro MUEVE el riesgo al punto de unión. El
 * módulo queda con red y el cableado sin ninguna. Acá el cableado es la frase:
 * `computeStandings` ordena por una cosa y el pie de la tabla explica otra, y
 * nadie se entera porque el pie no lo mira nadie más que una persona con un
 * navegador. Mismo precedente de extracción que `tabla-congelada.ts`.
 */

const NOMBRES = new Map([
  ['a1', 'Ana'], ['a2', 'Aldo'],
  ['b1', 'Bruno'], ['b2', 'Bea'],
])

const PADEL: SeasonConfig = {
  squadSize: 8,
  matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true, openScore: false },
  points: [10, 6, 3, 1],
  regularMatchdays: 10,
  countBestOf: 8,
  tiebreakSnapshotEvery: 3,
}
const FIFA: SeasonConfig = {
  ...PADEL,
  matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true, openScore: true },
}

function fila(
  side: Side,
  position: number,
  campos: Partial<Omit<SideStanding, 'side' | 'position'>>,
): SideStanding {
  return {
    side,
    played: 3,
    won: 0,
    drawn: 0,
    dayPoints: 0,
    setsDiff: 0,
    gamesDiff: 0,
    position,
    ...campos,
  }
}

const A = pair('a1', 'a2')
const B = pair('b1', 'b2')

describe('tiebreakNote', () => {
  it('no dice nada cuando nadie quedó nivelado', () => {
    const standings = [
      fila(A, 1, { won: 3, dayPoints: 3, gamesDiff: 6 }),
      fila(B, 2, { won: 1, dayPoints: 1, gamesDiff: 1 }),
    ]
    expect(tiebreakNote(standings, PADEL, NOMBRES, 2)).toBeNull()
  })

  it('nombra la diferencia de games cuando cortó ella, y a los dos lados', () => {
    const standings = [
      fila(A, 1, { won: 2, dayPoints: 2, gamesDiff: 6 }),
      fila(B, 2, { won: 2, dayPoints: 2, gamesDiff: 2 }),
    ]
    expect(tiebreakNote(standings, PADEL, NOMBRES, 2)).toBe(
      'Bruno & Bea quedaron 2° por diferencia de games: empataron en partidos ganados con Ana & Aldo.',
    )
  })

  it('con marcador abierto los games son goles', () => {
    const standings = [
      fila(A, 1, { won: 2, dayPoints: 6, gamesDiff: 6 }),
      fila(B, 2, { won: 2, dayPoints: 6, gamesDiff: 2 }),
    ]
    expect(tiebreakNote(standings, FIFA, NOMBRES, 2)).toContain('por diferencia de gol')
  })

  it('habla en singular cuando la disciplina se juega de a uno', () => {
    const standings = [
      fila(single('a1'), 1, { won: 2, dayPoints: 2, gamesDiff: 6 }),
      fila(single('b1'), 2, { won: 2, dayPoints: 2, gamesDiff: 2 }),
    ]
    const note = tiebreakNote(standings, PADEL, NOMBRES, 1)
    expect(note).toContain('Bruno quedó 2°')
    expect(note).toContain('empató en partidos ganados')
  })

  // ── El punto de unión, que es lo que esta extracción viene a cubrir ────────

  it('nivelados en PUNTOS pero no en ganados, la frase no dice "partidos ganados"', () => {
    // A ganó 3. B ganó 2 y empató 3: 2*3 + 3 = 9, los mismos puntos que A.
    // NO empataron en partidos ganados — decirlo sería falso.
    const standings = [
      fila(A, 1, { won: 3, drawn: 0, dayPoints: 9, gamesDiff: 6 }),
      fila(B, 2, { won: 2, drawn: 3, dayPoints: 9, gamesDiff: 2 }),
    ]
    expect(tiebreakNote(standings, FIFA, NOMBRES, 2)).toBe(
      'Bruno & Bea quedaron 2° por diferencia de gol: empataron en puntos de la fecha con Ana & Aldo.',
    )
  })

  it('con los MISMOS ganados pero distintos puntos no hubo desempate que explicar', () => {
    // Los dos ganaron uno, pero A además empató uno: 4 contra 3. El orden lo
    // decidieron los PUNTOS, no un desempate — no hay nada que narrar.
    // Éste es el test que se pone rojo si la frase vuelve a mirar `won`.
    const standings = [
      fila(A, 1, { won: 1, drawn: 1, dayPoints: 4, gamesDiff: 0 }),
      fila(B, 2, { won: 1, drawn: 0, dayPoints: 3, gamesDiff: 9 }),
    ]
    expect(tiebreakNote(standings, FIFA, NOMBRES, 2)).toBeNull()
  })

  it('el pádel a dos sets sigue cortando por diferencia de sets antes que por games', () => {
    const dosSets: SeasonConfig = {
      ...PADEL,
      matchFormat: { setsToWin: 2, gamesPerSet: 4, tieBreak: true, openScore: false },
    }
    const standings = [
      fila(A, 1, { won: 2, dayPoints: 2, setsDiff: 3, gamesDiff: 1 }),
      fila(B, 2, { won: 2, dayPoints: 2, setsDiff: 1, gamesDiff: 9 }),
    ]
    // Cortó la diferencia de SETS, que esta frase no narra: sin esta rama diría
    // que cortó la de games, y la de games la tiene GANADA el que quedó abajo.
    expect(tiebreakNote(standings, dosSets, NOMBRES, 2)).toBeNull()
  })
})
