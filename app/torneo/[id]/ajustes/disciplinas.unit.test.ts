import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NuevaDisciplina, type SquadMemberVM } from './disciplinas'

/**
 * El formulario de "+ Agregar disciplina" (REQ-D1-2/REQ-D1-4), RENDERIZADO
 * aparte de `Disciplinas` por lo mismo que `SelectorDeFormato` (`armado.tsx`,
 * PR21 D2): `Disciplinas` guarda `adding` en un `useState` que arranca en
 * `false`, y sin clicks (este repo no tiene runner E2E ni React Testing
 * Library) la suite nunca lo vería abierto si el fieldset "Lados" viviera
 * sólo adentro. Acá entra ya abierto, con el estado que quiera el test.
 *
 * Mismo límite que allá: lo que NO cubre es que tocar "Agregar" dispare
 * `addDisciplineToSeason` con el `pairSize` correcto — eso queda para el
 * reporte de esta rebanada. Lo que SÍ está cubierto de punta a punta es que
 * `newDisciplineSpec`, recibiendo `pairSize=1`, arma la fila con la curva de
 * la decisión #3963 (`wizard-state.unit.test.ts`).
 */
const squad: SquadMemberVM[] = [
  { entryId: 'a', name: 'Colo' },
  { entryId: 'b', name: 'Nacho' },
]

function html(kind: 'PADEL' | 'FIFA', pairSize: 1 | 2): string {
  return renderToStaticMarkup(
    createElement(NuevaDisciplina, {
      kind,
      pairSize,
      squad,
      selected: new Set(squad.map((member) => member.entryId)),
      pending: false,
      onChangeKind: () => {},
      onChangePairSize: () => {},
      onToggle: () => {},
      onSubmit: () => {},
      onCancel: () => {},
    }),
  )
}

describe('NuevaDisciplina', () => {
  it('nace con "Lados" en Parejas — no-regresión: ninguna disciplina existente cambia', () => {
    const markup = html('PADEL', 2)
    const inputs = markup.match(/<input[^>]*name="pairSize"[^>]*\/>/g) ?? []
    expect(inputs).toHaveLength(2)
    expect(inputs[0]).toContain('checked')
    expect(inputs[1]).not.toContain('checked')
  })

  // Se pincha el ARGUMENTO, no que el radio exista (#3957): con pairSize=1
  // el marcado tiene que ser "Individual", no "Parejas".
  it('marca "Individual" cuando pairSize=1', () => {
    const markup = html('FIFA', 1)
    const inputs = markup.match(/<input[^>]*name="pairSize"[^>]*\/>/g) ?? []
    expect(inputs).toHaveLength(2)
    expect(inputs[0]).not.toContain('checked')
    expect(inputs[1]).toContain('checked')
  })

  it('sigue ofreciendo "Tipo" al lado de "Lados" (mismo patrón de radio)', () => {
    const markup = html('PADEL', 2)
    expect(markup).toContain('Tipo')
    expect(markup).toContain('Lados')
    expect(markup).toContain('Parejas')
    expect(markup).toContain('Individual')
  })
})
