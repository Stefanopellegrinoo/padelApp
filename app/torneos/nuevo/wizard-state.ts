/**
 * La lógica del wizard, sin React.
 *
 * Vive aparte de `wizard.tsx` para poder testearla en la suite unitaria, sin
 * DOM y sin base. Es la única parte del paso a paso donde se puede equivocar
 * algo: el resto es dibujar.
 */
import {
  defaultConfig,
  disciplineProfile,
  formatsLabel,
  minSquadFor,
  pointsCountError,
  pointsErrors,
  type MatchdayFormat,
  type MatchFormat,
  type SeasonConfig,
  type SideSize,
} from '@/core'

/** Los rangos son medidas del handoff (§6 paso 4), no decisiones de este código. */
export interface Stepper {
  key: 'setsToWin' | 'gamesPerSet' | 'regularMatchdays' | 'countBestOf' | 'tiebreakSnapshotEvery'
  label: string
  hint: string
  min: number
  max: number
}

export const STEPPERS: Stepper[] = [
  {
    key: 'setsToWin',
    label: 'Sets por partido',
    hint: 'Con 1 set la fecha entra en una tarde.',
    min: 1,
    max: 3,
  },
  {
    key: 'gamesPerSet',
    label: 'Games por set',
    hint: 'A 4 games el resultado se carga en dos toques.',
    min: 3,
    max: 9,
  },
  {
    key: 'regularMatchdays',
    label: 'Fechas del año',
    hint: 'Sin contar el Masters, que va al final.',
    min: 1,
    max: 24,
  },
  {
    key: 'countBestOf',
    label: 'Cuentan las mejores',
    hint: 'Las peores se descartan, así se puede faltar sin quedar afuera.',
    min: 1,
    max: 24,
  },
  {
    key: 'tiebreakSnapshotEvery',
    label: 'Refresco del orden',
    hint: 'Cada cuántas fechas se actualiza el orden que corta los empates.',
    min: 1,
    max: 6,
  },
]

/**
 * Los steppers que gobiernan algo para ESTE conjunto de formatos.
 *
 * Con marcador abierto "Sets por partido" y "Games por set" no deciden nada
 * —`setError` los ignora, `matchError` no los exige y `usesSetsDiff` los
 * apaga— y encima el segundo se anuncia con "A 4 games el resultado se carga
 * en dos toques", que es JUSTO la máquina que esa disciplina no monta. Es la
 * misma clase de mentira que el copy que decía "1 set a 4 games" en una liga de
 * goles (W47, W51, W56, W63).
 *
 * Toma una lista de formatos y no un `openScore` suelto porque Ajustes
 * (`formato.tsx`) llama con un array de UNO -- la config es de UNA disciplina
 * ahí. Desde la Task 5 (docs/plan-arquitectura-de-paginas.md) el paso 4 del
 * wizard hace exactamente lo mismo: cada disciplina marcada tiene su PROPIA
 * config, así que también llama con un array de uno, por disciplina — nunca
 * con las de todas juntas. Antes de esa Task el wizard mandaba las de TODAS
 * las marcadas a la vez (una config compartida por la temporada entera), y
 * por eso el chequeo "alcanza con que UNA use sets" existe: hoy es
 * defensivo, sin un caller vivo que pase más de un elemento, pero la firma
 * se queda en array porque Ajustes ya llama así y esta Task no la toca.
 *
 * Una función y no dos filtros: W63 nació exactamente de que Ajustes
 * filtrara y el wizard no.
 *
 * Sin disciplinas se dibujan los cinco: "nadie usa sets" no es cierto cuando no
 * hay nadie, y el paso 1 no deja continuar sin marcar al menos una.
 */
export function steppersFor(formats: readonly MatchFormat[]): Stepper[] {
  const usesSets = formats.length === 0 || formats.some((format) => !format.openScore)
  if (usesSets) return STEPPERS
  return STEPPERS.filter((row) => row.key !== 'setsToWin' && row.key !== 'gamesPerSet')
}

/**
 * Las disciplinas que el paso 1 puede marcar. REQ-D1-1: checkboxes por kind,
 * 1 o más — no hay "+ agregar otra disciplina" acá. Dos disciplinas del MISMO
 * kind (dos Pádel) sólo se arman después, desde Ajustes (PR13): este paso
 * pregunta "qué juega el torneo", no "cuántas mesas de cada juego".
 */
export const DISCIPLINE_KINDS = ['PADEL', 'FIFA'] as const
export type DisciplineKind = (typeof DISCIPLINE_KINDS)[number]
export const DISCIPLINE_LABELS: Record<DisciplineKind, string> = { PADEL: 'Pádel', FIFA: 'FIFA' }

/**
 * Suma o saca un kind del marcado, sin ordenar: el orden en que se TOCAN los
 * checkboxes es el que después se vuelve `position` (`createSeason`, PR11b) y
 * de ahí el ordinal del slug (`padel`, `padel-2`, PR10). Ordenar acá por kind
 * o alfabético cambiaría esa URL sin que nadie lo haya pedido.
 */
export function toggleDiscipline(
  picked: readonly DisciplineKind[],
  kind: DisciplineKind,
): DisciplineKind[] {
  return picked.includes(kind) ? picked.filter((k) => k !== kind) : [...picked, kind]
}

/** El aviso del paso 1 si no se marcó ninguna disciplina, o `null`. REQ-D1-1: 1 o más. */
export function disciplinesWarning(picked: readonly DisciplineKind[]): string | null {
  return picked.length === 0 ? 'Elegí al menos una disciplina para el torneo.' : null
}

/**
 * Una fila por disciplina marcada, en el orden en que se marcaron: el mismo
 * `disciplines: NewSeasonDiscipline[]` que espera `createSeason` (PR11b).
 *
 * `config` es la de ESE `kind` solo, nunca una compartida por las demás
 * filas: cada una nace con la forma de marcador de su disciplina
 * (`disciplineProfile`, PR20 rebanada D2) aplicada sobre la config que le
 * pasaron. Hasta PR20 compartían la config entera y una liga de FIFA nacía
 * siendo pádel con otro nombre: sin marcador abierto y sin empates, o sea sin
 * poder cargar ni un `3-1` ni un `0-0`. No es una preferencia que el wizard
 * pueda preguntar más adelante: `allows_draw` no está en el grant de UPDATE
 * de `disciplines` (`0015_disciplines.sql:70`), así que la disciplina que
 * nace sin empates no los tiene nunca más.
 *
 * `buildDisciplines` en sí es agnóstica de si el CALLER usa la MISMA config
 * para más de un `kind` en `picked` o una distinta por cada uno — sólo
 * transforma lo que le dan. Antes de la Task 5
 * (docs/plan-arquitectura-de-paginas.md §2.4, §6) su único caller de
 * producción (`newTournamentPayload`, wizard) SÍ llamaba con la config
 * COMPARTIDA de la temporada entera para todo `picked` a la vez — el
 * aplanado vivía ahí, no acá. Desde esa Task, `newTournamentPayload` llama
 * una vez por disciplina, cada vez con SU PROPIA config: los puntos, las
 * fechas del año, cuántas cuentan y el refresco del desempate ya no se
 * comparten entre disciplinas — sólo el plantel (§3.2 del diseño).
 *
 * `pairSize` —FIFA es 1v1 Y 2v2, decisión de producto #5— es OPCIONAL y sin
 * default acá a propósito: quien no lo pasa arma parejas, como siempre
 * (`addDiscipline`/`NewSeasonDiscipline` caen a 2 si no llega). Sólo se agrega
 * al resultado cuando se pasa —el pádel de hoy no gana una clave `pairSize`
 * que antes no tenía, que rompería el `toEqual` de sus propios tests.
 * Rebanada F (decisión `decisions/alcance-desbloqueo-1v1-pr21`) es quien por
 * fin lo pasa, desde el radio "Lados".
 *
 * Quien quiera cambiar los puntos o las fechas de una disciplina después de
 * creado el torneo lo hace en Ajustes → Formato (`updateDisciplineConfig`,
 * PR6) — esta función sólo arma el estado INICIAL, al crear.
 */
