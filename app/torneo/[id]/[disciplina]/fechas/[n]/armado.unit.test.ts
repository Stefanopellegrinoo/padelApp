import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { MatchdayFormat } from '@/core'
import { SelectorDeFormato } from './armado'

/**
 * El selector de formato de la fecha (REQ-D8-1), RENDERIZADO — no la lógica
 * que lo alimenta (`offerableFormats`, `core/knockout.ts`, con su propio
 * test).
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
function html(formato: MatchdayFormat, sides: number): string {
  return renderToStaticMarkup(
    createElement(SelectorDeFormato, { formato, sides, pending: false, onChange: () => {} }),
  )
}

const ROUND_ROBIN: MatchdayFormat = { kind: 'ROUND_ROBIN' }
const GROUPS_2: MatchdayFormat = { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 }
const GROUPS_4: MatchdayFormat = { kind: 'GROUPS_KNOCKOUT', groups: 4, qualifiersPerGroup: 2 }

describe('SelectorDeFormato', () => {
  /**
   * W75 (verify-report-pr21 #4004): el selector ofrecía "aceptar o rechazar
   * la sugerencia" — un solo botón de grupos. Decisión de Stefano
   * (`decisions/formatos-ofrecidos-en-el-armado`): "todos contra todos"
   * siempre, más cada tamaño de grupo (`offerableFormats`, `core/knockout.ts`)
   * donde CADA grupo tenga 3 lados o más. Los cuatro escalones que importan.
   */
  it('4 lados: sólo ofrece "todos contra todos" — 2 grupos daría grupos de 2, eliminación cero', () => {
    const markup = html(ROUND_ROBIN, 4)
    expect(markup).toContain('Todos contra todos')
    expect(markup).not.toContain('grupos + llave')
  })

  it('6 lados: ofrece también "2 grupos + llave" (grupos de 3)', () => {
    const markup = html(ROUND_ROBIN, 6)
    expect(markup).toContain('2 grupos + llave')
    expect(markup).not.toContain('4 grupos + llave')
  })

  it('8 lados: ofrece "2 grupos + llave" pero NUNCA "4 grupos + llave" — ahí los grupos serían de 2', () => {
    const markup = html(ROUND_ROBIN, 8)
    expect(markup).toContain('2 grupos + llave')
    expect(markup).not.toContain('4 grupos + llave')
  })

  it('12 lados: ofrece "2 grupos + llave" Y "4 grupos + llave" — nunca más de tres botones', () => {
    const markup = html(ROUND_ROBIN, 12)
    expect(markup).toContain('2 grupos + llave')
    expect(markup).toContain('4 grupos + llave')
  })

  /**
   * El elegido hoy es el que se dibuja marcado — no cuál se ofreció primero.
   * Con 12 lados (2 Y 4 grupos ofrecibles a la vez) y `formato` en "2
   * grupos", el marcado tiene que ser ESE, no "4 grupos" aunque también esté
   * ofrecido. Se pincha el ARGUMENTO `formato`, no sólo que el botón exista
   * (#3957).
   *
   * S81 (verify-report-pr21 #4004): esto se decidía con `toContain('bg-accent')`
   * — acoplaba el test a una clase de Tailwind, no al comportamiento. El
   * hallazgo real era que el control no tenía NINGUNA señal de accesibilidad
   * (sin `role`/`aria-checked`, un lector de pantalla no podía saber cuál
   * está elegido). Fix en el componente (patrón "radio group" de la ARIA
   * APG); el test ahora lee `aria-checked`.
   */
  it('marca como elegido el `formato` que llega, no el primero ofrecido', () => {
    const eligioGrupos2 = html(GROUPS_2, 12)
    const btnGrupos2 = /<button[^>]*>2 grupos \+ llave<\/button>/.exec(eligioGrupos2)?.[0] ?? ''
    const btnGrupos4 = /<button[^>]*>4 grupos \+ llave<\/button>/.exec(eligioGrupos2)?.[0] ?? ''
    const btnTodos = /<button[^>]*>Todos contra todos<\/button>/.exec(eligioGrupos2)?.[0] ?? ''
    expect(btnGrupos2).toContain('aria-checked="true"')
    expect(btnGrupos4).toContain('aria-checked="false"')
    expect(btnTodos).toContain('aria-checked="false"')
  })

  it('y al revés: con formato ROUND_ROBIN elegido, el marcado es "Todos contra todos"', () => {
    const eligioTodos = html(ROUND_ROBIN, 12)
    const btnGrupos2 = /<button[^>]*>2 grupos \+ llave<\/button>/.exec(eligioTodos)?.[0] ?? ''
    const btnTodos = /<button[^>]*>Todos contra todos<\/button>/.exec(eligioTodos)?.[0] ?? ''
    expect(btnTodos).toContain('aria-checked="true"')
    expect(btnGrupos2).toContain('aria-checked="false"')
  })

  /**
   * W73 (verify-report-pr21 #4004), reverificado con la regla nueva de W75:
   * un `formato` de GRUPOS guardado puede quedar fuera de lo OFRECIBLE si
   * baja la asistencia — 12 presentes eligen "4 grupos + llave", bajan a 10 y
   * `offerableFormats(10)` ya no lo incluye (`floor(10/4) = 2 < 3`; en cambio
   * `floor(10/2) = 5 >= 3`, así que "2 grupos" SÍ sigue ofrecible). El botón
   * de "4 grupos" tiene que seguir ahí y marcado — la base sigue armando con
   * ese formato — sin que eso oculte que "2 grupos" también es una opción
   * real hoy.
   */
  it('con un `formato` de grupos GUARDADO pero ya no ofrecible, el botón sigue ahí y marcado', () => {
    const huerfano = html(GROUPS_4, 10)
    expect(huerfano).toContain('4 grupos + llave')
    expect(huerfano).toContain('2 grupos + llave')
    const btnGrupos4 = /<button[^>]*>4 grupos \+ llave<\/button>/.exec(huerfano)?.[0] ?? ''
    const btnGrupos2 = /<button[^>]*>2 grupos \+ llave<\/button>/.exec(huerfano)?.[0] ?? ''
    const btnTodos = /<button[^>]*>Todos contra todos<\/button>/.exec(huerfano)?.[0] ?? ''
    expect(btnGrupos4).toContain('aria-checked="true"')
    expect(btnGrupos2).toContain('aria-checked="false"')
    expect(btnTodos).toContain('aria-checked="false"')
  })
})
