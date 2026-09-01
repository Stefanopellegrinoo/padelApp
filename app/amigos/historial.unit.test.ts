import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import type { SharedMatch } from '@/db/friends'
import { Historial } from './historial'

// `SharedMatch` creció en Task 2 (plan-historial-entre-amigos-2a): esta
// pantalla todavía sólo lee `together` (Task 3 la vuelve una lista), pero el
// tipo que declara `HistorialProps.partidos` es el mismo, así que un fixture
// de acá tiene que completar el resto igual que cualquier otro caller real.
function partido(base: Pick<SharedMatch, 'matchId' | 'matchdayId' | 'together'>): SharedMatch {
  return {
    ...base,
    playedOn: '2026-01-01',
    matchdayNumber: 1,
    matchdayKind: 'REGULAR',
    seasonName: 'Temporada de test',
    outcome: null,
    score: null,
  }
}

describe('Historial', () => {
  it('separa los que jugaron juntos de los que se enfrentaron', () => {
    const html = renderToStaticMarkup(
      Historial({
        nombre: 'Juan',
        partidos: [
          partido({ matchId: '1', matchdayId: 'f1', together: true }),
          partido({ matchId: '2', matchdayId: 'f1', together: false }),
          partido({ matchId: '3', matchdayId: 'f2', together: false }),
        ],
      }),
    )
    expect(html).toContain('Juntos 1')
    expect(html).toContain('En contra 2')
  })

  it('con un amigo sin partidos dice qué falta, no una tabla vacía', () => {
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', partidos: [] }))
    expect(html).toContain('Todavía no jugaron')
  })
})