export function buildDisciplines(
  picked: readonly DisciplineKind[],
  config: SeasonConfig,
  pairSize?: SideSize,
): { kind: DisciplineKind; config: SeasonConfig; allowsDraw: boolean; pairSize?: SideSize }[] {
  return picked.map((kind) => ({
    kind,
    ...disciplineProfile(kind, config),
    ...(pairSize === undefined ? {} : { pairSize }),
  }))
}

/**
 * La fila que arma "+ Agregar disciplina" (Ajustes, REQ-D1-2): la misma forma
 * que una fila de `buildDisciplines`, para UNA sola disciplina y con la
 * config del tamaño de SU plantel elegido (`headcount`, no el de toda la
 * temporada — REQ-D1-4, solape parcial).
 *
 * Vive acá y no en `ajustes/actions.ts` por lo mismo que el resto de este
 * archivo: `actions.ts` es `'use server'` y no se puede importar en la suite
 * unitaria sin arrastrar `next/headers` (mismo precedente que
 * `SelectorDeFormato`, PR21 D2 — un pedazo se saca a un archivo sin ese
 * import para poder testearlo). El único tramo que queda sin test es la línea
 * de una sola llamada que le reenvía este resultado a `addDiscipline`.
 */
export function newDisciplineSpec(
  kind: DisciplineKind,
  headcount: number,
  pairSize?: SideSize,
): { kind: DisciplineKind; config: SeasonConfig; allowsDraw: boolean; pairSize?: SideSize } {
  return buildDisciplines([kind], defaultConfig(headcount, pairSize), pairSize)[0]!
}

/** Cuántos nombres del plantel están cargados de verdad. */
export function filledCount(names: readonly string[]): number {
  return names.filter((name) => name.trim().length > 0).length
}

/**
 * El piso real del plantel COMPARTIDO: el MÁXIMO entre los pisos de cada
 * disciplina elegida, nunca el mínimo ni el de la primera.
 *
 * El plantel es uno solo para toda la temporada (docs/tipos-de-torneo.md §0,
 * "Comparten el plantel, el nombre y el link de invitación"): un torneo con
 * pádel (parejas, piso 4) y FIFA (de a uno, piso 2) necesita 4. Elegir el
 * MÍNIMO dejaría armar un torneo cuyo pádel no puede jugar ni una sola
 * fecha — el máximo es lo que garantiza que la disciplina más exigente
 * también entre.
 *
 * `minSquadFor(1)` es la base del `Math.max`, no `sideSizes.map(minSquadFor)`
 * solo: con `sideSizes` vacío, `Math.max()` sin argumentos da `-Infinity`.
 * Hoy ningún caller del wizard llega acá con el array vacío en la pantalla
 * donde el valor se MUESTRA (`blocked` no deja salir del paso 0 sin marcar
 * ninguna disciplina) — pero `wizard.tsx:405` llama a esta función en CADA
 * render, no sólo al cambiar de paso, así que destildar las dos disciplinas
 * en el paso 0 sí la ejecuta con `[]`. Con la base puesta, esa llamada da 2
 * en vez de `-Infinity` y la función queda total en vez de depender de que
 * nadie mueva el JSX que hoy la protege.
 */
export function effectiveFloor(sideSizes: readonly SideSize[]): number {
  return Math.max(minSquadFor(1), ...sideSizes.map(minSquadFor))
}

/**
 * El aviso del paso 2, o `null` si se puede continuar.
 *
 * `floor` es el piso EFECTIVO del plantel compartido (`effectiveFloor`), no
 * un número fijo: con sólo FIFA arranca en 2, con pádel (solo o junto a FIFA)
 * en 4. Esta función no elige el piso, sólo lo aplica — quien arma el estado
 * del wizard es quien sabe qué disciplinas están marcadas.
 *
 * `needsPairs` — `true` cuando ALGUNA disciplina marcada tiene `pairSize ===
 * 2` — es lo que decide si la banda de paridad de abajo corre. La paridad es
 * una regla de PAREJAS ("para poder armar parejas"), no del plantel en
 * general: `validateConfig` (`core/config.ts`) ya la gatea sólo para
 * `sideSize === 2`, y un torneo de FIFA a secas (`assertMatchdaySize`, tests)
 * acepta un plantel impar sin quejarse. Sin este parámetro, esta función
 * exigía par SIEMPRE, así que un torneo de FIFA de 3 o de 13 quedaba
 * bloqueado en el wizard por un cartel que habla de "armar parejas" en un
 * torneo que no arma ninguna — el mismo defecto que
 * docs/plan-piso-y-techo-del-plantel.md borró de `db/season.ts:266`, un piso
 * más arriba.
 *
 * El plantel se carga **par** sólo cuando hace falta: la app agrega un
 * invitado cuando una FECHA da impar, que es otra cosa y no depende de esto.
 */
export function squadWarning(names: readonly string[], floor: number, needsPairs: boolean): string | null {
  const filled = filledCount(names)
  if (filled < floor) {
    const missing = floor - filled
    return missing === 1
      ? `Falta 1 nombre. El plantel arranca en ${floor}.`
      : `Faltan ${missing} nombres. El plantel arranca en ${floor}.`
  }
  if (needsPairs && filled % 2 !== 0) {
    return `Son ${filled}. El plantel tiene que ser par para poder armar parejas.`
  }
  return null
}

/**
 * El asiento del que arma el torneo, mientras el wizard lo mueve de lugar.
 *
 * El plantel es un `string[]` sin identidad: el asiento propio se sigue por
 * índice, y cualquier cosa que corra la lista lo tiene que correr también. Por
 * eso las tres operaciones que la tocan viven acá y devuelven las dos cosas
 * juntas — separarlas es exactamente cómo se pierde de vista cuál era el tuyo.
 *
 * `mySeat` es un índice, NO un nombre: si te renombrás el asiento seguís siendo
 * vos. En el grupo te dicen "Colo", no "Rodrigo", y ése es el nombre que tiene
 * que ver el resto.
 */
export interface Squad {
  names: string[]
  mySeat: number | null
}

/** Saca la fila `index`. Si era la propia, el organizador queda afuera del plantel. */
export function removeSeatAt({ names, mySeat }: Squad, index: number): Squad {
  return {
    names: names.filter((_, at) => at !== index),
    mySeat: mySeat === null || mySeat === index ? null : mySeat > index ? mySeat - 1 : mySeat,
  }
}

/**
 * El plantel después de tipear `value` en la fila `index`, con una fila más
 * en blanco al final si esa fila era la ÚLTIMA y quedó con algo cargado.
 *
 * Decisión del dueño (docs/plan-piso-y-techo-del-plantel.md): no "montar 8
 * filas de nuevo", ni un "tamaño típico" por disciplina — mover el piso a
 * `minSquadFor(sideSize)` ya borró dos números mágicos cuyo único pecado era
 * adivinar cuánta gente sos, y montar un plano fijo de filas es el MISMO
 * error con otra ropa. Que la fila aparezca sola mientras tipeás hace
 * desaparecer la pregunta en vez de elegir un bando, y funciona igual para
 * dos personas que para veinticuatro.
 *
 * Sólo CRECE, nunca se achica: tipear en una fila que NO es la última no
 * dispara nada (agregar ahí sería sumar una fila que nadie pidió, lejos de
 * donde se está escribiendo), y vaciar la última fila tampoco saca la que
 * ya se agregó — esta función no tiene ningún camino que elimine un
 * elemento, así que la lista no se puede achicar sola mientras se edita.
 *
 * Autolimitado a UNA fila en blanco por vez: apenas se agrega, ESA pasa a
 * ser la nueva última, así que la PRÓXIMA letra tipeada ahí dispara la MISMA
 * regla y agrega la que sigue. No hace falta un tope aparte ni contar cuántas
 * ya hay.
 *
 * `value.trim()` y no `value` a secas: mismo criterio que `filledCount` — un
 * espacio no es un nombre cargado, y si contara como "no vacío" la fila
 * crecería con un espacio suelto que ni `filledCount` ni `squadWarning` ven
 * como jugador.
 */
