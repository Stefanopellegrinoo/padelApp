import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { MatchdayFormat, SideSize } from '@/core'
import { PasoDisciplinas, PasoFormato, SelectorDeLados } from './wizard'
import { freshDisciplineConfig, type DisciplineKind } from './wizard-state'

const ROUND_ROBIN_ALL: Record<DisciplineKind, MatchdayFormat> = {
  PADEL: { kind: 'ROUND_ROBIN' },
  FIFA: { kind: 'ROUND_ROBIN' },
}

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
 *
 * `freshDisciplineConfig` para las dos disciplinas por default (Task 5,
 * docs/plan-arquitectura-de-paginas.md): la config de CADA una ya sale con
 * la forma de marcador de su `kind` aplicada, igual que en la app real -- no
 * hay un `buildDisciplines` que la corrija en el camino, como antes.
 */
function html(picked: DisciplineKind[]): string {
  return renderToStaticMarkup(
    createElement(PasoFormato, {
      configs: { PADEL: freshDisciplineConfig('PADEL', 8, 2), FIFA: freshDisciplineConfig('FIFA', 8, 2) },
      picked,
      pairSizes: { PADEL: 2, FIFA: 2 },
      hasMasters: { PADEL: true, FIFA: true },
      formatoDefault: ROUND_ROBIN_ALL,
      errors: { PADEL: [], FIFA: [] },
      onChangeConfig: () => {},
      onChangeHasMasters: () => {},
      onChangeFormatoDefault: () => {},
    }),
  )
}

