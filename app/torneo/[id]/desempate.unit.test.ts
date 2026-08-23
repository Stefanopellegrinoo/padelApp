import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Desempate, type StandingsRow } from './desempate'

/**
 * S85 (verify-report-pr21-cierre #4016): el número de puesto de `Desempate`
 * comparte el mismo `w-4 shrink-0` que `armado.tsx`/`masters.tsx` — y a
 * diferencia de `masters.tsx` (siempre 1..MASTERS_SIZE=4, nunca dos dígitos)
 * la tabla general de la temporada SÍ llega a 10+ jugadores sin techo
 * propio. `useRouter` se mockea porque `Desempate` lo llama en cada render
 * (`router.push` al tocar una fila) — sin esto `renderToStaticMarkup` tira
 * fuera de un árbol de Next real.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
}))

function row(position: number): StandingsRow {
  return {
    entryId: `e${position}`,
    displayName: `Jugador ${position}`,
    initials: `J${position}`,
    position,
    points: 100 - position,
    movement: 0,
    tiedWithEntryId: null,
  }
}

function html(rows: StandingsRow[]): string {
  return renderToStaticMarkup(
    createElement(Desempate, {
      seasonId: 's1',
      rows,
      mastersCutoff: 4,
      tiebreakOrder: [],
      tiebreakSnapshotEvery: 3,
      asOfMatchday: null,
      nextRefreshMatchday: 3,
    }),
  )
}

describe('Desempate — el número de puesto no se recorta desde el 10 (S85, verify-report-pr21-cierre #4016)', () => {
  it('con 10 jugadores, el décimo puesto usa w-5, no w-4', () => {
    const rows = Array.from({ length: 10 }, (_, index) => row(index + 1))

    const markup = html(rows)

    const decimo = /<span class="[^"]*">10<\/span>/.exec(markup)?.[0] ?? ''
    expect(decimo).toContain('w-5')
    expect(decimo).not.toContain('w-4')
  })
})
