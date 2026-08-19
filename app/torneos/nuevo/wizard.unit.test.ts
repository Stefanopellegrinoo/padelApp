import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PasoFormato } from './wizard'
import { configFor, type DisciplineKind } from './wizard-state'

/**
 * El paso 4 del wizard, RENDERIZADO — no la lógica que lo alimenta.
 *
 *Existió por la distancia entre esas dos cosas:
 * Ajustes y el wizard comparten `STEPPERS` y cada uno decide por su cuenta
 * cuáles dibuja, así que la corrección aterrizó en una pantalla y no en la
 * otra. Un test sobre la función que elige los steppers no lo hubiera cazado:
 * la función estaba bien, el `.map` del wizard no la llamaba.
 *
 * Por eso esto renderiza el JSX de verdad con `renderToStaticMarkup` y mira el
 * HTML. Es el mismo motor que corre en el servidor de Next; lo que no cubre es
 * la interacción (no hay clicks acá).
 */
function html(picked: DisciplineKind[]): string {
  return renderToStaticMarkup(
    createElement(PasoFormato, {
      config: configFor(8),
      picked,
      errors: [],
      onChange: () => {},
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
   *En un torneo que NO tiene pádel esos dos steppers no gobiernan nada
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