describe('paso 4 del wizard — los steppers que se dibujan', () => {
  /**
   * PIN de no-regresión: un torneo de pádel dibuja los cinco steppers, igual
   * que siempre. Es la mitad que no se puede mover. Verificado además
   * byte a byte contra la versión commiteada antes de la Task 5 (ver el
   * reporte de esta rebanada) — este PIN es la versión automatizada de esa
   * misma prueba.
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
   * Desde la Task 5 cada disciplina dibuja SU PROPIA tarjeta, con SU PROPIA
   * config -- ya no hay una lista de formatos compartida que preguntarle
   * "¿alguna usa sets?" (eso hacía el wizard antes; el criterio de Ajustes
   * era ya el correcto). Con Pádel Y FIFA marcados, la tarjeta de Pádel
   * sigue mostrando sus dos steppers de sets -- por su cuenta, no porque el
   * conjunto entero los fuerce.
   */
  it('con pádel Y FIFA marcados, la tarjeta de pádel sigue con sus dos steppers de sets', () => {
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
 * Task 5 (docs/plan-arquitectura-de-paginas.md §2.4, §6, §5): el paso
 * "Formato" pasa a ser uno por disciplina elegida. Estos tests son la
 * prueba automatizada de la mitad que el byte-diff manual no cubre: qué
 * aparece (o no) según cuántas disciplinas hay marcadas.
 */
describe('paso 4 del wizard — Masters y Formato de las fechas, por disciplina (Task 5)', () => {
  /**
   * §5 del diseño: "con una sola disciplina, el contenedor no se ve" — acá
   * es la misma idea aplicada al paso 4. Ningún control nuevo aparece, y
   * ningún nombre de disciplina se dibuja: nadie debería enterarse de que
   * el paso ahora es "por disciplina" hasta que marque la segunda.
   */
  it('con una sola disciplina, no dibuja Masters ni Formato de las fechas ni el nombre de la disciplina', () => {
    const paso = html(['PADEL'])
    // Ojo: "Masters" YA aparece en el hint de "Fechas del año" ("Sin contar
    // el Masters, que va al final."), así que un `toContain('Masters')` a
    // secas no serviría -- lo que no tiene que estar es el CONTROL: ni el
    // título "Masters" del checkbox, ni el checkbox en sí.
    expect(paso).not.toContain('type="checkbox"')
    expect(paso).not.toMatch(/<p class="text-\[14px\] font-bold">Masters<\/p>/)
    expect(paso).not.toContain('Formato de las fechas')
    expect(paso).not.toContain('Pádel')
  })

  it('con 2+ disciplinas, cada tarjeta lleva su nombre, Masters y Formato de las fechas', () => {
    const paso = html(['PADEL', 'FIFA'])
    expect(paso).toContain('Pádel')
    expect(paso).toContain('FIFA')
    // Dos de cada uno: uno por tarjeta. El título exacto del control, no la
    // palabra suelta -- "Masters" también aparece en el hint de "Fechas del
    // año" (una vez por tarjeta, así que contar la palabra suelta daría 4).
    expect(paso.match(/<p class="text-\[14px\] font-bold">Masters<\/p>/g)).toHaveLength(2)
    expect(paso.match(/Formato de las fechas/g)).toHaveLength(2)
    // Las mismas palabras que Ajustes (`matchdayFormatLabel`, `app/format.ts`
    // -- importada, no copiada), no un copy nuevo.
    expect(paso.match(/Todos contra todos/g)).toHaveLength(2)
    expect(paso).toContain('2 grupos + llave')
    expect(paso).toContain('4 grupos + llave')
  })

  /**
   * Decisión #4029 + `disciplines_has_masters_needs_pair` (0053): una
   * disciplina de a uno no puede tener Masters -- el checkbox tiene que
   * salir deshabilitado y sin marcar, sea cual sea el valor que traiga el
   * estado.
   */
  it('Masters sale deshabilitado y sin marcar para una disciplina de a uno', () => {
    const paso = renderToStaticMarkup(
      createElement(PasoFormato, {
        configs: { PADEL: freshDisciplineConfig('PADEL', 8, 2), FIFA: freshDisciplineConfig('FIFA', 8, 1) },
        picked: ['PADEL', 'FIFA'],
        pairSizes: { PADEL: 2, FIFA: 1 },
        hasMasters: { PADEL: true, FIFA: true }, // FIFA en true a mano -- inválido para pairSize 1
        formatoDefault: ROUND_ROBIN_ALL,
        errors: { PADEL: [], FIFA: [] },
        onChangeConfig: () => {},
        onChangeHasMasters: () => {},
        onChangeFormatoDefault: () => {},
      }),
    )
    const checkboxes = paso.match(/<input type="checkbox"[^>]*\/>/g) ?? []
    expect(checkboxes).toHaveLength(2)
    // El `class` de los dos SIEMPRE contiene la subcadena "disabled" --
    // `disabled:opacity-40` es un nombre de clase de Tailwind, no el
    // atributo -- así que el chequeo mira el ATRIBUTO `disabled=""`, no la
    // palabra suelta.
    expect(checkboxes[0]).toContain('checked') // Pádel, pairSize 2
    expect(checkboxes[0]).not.toMatch(/\bdisabled=""/)
    expect(checkboxes[1]).not.toContain('checked') // FIFA, pairSize 1: forzado sin marcar
    expect(checkboxes[1]).toMatch(/\bdisabled=""/)
  })

  // Errores con 2+ disciplinas: cada uno lleva el nombre de SU disciplina,
  // mismo criterio que el aviso de plantel desajustado de Ajustes.
  it('los errores de una disciplina llevan su nombre cuando hay 2+ marcadas', () => {
    const paso = renderToStaticMarkup(
      createElement(PasoFormato, {
        configs: { PADEL: freshDisciplineConfig('PADEL', 8, 2), FIFA: freshDisciplineConfig('FIFA', 8, 2) },
        picked: ['PADEL', 'FIFA'],
        pairSizes: { PADEL: 2, FIFA: 2 },
        hasMasters: { PADEL: true, FIFA: true },
        formatoDefault: ROUND_ROBIN_ALL,
        errors: { PADEL: ['No pueden contar más fechas de las que se juegan.'], FIFA: [] },
        onChangeConfig: () => {},
        onChangeHasMasters: () => {},
        onChangeFormatoDefault: () => {},
      }),
    )
    expect(paso).toContain('Pádel: No pueden contar más fechas de las que se juegan.')
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
