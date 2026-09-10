import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { MatchdayFormat, SideSize } from '@/core'
import { PasoDisciplinas, PasoFormato, PasoOrdenInicial, SelectorDeLados } from './wizard'
import { freshDisciplineConfig, type DisciplineKind } from './wizard-state'

const NO_OWN_ORDER: Record<DisciplineKind, boolean> = { PADEL: false, FIFA: false }
// Minor de esta tarea: el test "cada tarjeta lee su PROPIO ownOrder" pasaba
// `NO_OWN_ORDER` como `fixedTeams` -- el mismo test que existe para probar
// que las props NO se cruzan estaba cruzando dos props. Misma FORMA
// (`Record<DisciplineKind, boolean>`, las dos en `false`), pero otro nombre
// para no repetir la confusión.
const NO_FIXED_TEAMS: Record<DisciplineKind, boolean> = { PADEL: false, FIFA: false }

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
      fixedTeams: { PADEL: false, FIFA: false },
      ownOrder: NO_OWN_ORDER,
      errors: { PADEL: [], FIFA: [] },
      onChangeConfig: () => {},
      onChangeHasMasters: () => {},
      onChangeFormatoDefault: () => {},
      onChangeFixedTeams: () => {},
      onChangeOwnOrder: () => {},
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
  it('con una sola disciplina, no dibuja Masters ni Formato de las fechas ni el nombre de la disciplina, pero sí el checkbox nuevo de equipos fijos', () => {
    const paso = html(['PADEL'])
    // Ojo: "Masters" YA aparece en el hint de "Fechas del año" ("Sin contar
    // el Masters, que va al final."), así que un `toContain('Masters')` a
    // secas no serviría -- lo que no tiene que estar es el CONTROL: ni el
    // título "Masters" del checkbox, ni su checkbox.
    expect(paso).not.toMatch(/<p class="text-\[14px\] font-bold">Masters<\/p>/)
    expect(paso).not.toContain('Formato de las fechas')
    expect(paso).not.toContain('Pádel')
    // El checkbox de equipos fijos, al revés que Masters/Formato, SÍ se
    // dibuja con una sola disciplina marcada (docs/tipos-de-torneo.md §1.2):
    // copiar el gating de Masters (sólo con 2+ marcadas) dejaría la feature
    // inalcanzable para el 100% de los torneos que existen hoy, que tienen
    // una sola disciplina. Es el ÚNICO checkbox de la pantalla en este caso.
    expect(paso).toContain('Equipos fijos')
    expect(paso.match(/<input type="checkbox"[^>]*\/>/g)).toHaveLength(1)
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
        fixedTeams: { PADEL: true, FIFA: true }, // FIFA en true a mano -- inválido para pairSize 1
        ownOrder: { PADEL: false, FIFA: true },
        errors: { PADEL: [], FIFA: [] },
        onChangeConfig: () => {},
        onChangeHasMasters: () => {},
        onChangeFormatoDefault: () => {},
        onChangeFixedTeams: () => {},
        onChangeOwnOrder: () => {},
      }),
    )
    const checkboxes = paso.match(/<input type="checkbox"[^>]*\/>/g) ?? []
    // Seis, no cuatro: cada tarjeta ahora lleva TRES checkboxes -- Equipos
    // fijos (adentro de `cuerpo`, se dibuja primero), Masters y Orden propio
    // (los dos después, sólo con 2+ marcadas) -- ver
    // `FormatoDeUnaDisciplina`, wizard.tsx.
    expect(checkboxes).toHaveLength(6)
    // El `class` de los deshabilitados SIEMPRE contiene la subcadena
    // "disabled" -- `disabled:opacity-40` es un nombre de clase de
    // Tailwind, no el atributo -- así que el chequeo mira el ATRIBUTO
    // `disabled=""`, no la palabra suelta.
    //
    // [0]/[3]: Equipos fijos (Pádel/FIFA). [1]/[4]: Masters (Pádel/FIFA).
    // [2]/[5]: Orden propio (Pádel/FIFA).
    expect(checkboxes[0]).toContain('checked') // Equipos fijos Pádel, pairSize 2
    expect(checkboxes[0]).not.toMatch(/\bdisabled=""/)
    expect(checkboxes[3]).not.toContain('checked') // Equipos fijos FIFA, pairSize 1: forzado sin marcar
    expect(checkboxes[3]).toMatch(/\bdisabled=""/)
    expect(checkboxes[1]).toContain('checked') // Masters Pádel, pairSize 2
    expect(checkboxes[1]).not.toMatch(/\bdisabled=""/)
    expect(checkboxes[4]).not.toContain('checked') // Masters FIFA, pairSize 1: forzado sin marcar
    expect(checkboxes[4]).toMatch(/\bdisabled=""/)
    // Orden propio no depende de `pairSize` -- ninguna regla de la base lo
    // exige de a dos (a diferencia de Masters/Equipos fijos), así que nunca
    // sale deshabilitado, ni siquiera para la disciplina en pairSize 1.
    expect(checkboxes[2]).not.toContain('checked') // ownOrder.PADEL: false
    expect(checkboxes[2]).not.toMatch(/\bdisabled=""/)
    expect(checkboxes[5]).toContain('checked') // ownOrder.FIFA: true
    expect(checkboxes[5]).not.toMatch(/\bdisabled=""/)
  })

  // Las DOS en `pairSize: 2` (sin que ningún clamp entre en juego) y con
  // `fixedTeams` DISTINTO entre sí -- el único caso capaz de cazar un
  // `fixedTeams={fixedTeams[kind]}` mal enganchado (p.ej. siempre
  // `fixedTeams.PADEL`) en el call site de `PasoFormato` -> `FormatoDeUnaDisciplina`
  // (wizard.tsx). Con una disciplina en `pairSize: 1` de por medio (como el
  // test de arriba) el guard `pairSize === 1 ? false : fixedTeams` fuerza el
  // mismo `false` sin marcar sin importar QUÉ valor de `fixedTeams` haya
  // leído -- enmascararía exactamente ese mis-wire.
  it('cada tarjeta lee su PROPIO fixedTeams, no el de la otra disciplina', () => {
    const paso = renderToStaticMarkup(
      createElement(PasoFormato, {
        configs: { PADEL: freshDisciplineConfig('PADEL', 8, 2), FIFA: freshDisciplineConfig('FIFA', 8, 2) },
        picked: ['PADEL', 'FIFA'],
        pairSizes: { PADEL: 2, FIFA: 2 },
        hasMasters: { PADEL: true, FIFA: true },
        formatoDefault: ROUND_ROBIN_ALL,
        fixedTeams: { PADEL: true, FIFA: false },
        ownOrder: NO_OWN_ORDER,
        errors: { PADEL: [], FIFA: [] },
        onChangeConfig: () => {},
        onChangeHasMasters: () => {},
        onChangeFormatoDefault: () => {},
        onChangeFixedTeams: () => {},
        onChangeOwnOrder: () => {},
      }),
    )
    const checkboxes = paso.match(/<input type="checkbox"[^>]*\/>/g) ?? []
    // [0]: Equipos fijos Pádel (true). [3]: Equipos fijos FIFA (false).
    // [1]/[4] son los de Masters y [2]/[5] los de Orden propio, no los de
    // esta prueba.
    expect(checkboxes).toHaveLength(6)
    expect(checkboxes[0]).toContain('checked')
    expect(checkboxes[3]).not.toContain('checked')
  })

  // Mismo caso que el de arriba, para `ownOrder`: las DOS disciplinas con
  // valores DISTINTOS entre sí -- el único caso capaz de cazar un
  // `ownOrder={ownOrder[kind]}` mal enganchado en el call site de
  // `PasoFormato` -> `FormatoDeUnaDisciplina` (wizard.tsx).
  it('cada tarjeta lee su PROPIO ownOrder, no el de la otra disciplina', () => {
    const paso = renderToStaticMarkup(
      createElement(PasoFormato, {
        configs: { PADEL: freshDisciplineConfig('PADEL', 8, 2), FIFA: freshDisciplineConfig('FIFA', 8, 2) },
        picked: ['PADEL', 'FIFA'],
        pairSizes: { PADEL: 2, FIFA: 2 },
        hasMasters: { PADEL: true, FIFA: true },
        formatoDefault: ROUND_ROBIN_ALL,
        fixedTeams: NO_FIXED_TEAMS,
        ownOrder: { PADEL: false, FIFA: true },
        errors: { PADEL: [], FIFA: [] },
        onChangeConfig: () => {},
        onChangeHasMasters: () => {},
        onChangeFormatoDefault: () => {},
        onChangeFixedTeams: () => {},
        onChangeOwnOrder: () => {},
      }),
    )
    const checkboxes = paso.match(/<input type="checkbox"[^>]*\/>/g) ?? []
    // [2]: Orden propio Pádel (false). [5]: Orden propio FIFA (true).
    expect(checkboxes).toHaveLength(6)
    expect(checkboxes[2]).not.toContain('checked')
    expect(checkboxes[5]).toContain('checked')
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
        fixedTeams: { PADEL: false, FIFA: false },
        ownOrder: NO_OWN_ORDER,
        errors: { PADEL: ['No pueden contar más fechas de las que se juegan.'], FIFA: [] },
        onChangeConfig: () => {},
        onChangeHasMasters: () => {},
        onChangeFormatoDefault: () => {},
        onChangeFixedTeams: () => {},
        onChangeOwnOrder: () => {},
      }),
    )
    expect(paso).toContain('Pádel: No pueden contar más fechas de las que se juegan.')
  })
})

