import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BotonesDelPerdedor, PanelGoles } from './carga'

/**
 * El panel de marcador abierto, RENDERIZADO.
 *
 * Las dos cosas que la ronda 21 encontró abriéndolo en un navegador —que el
 * botón se apaga sin decir por qué (S74) y que no se ve dónde está el foco
 * (S72)— no las puede ver un test sobre la función que valida: son atributos y
 * clases del DOM. Por eso esto renderiza el JSX y mira el HTML.
 *
 * Lo que NO cubre: la interacción. Acá no se tipea ni se clickea; lo que se
 * fija es qué dibuja el panel para un estado dado.
 */
function html(a: string, b: string): string {
  return renderToStaticMarkup(
    createElement(PanelGoles, {
      pairAName: 'Jugador 1 & Jugador 8',
      pairBName: 'Jugador 4 & Jugador 5',
      goals: { a, b },
      pending: false,
      onChange: () => {},
      onSave: () => {},
    }),
  )
}

describe('panel de goles — por qué el botón está apagado', () => {
  it('mientras se tipea no reta a nadie', () => {
    expect(html('', '')).not.toContain('Un número por lado')
    expect(html('3', '')).not.toContain('Un número por lado')
    expect(html('3', '')).not.toContain('aria-invalid')
  })

  it('un 3-1 en un solo campo se explica, y el campo queda marcado', () => {
    const panel = html('3-1', '')
    expect(panel).toContain('Un número por lado')
    expect(panel).toContain('aria-invalid="true"')
  })

  it('las letras y los decimales también', () => {
    expect(html('abc', '2')).toContain('Un número por lado')
    expect(html('1', '1.5')).toContain('Un número por lado')
  })

  it('con el marcador completo no queda nada marcado ni nada que explicar', () => {
    const panel = html('3', '1')
    expect(panel).not.toContain('Un número por lado')
    expect(panel).not.toContain('aria-invalid')
  })
})

describe('panel de goles — el foco se ve', () => {
  /**
   * `outline-none` sin nada que lo reemplace deja el panel operable por teclado
   * y sin indicador de foco (WCAG 2.4.7). Antes cada campo traía su propio
   * `focus-visible:ring-2`; desde el rediseño el anillo es global
   * (`:focus-visible` sin capa en `globals.css`) y le gana a cualquier
   * utilidad. Lo que se fija acá es que los campos no lo apaguen.
   */
  it('los dos campos de goles no apagan el anillo de foco', () => {
    const panel = html('', '')
    expect(panel.match(/<input/g) ?? []).toHaveLength(2)
    expect(panel).not.toContain('outline-none')
  })

  it('los campos piden 16px o más (sin zoom de iOS) y el teclado numérico', () => {
    const panel = html('', '')
    for (const input of panel.match(/<input[^>]*>/g) ?? []) {
      expect(input).toContain('inputMode="numeric"')
      expect(input).toMatch(/text-\[(1[6-9]|[2-9]\d)px\]/)
    }
  })
})

describe('botones del perdedor — la unidad del deporte y los de ventaja', () => {
  const PING_PONG = { setsToWin: 2, gamesPerSet: 11, tieBreak: false, openScore: false }
  const PADEL = { setsToWin: 1, gamesPerSet: 4, tieBreak: true, openScore: false }

  function botones(format: typeof PADEL, unit: string) {
    const html = renderToStaticMarkup(
      createElement(BotonesDelPerdedor, { format, unit, loserName: 'Caro & Dani', pending: false, onLoser: () => {}, onDeuce: () => {} }),
    )
    const labels = [...html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map((m) => ({
      text: m[2] ?? '',
      aria: /aria-label="([^"]*)"/.exec(m[1] ?? '')?.[1] ?? null,
    }))
    return { html, labels }
  }

  it('ping pong: "Puntos de" quien perdió, 0 a 9 y después 12-10 … 16-14 con su nombre para el lector', () => {
    const { html, labels } = botones(PING_PONG, 'puntos')
    expect(html).toContain('Puntos de Caro &amp; Dani')
    expect(labels.map((b) => b.text)).toEqual([
      ...['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
      ...['12-10', '13-11', '14-12', '15-13', '16-14'],
    ])
    expect(labels.filter((b) => b.text.includes('-')).map((b) => b.aria)).toEqual([
      '12 a 10',
      '13 a 11',
      '14 a 12',
      '15 a 13',
      '16 a 14',
    ])
  })

  it('pádel, igual que siempre: "Games de" quien perdió, 0 a 3 y ningún botón de ventaja', () => {
    const { html, labels } = botones(PADEL, 'games')
    expect(html).toContain('Games de Caro &amp; Dani')
    expect(labels.map((b) => b.text)).toEqual(['0', '1', '2', '3'])
  })

  // 44 es el piso; la hoja los hace de 60, como el prototipo (`.gpick`), porque se tocan parado en el club.
  it('cada botón mide al menos 44px de alto (la regla del dedo), en ping pong y en pádel', () => {
    for (const [format, unit] of [[PING_PONG, 'puntos'], [PADEL, 'games']] as const) {
      const { html } = botones(format, unit)
      const clases = [...html.matchAll(/<button[^>]*class="([^"]*)"/g)].map((m) => m[1] ?? '')
      expect(clases.length).toBeGreaterThan(0)
      for (const clase of clases) expect(clase.split(' ')).toContain('min-h-[60px]')
    }
  })

  it('sin ganador elegido se ven pero no se tocan, y la pregunta no nombra a nadie', () => {
    const html = renderToStaticMarkup(
      createElement(BotonesDelPerdedor, { format: PADEL, unit: 'games', loserName: null, pending: false, onLoser: () => {}, onDeuce: () => {} }),
    )
    expect(html).toContain('Games del que perdió')
    const deshabilitados = html.match(/<button[^>]*disabled=""/g) ?? []
    expect(deshabilitados).toHaveLength(4)
  })
})
