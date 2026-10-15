/**
 * La lógica de plantel y payload del alta de torneo, sin React.
 *
 * Vive aparte de la pantalla (`crear.tsx`) para poder testearla en la suite
 * unitaria, sin DOM y sin base. Es lo que quedó del wizard de cinco pasos
 * (borrado): lo que usa el wizard de hoy y lo que ejercitan los tests de base.
 */
import {
  defaultConfig,
  disciplineProfile,
  minSquadFor,
  pointsCountError,
  pointsErrors,
  SPORTS,
  type MatchdayFormat,
  type SeasonConfig,
  type SideSize,
} from '@/core'

/**
 * Las disciplinas del payload del wizard anterior: `PADEL` y `FIFA`, literal.
 *
 * Congelada a propósito, ya NO es `TOURNAMENT_SPORTS`: los tests de base la
 * usan (vía `buildDisciplines`/`newTournamentPayload`) como constructor de
 * `createSeason` -- `db/season-multi-discipline.db.test.ts`,
 * `db/public-formats.db.test.ts`, `db/open-score-screens.db.test.ts`. Si
 * siguiera al registro, sumar un deporte (PING_PONG) volvería obligatorio
 * `Record<DisciplineKind, …>` en esos tests, que ejercitan `createSeason` y no
 * se tocan. Los deportes nuevos se arman desde la ficha, no desde acá.
 */
export const DISCIPLINE_KINDS = ['PADEL', 'FIFA'] as const
export type DisciplineKind = (typeof DISCIPLINE_KINDS)[number]
export const DISCIPLINE_LABELS: Record<DisciplineKind, string> = {
  PADEL: SPORTS.PADEL.label,
  FIFA: SPORTS.FIFA.label,
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
 * ninguna disciplina) — pero el wizard llama a esta función en CADA
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
 * paso 3 usaba ese índice tal cual para mover filas. Cortando sólo la cola, el
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
 * Agrega una fila en blanco al final del plantel -- "+ Agregar jugador".
 * Una fila en blanco todavía no es un asiento: no corre ningún índice.
 */
export function addBlankSeat(squad: Squad): Squad {
  return { ...squad, names: [...squad.names, ''] }
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
 * pasar por la baja del asiento, uno vaciado a mano, o uno fuera de rango) se
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
  // índice repetido -- hoy inalcanzable, el orden propio sólo se arma con
  // altas, bajas y swaps que preservan la unicidad por construcción. Se queda
  // como red barata para cualquier otro caller de esta función exportada, no
  // porque haya un camino de producción que hoy la dispare.
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
 * El payload que armaba el wizard de cinco pasos para `createTournament`
 * (`./actions`). El wizard de hoy (`crear.tsx`) ya no lo usa; queda porque los
 * tests de base lo ejercitan como constructor de `createSeason`
 * (`db/season-multi-discipline.db.test.ts`).
 *
 * `squadSize` sale del plantel REALMENTE cargado (`submitSeats(squad)`), no del
 * que traía cada `configs[kind]`: `resizeConfig` (por disciplina) lo pone al
 * día antes de construir la fila.
 *
 * `hasMasters`/`formatoDefault`/`seedOrder` sólo se agregan a la fila cuando
 * hay 2+ disciplinas (`picked.length > 1`): con una sola el payload es
 * EXACTAMENTE el de siempre y `createSeason` cae al automático (decisión
 * #4029) y al default de columna (ROUND_ROBIN, 0074). `fixedTeams` viaja
 * siempre. `effectiveHasMasters`/`effectiveFixedTeams` son las puertas de
 * salida reales: una disciplina de a uno no puede tener Masters
 * (`disciplines_has_masters_needs_pair`, 0053) ni equipos fijos
 * (`disciplines_fixed_teams_needs_pair`, 0077) pase lo que diga el control.
 *
 * `orders` es el orden PROPIO de cada disciplina, por ÍNDICE de asiento (F1,
 * ver `seedOrderFrom`) -- `Partial`: "ninguna disciplina tiene orden propio"
 * es el estado NORMAL. Un OBJETO con las nueve claves obligatorias y no
 * posicionales (WU6): `hasMasters` y `fixedTeams` comparten tipo, y swapearlos
 * no rompe `tsc` -- con claves nombradas el swap es un cambio visible.
 */
export interface NewTournamentPayloadInput {
  name: string
  squad: Squad
  configs: Record<DisciplineKind, SeasonConfig>
  picked: readonly DisciplineKind[]
  pairSizes: Record<DisciplineKind, SideSize>
  hasMasters: Record<DisciplineKind, boolean>
  formatoDefault: Record<DisciplineKind, MatchdayFormat>
  fixedTeams: Record<DisciplineKind, boolean>
  orders: Partial<Record<DisciplineKind, number[]>>
}

export function newTournamentPayload({
  name,
  squad,
  configs,
  picked,
  pairSizes,
  hasMasters,
  formatoDefault,
  fixedTeams,
  orders,
}: NewTournamentPayloadInput): {
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
 * contra parejas en silencio, que es el bug de esta familia entera. Corre
 * UNA VEZ POR DISCIPLINA, con el `pairSize` propio de esa disciplina — ya no
 * hay un "efectivo" de una curva compartida que calcular.
 *
 * `pointsErrors` mira los VALORES y `pointsCountError` la CANTIDAD.
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
