import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { Historial } from './historial'

describe('Historial', () => {
  it('separa los que jugaron juntos de los que se enfrentaron', () => {
    const html = renderToStaticMarkup(
      Historial({
        nombre: 'Juan',
        partidos: [
          { matchId: '1', matchdayId: 'f1', together: true },
          { matchId: '2', matchdayId: 'f1', together: false },
          { matchId: '3', matchdayId: 'f2', together: false },
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
