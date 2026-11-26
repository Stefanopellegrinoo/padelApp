import { ordinal } from './narrate'
import { single } from './side'
import type { Award, EntryId, SeasonConfig, SideStanding } from './types'

/**
 * Una fecha por ranking (`MatchdayFormat` `RANKING`, bowling): no hay
 * partidos, cada uno carga su total y "el que más hizo ganó, y para abajo"
 * (S4). Puro, como el resto de `core/`: la base guarda los pinos
 * (`matchday_scores`) y esto los convierte en tabla y en puntos.
 */
/**
 * El total más alto que se acepta. No es el de un deporte —una línea de
 * bowling llega a 300 y una serie sumada pasa de mil— sino un tope sano contra
 * un dedo de más. La base lo vuelve a exigir (`matchday_scores_score_range`, 0109).
 */
export const MAX_RANKING_SCORE = 9999

/** `null` si `score` es un total que se puede guardar: entero, de 0 a `MAX_RANKING_SCORE`. */
export function rankingScoreError(score: number): string | null {
  return Number.isInteger(score) && score >= 0 && score <= MAX_RANKING_SCORE
    ? null
    : `Los pinos van de 0 a ${MAX_RANKING_SCORE}, sin decimales.`
}

/**
 * Lo que se tipeó en un campo de pinos: `null` si todavía no hay nada, el
 * total si se puede guardar, o por qué no. La comparten la fecha de un torneo
 * y el torneo rápido: el mismo campo no puede aceptar cosas distintas.
 */
export function parseRankingScore(raw: string): { score: number } | { error: string } | null {
  const text = raw.trim()
  if (text === '') return null
  if (!/^\d+$/.test(text)) return { error: 'Sólo números.' }
  const score = Number(text)
  const problem = rankingScoreError(score)
  return problem === null ? { score } : { error: problem }
}

export interface EntryScore {
  entryId: EntryId
  score: number
}

/**
 * La tabla del día de una fecha por ranking. Los empatados COMPARTEN el puesto
 * y el siguiente salta los que ocuparon ("comparten el puesto y los puntos",
 * S4): dos con 180 quedan los dos 2° y el que sigue queda 4°. El puesto es
 * `1 + cuántos hicieron más`, la misma cuenta que el `rank()` de SQL con el
 * que `close_matchday` (0111) lo vuelve a verificar.
 *
 * Devuelve `SideStanding` para que la tabla, los awards y la página de la
 * fecha hablen el mismo tipo que una fecha de partidos: cada fila es un lado
 * de uno, `dayPoints` son los pinos —el número que ordenó la tabla— y no hay
 * partidos ganados, sets ni games. Dentro de un empate se respeta el orden de
 * entrada (el del plantel): sólo decide qué fila se dibuja primero, nunca el
 * puesto.
 */
export function rankScores(scores: readonly EntryScore[]): SideStanding[] {
  const ordered = scores
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => right.entry.score - left.entry.score || left.index - right.index)
  return ordered.map(({ entry }) => ({
    side: single(entry.entryId),
    played: 1,
    won: 0,
    drawn: 0,
    dayPoints: entry.score,
    setsDiff: 0,
    gamesDiff: 0,
    position: 1 + scores.filter((other) => other.score > entry.score).length,
  }))
}

/**
 * Los puntos de una fecha por ranking: cada uno cobra los de SU puesto
 * compartido (`config.points[position - 1]`), así que dos 2° se llevan los dos
 * lo del 2° y el 3° no lo cobra nadie.
 *
 * Una función aparte y no una opción de `computeAwards`: aquélla paga por
 * ORDEN de la tabla y saltea a los lados de invitados; ésta paga por PUESTO y
 * no tiene invitados (una fecha por ranking juega sólo con los presentes del
 * plantel). Un parámetro que cambiara las dos reglas a la vez dejaría a todos
 * los formatos de partidos a un booleano de pagar distinto.
 */
export function computeRankingAwards(standings: readonly SideStanding[], config: SeasonConfig): Award[] {
  if (standings.length > config.points.length) {
    throw new Error(
      `La fecha tiene ${standings.length} competidores del torneo pero la lista de puntos sólo tiene ${config.points.length} valores.`,
    )
  }
  return standings.map((row) => {
    const points = config.points[row.position - 1]
    // Inalcanzable: el puesto nunca pasa de la cantidad de filas, que ya se
    // comparó con el largo de la lista. Sólo para `noUncheckedIndexedAccess`.
    if (points === undefined) throw new Error(`No hay puntos definidos para la posición ${row.position}.`)
    return {
      entryId: row.side.a,
      position: row.position,
      points,
      lines: [{ reason: `${ordinal(row.position)} de la fecha`, points }],
    }
  })
}

/** Los pinos de una persona en el año: lo que Stats y el perfil muestran en vez de partidos y games. */
export interface RankingTally {
  entryId: EntryId
  /** Fechas cerradas en las que cargó su total. */
  played: number
  total: number
  /** El mejor total de una fecha; 0 sin fechas. */
  best: number
  /** `total / played`, redondeado; 0 sin fechas. */
  average: number
}

/**
 * Una fila por asiento de `squad` (en ese orden), con sus pinos de las fechas
 * cerradas. `scoresByMatchday` son sólo los totales que contaron (los de los
 * presentes): quien se bajó después de cargar no juega esa fecha.
 */
export function rankingTallies(
  scoresByMatchday: ReadonlyMap<number, ReadonlyMap<EntryId, number>>,
  squad: readonly EntryId[],
): RankingTally[] {
  return squad.map((entryId) => {
    const scores = [...scoresByMatchday.values()].flatMap((byEntry) => {
      const score = byEntry.get(entryId)
      return score === undefined ? [] : [score]
    })
    const total = scores.reduce((sum, score) => sum + score, 0)
    return {
      entryId,
      played: scores.length,
      total,
      best: scores.length === 0 ? 0 : Math.max(...scores),
      average: scores.length === 0 ? 0 : Math.round(total / scores.length),
    }
  })
}