/**
 * El checkbox "orden propio" (paso Formato, plan de multi-disciplina):
 * gatea igual que Masters/Formato de las fechas -- sólo con `label !==
 * null`, es decir sólo con 2+ disciplinas marcadas. Con una sola, "el orden
 * global" y "el orden de ESTA disciplina" son el mismo dato -- el control
 * sería una pregunta sin sentido, la misma razón por la que Masters/Formato
 * de las fechas tampoco se dibujan con una sola marcada.
 */
describe('paso 4 del wizard — el checkbox "orden propio" (orden inicial por disciplina)', () => {
  it('con una sola disciplina, no dibuja el checkbox de orden propio', () => {
    const paso = html(['PADEL'])
    expect(paso).not.toContain('Orden propio')
  })

  it('con 2+ disciplinas, cada tarjeta lleva su propio checkbox de orden propio', () => {
    const paso = html(['PADEL', 'FIFA'])
    expect(paso.match(/Orden propio/g)).toHaveLength(2)
  })
})

/**
 * El paso "Orden inicial" -- ahora en el índice 3 (Task del plan de
 * multi-disciplina, swap con "Formato"): extraído y exportado por el MISMO
 * motivo que `PasoDisciplinas`/`PasoFormato` -- `step` es estado interno de
 * `Wizard` y sin clicks la suite no llega hasta acá.
 *
 * La lista global (arriba) es exactamente la de siempre; lo nuevo es la
 * lista PROPIA de cada disciplina que prendió su toggle en el paso Formato
 * -- una tarjeta por disciplina, con el nombre de la disciplina, debajo de
 * la global.
 */