export function namesAfterEdit(names: readonly string[], index: number, value: string): string[] {
  const next = [...names]
  next[index] = value
  const isLastRow = index === names.length - 1
  return isLastRow && value.trim().length > 0 ? [...next, ''] : next
}

/**
 * Los nombres sin las filas en blanco del FINAL — la que `namesAfterEdit`
 * deja creciendo sola mientras se tipea la última.
 *
 * El paso 3 (orden) reordena jugadores, no casilleros: sin esto, terminar de
 * cargar el plantel tipeando de corrido (el caso que esta función existe
 * para arreglar) deja SIEMPRE una fila en blanco colgando al final, y ese
 * paso la dibujaba igual que cualquier otra, con flechas de subir/bajar
 * sobre un nombre que no existe.
 *
 * Corta sólo desde la COLA, no filtra el array entero: una fila en blanco en
 * el medio (la deja "+ Agregar jugador" sin llenar, o vaciarla a mano) sigue
 * ahí — filtrar todo correría el ÍNDICE de las filas que sobreviven, y el
 * paso 3 usa ese índice tal cual para `moveSeat`. Cortando sólo la cola, el
 * índice de cada fila visible es EXACTAMENTE el mismo que en `names`.
 */
export function withoutTrailingBlanks(names: readonly string[]): string[] {
  let end = names.length
  while (end > 0 && names[end - 1]!.trim().length === 0) end -= 1
  return names.slice(0, end)
}

/**
 * Vuelve a meter al organizador en el plantel, al final, exactamente como
 * "+ Agregar jugador".
 *
 * Agrega una fila y no reusa un casillero vacío. La versión que los reusaba
 * perdía una fila en la ida y vuelta —sacarse ya achica la lista, así que
 * volver reusando un vacío deja el plantel un lugar más corto que al empezar—
 * y quedaba en un plantel de siete que el aviso reclamaba sin explicar por qué.
 *
 * Que caiga último y no primero es correcto: el orden es el desempate inicial,
 * y el paso 3 existe para acomodarlo.
 */
export function addMySeat({ names }: Squad, myName: string): Squad {
  return { names: [...names, myName], mySeat: names.length }
}

/**
 * Swapea `from`/`to` de `arr`, o lo devuelve intacto si cualquiera de los dos
 * cae afuera de rango. Pieza compartida entre `moveSeat` (el plantel global,
 * que además arrastra `mySeat`) y `moveInOrder` (el orden propio de una
 * disciplina, que no arrastra nada más): antes de esta tarea (F1/minors)
 * reimplementaban el mismo swap cada una por su lado, y `moveInOrder` sólo
 * guardaba `to` -- un `from` fuera de rango la rompía en silencio.
 */
function swapAt<T>(arr: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= arr.length || to < 0 || to >= arr.length) return [...arr]
  const next = [...arr]
  next[from] = arr[to]!
  next[to] = arr[from]!
  return next
}

/** Sube o baja una fila del orden inicial, arrastrando el asiento propio si es una de las dos. */
export function moveSeat({ names, mySeat }: Squad, from: number, to: number): Squad {
  if (from < 0 || from >= names.length || to < 0 || to >= names.length) return { names, mySeat }
  return { names: swapAt(names, from, to), mySeat: mySeat === from ? to : mySeat === to ? from : mySeat }
}

/**
 * Agrega una fila en blanco al final del plantel -- "+ Agregar jugador"
 * (paso 1). No toca `orders`: una fila en blanco todavía no es un asiento
 * (`addToOrders` corre recién en `editSeatState`, más abajo, cuando esa fila
 * deja de estarlo).
 *
 * WU2 (ronda 2 de revisión): antes era un `setSquad({...squad, names:
 * [...names, '']})` a mano, adentro del JSX de `wizard.tsx` -- la única de
 * las mutaciones de plantel que no pasaba por una función con nombre acá.
 * Hoy es inofensiva (agregar SIEMPRE un blanco no corre ningún índice), pero
 * es la forma del próximo bug: cualquiera que la toque después hereda el
 * mismo riesgo que `editSeatName`/`joinSquad`/`removeSeat`/`moveGlobalSeat`
 * ya tenían antes de esta tarea. Ruteada por el mismo camino que las demás
 * desde acá.
 */
export function addBlankSeat(squad: Squad): Squad {
  return { ...squad, names: [...squad.names, ''] }
}

/**
 * Sube o baja una fila del orden PROPIO de una disciplina -- igual que
 * `moveSeat`, pero sin `mySeat` que arrastrar: esta lista es de ÍNDICES de
 * asiento (F1, ver el docblock de `Squad` más arriba), y la marca "vos" que
 * sí dibuja el orden global no la dibuja ésta (vive en el plantel, no en la
 * copia por disciplina).
 */
export function moveInOrder(order: readonly number[], from: number, to: number): number[] {
  return swapAt(order, from, to)
}

/**
 * Los índices de `names` que de verdad tienen alguien -- sin las filas en
 * blanco del MEDIO. `withoutTrailingBlanks` (arriba) sólo saca las del
 * FINAL, así que una fila vaciada a mano en el medio del plantel sigue
 * presente ahí. Es lo que arranca el orden propio de una disciplina
 * (`toggleOwnOrder`, abajo): copiar TODOS los índices, blancos incluidos,
 * dejaba una fila sin nombre con flechas que sí funcionan y un
 * `aria-label="Subir a  en FIFA"` (minor de esta tarea).
 */
export function filledSeatIndices(names: readonly string[]): number[] {
  return names.flatMap((name, index) => (name.trim().length > 0 ? [index] : []))
}

/**
 * El estado de `orders` después de tocar el checkbox "orden propio" de una
 * disciplina (`FormatoDeUnaDisciplina`, wizard.tsx, sólo con `label !==
 * null` -- ver su docblock): prender COPIA el orden GLOBAL de este instante,
 * apagar BORRA la entrada entera -- nunca la deja en `[]`, que es un
 * `seedOrder` que no calza con NADA de permutación (`isIndexPermutation`,
 * `db/season.ts`).
 *
 * F1 (dos jueces ciegos, `37b225b..d33377a`): la copia es de ÍNDICES de
 * asiento (`filledSeatIndices(orderedNames)`), no de nombres. La versión
 * anterior copiaba texto y lo reconciliaba por VALOR (`reconcileOrder`,
 * borrada en esta tarea) -- reconciliar por valor es exactamente lo que
 * rompía con una renombrada a mitad de tipeo: un `setSquad` corre en CADA
 * tecla, y el string intermedio ("Ca" mientras se retipea "Caro") no
 * matcheaba contra el `order` viejo, así que ese asiento se caía a la cola
 * y no volvía a subir aunque el nombre final calzara de nuevo -- medido,
 * `[Caro,Dani,Ana,Beto]` terminaba en `[Dani,Ana,Beto,Caro]` con el plantel
 * BYTE A BYTE igual al de arranque. Un índice no tiene ese problema: la
 * posición de un asiento no cambia mientras se lo renombra (`Squad.mySeat`
 * ya vive de esta misma garantía), así que no hace falta reconciliar NADA
 * por una renombrada, ocurra en un solo tecleo o en veinte. De paso cierra
 * F2 (nombres duplicados): dos "Juan" son dos ÍNDICES distintos, nunca el
 * mismo casillero.
 *
 * Copiar y no referenciar el array global en vivo sigue siendo la decisión:
 * desde que se prende, la lista de la disciplina se edita SOLA (`moveInOrder`,
 * arriba, más `swapInOrders`/`removeFromOrders`/`addToOrders` de abajo
 * cuando el plantel cambia) -- si el admin reordena el plantel GLOBAL
 * después de prender el toggle, esa edición no tiene por qué pisar lo que ya
 * se armó para ESTA disciplina en particular. Son dos preguntas distintas:
 * "¿en qué orden entran las disciplinas SIN toggle propio?" (el global) vs.
 * "¿en qué orden entra ÉSTA?" (la suya).
 */
