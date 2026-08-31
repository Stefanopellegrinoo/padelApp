import { MASTERS_MATCHES, MASTERS_SIZE, MAX_PLAYERS, MIN_PLAYERS, maxMatchesOf } from './constants'
import { thirdPlaceByGroupTable } from './knockout'
import { usesSetsDiff } from './standings'
import type { DisciplineShape, MatchFormat, MatchResult, SeasonConfig } from './types'

/**
 * La etiqueta corta del formato: "1 set a 4 games", "3 sets a 4 games",
 * "Marcador de goles".
 *
 * La misma frase la mostraban tres pantallas con tres copias —Reglas, Ajustes
 * y el resumen del wizard—, y las tres decían "1 set a 4 games" sobre una
 * disciplina que se juega a goles. La de Ajustes además escribía "set" en
 * singular siempre, así que con `setsToWin: 3` decía "3 set a 4".
 */
export function formatLabel(format: MatchFormat): string {
  if (format.openScore) return 'Marcador de goles'
  const setWord = format.setsToWin === 1 ? '1 set' : `${format.setsToWin} sets`
  return `${setWord} a ${format.gamesPerSet} games`
}

/**
 * La línea de "formato de partido" de un TORNEO, que puede tener más de una
 * disciplina y —desde PR20 rebanada D2— más de un formato.
 *
 * W64: hasta D2 todas las disciplinas de una
 * temporada compartían `matchFormat`, así que una sola frase era verdad y
 * Reglas y Ajustes narraban `primaryDiscipline(header)` sin mentir. D2 hizo que
 * cada disciplina naciera con la forma de marcador de su `kind`, y ese mismo
 * día un torneo de pádel + FIFA pasó a decirle al grupo "1 set a 4 games" sobre
 * una mitad que se juega a goles.
 *
 * Se agrupa por FORMATO y no por disciplina: dos Pádel de la misma temporada
 * (que la app arma desde PR13) no son dos cosas que nombrar, y con un solo
 * formato la frase es exactamente la de siempre, sin prefijo. El prefijo
 * aparece recién cuando hay dos cosas distintas que decir — el mismo criterio
 * que ya usaba `summaryOf` en el paso 5 del wizard.
 *
 * El `label` de cada disciplina lo pone quien llama: acá adentro no vive el
 * nombre que la UI le da a un `kind`.
 */
export function formatsLabel(
  disciplines: readonly { label: string; matchFormat: MatchFormat }[],
): string {
  const rows = disciplines.map((row) => ({ label: row.label, format: formatLabel(row.matchFormat) }))
  const distinct = [...new Set(rows.map((row) => row.format))]
  if (distinct.length <= 1) return distinct[0] ?? ''
  return rows.map((row) => `${row.label}: ${row.format}`).join(' · ')
}

export interface RulesSection {
  title: string
  body: string
}

/**
 * The rules page, told from the config AND the discipline's own shape.
 *
 * Everything the app can derive, it derives. If the admin wrote "the winner
 * takes 10 points" by hand and then changed the config to 12, the page would
 * be lying — and a rules page that disagrees with the app is worse than none.
 *
 * `shape` is required and has no default (same reasoning as
 * `MatchFormat.openScore`): `hasMasters`, `pairSize` and `allowsDraw` live on
 * `disciplines`, not in `config`, and a caller that forgot one would
 * otherwise narrate a discipline it does not have.
 *
 * The output is in Spanish because the group reads it.
 */
