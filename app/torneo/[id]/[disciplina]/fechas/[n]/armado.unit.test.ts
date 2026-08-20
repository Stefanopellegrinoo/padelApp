import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { MatchdayFormat } from '@/core'
import { SelectorDeFormato } from './armado'

/**
 * El selector de formato de la fecha (REQ-D8-1), RENDERIZADO — no la lógica
 * que lo alimenta (esa vive en `armado-state.ts`, `matchdayShape.suggestedFormat`,
 * con su propio test).
 *
 * `Armado` (el componente entero) importa `./actions`, que es `'use server'`
 * y arrastra `next/headers`/`@supabase/ssr` — no se renderiza acá, mismo
 * precedente que `PasoFormato` (`app/torneos/nuevo/wizard.unit.test.ts`) y
 * `PanelGoles` (`./carga.unit.test.ts`): un subcomponente exportado que recibe
 * `onChange` como prop en vez de importar la action.
 *
 * Lo que NO cubre: la interacción. Este repo no tiene runner E2E — acá no se
 * clickea, se mira qué botón sale marcado como el elegido para un `formato`
 * dado. Que tocar ESE botón dispare `changeMatchdayFormat` con el argumento
 * correcto queda sin cubrir por esa misma razón (ver el reporte de esta
 * rebanada).
 */
function html(formato: MatchdayFormat, suggested: MatchdayFormat): string {
  return renderToStaticMarkup(
    createElement(SelectorDeFormato, { formato, suggested, pending: false, onChange: () => {} }),
  )
}

const ROUND_ROBIN: MatchdayFormat = { kind: 'ROUND_ROBIN' }
const GROUPS_2: MatchdayFormat = { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 }
const GROUPS_4: MatchdayFormat = { kind: 'GROUPS_KNOCKOUT', groups: 4, qualifiersPerGroup: 2 }

describe('SelectorDeFormato', () => {
  it('con plantel chico (sugerencia ROUND_ROBIN) no ofrece el botón de grupos', () => {
    const markup = html(ROUND_ROBIN, ROUND_ROBIN)
    expect(markup).toContain('Todos contra todos')
    expect(markup).not.toContain('grupos + llave')
  })

  it('con la sugerencia de 2 grupos, ofrece exactamente ese botón — no un valor fijo', () => {
    const markup = html(ROUND_ROBIN, GROUPS_2)
    expect(markup).toContain('2 grupos + llave')
    expect(markup).not.toContain('4 grupos + llave')
  })

  it('con la sugerencia de 4 grupos (12 de a uno), ofrece 4 y no 2: el argumento manda', () => {
    const markup = html(ROUND_ROBIN, GROUPS_4)
    expect(markup).toContain('4 grupos + llave')
    expect(markup).not.toContain('2 grupos + llave')
  })

  /**
   * El elegido hoy es el que se dibuja marcado — no el sugerido. Con
   * `formato` en GROUPS_KNOCKOUT y `suggested` en ROUND_ROBIN (el admin ya se
   * apartó de la sugerencia), el botón marcado tiene que ser el de grupos.
   * Se pincha el ARGUMENTO `formato`, no sólo que el botón exista (#3957).
   */
  it('marca como elegido el `formato` que llega, no el sugerido', () => {
    const eligioGrupos = html(GROUPS_2, GROUPS_2)
    const btnGrupos = /<button[^>]*>2 grupos \+ llave<\/button>/.exec(eligioGrupos)?.[0] ?? ''
    const btnTodos = /<button[^>]*>Todos contra todos<\/button>/.exec(eligioGrupos)?.[0] ?? ''
    expect(btnGrupos).toContain('bg-accent')
    expect(btnTodos).not.toContain('bg-accent')
  })

  it('y al revés: con formato ROUND_ROBIN elegido, el marcado es "Todos contra todos"', () => {
    const eligioTodos = html(ROUND_ROBIN, GROUPS_2)
    const btnGrupos = /<button[^>]*>2 grupos \+ llave<\/button>/.exec(eligioTodos)?.[0] ?? ''
    const btnTodos = /<button[^>]*>Todos contra todos<\/button>/.exec(eligioTodos)?.[0] ?? ''
    expect(btnTodos).toContain('bg-accent')
    expect(btnGrupos).not.toContain('bg-accent')
  })
})