export function toggleOwnOrder(
  orders: Partial<Record<DisciplineKind, number[]>>,
  kind: DisciplineKind,
  next: boolean,
  orderedNames: readonly string[],
): Partial<Record<DisciplineKind, number[]>> {
  const { [kind]: _current, ...rest } = orders
  return next ? { ...rest, [kind]: filledSeatIndices(orderedNames) } : rest
}

/**
 * El orden propio de cada disciplina, con el asiento `removed` sacado --
 * MISMA fórmula que `removeSeatAt` (arriba) ya aplica a `mySeat`: el que
 * apuntaba exactamente a `removed` desaparece de la lista, y todo el que
 * apuntaba a uno de más atrás se corre un lugar para adelante. Generalizada
 * a una lista entera porque acá no hay un único "asiento propio" que seguir,
 * sino tantos como la disciplina tenga ordenados.
 */
export function removeFromOrder(order: readonly number[], removed: number): number[] {
  return order.flatMap((at) => (at === removed ? [] : at > removed ? [at - 1] : [at]))
}

/** `removeFromOrder` aplicado a cada disciplina que tiene su propia lista -- las que no, ni se tocan. */
export function removeFromOrders(
  orders: Partial<Record<DisciplineKind, number[]>>,
  removed: number,
): Partial<Record<DisciplineKind, number[]>> {
  const next: Partial<Record<DisciplineKind, number[]>> = {}
  for (const kind of DISCIPLINE_KINDS) {
    const order = orders[kind]
    if (order !== undefined) next[kind] = removeFromOrder(order, removed)
  }
  return next
}

/**
 * El orden propio de una disciplina, con el asiento `at` agregado al final
 * si todavía no estaba -- el lugar donde entra cualquier asiento nuevo
 * (`addMySeat`, o la fila que `namesAfterEdit` deja de estar en blanco). Si
 * `at` ya estaba en la lista, no hace nada: una renombrada no agrega ningún
 * asiento nuevo, el índice sigue señalando al mismo de siempre (F1).
 */
export function addToOrder(order: readonly number[], at: number): number[] {
  return order.includes(at) ? [...order] : [...order, at]
}

/** `addToOrder` aplicado a cada disciplina que tiene su propia lista -- las que no, ni se tocan. */
export function addToOrders(
  orders: Partial<Record<DisciplineKind, number[]>>,
  at: number,
): Partial<Record<DisciplineKind, number[]>> {
  const next: Partial<Record<DisciplineKind, number[]>> = {}
  for (const kind of DISCIPLINE_KINDS) {
    const order = orders[kind]
    if (order !== undefined) next[kind] = addToOrder(order, at)
  }
  return next
}

/**
 * El orden propio de una disciplina, con `from`/`to` swapeados -- MISMA
 * fórmula que `moveSeat` (arriba) usa para `mySeat`: cuando el orden GLOBAL
 * (paso "Orden inicial", lista de arriba) swapea dos asientos, cualquier
 * lista propia que ya los tuviera anotados tiene que seguir señalando a la
 * MISMA persona, no a la que quedó parada en ese índice después del swap.
 */
export function swapInOrder(order: readonly number[], from: number, to: number): number[] {
  return order.map((at) => (at === from ? to : at === to ? from : at))
}

/** `swapInOrder` aplicado a cada disciplina que tiene su propia lista -- las que no, ni se tocan. */
export function swapInOrders(
  orders: Partial<Record<DisciplineKind, number[]>>,
  from: number,
  to: number,
): Partial<Record<DisciplineKind, number[]>> {
  const next: Partial<Record<DisciplineKind, number[]>> = {}
  for (const kind of DISCIPLINE_KINDS) {
    const order = orders[kind]
    if (order !== undefined) next[kind] = swapInOrder(order, from, to)
  }
  return next
}

/**
 * El estado combinado (`squad` + `orders`) después de tipear `value` en la
 * fila `index` del plantel (paso 1).
 *
 * WU2 (ronda 2 de revisión): antes vivía partido en dos llamadas sueltas
 * adentro de `editSeatName` (`wizard.tsx`), sin ningún test que las
 * ejercitara juntas -- esta suite no tiene runner de clicks/tecleo, así que
 * la lógica que sólo existía adentro de un handler de `.tsx` quedaba
 * estructuralmente fuera de su alcance (mismo defecto que
 * `app/cableado-de-formato.unit.test.ts` ya documenta para el punto de
 * unión del paso 4 -- "extraer a un módulo puro MUEVE el riesgo al punto de
 * unión, y ahí no queda nada"). Acá la lógica entera queda adentro del
 * módulo puro, testeable sin DOM; `wizard.tsx` sólo aplica las dos mitades
 * del resultado (pin de ese cableado en `app/cableado-de-formato.unit.test.ts`).
 *
 * Un asiento en blanco que pasa a tener contenido es un asiento NUEVO --
 * entra al final de cada orden propio que ya exista (`addToOrders`); uno que
 * ya tenía nombre es una renombrada y no hace falta tocar `orders` (F1: el
 * índice sigue señalando al mismo asiento, se llame como se llame).
 */
export function editSeatState(
  squad: Squad,
  orders: Partial<Record<DisciplineKind, number[]>>,
  index: number,
  value: string,
): { squad: Squad; orders: Partial<Record<DisciplineKind, number[]>> } {
  const wasBlank = (squad.names[index] ?? '').trim().length === 0
  const nextSquad = { ...squad, names: namesAfterEdit(squad.names, index, value) }
  const nextOrders = wasBlank && value.trim().length > 0 ? addToOrders(orders, index) : orders
  return { squad: nextSquad, orders: nextOrders }
}

/**
 * El estado combinado tras "Participar en el torneo" (WU2): el organizador
 * entra al plantel en un asiento NUEVO, al final -- mismo criterio que
 * `editSeatState` para un asiento que aparece, así que también entra a cada
 * orden propio que ya exista.
 */
export function joinSquadState(
  squad: Squad,
  orders: Partial<Record<DisciplineKind, number[]>>,
  myName: string,
): { squad: Squad; orders: Partial<Record<DisciplineKind, number[]>> } {
  return { squad: addMySeat(squad, myName), orders: addToOrders(orders, squad.names.length) }
}

/**
 * El estado combinado tras sacar la fila `index` del plantel (WU2): la cruz
 * de paso 1, o "Sacame del plantel" para la propia. `removeFromOrders` corre
 * la MISMA fórmula que `removeSeatAt` ya aplica a `mySeat`, generalizada a
 * cada orden propio.
 */
