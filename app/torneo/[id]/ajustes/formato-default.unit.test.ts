import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { DisciplineId, MatchdayFormat } from '@/core'
import { FormatoDefault } from './formato-default'

/**
 * `FormatoDefault` (§2.5), RENDERIZADO por el mismo motivo que el resto de
 * Ajustes (`formato.unit.test.ts`): sin clicks (este repo no tiene runner
 * E2E ni React Testing Library), lo que se puede probar es qué dibuja el
 * componente para cada `formatoDefault` -- no que tocar un radio dispare
 * `saveFormatoDefault` con el argumento correcto.
 */
function html(formatoDefault: MatchdayFormat, disciplineLabel: string | null = null): string {
  return renderToStaticMarkup(
    createElement(FormatoDefault, {
      seasonId: 'season-1',
      disciplineId: 'discipline-1' as DisciplineId,
      formatoDefault,
      disciplineLabel,
    }),
  )
}

/** Los tres `<input type="radio">`, en el orden en que el componente los dibuja. */
function radios(markup: string): string[] {
  return markup.match(/<input[^>]*type="radio"[^>]*\/>/g) ?? []
}

describe('FormatoDefault (§2.5)', () => {
  it('con ROUND_ROBIN guardado, sale marcado el radio de "Todos contra todos" y ningún otro', () => {
    const markup = html({ kind: 'ROUND_ROBIN' })
    const [todos, dos, cuatro] = radios(markup)
    expect(markup).toContain('Todos contra todos')
    expect(todos).toContain('checked')
    expect(dos).not.toContain('checked')
    expect(cuatro).not.toContain('checked')
  })

  it('con GROUPS_KNOCKOUT groups=2 guardado, sale marcado sólo "2 grupos + llave"', () => {
    const markup = html({ kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 })
    const [todos, dos, cuatro] = radios(markup)
    expect(markup).toContain('2 grupos + llave')
    expect(todos).not.toContain('checked')
    expect(dos).toContain('checked')
    expect(cuatro).not.toContain('checked')
  })

  it('con GROUPS_KNOCKOUT groups=4 guardado, sale marcado sólo "4 grupos + llave"', () => {
    const markup = html({ kind: 'GROUPS_KNOCKOUT', groups: 4, qualifiersPerGroup: 2 })
    const [todos, dos, cuatro] = radios(markup)
    expect(markup).toContain('4 grupos + llave')
    expect(todos).not.toContain('checked')
    expect(dos).not.toContain('checked')
    expect(cuatro).toContain('checked')
  })

  it('con disciplineLabel null el título es "Formato de las fechas" a secas', () => {
    const markup = html({ kind: 'ROUND_ROBIN' }, null)
    expect(markup).toContain('Formato de las fechas')
    expect(markup).not.toContain('Formato de las fechas ·')
  })

  it('con más de una disciplina el título nombra cuál es (mismo contrato que Formato/Reglas)', () => {
    const markup = html({ kind: 'ROUND_ROBIN' }, 'FIFA')
    expect(markup).toContain('Formato de las fechas · FIFA')
  })

  /**
   * Fix round 1, LOW: el `name` compartido es lo que hace que el navegador
   * trate los tres radios como un solo grupo mutuamente excluyente, Y lo
   * que separa el grupo de UNA disciplina del de otra cuando hay más de un
   * `FormatoDefault` en la misma página (`ajustes/page.tsx` dibuja uno por
   * disciplina). Sin este assert, borrar el `name` dejaba las 5 pruebas de
   * arriba en verde igual -- ninguna mira ese atributo.
   */
  it('los tres radios comparten `name`, scopeado a la disciplina', () => {
    const markup = html({ kind: 'ROUND_ROBIN' })
    const conNombre = radios(markup).filter((radio) => radio.includes('name="formato-default-discipline-1"'))
    expect(conNombre).toHaveLength(3)
  })
})
