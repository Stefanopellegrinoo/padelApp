import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@/core'
import { RulesBody } from './rules-body'

/**
 * Reglas es la pantalla que se comparte con el grupo, y la fila "Formato de
 * partido" es la que W64 (verify-report ronda 21) encontró mintiendo: un
 * torneo con pádel Y FIFA decía "1 set a 4 games" porque narraba
 * `primaryDiscipline(header)` y nada más.
 *
 * Se renderiza el JSX de verdad, igual que el paso 4 del wizard: la fila sale
 * del acordeón y hay que mirar el HTML para saber qué dice.
 */
const PADEL = defaultConfig(8).matchFormat
const FIFA = { ...PADEL, openScore: true }

function html(formats: Array<{ label: string; matchFormat: typeof PADEL }>): string {
  return renderToStaticMarkup(
    createElement(RulesBody, {
      seasonId: 'season-1',
      config: defaultConfig(8),
      formats,
      adminName: 'Marce',
      rulesText: '',
      isAdmin: false,
    }),
  )
}

describe('Reglas — la fila de formato', () => {
  /**
   * PIN de no-regresión: con una sola disciplina la pantalla dice EXACTAMENTE
   * lo de siempre, sin prefijo y sin nombrar a nadie. Es el caso de todos los
   * torneos que existen hoy.
   */
  it('con una sola disciplina dice lo mismo que siempre', () => {
    expect(html([{ label: 'Pádel', matchFormat: PADEL }])).toContain('1 set a 4 games')
    expect(html([{ label: 'Pádel', matchFormat: PADEL }])).not.toContain('Pádel: 1 set a 4 games')
  })

  /**
   * W64: desde PR20 rebanada D2 cada disciplina nace con la forma de marcador
   * de su kind, así que un torneo puede tener DOS formatos. Una sola línea
   * dejó de ser verdad ese día.
   */
  it('con dos formatos nombra los dos, y de quién es cada uno', () => {
    expect(
      html([
        { label: 'Pádel', matchFormat: PADEL },
        { label: 'FIFA', matchFormat: FIFA },
      ]),
    ).toContain('Pádel: 1 set a 4 games · FIFA: Marcador de goles')
  })

  /**
   * Dos disciplinas del MISMO formato no son dos cosas que nombrar: dos Pádel
   * de una misma temporada (que la app arma desde PR13) siguen leyendo como
   * hasta hoy.
   */
  it('dos disciplinas con el mismo formato no repiten la frase', () => {
    const paso = html([
      { label: 'Pádel', matchFormat: PADEL },
      { label: 'Pádel', matchFormat: PADEL },
    ])
    expect(paso).toContain('1 set a 4 games')
    expect(paso).not.toContain('Pádel: 1 set a 4 games')
  })
})