export function narrateRules(config: SeasonConfig, shape: DisciplineShape): RulesSection[] {
  const { points, matchFormat, regularMatchdays, countBestOf, tiebreakSnapshotEvery } = config
  const { hasMasters, pairSize, allowsDraw } = shape

  // El "8 y 12" es el piso/techo de PLANTEL (`squadSize`), que rige igual sin
  // importar `pairSize` (core/types.ts: "Even only when sideSize=2"). Lo que
  // SÍ varía por disciplina es el TOPE DE PARTIDOS de la fecha
  // (`maxMatchesOf`, W32): 15 de a dos, 36 de a uno por default. Se omite el
  // tramo cuando coincide con el default de pádel de HOY (pairSize=2, sin
  // `maxMatches` propio) para que esa única forma que existe en producción
  // siga leyendo carácter a carácter como siempre — con `maxMatches`
  // explícito o `pairSize=1` el tope pasa a nombrarse.
  const cap = maxMatchesOf(config, pairSize)
  const isTodaysPadelDefault = pairSize === 2 && config.maxMatches === undefined
  const capClause = isTodaysPadelDefault ? '' : `, con un tope de ${cap} partidos por fecha`

  // Con `pairSize === 1` no hay pareja que armar (core/pairing.ts:135-147:
  // "no defenders, no fixed pairs, no no-repeat rule") ni impar que resolver
  // con un invitado (core/types.ts: "with sideSize=1 an odd squad is
  // perfectly playable").
  const sides =
    pairSize === 1
      ? 'Cada uno juega por su cuenta y todos contra todos. '
      : 'Se arman parejas con todos y juegan todos contra todos. '
  const guestClause =
    pairSize === 1
      ? ''
      : ` Si el número de confirmados da impar, se suma un invitado para poder armar las parejas: ` +
        `el invitado no suma puntos, pero su compañero sí.`

  const pointsIntro =
    pairSize === 1
      ? 'Cada uno suma según dónde terminó: '
      : 'Los dos integrantes de una pareja suman siempre lo mismo, según dónde terminó la pareja: '
  const pointsMiddle =
    pairSize === 1
      ? 'Cuando juegan menos jugadores se usan los primeros valores, así ganar la fecha '
      : 'Cuando juegan menos parejas se usan los primeros valores, así ganar la fecha '

  const sections: RulesSection[] = [
    {
      title: 'El torneo',
      body:
        `El campeonato son ${regularMatchdays} fechas. Para cada jugador cuentan sus ` +
        `${countBestOf} mejores resultados, así que se puede faltar alguna vez sin quedar ` +
        `afuera de la pelea.` +
        (hasMasters ? ` El año cierra con un Masters entre los ${MASTERS_SIZE} mejores.` : ''),
    },
    {
      title: 'La fecha',
      body:
        `Cada fecha la juegan los que confirman, entre ${MIN_PLAYERS} y ${MAX_PLAYERS}${capClause}. ` +
        sides +
        describeFormat(matchFormat, allowsDraw) +
        guestClause,
    },
    {
      title: 'Los puntos',
      body:
        pointsIntro +
        points.map((value, index) => `${ordinal(index + 1)}, ${value}`).join('; ') +
        `. ${pointsMiddle}` +
        `siempre suma ${points[0] ?? 0}. ` +
        zeroTail(points),
    },
  ]

  // "Cómo se arman las parejas" narra tres mecanismos (ordenar la tabla,
  // primero-con-último, la regla de no repetir) que son falsos de punta a
  // punta con `pairSize === 1` (core/pairing.ts:135-147) — no hay pareja que
  // armar, así que no hay sección que mostrarla.
  if (pairSize !== 1) {
    sections.push({
      title: 'Cómo se arman las parejas',
      body:
        `Las parejas se arman con la tabla del campeonato: se ordena a los presentes por puntos ` +
        `y se junta al primero con el último, al segundo con el anteúltimo, y así. ` +
        `Ninguna pareja se repite dos fechas seguidas, con una sola excepción: la pareja que ` +
        `gana una fecha se mantiene junta en la siguiente. Después se separa, gane o pierda, ` +
        `así que toda pareja campeona juega exactamente 2 fechas junta.`,
    })
  }

  sections.push({
    title: 'Los desempates',
    body: describeTiebreak(matchFormat, tiebreakSnapshotEvery),
  })

  if (hasMasters) {
    sections.push({
      title: 'El Masters',
      body:
        `Los ${MASTERS_SIZE} mejores del año juegan una jornada final de ${MASTERS_MATCHES} partidos con ` +
        `compañeros rotativos: cada uno juega una vez con cada uno. Se cuentan los partidos ` +
        `ganados de forma individual. Si hay empate, gana el que llegó mejor posicionado en el ` +
        `ranking anual.`,
    })
  }

  return sections
}

