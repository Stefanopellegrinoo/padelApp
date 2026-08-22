import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SideSize } from '@/core'
import { PasoDisciplinas, PasoFormato, SelectorDeLados } from './wizard'
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
function html(picked: DisciplineKind[]): string {
  return renderToStaticMarkup(
    createElement(PasoFormato, {
      config: configFor(8, 2),
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

  /**
   * W76/decisión #4017: el radio "Lados" bajó al paso 1 — el paso 4 ya no
   * lo dibuja para nada, marcado o no. Si esto volviera a aparecer acá,
   * volvería la ambigüedad que W76 midió (dos disciplinas, un solo radio).
   */
  it('ya no dibuja el radio "Lados": bajó al paso 1, uno por disciplina', () => {
    const paso = html(['PADEL', 'FIFA'])
    expect(paso).not.toContain('Lados')
  })
})

/**
 * El radio "Lados" (Rebanada F, decisión `decisions/alcance-desbloqueo-1v1-pr21`,
 * y W76/decisión #4017 que lo movió al paso 1, uno por disciplina).
 *
 * Sin clicks —este repo no tiene runner E2E ni React Testing Library, mismo
 * límite documentado en `armado.unit.test.ts` para `SelectorDeFormato`—: se
 * mira qué radio sale marcado para un `pairSize` dado. Que tocar el radio
 * dispare `changePairSize(kind, next)` con el argumento correcto en el
 * submit real queda sin cubrir por esa misma razón (ver el reporte de esta
 * rebanada). Lo que SÍ está cubierto de punta a punta es que
 * `newTournamentPayload`, recibiendo `pairSizes`, arma cada fila con la
 * curva de la decisión #3963 (`wizard-state.unit.test.ts`).
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

  it('con un `name` propio, los `<input>` llevan ESE name -- no siempre "pairSize"', () => {
    const markup = renderToStaticMarkup(
      createElement(SelectorDeLados, { pairSize: 2, onChange: () => {}, name: 'pairSize-FIFA' }),
    )
    expect(markup).not.toContain('name="pairSize"')
    const inputs = markup.match(/<input[^>]*name="pairSize-FIFA"[^>]*\/>/g) ?? []
    expect(inputs).toHaveLength(2)
  })
})

const PICK_NONE: DisciplineKind[] = []

function pasoDisciplinasHtml(
  picked: DisciplineKind[],
  pairSizes: Record<DisciplineKind, SideSize> = { PADEL: 2, FIFA: 2 },
): string {
  return renderToStaticMarkup(
    createElement(PasoDisciplinas, {
      picked,
      pairSizes,
      warning: null,
      onToggle: () => {},
      onChangePairSize: () => {},
    }),
  )
}

/**
 * W76 (verify-report-pr21-cierre, #4016) + decisión #4017: el paso 1 lleva
 * un selector "Parejas / Individual" POR disciplina marcada, al lado de su
 * checkbox — no uno solo para todas.
 *
 * Antes (medido en la auditoría): con Pádel + FIFA marcados, tocar
 * "Individual" pintaba la curva de 8 puntos en el paso 4 y el torneo se
 * creaba con las DOS en `pair_size=2` — la pantalla prometía algo que el
 * dato no iba a tener. El test de abajo tiene que DISTINGUIR las dos filas
 * a la vez: uno que sólo mirara una no probaría la ausencia de herencia
 * cruzada en ningún sentido.
 */
describe('PasoDisciplinas', () => {
  it('sin marcar ninguna, no dibuja ningún selector de Lados', () => {
    const paso = pasoDisciplinasHtml(PICK_NONE)
    expect(paso).not.toContain('Lados')
  })

  it('marcar una disciplina hace aparecer SU selector de Lados', () => {
    const paso = pasoDisciplinasHtml(['PADEL'])
    expect(paso).toContain('Lados')
    expect(paso).toContain('name="pairSize-PADEL"')
    expect(paso).not.toContain('name="pairSize-FIFA"')
  })

  /**
   * La prueba central de #4017: Pádel y FIFA marcados, cada uno con SU
   * `pairSize` -- Pádel en Parejas, FIFA en Individual. Los DOS radios
   * tienen que salir marcados con su valor propio, cada uno en SU grupo
   * (`name` distinto), sin que ninguno le pise el estado al otro.
   */
  it('con Pádel Y FIFA marcados y sólo FIFA en Individual, cada radio queda marcado por su cuenta', () => {
    const paso = pasoDisciplinasHtml(['PADEL', 'FIFA'], { PADEL: 2, FIFA: 1 })

    const padelInputs = paso.match(/<input[^>]*name="pairSize-PADEL"[^>]*\/>/g) ?? []
    const fifaInputs = paso.match(/<input[^>]*name="pairSize-FIFA"[^>]*\/>/g) ?? []
    expect(padelInputs).toHaveLength(2)
    expect(fifaInputs).toHaveLength(2)

    // Pádel: "Parejas" (primero) marcado, "Individual" (segundo) no.
    expect(padelInputs[0]).toContain('checked')
    expect(padelInputs[1]).not.toContain('checked')
    // FIFA: al revés -- "Individual" marcado, "Parejas" no. Si los dos
    // grupos compartieran `name`, el navegador forzaría UN solo marcado
    // entre los cuatro radios -- acá tienen que convivir los dos.
    expect(fifaInputs[0]).not.toContain('checked')
    expect(fifaInputs[1]).toContain('checked')
  })

  it('el aviso de "elegí al menos una disciplina" se dibuja cuando llega no-null', () => {
    const paso = renderToStaticMarkup(
      createElement(PasoDisciplinas, {
        picked: PICK_NONE,
        pairSizes: { PADEL: 2, FIFA: 2 },
        warning: 'Elegí al menos una disciplina para el torneo.',
        onToggle: () => {},
        onChangePairSize: () => {},
      }),
    )
    expect(paso).toContain('Elegí al menos una disciplina para el torneo.')
  })
})
