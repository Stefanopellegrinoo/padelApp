import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SideSize } from '@/core'
import { PasoFormato, SelectorDeLados } from './wizard'
import { configFor, type DisciplineKind } from './wizard-state'

/**
 * El paso 4 del wizard, RENDERIZADO — no la lógica que lo alimenta.
 *
 * W63 existió por la distancia entre esas dos cosas:
 * Ajustes y el wizard comparten `STEPPERS` y cada uno decide por su cuenta
 * cuáles dibuja, así que la corrección aterrizó en una pantalla y no en la
 * otra. Un test sobre la función que elige los steppers no lo hubiera cazado:
 * la función estaba bien, el `.map` del wizard no la llamaba.
 *
 * Por eso esto renderiza el JSX de verdad con `renderToStaticMarkup` y mira el
 * HTML. Es el mismo motor que corre en el servidor de Next; lo que no cubre es
 * la interacción (no hay clicks acá).
 */
function html(picked: DisciplineKind[], pairSize: SideSize = 2): string {
  return renderToStaticMarkup(
    createElement(PasoFormato, {
      config: configFor(8),
      picked,
      errors: [],
      pairSize,
      onChange: () => {},
      onChangePairSize: () => {},
    }),
  )
}

describe('paso 4 del wizard — los steppers que se dibujan', () => {
  /**
   * PIN de no-regresión: un torneo de pádel dibuja los cinco steppers, igual
   * que siempre. Es la mitad que no se puede mover.
   */
  it('un torneo de pádel dibuja los cinco steppers', () => {
    const paso = html(['PADEL'])
    expect(paso).toContain('Sets por partido')
    expect(paso).toContain('Games por set')
    expect(paso).toContain('Fechas del año')
    expect(paso).toContain('Cuentan las mejores')
    expect(paso).toContain('Refresco del orden')
  })

  /**
   * W63: en un torneo que NO tiene pádel esos dos steppers no gobiernan nada
   * —`setError` los ignora y `usesSetsDiff` los apaga— y encima uno se anuncia
   * con "el resultado se carga en dos toques", que es JUSTO la máquina que esa
   * disciplina no monta.
   */
  it('una liga de solo FIFA no ofrece sets ni games, ni promete los dos toques', () => {
    const paso = html(['FIFA'])
    expect(paso).not.toContain('Sets por partido')
    expect(paso).not.toContain('Games por set')
    expect(paso).not.toContain('el resultado se carga en dos toques')
    // Los otros tres siguen: son de la temporada, no del marcador.
    expect(paso).toContain('Fechas del año')
    expect(paso).toContain('Cuentan las mejores')
    expect(paso).toContain('Refresco del orden')
  })

  /**
   * Y acá está por qué el filtro de Ajustes NO se podía copiar tal cual: en el
   * wizard la config es de la TEMPORADA y la comparten todas las disciplinas
   * marcadas. Con Pádel marcado, esos dos steppers gobiernan la mitad pádel del
   * torneo y sacarlos sería sacarle al admin una decisión que sí es suya.
   */
  it('con pádel Y FIFA los sigue ofreciendo: gobiernan la mitad de pádel', () => {
    const paso = html(['PADEL', 'FIFA'])
    expect(paso).toContain('Sets por partido')
    expect(paso).toContain('Games por set')
  })
})

/**
 * El radio "Lados" (Rebanada F, decisión `decisions/alcance-desbloqueo-1v1-pr21`).
 *
 * Sin clicks —este repo no tiene runner E2E ni React Testing Library, mismo
 * límite documentado en `armado.unit.test.ts` para `SelectorDeFormato`—: se
 * mira qué radio sale marcado para un `pairSize` dado. Que tocar el radio
 * dispare `buildDisciplines(picked, config, pairSize)` con el argumento
 * correcto en el submit real queda sin cubrir por esa misma razón (ver el
 * reporte de esta rebanada). Lo que SÍ está cubierto de punta a punta es que
 * `buildDisciplines`, recibiendo `pairSize=1`, arma la fila con la curva de
 * la decisión #3963 (`wizard-state.unit.test.ts`).
 */
describe('SelectorDeLados', () => {
  it('nace marcado en "Parejas" — no-regresión: ningún pádel existente cambia', () => {
    const markup = renderToStaticMarkup(
      createElement(SelectorDeLados, { pairSize: 2, onChange: () => {} }),
    )
    const parejas = /<input[^>]*name="pairSize"[^>]*\/>/.exec(markup)?.[0] ?? ''
    expect(markup).toContain('Parejas')
    expect(markup).toContain('Individual')
    expect(parejas).toContain('checked')
  })

  it('marca "Individual" cuando pairSize=1, no "Parejas" (se pincha el argumento, #3957)', () => {
    const markup = renderToStaticMarkup(
      createElement(SelectorDeLados, { pairSize: 1, onChange: () => {} }),
    )
    const inputs = markup.match(/<input[^>]*name="pairSize"[^>]*\/>/g) ?? []
    expect(inputs).toHaveLength(2)
    // El primer radio es "Parejas" (value 2), el segundo "Individual" (value 1).
    expect(inputs[0]).not.toContain('checked')
    expect(inputs[1]).toContain('checked')
  })
})

describe('paso 4 del wizard — el fieldset "Lados"', () => {
  it('el paso de formato incluye el selector de Lados, en Parejas por default', () => {
    const paso = html(['PADEL'])
    expect(paso).toContain('Lados')
    expect(paso).toContain('Parejas')
    expect(paso).toContain('Individual')
  })

  it('con pairSize=1 marca "Individual" también dentro del paso de formato', () => {
    const paso = html(['FIFA'], 1)
    const inputs = paso.match(/<input[^>]*name="pairSize"[^>]*\/>/g) ?? []
    expect(inputs).toHaveLength(2)
    expect(inputs[1]).toContain('checked')
  })
})
