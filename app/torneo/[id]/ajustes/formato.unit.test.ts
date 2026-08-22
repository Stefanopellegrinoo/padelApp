import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { DisciplineId } from '@/core'
import { configFor } from '@/app/torneos/nuevo/wizard-state'
import { Formato } from './formato'

/**
 * El control de Masters (decisión #4029, parte 2: editable en Ajustes;
 * parte 3: no se puede encender en una disciplina de a uno).
 *
 * RENDERIZADO, mismo motivo que el resto de esta pantalla y del wizard: sin
 * clicks (este repo no tiene runner E2E ni React Testing Library), lo que se
 * puede probar es qué dibuja `Formato` para cada combinación de
 * `pairSize`/`hasMasters` -- no que tocar el check dispare `saveHasMasters`
 * con el argumento correcto.
 */
function html(pairSize: 1 | 2, hasMasters: boolean): string {
  return renderToStaticMarkup(
    createElement(Formato, {
      seasonId: 'season-1',
      disciplineId: 'discipline-1' as DisciplineId,
      config: configFor(8, pairSize),
      pairSize,
      hasMasters,
      disciplineLabel: null,
    }),
  )
}

describe('Formato — el control de Masters (decisión #4029)', () => {
  it('con pairSize=2 y hasMasters=true, el check sale marcado y HABILITADO -- se puede apagar', () => {
    const markup = html(2, true)
    const input = /<input[^>]*type="checkbox"[^>]*\/>/.exec(markup)?.[0] ?? ''
    expect(markup).toContain('Masters')
    expect(input).toContain('checked')
    expect(input).not.toContain('disabled')
  })

  it('con pairSize=2 y hasMasters=false, el check sale apagado pero SIGUE habilitado -- una liga de pádel también puede no querer Masters', () => {
    const markup = html(2, false)
    const input = /<input[^>]*type="checkbox"[^>]*\/>/.exec(markup)?.[0] ?? ''
    expect(input).not.toContain('checked')
    expect(input).not.toContain('disabled')
  })

  /**
   * Parte 3 de la decisión: ofrecer el check encendido en una disciplina de
   * a uno sería ofrecer algo que la app rechaza después (`openMatchday`,
   * `db/matchday.ts:985`). Con `pairSize=1`, `hasMasters` es SIEMPRE `false`
   * (parte 1) y el control tiene que salir DESHABILITADO -- no sólo apagado.
   */
  it('con pairSize=1, el check sale apagado y DESHABILITADO -- no se puede encender (#4029)', () => {
    const markup = html(1, false)
    const input = /<input[^>]*type="checkbox"[^>]*\/>/.exec(markup)?.[0] ?? ''
    expect(input).not.toContain('checked')
    expect(input).toContain('disabled')
    expect(markup).toContain('Una disciplina de a uno no juega Masters')
  })
})