export function removeSeatState(
  squad: Squad,
  orders: Partial<Record<DisciplineKind, number[]>>,
  index: number,
): { squad: Squad; orders: Partial<Record<DisciplineKind, number[]>> } {
  return { squad: removeSeatAt(squad, index), orders: removeFromOrders(orders, index) }
}

/**
 * El estado combinado tras el swap del orden GLOBAL (paso "Orden inicial",
 * WU2): `swapInOrders` sigue la MISMA fórmula que `moveSeat` ya aplica a
 * `mySeat` -- si un orden propio ya tenía anotado alguno de los dos
 * asientos, tiene que seguir señalando a la MISMA persona después del swap.
 *
 * WU5 (ronda 2 de revisión): el guard de rango es UNO SOLO para las dos
 * mitades -- antes `moveSeat` se negaba a mover fuera de rango (dejaba
 * `squad` intacto) pero `swapInOrders`, llamada suelta, swapeaba igual;
 * inalcanzable hoy porque las flechas de `wizard.tsx` salen `disabled` en
 * los bordes, pero las dos mitades de UNA sola acción de usuario no tienen
 * por qué discrepar sobre qué es "fuera de rango".
 */
export function moveGlobalSeatState(
  squad: Squad,
  orders: Partial<Record<DisciplineKind, number[]>>,
  from: number,
  to: number,
): { squad: Squad; orders: Partial<Record<DisciplineKind, number[]>> } {
  if (from < 0 || from >= squad.names.length || to < 0 || to >= squad.names.length) {
    return { squad, orders }
  }
  return { squad: moveSeat(squad, from, to), orders: swapInOrders(orders, from, to) }
}

/**
 * El `seedOrder` final de una disciplina con orden propio: traduce los
 * ÍNDICES CRUDOS de `order` (posiciones sobre `squad.names`, F1) a índices
 * sobre `squadNames` -- la lista YA FILTRADA que `submitSeats` produce y que
 * `db/season.ts` usa como base (`entryRows`) -- una sola vez, ACÁ, no antes:
 * el índice crudo sobrevive a cualquier renombrada en el camino
 * (`Squad.mySeat` ya vive de esta misma garantía), así que no hace falta
 * reconciliar nada mientras se edita el plantel.
 *
 * WU1 (ronda 2 de revisión): reemplaza a `seedNamesFrom`, que traducía a
 * NOMBRES -- un formato que la identidad del asiento no sobrevivía cruzar el
 * borde con el server. Medido: `squad.names = ['Ana','Juan','Luis','Juan']`,
 * `orders.FIFA = [3,0,1,2]` (el usuario arrastró el Juan del asiento 3)
 * cruzaba como `['Juan','Ana','Juan','Luis']` -- dos nombres iguales, la
 * posición ya no dice CUÁL Juan es cuál -- y `seedOrderIndices`
 * (`db/season.ts`, borrada en esta tarea) volvía a elegir el PRIMER Juan con
 * un scan de primero-libre, sin forma de saber cuál era. Con índices de
 * punta a punta no hay nada que adivinar: el resultado de esta función ya
 * es la posición DEFINITIVA dentro de `squadNames`, y viaja tal cual hasta
 * `db/season.ts`.
 *
 * Cualquier índice que ya no señale a un asiento con nombre (uno sacado sin
 * pasar por `removeFromOrders`, uno vaciado a mano, o uno fuera de rango) se
 * descarta -- mismo espíritu que la vieja `reconcileOrder` con un nombre que
 * ya no está. Y cualquier asiento del plantel que `order` no llegó a anotar
 * se agrega al final, en el orden del plantel -- así el resultado es
 * SIEMPRE una permutación completa de `[0, squadNames.length)`, la que
 * exige el guard de `createSeason` (`isIndexPermutation`, `db/season.ts`).
 */
export function seedOrderFrom(order: readonly number[], names: readonly string[]): number[] {
  const filled = names
    .map((name, at) => ({ name: name.trim(), at }))
    .filter((seat) => seat.name.length > 0)
  // WU5 (ronda 2 de revisión): `usedAt` es defensa contra un `order` con un
  // índice repetido -- hoy inalcanzable, `orders[kind]` sólo se arma con
  // `addToOrders`/`removeFromOrders`/`swapInOrders`/`moveInOrder`, y las
  // cuatro preservan la unicidad por construcción. Se queda como red barata
  // para cualquier otro caller de esta función exportada, no porque haya un
  // camino de producción que hoy la dispare.
  const positionOf = new Map(filled.map((seat, position) => [seat.at, position]))
  const usedAt = new Set<number>()
  const kept: number[] = []
  for (const at of order) {
    if (!positionOf.has(at) || usedAt.has(at)) continue
    kept.push(positionOf.get(at)!)
    usedAt.add(at)
  }
  const remaining = filled.filter((seat) => !usedAt.has(seat.at)).map((seat) => positionOf.get(seat.at)!)
  return [...kept, ...remaining]
}

/**
 * Lo que se manda a crear: los nombres cargados, y en qué posición de ESA lista
 * quedó el asiento propio.
 *
 * El índice se recalcula contra la lista filtrada y no se manda el del wizard:
 * los casilleros vacíos de arriba lo corren, y mandar el crudo ataría al
 * organizador al asiento de otro. Un asiento sin nombre no es un asiento, así
 * que si la fila propia quedó en blanco el organizador no juega.
 */
export function submitSeats({ names, mySeat }: Squad): {
  squadNames: string[]
  mySeatIndex: number | null
} {
  const filled = names
    .map((name, at) => ({ name: name.trim(), at }))
    .filter((seat) => seat.name.length > 0)
  const index = mySeat === null ? -1 : filled.findIndex((seat) => seat.at === mySeat)
  return {
    squadNames: filled.map((seat) => seat.name),
    mySeatIndex: index < 0 ? null : index,
  }
}

