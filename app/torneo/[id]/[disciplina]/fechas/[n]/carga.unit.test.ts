import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PanelGoles } from './carga'

/**
 * El panel de marcador abierto, RENDERIZADO.
 *
 * Las dos cosas que la ronda 21 encontró abriéndolo en un navegador —que el
 *Botón se apaga sin decir por qué y que no se ve dónde está el foco
 *No las puede ver un test sobre la función que valida: son atributos y
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
    expect(html('', '')).not.toContain('un número entero por lado')
    expect(html('3', '')).not.toContain('un número entero por lado')
    expect(html('3', '')).not.toContain('aria-invalid')
  })

  it('un 3-1 en un solo campo se explica, y el campo queda marcado', () => {
    const panel = html('3-1', '')
    expect(panel).toContain('un número entero por lado')
    expect(panel).toContain('aria-invalid="true"')
  })

  it('las letras y los decimales también', () => {
    expect(html('abc', '2')).toContain('un número entero por lado')
    expect(html('1', '1.5')).toContain('un número entero por lado')
  })

  it('con el marcador completo no queda nada marcado ni nada que explicar', () => {
    const panel = html('3', '1')
    expect(panel).not.toContain('un número entero por lado')
    expect(panel).not.toContain('aria-invalid')
  })
})

describe('panel de goles — el foco se ve', () => {
  /**
   * `outline-none` sin nada que lo reemplace deja el panel operable por teclado
   * y sin indicador de foco (WCAG 2.4.7). Medido en el navegador:
   * `outlineStyle: none`, `boxShadow: none`.
   *
   * Sólo los dos campos nuevos: `outline-none` está en 19 inputs de 11
   * archivos y `focus-visible` no aparecía en ninguno. Los otros 17 son deuda
   * de a11y previa y no son de esta tanda.
   */
  it('los dos campos de goles traen un anillo de foco', () => {
    const anillos = html('', '').match(/focus-visible:ring-2/g) ?? []
    expect(anillos).toHaveLength(2)
  })
})
