import { createElement } from 'react'
import { defaultMaxMatches } from '@/core'
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
// El techo por default de una disciplina de a uno (36). Los tamaños que estos
// tests usan —8, 10, 12 lados— sólo se dan de a uno: de a dos serían 16, 20 y
// 24 jugadores, muy por encima de `MAX_PLAYERS`.
const TECHO_DE_A_UNO = defaultMaxMatches(1)

function html(
  formato: MatchdayFormat,
  sides: number,
  suggested: MatchdayFormat = formato,
  maxMatches: number = TECHO_DE_A_UNO,
): string {
  return renderToStaticMarkup(
    createElement(SelectorDeFormato, { formato, sides, maxMatches, suggested, pending: false, onChange: () => {} }),
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

  // Antes este test pedía 2 Y 4 grupos con 12 lados. Con el techo de partidos
  // (`MAX_MATCHES`) ya no conviven: 12 lados en 2 grupos son 34 partidos y en 4
  // son 20. Y 12 lados sólo se dan de a uno (de a dos serían 24 jugadores, muy
  // por encima de `MAX_PLAYERS`), que es exactamente el caso que el techo vino
  // a acotar. Los dos escalones que SÍ conviven hoy son 6 lados.
  it('6 lados: ofrece "Todos contra todos" (15) Y "2 grupos + llave" (10)', () => {
    const markup = html(ROUND_ROBIN, 6)
    expect(markup).toContain('Todos contra todos')
    expect(markup).toContain('2 grupos + llave')
  })

  it('12 lados de a uno: los dos tamaños de grupo, pero NO todos contra todos (66 partidos)', () => {
    const markup = html(GROUPS_4, 12)
    expect(markup).toContain('4 grupos + llave')
    expect(markup).toContain('2 grupos + llave') // 34 partidos, entra en el techo de a uno (36)
    expect(markup).not.toContain('Todos contra todos')
  })

  it('y con el techo de pádel (15) no entra ninguno de los tres: queda el más barato', () => {
    const markup = html(GROUPS_4, 12, GROUPS_4, defaultMaxMatches(2))
    expect(markup).toContain('4 grupos + llave') // 20, el más barato de los tres
    expect(markup).not.toContain('2 grupos + llave')
    expect(markup).not.toContain('Todos contra todos')
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
    const eligioGrupos2 = html(GROUPS_2, 6)
    const btnGrupos2 = /<button[^>]*>2 grupos \+ llave<\/button>/.exec(eligioGrupos2)?.[0] ?? ''
    const btnTodos = /<button[^>]*>Todos contra todos<\/button>/.exec(eligioGrupos2)?.[0] ?? ''
    expect(btnGrupos2).toContain('aria-checked="true"')
    expect(btnTodos).toContain('aria-checked="false"')
  })

  it('y al revés: con formato ROUND_ROBIN elegido, el marcado es "Todos contra todos"', () => {
    const eligioTodos = html(ROUND_ROBIN, 6)
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
    // Y el botón de todos contra todos NO está: con 10 lados son 45 partidos.
    // Un `formato` guardado se sigue dibujando aunque ya no se ofrezca —esa es
    // la regla de este test—, pero un formato que NUNCA se eligió y encima
    // pasa el techo no tiene por qué aparecer.
    expect(huerfano).not.toContain('Todos contra todos')
    const btnGrupos4 = /<button[^>]*>4 grupos \+ llave<\/button>/.exec(huerfano)?.[0] ?? ''
    const btnGrupos2 = /<button[^>]*>2 grupos \+ llave<\/button>/.exec(huerfano)?.[0] ?? ''

    expect(btnGrupos4).toContain('aria-checked="true"')
    expect(btnGrupos2).toContain('aria-checked="false"')
  })

  /**
   * W77 (verify-report-pr21-cierre, #4016) / decisión #4022: el selector
   * marca cuál formato SUGIERE la app — `suggestFormat` (`core/knockout.ts`)
   * se había quedado sin ningún consumidor de producción, y con eso
   * desaparecía de la pantalla toda noción de "sugerido" (REQ-D8-1, primer
   * GIVEN). Acá se pincha el TEXTO de la marca, no sólo que `suggested`
   * exista como prop (#3957).
   */
  describe('la marca de "sugerido" (W77, decisión #4022)', () => {
    it('nombra el formato sugerido en una leyenda propia, separada de los botones', () => {
      const markup = html(ROUND_ROBIN, 6, GROUPS_2)
      expect(markup).toContain('Sugerido: 2 grupos + llave')
    })

    it('también marca "todos contra todos" cuando es lo sugerido', () => {
      const markup = html(GROUPS_2, 4, ROUND_ROBIN)
      expect(markup).toContain('Sugerido: Todos contra todos')
    })

    /**
     * S81 (verify-report-pr21 #4004) no puede volver por la puerta de atrás:
     * la marca de "sugerido" es una leyenda de texto, nunca una clase ni un
     * `aria-checked` sobre el botón — así que un botón puede estar
     * SUGERIDO sin estar SELECCIONADO (y viceversa) sin que las dos señales
     * se confundan. Acá `formato` (seleccionado) es "todos contra todos" y
     * `suggested` es "2 grupos": el botón de 2 grupos queda con
     * `aria-checked="false"` igual, y la leyenda nombra la sugerencia aparte.
     */
    it('sugerido y seleccionado son señales independientes: uno no pisa al otro', () => {
      const markup = html(ROUND_ROBIN, 6, GROUPS_2)
      const btnGrupos2 = /<button[^>]*>2 grupos \+ llave<\/button>/.exec(markup)?.[0] ?? ''
      expect(btnGrupos2).toContain('aria-checked="false"') // sugerido, no elegido
      expect(markup).toContain('Sugerido: 2 grupos + llave')
    })

    /**
     * El caso que expuso la contradicción original (W77): antes del fix,
     * `matchdayShape.suggestedFormat` podía calcular una sugerencia que
     * `offerableFormats` YA NO cruzaba (`eventualSize` cuenta al invitado
     * suelto que todavía no está sentado; `sides` acá no). En vez de
     * mentir mostrando un botón que no está, sin marca ninguna es mejor que
     * una marca falsa.
     */
    it('si lo sugerido no está entre lo ofrecido ni es el guardado, no dibuja ninguna leyenda', () => {
      const markup = html(ROUND_ROBIN, 4, GROUPS_4)
      expect(markup).not.toContain('Sugerido:')
    })
  })
})