/**
 * Cómo se llama lo que se cuenta adentro de un partido: **goles** con marcador
 * abierto, **games** cuando hay sets.
 *
 * Exportada porque no la usa sólo esta narración: la marca del campeón en la
 * lista de fechas (`championRecord`) cuenta la misma unidad. Eran dos copias
 * del mismo ternario y `championRecord` iba a ser la tercera — exactamente lo
 * que pasó con `setsToWin > 1` antes de que existiera `usesSetsDiff`.
 */
export function scoreUnit(format: MatchFormat): 'goles' | 'games' {
  return format.openScore ? 'goles' : 'games'
}

/**
 * El nombre del desempate, dicho como lo dice la cancha: *"diferencia de gol"*
 * en fútbol, *"diferencia de games"* en pádel.
 *
 * NO sale de `scoreUnit`: es "diferencia de **gol**", singular, y no
 * "diferencia de goles". Dos funciones y no una porque son dos frases
 * distintas, no una con un sustantivo adentro.
 */
export function scoreDiffLabel(format: MatchFormat): string {
  return format.openScore ? 'diferencia de gol' : 'diferencia de games'
}

function describeTiebreak(format: MatchFormat, snapshotEvery: number): string {
  const setStep = usesSetsDiff(format) ? `corta la diferencia de sets, después ` : ''
  // Con marcador abierto los "games" son goles y no hay escalón de sets que
  // narrar: es el MISMO criterio que corre `computeStandings`, contado.
  const scoreDiff = scoreDiffLabel(format)
  return (
    `En la tabla de la fecha, si dos parejas ganan la misma cantidad de partidos, ${setStep}` +
    `corta la ${scoreDiff}. Si empatan dos, el partido entre ellas lo decide; si empatan ` +
    `tres o más, el partido entre ellas no alcanza porque se ganan en círculo, y corta el orden de ` +
    `desempate. En la tabla del campeonato, si dos jugadores tienen los mismos puntos corta el orden ` +
    `de desempate: una lista del mejor al peor que arranca en el orden que consensuó el ` +
    `grupo y se actualiza cada ${snapshotEvery} fechas con la tabla de ese momento.`
  )
}

/**
 * `allowsDraw` sola y no el `DisciplineShape` entero: ésta es la única
 * llamadora (línea de abajo, dentro de `narrateRules`) y sólo necesita este
 * campo — la firma más chica que funciona.
 *
 * La cuarta mentira (design rev 2 §2): con marcador abierto y `allows_draw =
 * false`, la base rechaza un resultado en igualdad (`match_sets_no_draw`,
 * 0034) y esta frase igual prometía "Puede terminar empatado." Una página de
 * reglas que promete lo que la base va a rechazar es peor que no decir nada
 * — así que cuando no se puede, se dice la negativa, no se calla.
 */
function describeFormat(format: MatchFormat, allowsDraw: boolean): string {
  // Con marcador abierto no hay set, ni número al que llegar, ni tie-break:
  // hay dos números de goles y ahí termina el partido. Narrar el set de pádel
  // acá era describirle a los jugadores un formato que la app no juega.
  if (format.openScore) {
    const drawClause = allowsDraw
      ? 'Puede terminar empatado.'
      : 'Tiene que salir con un ganador: no puede quedar en igualdad.'
    return (
      `Cada partido se carga con el marcador de goles: los dos números como quedaron, sin ` +
      `un número al que haya que llegar. ${drawClause}`
    )
  }
  const setWord = format.setsToWin === 1 ? 'un set' : `${format.setsToWin} sets ganados`
  const tie = format.tieBreak ? ' con tie-break' : ''
  return `Cada partido se define a ${setWord} de ${format.gamesPerSet} games${tie}.`
}

/**
 * La frase de cierre de "Los puntos", que depende de si el torneo paga todos
 * los puestos o no.
 *
 * La versión anterior afirmaba siempre "Nadie suma 0 por presentarse", y desde
 * que el 0 es legal eso puede ser mentira. Esta página es la que leen los
 * jugadores para saber cómo funciona el campeonato: una regla que la config ya
 * no cumple es peor que no decir nada.
 */