/**
 * El payload exacto que espera `createTournament` (`./actions`), armado a
 * partir de lo que el wizard fue juntando en sus cinco pasos.
 *
 * Vivía inline adentro del `startTransition` del submit de `Wizard` —puro
 * salvo el `await` final— e intestable ahí por eso: mismo motivo por el que
 * `wizard-state.ts`/`armado-state.ts`/`carga-state.ts`/`sumar-state.ts`
 * existen, sacar la lógica del `.tsx` para poder probarla sin DOM y sin base.
 *
 * `squadSize` sale del plantel REALMENTE cargado (`submitSeats(squad)`), no
 * del que traía cada `configs[kind]`: el paso 4 puede quedar desactualizado
 * si el admin agrega o saca nombres después de tocarlo, y `resizeConfig`
 * (por disciplina, acá abajo) es quien lo pone al día antes de construir la
 * fila — mismo criterio que ya usaba `setSquad` (`wizard.tsx`) mientras se
 * edita, esto es la red de seguridad para el instante del submit.
 *
 * `pairSize` es el punto de unión de la Rebanada F: viaja tal cual hasta
 * `buildDisciplines`, así que elegir "Individual" llega hasta ACÁ, en el
 * payload real que cruza al server action (#3957 — se pinchan los
 * argumentos, no que la función interna acepte el parámetro).
 *
 * OBLIGATORIOS acá y no opcionales como en `buildDisciplines`/`newDisciplineSpec`:
 * este único caller (`Wizard`) SIEMPRE tiene un valor por disciplina para
 * `pairSizes`, `hasMasters` y `formatoDefault` (nacen en un `Record` con las
 * dos claves puestas, el `useState` no es `undefined` nunca), así que
 * dejarlos opcionales sólo abriría la puerta a olvidarlos en el sitio del
 * submit sin que nada lo marque. Con los parámetros obligatorios, olvidarlos
 * es un error de `tsc`, no un test que haya que escribir y mantener — mismo
 * criterio que ya fijó `pairSizes` (verificado con mutación: sacar un
 * argumento en `wizard.tsx` rompe `npm run typecheck`).
 *
 * Task 5 (docs/plan-arquitectura-de-paginas.md §2.4, §6) cierra la cadena
 * C29 → W69 → W76 → W83 → W88 → W90: todas esas correcciones existían
 * porque el paso 4 editaba UNA config compartida por TODAS las disciplinas
 * marcadas, y cada una era una nueva forma de que la pantalla prometiera una
 * curva que la disciplina real no iba a tener. Con `configs` genuinamente
 * por disciplina —una entrada por `DisciplineKind`, cada una con SU PROPIO
 * `squadSize`/`points`/`regularMatchdays`/`countBestOf`/`tiebreakSnapshotEvery`
 * mantenida al día por `wizard.tsx` (`resizeConfigs` en cada edición del
 * plantel, `freshDisciplineConfig` en cada cambio de "Lados")— no queda
 * ninguna ambigüedad que resolver acá: cada fila usa `configs[kind]`, la
 * suya, nunca una prestada. El campo `config` de arriba (el legado de
 * `NewSeason`/`createTournament`, `db/season.ts`) sigue existiendo porque el
 * tipo lo pide, pero `createSeason` lo ignora en cuanto `disciplines` llega
 * —y el wizard SIEMPRE lo manda—: no hay curva "correcta" que elegir ahí
 * porque nadie la lee.
 *
 * `hasMasters`/`formatoDefault` sólo se agregan a la fila cuando hay 2+
 * disciplinas marcadas (`picked.length > 1`): con una sola, el paso 4 no
 * dibuja esos controles (§5 del diseño, "nadie debería enterarse de que
 * ahora es por disciplina hasta que marque la segunda") y el payload tiene
 * que verse EXACTAMENTE como antes de esta Task — sin esas dos claves,
 * `createSeason` cae al automático de siempre (decisión #4029) y al default
 * de columna (ROUND_ROBIN, 0074). Mandarlas siempre, aunque con el mismo
 * valor que el automático, arriesgaría filtrar a esa fila una edición vieja
 * que el admin hizo mientras SÍ había una segunda disciplina marcada y
 * después destildó — un control que ya no se ve no puede seguir mandando.
 *
 * `fixedTeams` NO sigue esa misma regla: a diferencia de Masters/formato, el
 * paso 4 dibuja su checkbox SIEMPRE (docs/tipos-de-torneo.md §1), con una
 * disciplina marcada o con dos — no hay "antes de esta Task" que preservar
 * porque el control es nuevo en las dos formas. Por eso viaja siempre en la
 * fila, nunca detrás de `picked.length > 1`.
 *
 * `effectiveHasMasters`/`effectiveFixedTeams` son las puertas de salida
 * reales para sus checkboxes respectivos: una disciplina de a uno no puede
 * tener Masters (`disciplines_has_masters_needs_pair`, 0053) ni equipos fijos
 * (`disciplines_fixed_teams_needs_pair`, 0077) pase lo que pase haya elegido
 * el control — el guard vive ACÁ, no confiando en que el control quede
 * siempre deshabilitado a tiempo.
 */
export function newTournamentPayload(
  name: string,
  squad: Squad,
  configs: Record<DisciplineKind, SeasonConfig>,
  picked: readonly DisciplineKind[],
  pairSizes: Record<DisciplineKind, SideSize>,
  hasMasters: Record<DisciplineKind, boolean>,
  formatoDefault: Record<DisciplineKind, MatchdayFormat>,
  fixedTeams: Record<DisciplineKind, boolean>,
  /**
   * El orden PROPIO de cada disciplina que prendió el toggle del paso
   * Formato (`orders`, `Wizard`), por ÍNDICE de asiento (F1, ver
   * `toggleOwnOrder`/`seedOrderFrom` más arriba) -- `Partial`, a diferencia
   * de los cuatro `Record` de arriba: "ninguna disciplina tiene orden
   * propio" (entrada ausente) es el estado NORMAL del 100% de los torneos de
   * hoy, no un olvido.
   *
   * OBLIGATORIO igual que los cuatro anteriores (F8, dos jueces ciegos,
   * `37b225b..d33377a`): tenía un default `= {}` que dejaba a `tsc` en
   * silencio si alguien sacaba el argumento del único call site de
   * producción (`Wizard`, `wizard.tsx`) -- exactamente el defecto que el
   * docblock de `fixedTeams`/`hasMasters` de arriba ya argumenta para SUS
   * cuatro parámetros: "olvidarlos en el sitio del submit es un error de
   * `tsc`, no un test que haya que escribir y mantener". Un `Partial`
   * obligatorio sigue sin forzar a nadie a rellenar las dos claves -- sólo a
   * escribir el argumento, aunque sea `{}` a propósito.
   */
  orders: Partial<Record<DisciplineKind, number[]>>,
): {
  name: string
  squadNames: string[]
  mySeatIndex: number | null
  config: SeasonConfig
  disciplines: Array<
    ReturnType<typeof buildDisciplines>[number] & {
      hasMasters?: boolean
      formatoDefault?: MatchdayFormat
      fixedTeams?: boolean
      seedOrder?: number[]
    }
  >
} {
  const seats = submitSeats(squad)
  const squadSize = seats.squadNames.length
  const first = picked[0]!

  return {
    name,
    ...seats,
    // Legado de `NewSeason`/`createTournament` (`db/season.ts`): ignorado en
    // cuanto `disciplines` llega, y el wizard SIEMPRE lo manda -- ver el
    // docblock de arriba.
    config: resizeConfig(configs[first], squadSize, pairSizes[first]),
    disciplines: picked.flatMap((kind) => {
      const pairSize = pairSizes[kind]
      const resized = resizeConfig(configs[kind], squadSize, pairSize)
      const extra =
        picked.length > 1
          ? {
              hasMasters: effectiveHasMasters(pairSize, hasMasters[kind]),
              formatoDefault: formatoDefault[kind],
            }
          : {}
      const ownOrder = orders[kind]
      // `seedOrder` sólo se agrega con 2+ disciplinas marcadas (F3, dos
      // jueces ciegos, `37b225b..d33377a`) -- MISMO gate que
      // `hasMasters`/`formatoDefault` arriba, `picked.length > 1`, y por la
      // MISMA razón: con una sola disciplina el paso Formato no dibuja el
      // checkbox de "orden propio" (`FormatoDeUnaDisciplina`, `label ===
      // null`), así que `orders[kind]` sólo puede ser una foto sobrante de
      // un momento en que SÍ había 2+ marcadas -- "un control que ya no se
      // ve no puede seguir mandando" (mismo comentario, dos líneas más
      // arriba). Gatear sólo en `ownOrder === undefined` (la versión de
      // antes de esta tarea) dejaba pasar justo ese sobrante: elegir Pádel +
      // FIFA, prender "orden propio" en Pádel, volver al paso 1 y destildar
      // FIFA deja un torneo de UNA sola disciplina (Pádel) con `seedOrder`
      // en el payload, tomando el camino nuevo en vez del de siempre.
      //
      // `seedOrderFrom` (WU1, arriba) traduce los ÍNDICES CRUDOS de
      // `ownOrder` a posiciones dentro de `seats.squadNames` -- WU5 (ronda 2
      // de revisión): el segundo argumento tiene que ser `squad.names`, EL
      // PLANTEL CRUDO, nunca `seats.squadNames` (ya reindexado). `ownOrder`
      // trae índices ORIGINALES sobre `squad.names` (los que `orders` usa en
      // todo momento, F1) -- traducirlos contra la versión YA achicada
      // correría a cada jugador un lugar de más apenas hubiera un blanco en
      // el medio (`filled === floor`, un estado normal, no un error).
      const seedOrder =
        picked.length > 1 && ownOrder !== undefined ? { seedOrder: seedOrderFrom(ownOrder, squad.names) } : {}
      return buildDisciplines([kind], resized, pairSize).map((row) => ({
        ...row,
        ...extra,
        fixedTeams: effectiveFixedTeams(pairSize, fixedTeams[kind]),
        ...seedOrder,
      }))
    }),
  }
}

