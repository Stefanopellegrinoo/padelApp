/**
 * La lógica del wizard, sin React.
 *
 * Vive aparte de `wizard.tsx` para poder testearla en la suite unitaria, sin
 * DOM y sin base. Es la única parte del paso a paso donde se puede equivocar
 * algo: el resto es dibujar.
 */
import {
  MAX_PLAYERS,
  defaultConfig,
  disciplineProfile,
  formatsLabel,
  minSquadFor,
  pointsCountError,
  pointsErrors,
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
 * Toma una lista de formatos y no un `openScore` suelto porque las dos
 * pantallas que dibujan estos steppers preguntan cosas distintas: Ajustes edita
 * la config de UNA disciplina, y el paso 4 del wizard edita la de la TEMPORADA,
 * compartida por todas las marcadas. Con Pádel y FIFA marcados esos dos
 * steppers siguen gobernando la mitad de pádel, así que se van sólo cuando
 * NINGUNA de las disciplinas usa sets. Una función y no dos filtros: W63 nació
 * exactamente de que Ajustes filtrara y el wizard no.
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
 * Comparten los PUNTOS, las fechas y el plantel —que es lo que el paso 4
 * pregunta—, y cada una nace con la forma de marcador de su disciplina
 * (`disciplineProfile`, PR20 rebanada D2). Hasta acá compartían la config
 * entera y una liga de FIFA nacía siendo pádel con otro nombre: sin marcador
 * abierto y sin empates, o sea sin poder cargar ni un `3-1` ni un `0-0`. No es
 * una preferencia que el wizard pueda preguntar más adelante: `allows_draw` no
 * está en el grant de UPDATE de `disciplines` (`0015_disciplines.sql:70`), así
 * que la disciplina que nace sin empates no los tiene nunca más.
 *
 * `pairSize` —FIFA es 1v1 Y 2v2, decisión de producto #5— es OPCIONAL y sin
 * default acá a propósito: quien no lo pasa arma parejas, como siempre
 * (`addDiscipline`/`NewSeasonDiscipline` caen a 2 si no llega). Sólo se agrega
 * al resultado cuando se pasa —el pádel de hoy no gana una clave `pairSize`
 * que antes no tenía, que rompería el `toEqual` de sus propios tests.
 * Rebanada F (decisión `decisions/alcance-desbloqueo-1v1-pr21`) es quien por
 * fin lo pasa, desde el radio "Lados".
 *
 * Quien quiera cambiar los puntos o las fechas de una disciplina lo hace
 * después en Ajustes → Formato (`updateDisciplineConfig`, PR6).
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
 * El plantel es uno solo para toda la temporada (docs/tipos-de-torneo.md
 * §3.3): un torneo con pádel (parejas, piso 4) y FIFA (de a uno, piso 2)
 * necesita 4. Elegir el MÍNIMO dejaría armar un torneo cuyo pádel no puede
 * jugar ni una sola fecha — el máximo es lo que garantiza que la disciplina
 * más exigente también entre.
 */
export function effectiveFloor(sideSizes: readonly SideSize[]): number {
  return Math.max(...sideSizes.map(minSquadFor))
}

/**
 * El aviso del paso 2, o `null` si se puede continuar.
 *
 * `floor` es el piso EFECTIVO del plantel compartido (`effectiveFloor`), no
 * un número fijo: con sólo FIFA arranca en 2, con pádel (solo o junto a FIFA)
 * en 4. Esta función no elige el piso, sólo lo aplica — quien arma el estado
 * del wizard es quien sabe qué disciplinas están marcadas.
 *
 * El plantel se carga **par**: la app agrega un invitado cuando una FECHA da
 * impar, que es otra cosa.
 */
export function squadWarning(names: readonly string[], floor: number): string | null {
  const filled = filledCount(names)
  if (filled < floor) {
    const missing = floor - filled
    return missing === 1
      ? `Falta 1 nombre. El plantel arranca en ${floor}.`
      : `Faltan ${missing} nombres. El plantel arranca en ${floor}.`
  }
  if (filled > MAX_PLAYERS) {
    return `Son ${filled} y el plantel llega hasta ${MAX_PLAYERS}.`
  }
  if (filled % 2 !== 0) {
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

/** Sube o baja una fila del orden inicial, arrastrando el asiento propio si es una de las dos. */
export function moveSeat({ names, mySeat }: Squad, from: number, to: number): Squad {
  if (to < 0 || to >= names.length) return { names, mySeat }
  const next = [...names]
  next[from] = names[to]!
  next[to] = names[from]!
  return { names: next, mySeat: mySeat === from ? to : mySeat === to ? from : mySeat }
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
 * del que traía `config`: la config del paso 4 puede quedar desactualizada
 * si el admin agrega o saca nombres después de tocarla, y `buildDisciplines`
 * tiene que ver el tamaño real para que la curva de puntos sea la correcta.
 *
 * `pairSize` es el punto de unión de la Rebanada F: viaja tal cual hasta
 * `buildDisciplines`, así que elegir "Individual" llega hasta ACÁ, en el
 * payload real que cruza al server action (#3957 — se pinchan los
 * argumentos, no que la función interna acepte el parámetro).
 *
 * OBLIGATORIO acá y no opcional como en `buildDisciplines`/`newDisciplineSpec`:
 * este único caller (`Wizard`) SIEMPRE tiene un `pairSize` (nace en 2, el
 * `useState` no es `undefined` nunca), así que dejarlo opcional sólo abriría
 * la puerta a olvidarlo en el sitio del submit sin que nada lo marque. Con el
 * parámetro obligatorio, olvidarlo es un error de `tsc`, no un test que haya
 * que escribir y mantener — más fuerte que cualquier test (verificado con
 * mutación: sacar el argumento en `wizard.tsx` rompe `npm run typecheck`).
 *
 * C29 (verify-report-pr21, #4004): acá adentro `config` viaja hacia DOS
 * lugares con reglas DISTINTAS, y antes de este fix era el MISMO objeto para
 * los dos. `seasons.config` es el legado (`db/season.ts: createSeason`,
 * comentario "siempre pádel, sideSize=2 fijo, nunca disciplina-specific") y
 * `createSeason` lo valida con `sideSize` HARDCODEADO en 2. Con
 * `pairSize=1`, `builtConfig.points` trae la curva de la decisión #3963 (8-12
 * lados) — pasa la validación de la disciplina y rompe la del legado, que
 * exige la MITAD de esos valores. No existe un `config` que pase las dos: el
 * legado necesita su PROPIA curva, siempre de a dos, sin importar qué eligió
 * "Lados". El plantel llega siempre par acá (`squadWarning`, paso 2), así que
 * esa curva de a dos siempre existe.
 *
 * W69 (tanda de cierre, #4006) + W76/decisión #4017 (verify-report-pr21-cierre,
 * #4016): "Lados" ERA un solo control para las disciplinas marcadas del paso
 * 4 — sólo era inequívoco con UNA marcada, así que con dos o más se ignoraba
 * y todas nacían en 2. Eso evitaba la herencia cruzada (REQ-D2-1) pero abría
 * otra: la pantalla podía mostrar "Individual" tildado sin que el dato lo
 * reflejara. El wizard ahora trae un selector POR disciplina (`pairSizes`,
 * uno por cada `DisciplineKind`), así que acá cada disciplina arma SU PROPIA
 * config con SU PROPIA curva — `picked.length` ya no importa: dos
 * disciplinas nunca comparten `pairSize` a menos que el admin haya elegido
 * lo mismo para las dos a propósito. `config` (el que entra y el que se
 * devuelve como legado) sigue siendo SIEMPRE la curva de a dos (C29): el
 * paso 4 ya no tiene un control que la cambie, ahora que "Lados" bajó al
 * paso 1.
 *
 * W83 (verify-report-pre-contract, #4026): con UNA sola disciplina marcada,
 * `pairSize !== 2` pisaba `points` SIEMPRE con el default de la decisión
 * #3963, sin mirar si `config` ya traía la curva editada a mano —
 * `changePairSize` (`wizard.tsx`) dejó de rehacer `config` cuando se cerró
 * W76, así que no había ninguna forma de configurar la tabla de puntos de un
 * 1v1 en el wizard. `soleCurveMatches` es lo que confía en la edición: sólo
 * cuando queda UNA disciplina Y el LARGO de lo que trae `builtConfig.points`
 * ya es el que le corresponde a esa disciplina (`configForPairSizeChange`,
 * en `wizard.tsx`, es quien deja a `config` en esa forma apenas cambia
 * "Lados"). El chequeo de largo, y no `picked.length === 1` a secas, es el
 * que evita reabrir la MISMA familia por otra puerta: si el admin marcó dos
 * disciplinas y después destildó una sin volver a tocar "Lados", `config`
 * puede quedar con la forma legado (de a dos) mientras la única disciplina
 * que sobrevive es de a uno — sin el chequeo de largo eso guardaría un
 * `points` de largo inválido en vez del default seguro.
 */
export function newTournamentPayload(
  name: string,
  squad: Squad,
  config: SeasonConfig,
  picked: readonly DisciplineKind[],
  pairSizes: Record<DisciplineKind, SideSize>,
): {
  name: string
  squadNames: string[]
  mySeatIndex: number | null
  config: SeasonConfig
  disciplines: ReturnType<typeof buildDisciplines>
} {
  const seats = submitSeats(squad)
  const squadSize = seats.squadNames.length
  const builtConfig = { ...config, squadSize }

  return {
    name,
    ...seats,
    config: builtConfig,
    disciplines: picked.flatMap((kind) => {
      const pairSize = pairSizes[kind]
      const soleCurveMatches =
        picked.length === 1 && builtConfig.points.length === configFor(squadSize, pairSize).points.length
      const disciplineConfig: SeasonConfig =
        pairSize === 2 || soleCurveMatches
          ? builtConfig
          : { ...builtConfig, points: configFor(squadSize, pairSize).points }
      return buildDisciplines([kind], disciplineConfig, pairSize)
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
 * una disciplina de a uno (S75, y de nuevo en `wizard.tsx` tres veces:
 * `configSideSize`, acá abajo). Con el parámetro obligatorio, olvidarlo es
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
 * El `sideSize` que le corresponde a `config` — la curva compartida del
 * paso 4, C29 — en el estado ACTUAL del wizard (disciplinas marcadas +
 * lados elegidos), sin que haya cambiado nada todavía.
 *
 * Nace de la corrección #4030 sobre W83: al volver `sideSize` obligatorio en
 * `configFor`/`resizeConfig` (#3994), el compilador marcó TRES call sites en
 * `wizard.tsx` que hasta entonces dejaban que `sideSize` cayera a `undefined`
 * (parejas) en silencio — el estado inicial de `config`, `setSquad`
 * (agrandar/achicar el plantel) y "Usar los defaults". Los tres necesitan
 * la MISMA pregunta ("¿qué representa `config` ahora mismo?"), así que viven
 * de esta única función y no de tres respuestas escritas a mano.
 *
 * Misma regla que `configForPairSizeChange`, que resuelve la pregunta
 * hermana ("¿qué pasa a representar `config` cuando ESO cambia"): sin
 * ambigüedad (UNA sola disciplina marcada) es SU `pairSize`; con 2+ sigue
 * siendo la curva legado de a dos (C29) — nadie más la mueve.
 */
export function configSideSize(
  picked: readonly DisciplineKind[],
  pairSizes: Record<DisciplineKind, SideSize>,
): SideSize {
  return picked.length === 1 ? pairSizes[picked[0]!] : 2
}

/**
 * El `config` que corresponde cuando el admin toca "Lados" para `kind`, o el
 * mismo `config` sin tocar si tocar ese radio no cambia nada de lo que se
 * edita en pantalla.
 *
 * Cierra W83 (verify-report-pre-contract, #4026), la TERCERA vez de la
 * familia W69 → W76 → W83: las tres son la pantalla prometiendo una curva
 * que la base no guarda, y las dos últimas las abrió el arreglo de la
 * anterior. Antes de `fe44255` (el fix de W76/#4017), con `picked.length ===
 * 1` cambiar "Lados" SÍ rehacía `config` (`setConfig(configFor(filled,
 * next))` vivía en `wizard.tsx`), así que el paso 4 mostraba la curva de la
 * ÚNICA disciplina marcada y lo que el admin editaba ahí era, literal, lo
 * que esa disciplina iba a guardar. El fix de W76 sacó esa rehecha ENTERA
 * —correcto para 2+ disciplinas, donde `config` tiene que quedarse siendo la
 * curva legado de a dos (C29) sin que ningún radio la mueva— pero se llevó
 * puesto el caso de UNA sola disciplina, que no tenía la ambigüedad que W76
 * vino a resolver.
 *
 * La condición es la misma que la causa: `config` sólo puede representar SIN
 * AMBIGÜEDAD la curva de una disciplina puntual cuando hay UNA sola marcada.
 * Con 2+, sigue siendo la curva legado — tocar "Lados" ahí no la mueve, que
 * es lo que #4017 arregló y no hay que volver a romper.
 */
export function configForPairSizeChange(
  config: SeasonConfig,
  squadSize: number,
  picked: readonly DisciplineKind[],
  next: SideSize,
): SeasonConfig {
  return picked.length === 1 ? configFor(squadSize, next) : config
}

/**
 * Los errores del paso 4.
 *
 * Los de puntos NO se escriben acá: salen de `pointsErrors` y de
 * `pointsCountError`, las mismas funciones que corre `validateConfig` antes de
 * escribir. Esta pantalla tenía su propia copia y se separaron — cuando el 0
 * pasó a ser legal, el paso 4 siguió rechazándolo y trababa el "Continuar"
 * sobre un valor que el stepper te dejaba elegir. Con una sola
 * implementación eso no puede volver a pasar.
 *
 * `sideSize` es el EFECTIVO de la curva compartida —`configSideSize(picked,
 * pairSizes)`— y no un `2` literal (W88/W90, #4034). Es obligatorio por lo
 * mismo que en `configFor`/`resizeConfig` (#3994): con un default, los call
 * sites que dejen de pasarlo validan contra parejas en silencio, que es el
 * bug de esta familia entera.
 *
 * `pointsErrors` mira los VALORES y `pointsCountError` la CANTIDAD. Faltaba
 * la segunda, y es la única que cambia cuando el admin marca o desmarca
 * disciplinas: `onToggle` no rehace `config` a propósito (con 2+ marcadas no
 * debe, C29/W76), así que la curva editada podía dejar de corresponder sin
 * que nada lo dijera. Medido en #4034: la pantalla mostraba `[20,12,6,2]` y
 * la base guardaba `[10,7,5,3,2,1,0,0]`. La salida ya existía —"Usar los
 * defaults", `wizard.tsx:698`, que rehace la curva con `configSideSize`—;
 * lo que faltaba era decirle al admin que la necesitaba.
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
 * Esa regla la escribe `formatsLabel` (`core/narrate.ts`) y no este archivo:
 * Reglas y Ajustes tenían el mismo problema con los mismos datos (W64)
 * y tres copias de la misma frase es como nació W64.
 */
export function summaryOf(
  name: string,
  names: readonly string[],
  config: SeasonConfig,
  picked: readonly DisciplineKind[],
): Array<{ key: string; value: string }> {
  return [
    { key: 'Nombre', value: name },
    { key: 'Jugadores', value: String(filledCount(names)) },
    {
      key: 'Formato',
      value: formatsLabel(
        picked.map((kind) => ({
          label: DISCIPLINE_LABELS[kind],
          matchFormat: disciplineProfile(kind, config).config.matchFormat,
        })),
      ),
    },
    { key: 'Puntos', value: config.points.join(' · ') },
    { key: 'Fechas', value: String(config.regularMatchdays) },
    { key: 'Desempate', value: `cada ${config.tiebreakSnapshotEvery} fechas` },
  ]
}