describe('PasoOrdenInicial', () => {
  it('sin ninguna disciplina con orden propio, dibuja sólo la lista global', () => {
    const paso = renderToStaticMarkup(
      createElement(PasoOrdenInicial, {
        orderedNames: ['Colo', 'Nacho', 'Fede'],
        mySeat: 0,
        disciplines: ['PADEL', 'FIFA'],
        ownOrder: NO_OWN_ORDER,
        orders: {},
        onMoveGlobal: () => {},
        onMoveOwn: () => {},
      }),
    )
    expect(paso).toContain('Colo')
    expect(paso).toContain('Nacho')
    expect(paso).toContain('Fede')
    expect(paso).not.toContain('Pádel')
    expect(paso).not.toContain('FIFA')
    expect(paso.match(/⠿/g)).toHaveLength(3)
  })

  it('con el toggle prendido para una disciplina, agrega su propia lista debajo de la global', () => {
    const paso = renderToStaticMarkup(
      createElement(PasoOrdenInicial, {
        orderedNames: ['Colo', 'Nacho', 'Fede'],
        mySeat: null,
        disciplines: ['PADEL', 'FIFA'],
        ownOrder: { PADEL: false, FIFA: true },
        // Índices sobre `orderedNames` (F1): Fede=2, Colo=0, Nacho=1.
        orders: { FIFA: [2, 0, 1] },
        onMoveGlobal: () => {},
        onMoveOwn: () => {},
      }),
    )
    expect(paso).toContain('FIFA')
    // Pádel no prendió su toggle: sin tarjeta propia, sin su nombre en pantalla.
    expect(paso).not.toContain('Pádel')
    // Dos listas -- la global (3 filas) y la propia de FIFA (3 filas más).
    expect(paso.match(/⠿/g)).toHaveLength(6)
  })

  /**
   * F3 (dos jueces ciegos, `37b225b..d33377a`): con UNA sola disciplina
   * marcada, ninguna tarjeta propia se dibuja -- ni siquiera si `ownOrder`/
   * `orders` traen una entrada sobrante de cuando había 2+ marcadas
   * (destildar la otra no los limpia). El checkbox que la prendería
   * (`FormatoDeUnaDisciplina`, paso Formato) ya no está visible con una sola
   * disciplina -- "un control que ya no se ve no puede seguir mandando".
   * Reachable: Pádel + FIFA, prender "orden propio" en FIFA, volver al paso
   * 1 y destildar Pádel deja un torneo de UNA sola disciplina (FIFA) con
   * `ownOrder.FIFA`/`orders.FIFA` todavía puestos.
   */
  it('con una sola disciplina marcada, no dibuja ninguna tarjeta propia aunque ownOrder/orders tengan sobrantes', () => {
    const paso = renderToStaticMarkup(
      createElement(PasoOrdenInicial, {
        orderedNames: ['Colo', 'Nacho', 'Fede'],
        mySeat: 0,
        disciplines: ['FIFA'],
        ownOrder: { PADEL: false, FIFA: true },
        orders: { FIFA: [2, 0, 1] },
        onMoveGlobal: () => {},
        onMoveOwn: () => {},
      }),
    )
    expect(paso).not.toContain('FIFA')
    // Sólo la lista global -- ninguna tarjeta propia agregó filas de más.
    expect(paso.match(/⠿/g)).toHaveLength(3)
  })

  /**
   * WU4 (ronda 2 de revisión), la fila fantasma: verificado alcanzable --
   * plantel `[Ana, Beto, Caro, Dani, Eze]`, se prende "orden propio" de FIFA
   * copiando el orden global (`[0,1,2,3,4]`), se vuelve al paso 1 y se vacía
   * a MANO el nombre de una fila del medio (Caro, índice 2) sin sacar la
   * fila. `filledSeatIndices` (al prender el toggle) y `seedOrderFrom` (al
   * submit) ya filtran ese caso -- el render de EN MEDIO no hacía ninguno de
   * los dos, y dibujaba una fila fantasma con flechas que funcionan y un
   * `aria-label="Subir a  en FIFA"`.
   */
  it('un asiento vaciado a mano no dibuja una fila fantasma en la tarjeta propia', () => {
    const paso = renderToStaticMarkup(
      createElement(PasoOrdenInicial, {
        orderedNames: ['Ana', 'Beto', '', 'Dani', 'Eze'],
        mySeat: 0,
        disciplines: ['PADEL', 'FIFA'],
        ownOrder: { PADEL: false, FIFA: true },
        orders: { FIFA: [0, 1, 2, 3, 4] },
        onMoveGlobal: () => {},
        onMoveOwn: () => {},
      }),
    )
    expect(paso).not.toContain('aria-label="Subir a  en FIFA"')
    expect(paso).not.toContain('aria-label="Bajar a  en FIFA"')
    // La tarjeta de FIFA dibuja 4 filas, no 5 -- la del medio, vacía, no cuenta.
    expect(paso.slice(paso.indexOf('FIFA')).match(/⠿/g)).toHaveLength(4)
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