/**
 * La config por defecto para un plantel de este tamaño.
 *
 * Sale de `defaultConfig` y no de la lista del handoff (§6 paso 4, "Defaults
 * 10 · 7 · 5 · 3 · 2 · 1"). Los dos documentos no coinciden —el handoff también
 * dice 12 fechas y 9 que cuentan, y el spec §2.1 dice 10 y 8— y manda el que
 * está implementado, testeado, validado por `validateConfig` y usado por el
 * seed y por todos los tests contra la base. Un wizard que produjera otros
 * defaults haría que ninguna captura de pantalla coincida con ningún fixture.
 *
 * `sideSize` es OBLIGATORIO (lección #3994, cerrada acá tras W69 → W76 →
 * W83): era opcional y caía en silencio a la curva de parejas — el mismo
 * default que "el caso feliz" (pádel) necesita, así que ningún call site
 * que se olvidara de pasarlo se veía roto en ese caso, y sólo se notaba con
 * una disciplina de a uno (S75). Con el parámetro obligatorio, olvidarlo es
 * un error de `tsc` en cada call site — el compilador los señala a todos,
 * no sólo al que un verify-report mida esta vez.
 */
export function configFor(squadSize: number, sideSize: SideSize): SeasonConfig {
  return defaultConfig(squadSize, sideSize)
}

/**
 * Rehace `points` cuando cambia el tamaño del plantel, **pisando** lo que el
 * admin hubiera tocado. No es una pérdida: con otro plantel hace falta otra
 * cantidad de valores, y una lista de 4 en un plantel de 12 es inválida.
 *
 * `sideSize` viaja igual que en `configFor`, y por la misma razón: OBLIGATORIO
 * (#3994) desde que dejar de pasarlo daba la curva de parejas en silencio.
 */
export function resizeConfig(config: SeasonConfig, squadSize: number, sideSize: SideSize): SeasonConfig {
  if (config.squadSize === squadSize) return config
  return { ...config, squadSize, points: configFor(squadSize, sideSize).points }
}

/**
 * `resizeConfig` aplicado a las DOS disciplinas del wizard a la vez, cada
 * una con SU PROPIO `pairSize` (Task 5, docs/plan-arquitectura-de-paginas.md
 * §2.4, §6). Reemplaza a lo que antes hacía `configSideSize` + una sola
 * llamada a `resizeConfig`: hasta la Task 5 el paso 4 editaba UNA config
 * compartida por todas las disciplinas marcadas, así que agrandar o achicar
 * el plantel sólo tenía UNA curva que poner al día. Ahora cada disciplina
 * tiene la suya —incluso la que no está marcada, mismo criterio que
 * `pairSizes` en `wizard.tsx`, que también sigue las dos aunque el torneo
 * sólo use una—, así que `setSquad` (`wizard.tsx`) tiene que ponerlas al día
 * A LAS DOS, cada una contra su propio `pairSize`.
 */
export function resizeConfigs(
  configs: Record<DisciplineKind, SeasonConfig>,
  squadSize: number,
  pairSizes: Record<DisciplineKind, SideSize>,
): Record<DisciplineKind, SeasonConfig> {
  const next = { ...configs }
  for (const kind of DISCIPLINE_KINDS) next[kind] = resizeConfig(configs[kind], squadSize, pairSizes[kind])
  return next
}

/**
 * La config con la que arranca (o se rehace) UNA disciplina: `configFor`
 * para su plantel y su `pairSize`, con la forma de marcador de SU `kind` ya
 * aplicada (`disciplineProfile`) — nunca la de otra.
 *
 * Reemplaza a `configForPairSizeChange` (Task 5): aquella función existía
 * por la ambigüedad de C29/W76/W83 — UNA config compartida por 2+
 * disciplinas no podía rehacerse sin arriesgar la curva de la otra, así que
 * sólo lo hacía con `picked.length === 1`. Con una config GENUINAMENTE por
 * disciplina esa ambigüedad no existe más: tocar "Lados" para `kind` rehace
 * SU config siempre, marcada sola o junto a otra — nunca toca la de la
 * disciplina vecina, porque cada una vive en su propia entrada del
 * `Record`.
 *
 * Aplica `disciplineProfile` acá adentro (y no al leer `matchFormat` más
 * tarde, como hacía `buildDisciplines` con la config compartida): con una
 * config por disciplina no hace falta esperar al submit para saber si es
 * FIFA — se sabe en el momento en que esta función arma la fila, y
 * `steppersFor`/el resumen del paso 5 pueden leer `matchFormat.openScore`
 * directo, sin envolver de nuevo.
 */
export function freshDisciplineConfig(
  kind: DisciplineKind,
  squadSize: number,
  pairSize: SideSize,
): SeasonConfig {
  return disciplineProfile(kind, configFor(squadSize, pairSize)).config
}

/**
 * El Masters con el que arranca el control de una disciplina (decisión
 * #4029): `false` con `pairSize` 1 —`disciplines_has_masters_needs_pair`
 * (0053) lo rechaza siempre ahí—, `true` si no. El mismo automático que
 * `createSeason`/`addDiscipline` (`db/season.ts`/`db/discipline.ts`) aplican
 * cuando el spec no manda `hasMasters` — acá es el valor INICIAL del
 * checkbox, no una escritura.
 */
export function automaticHasMasters(pairSize: SideSize): boolean {
  return pairSize !== 1
}

/**
 * El Masters que de verdad se manda para una disciplina, sea lo que sea que
 * el checkbox tenga guardado: `false` siempre que `pairSize` sea 1.
 *
 * `disciplines_has_masters_needs_pair` (0053) rechaza `has_masters = true`
 * con `pair_size = 1` sin excepción. El checkbox del paso 4 se deshabilita
 * en pantalla para una disciplina de a uno (mismo criterio que `Formato`,
 * Ajustes), pero deshabilitado no es lo mismo que ausente: el estado que
 * queda atrás (de cuando esa disciplina tenía `pairSize` 2, antes de que el
 * admin tocara "Lados" en el paso 1) puede seguir en `true`. Este guard es
 * la puerta de salida real — vive en `newTournamentPayload`, no confía en
 * que el control quede siempre deshabilitado a tiempo.
 */
export function effectiveHasMasters(pairSize: SideSize, hasMasters: boolean): boolean {
  return pairSize === 1 ? false : hasMasters
}

/**
 * Equipos fijos que de verdad se manda para una disciplina, sea lo que sea
 * que el checkbox tenga guardado: `false` siempre que `pairSize` sea 1.
 *
 * `disciplines_fixed_teams_needs_pair` (0077) rechaza `fixed_teams = true`
 * con `pair_size = 1` sin excepción. El checkbox del paso 4 se deshabilita en
 * pantalla para una disciplina de a uno (mismo criterio que Masters), pero
 * deshabilitado no es lo mismo que ausente: el estado que queda atrás (de
 * cuando esa disciplina tenía `pairSize` 2) puede seguir en `true`. Mismo
 * guard que `effectiveHasMasters`, arriba, y por el mismo motivo.
 */
export function effectiveFixedTeams(pairSize: SideSize, fixedTeams: boolean): boolean {
  return pairSize === 1 ? false : fixedTeams
}

