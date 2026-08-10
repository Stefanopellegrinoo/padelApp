import { MASTERS_MATCHES, MASTERS_SIZE, MAX_PLAYERS, MIN_PLAYERS } from './constants'
import type { SeasonConfig } from './types'

export interface RulesSection {
  title: string
  body: string
}

/**
 * The rules page, told from the config.
 *
 * Everything the app can derive, it derives. If the admin wrote "the winner
 * takes 10 points" by hand and then changed the config to 12, the page would
 * be lying — and a rules page that disagrees with the app is worse than none.
 *
 * The output is in Spanish because the group reads it.
 */
export function narrateRules(config: SeasonConfig): RulesSection[] {
  const { points, matchFormat, regularMatchdays, countBestOf, tiebreakSnapshotEvery } = config

  return [
    {
      title: 'El torneo',
      body:
        `El campeonato son ${regularMatchdays} fechas. Para cada jugador cuentan sus ` +
        `${countBestOf} mejores resultados, así que se puede faltar alguna vez sin quedar ` +
        `afuera de la pelea. El año cierra con un Masters entre los ${MASTERS_SIZE} mejores.`,
    },
    {
      title: 'La fecha',
      body:
        `Cada fecha la juegan los que confirman, entre ${MIN_PLAYERS} y ${MAX_PLAYERS}. ` +
        `Se arman parejas con todos y juegan todos contra todos. ` +
        describeFormat(matchFormat) +
        ` Si el número de confirmados da impar, se suma un invitado para poder armar las parejas: ` +
        `el invitado no suma puntos, pero su compañero sí.`,
    },
    {
      title: 'Los puntos',
      body:
        `Los dos integrantes de una pareja suman siempre lo mismo, según dónde terminó la pareja: ` +
        points.map((value, index) => `${ordinal(index + 1)}, ${value}`).join('; ') +
        `. Cuando juegan menos parejas se usan los primeros valores, así ganar la fecha ` +
        `siempre suma ${points[0] ?? 0}. Nadie suma 0 por presentarse: si salir último diera ` +
        `lo mismo que faltar, convendría faltar.`,
    },
    {
      title: 'Cómo se arman las parejas',
      body:
        `Las parejas se arman con la tabla del campeonato: se ordena a los presentes por puntos ` +
        `y se junta al primero con el último, al segundo con el anteúltimo, y así. ` +
        `Ninguna pareja se repite dos fechas seguidas, con una sola excepción: la pareja que ` +
        `gana una fecha se mantiene junta en la siguiente. Después se separa, gane o pierda, ` +
        `así que toda pareja campeona juega exactamente 2 fechas junta.`,
    },
    {
      title: 'Los desempates',
      body: describeTiebreak(matchFormat, tiebreakSnapshotEvery),
    },
    {
      title: 'El Masters',
      body:
        `Los ${MASTERS_SIZE} mejores del año juegan una jornada final de ${MASTERS_MATCHES} partidos con ` +
        `compañeros rotativos: cada uno juega una vez con cada uno. Se cuentan los partidos ` +
        `ganados de forma individual. Si hay empate, gana el que llegó mejor posicionado en el ` +
        `ranking anual.`,
    },
  ]
}

function describeTiebreak(format: SeasonConfig['matchFormat'], snapshotEvery: number): string {
  const setStep = format.setsToWin > 1 ? `corta la diferencia de sets, después ` : ''
  return (
    `En la tabla de la fecha, si dos parejas ganan la misma cantidad de partidos, ${setStep}` +
    `corta la diferencia de games. Si empatan dos, el partido entre ellas lo decide; si empatan ` +
    `tres o más, el partido entre ellas no alcanza porque se ganan en círculo, y corta el orden de ` +
    `desempate. En la tabla del campeonato, si dos jugadores tienen los mismos puntos corta el orden ` +
    `de desempate: una lista del mejor al peor que arranca en el orden que consensuó el ` +
    `grupo y se actualiza cada ${snapshotEvery} fechas con la tabla de ese momento.`
  )
}

function describeFormat(format: SeasonConfig['matchFormat']): string {
  const setWord = format.setsToWin === 1 ? 'un set' : `${format.setsToWin} sets ganados`
  const tie = format.tieBreak ? ' con tie-break' : ''
  return `Cada partido se define a ${setWord} de ${format.gamesPerSet} games${tie}.`
}

function ordinal(position: number): string {
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