function zeroTail(points: number[]): string {
  const paying = points.filter((value) => value > 0).length
  if (paying === points.length) {
    return 'Nadie suma 0 por presentarse: si salir último diera lo mismo que faltar, convendría faltar.'
  }
  if (paying === 1) {
    return 'De ahí para abajo no se suma nada: en esta temporada sólo puntúa el que gana la fecha.'
  }
  return `De ahí para abajo no se suma nada: en esta temporada sólo puntúan los primeros ${paying} puestos.`
}

/**
 * La línea de relato de la decisión #3990 (mitigación del costo aceptado en
 * #3979): cuando el tercer puesto no se jugó y salió de la tabla de grupos en
 * vez de la cancha, la fecha cerrada lo dice — dos jugadores se reparten 5 y
 * 3 puntos de campeonato (curva de pádel) por una razón que la app conoce y
 * antes no contaba. `null` cuando el partido se jugó de verdad, o cuando la
 * llave no tuvo semifinales (no hay 3º/4º que explicar).
 */
export function thirdPlaceNote(matches: readonly MatchResult[]): string | null {
  if (!thirdPlaceByGroupTable(matches)) return null
  return 'El tercer puesto se definió por la tabla de grupos: no se jugó el partido.'
}

/**
 * La línea de relato para cuando el ORDEN de una fecha `GROUPS_KNOCKOUT`
 * cerrada no lo explican ni el `PG` ni la diferencia de `scoreDiffLabel` (W70,
 * verify-report-pr21 #4004, decisión #3962 respetada: el orden NO cambia,
 * esto sólo lo cuenta). `knockoutPositions` (core/knockout.ts) arma ese orden
 * a partir del resultado de LA LLAVE —quién ganó la final, quién quedó
 * afuera en cada instancia—, no de la fase de grupos sola: dos lados
 * empatados en `PG` y en esa diferencia pueden terminar en un orden que esas
 * dos columnas no explican.
 *
 * `scoreDiffLabel(format)`, no un "games" fijo: la llave existe sobre todo en
 * FIFA (`pair_size=1`, `openScore=true`), donde eso es "diferencia de gol" y
 * no "diferencia de games" — mismo criterio que `tiebreakNote`
 * (tabla-desempate.ts) ya usa para la MISMA frase en la tabla de pádel/FIFA.
 * Sin esto sería la CUARTA copia del ternario `openScore ? 'gol' : 'games'`
 * que `scoreDiffLabel` existe justamente para no repetir.
 *
 * `tiebreakNote` no puede narrar el caso de la llave: esa frase explica el
 * desempate que hizo `computeStandings` sobre el orden EN VIVO, y acá el
 * orden que se dibuja es el de la llave, no el de `computeStandings` —
 * `page.tsx` sólo la muestra cuando `orderMoved` ya apagó a `tiebreakNote`,
 * así que las dos frases son mutuamente excluyentes y ninguna reemplaza a la
 * otra: completa el pie donde el otro se calla.
 */
export function bracketOrderNote(format: MatchFormat): string {
  return `El orden sale del resultado de la llave, no sólo de la fase de grupos: por eso puede haber lados con el mismo PG y la misma ${scoreDiffLabel(format)} en un orden distinto.`
}

/**
 * "el 1º", "el 2º"... La única fuente de este nombre: `computeAwards`
 * (core/awards.ts) la reusa para el `reason` de `AwardLine` en vez de
 * reimplementar la misma tabla — sería la tercera copia, el mismo patrón que
 * ya se cerró para `scoreDiffLabel`/`scoreUnit` (HIGIENE, championRecord).
 */
export function ordinal(position: number): string {
  const words: Record<number, string> = {
    1: 'el 1º',
    2: 'el 2º',
    3: 'el 3º',
    4: 'el 4º',
    5: 'el 5º',
    6: 'el 6º',
  }
  return words[position] ?? `el ${position}º`
}