/**
 * Las tres opciones legales de "Formato de las fechas" (decisión ya tomada,
 * docs/tipos-de-torneo.md §2.5): `ROUND_ROBIN`, y `GROUPS_KNOCKOUT` con 2 o
 * con 4 grupos, siempre `qualifiersPerGroup: 2`. `groups: 1` no es una
 * opción acá aunque `matchdays_formato_kind` (0040) lo acepte:
 * `disciplines_formato_default_kind` (0074) lo rechaza a propósito porque
 * `offerableFormats` (`core/knockout.ts:531`) nunca lo ofrece para ningún
 * `sides` — "1 grupo + llave" no ahorra nada sobre un round robin liso.
 *
 * Es un CRITERIO, no un layout: cuáles opciones son legalmente ofrecibles
 * para una disciplina, respaldado por ese CHECK de la base. Fix round 1
 * (revisión de la Task 5): esta lista nació duplicada acá y en
 * `ajustes/formato-default.tsx` (`OPCIONES`, módulo-privada), con un test de
 * cada lado comparando contra un literal escrito a mano en vez de contra la
 * OTRA lista — nada en el repo fallaba si las dos divergían. Es la MISMA
 * clase de error que ya tiene nombre en este código: el docblock de
 * `steppersFor`/`Formato` (`ajustes/formato.tsx`) dice "copiar el criterio
 * en vez de compartirlo es lo que produjo W63". Vive acá — junto a
 * `steppersFor`, que ya comparte el mismo tipo de criterio con Ajustes — y
 * `formato-default.tsx` la IMPORTA en vez de declarar la suya.
 */
export const FORMATO_DEFAULT_OPTIONS: MatchdayFormat[] = [
  { kind: 'ROUND_ROBIN' },
  { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 },
  { kind: 'GROUPS_KNOCKOUT', groups: 4, qualifiersPerGroup: 2 },
]

/**
 * `key` estable para `FORMATO_DEFAULT_OPTIONS`, no atada a la copia:
 * `matchdayFormatLabel(candidato)` (`app/format.ts`) es texto para HUMANOS y
 * puede cambiar — mismo motivo por el que `SelectorDeFormato`
 * (`fechas/[n]/armado.tsx`) usa `candidato.groups` como `key` y no el
 * label. `FORMATO_DEFAULT_OPTIONS` es una lista fija de tres, así que basta
 * con la identidad estructural del `kind`/`groups`.
 */
export function formatoDefaultKey(formato: MatchdayFormat): string {
  return formato.kind === 'ROUND_ROBIN' ? 'ROUND_ROBIN' : `GROUPS_${formato.groups}`
}

/** ¿Es la misma opción de `FORMATO_DEFAULT_OPTIONS`? Compara por `kind` + `groups`, no por identidad de objeto. */
export function isSameFormatoDefault(a: MatchdayFormat, b: MatchdayFormat): boolean {
  if (a.kind !== b.kind) return false
  return a.kind === 'ROUND_ROBIN' || (b.kind === 'GROUPS_KNOCKOUT' && a.groups === b.groups)
}

/**
 * Los errores del paso 4, para UNA disciplina.
 *
 * Los de puntos NO se escriben acá: salen de `pointsErrors` y de
 * `pointsCountError`, las mismas funciones que corre `validateConfig` antes de
 * escribir. Esta pantalla tenía su propia copia y se separaron — cuando el 0
 * pasó a ser legal, el paso 4 siguió rechazándolo y trababa el "Continuar"
 * sobre un valor que el stepper te dejaba elegir. Con una sola
 * implementación eso no puede volver a pasar.
 *
 * `sideSize` es obligatorio por lo mismo que en `configFor`/`resizeConfig`
 * (#3994): con un default, los call sites que dejen de pasarlo validan
 * contra parejas en silencio, que es el bug de esta familia entera. Desde
 * la Task 5 esta función corre UNA VEZ POR DISCIPLINA (`wizard.tsx`), con
 * el `pairSize` propio de esa disciplina — ya no hay un "efectivo" de una
 * curva compartida que calcular (`configSideSize`, borrada en esta Task).
 *
 * `pointsErrors` mira los VALORES y `pointsCountError` la CANTIDAD.
 * `changePairSize` (`wizard.tsx`) rehace la config entera al tocar "Lados"
 * (`freshDisciplineConfig`), así que la cantidad de puntos SIEMPRE
 * corresponde apenas cambia — a diferencia de antes de esta Task, ya no
 * hace falta un aviso para el caso en que dejó de corresponder en silencio
 * (W88/W90): no hay forma de llegar a ese estado con una config genuinamente
 * propia por disciplina.
 *
 * La de `countBestOf` sí es propia, y a propósito: es la frase corta del
 * handoff, que en el wizard entra al lado del stepper que la causó.
 */
export function formatErrors(config: SeasonConfig, sideSize: SideSize): string[] {
  const errors: string[] = []

  const countError = pointsCountError(config.squadSize, sideSize, config.points.length)
  if (countError !== null) errors.push(countError)
  errors.push(...pointsErrors(config.points))

  if (config.countBestOf > config.regularMatchdays) {
    errors.push('No pueden contar más fechas de las que se juegan.')
  }
  return errors
}

/**
 * El resumen del paso 5, en el orden del handoff.
 *
 * `picked` no es decorativo: la fila "Formato" decía "1 set a 4 games" leyendo
 * la config compartida, y desde que una liga de FIFA nace con marcador de goles
 * esa frase describe la mitad pádel del torneo y MIENTE sobre la otra mitad.
 * Con una sola disciplina el resumen dice exactamente lo mismo que siempre —el
 * prefijo aparece recién cuando hay dos cosas distintas que nombrar.
 *
 * Esa regla la escribe `formatsLabel` (`core/narrate.ts`) para "Formato", y
 * desde la Task 5 la aplica ACÁ TAMBIÉN `perDisciplineValue` para "Puntos",
 * "Fechas" y "Desempate": con `configs` genuinamente por disciplina esos
 * tres números pueden ser distintos entre Pádel y FIFA, y mostrar sólo uno
 * de los dos sería exactamente la misma mentira que Reglas y Ajustes ya
 * tuvieron con "Formato" (W64) — tres copias del mismo problema es como
 * nació esa ronda, y ésta es la cuarta fila que podía repetirlo si no se
 * corregía acá.
 *
 * Ya no hace falta pasar cada `config` por `disciplineProfile` acá: desde
 * que `configs[kind]` sale de `freshDisciplineConfig` (Task 5), su
 * `matchFormat.openScore` ya viene con la forma de SU `kind` aplicada.
 */
export function summaryOf(
  name: string,
  names: readonly string[],
  configs: Record<DisciplineKind, SeasonConfig>,
  picked: readonly DisciplineKind[],
): Array<{ key: string; value: string }> {
  const perDisciplineValue = (value: (config: SeasonConfig) => string): string =>
    picked.length <= 1
      ? value(configs[picked[0]!])
      : picked.map((kind) => `${DISCIPLINE_LABELS[kind]}: ${value(configs[kind])}`).join(' · ')

  return [
    { key: 'Nombre', value: name },
    { key: 'Jugadores', value: String(filledCount(names)) },
    {
      key: 'Formato',
      value: formatsLabel(
        picked.map((kind) => ({ label: DISCIPLINE_LABELS[kind], matchFormat: configs[kind].matchFormat })),
      ),
    },
    { key: 'Puntos', value: perDisciplineValue((config) => config.points.join(' · ')) },
    { key: 'Fechas', value: perDisciplineValue((config) => String(config.regularMatchdays)) },
    { key: 'Desempate', value: perDisciplineValue((config) => `cada ${config.tiebreakSnapshotEvery} fechas`) },
  ]
}
