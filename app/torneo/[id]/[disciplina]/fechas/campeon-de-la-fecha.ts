/**
 * La marca del campeón de una fecha, aparte de la pantalla para que se pueda
 * testear: `page.tsx` es un server component `async` que abre el cliente de
 * Supabase al montarse. Mismo precedente de extracción que `tabla-congelada.ts`,
 * `tabla-desempate.ts` y `TablaDelDia`.
 *
 * **Por qué salió**: adentro de la pantalla no tenía una sola aserción, y se
 * caía en los DOS lados apenas la disciplina permite empates — contaba
 * `ganados` y `perdidos` nada más, así que un lado con 2 ganados, 1 empatado y
 * 0 perdidos salía `2–0`, como si hubiera jugado dos partidos cuando fueron
 * tres; y llamaba `games` a lo que en FIFA son goles.
 */

import { members, sameSide, scoreUnit, type MatchFormat, type MatchResult, type Side } from '@/core'

/**
 * Partidos ganados–(empatados)–perdidos y diferencia de la unidad que
 * corresponda, dentro de esa fecha puntual.
 *
 * No pasa por `computeStandings` —pide `SeasonConfig` y el snapshot de
 * desempate, que esta pantalla de lectura no trae— porque el campeón ya lo
 * dice `seasonAwardsOf`; sólo falta sumar sus propios partidos, el mismo tally
 * que hace `computeStandings` puertas adentro pero para un solo lado.
 *
 * `allowsDraw` decide la FORMA (dos números o tres) y sale de la fecha, no de
 * lo que pasó esa tarde: si dependiera de si hubo empates, dos fechas de la
 * misma liga se leerían distinto. Es el mismo valor congelado que ya gobierna
 * la tabla del día.
 */
export function championRecord(
  matches: readonly MatchResult[],
  champion: Side,
  format: MatchFormat,
  allowsDraw: boolean,
): string {
  let won = 0
  let drawn = 0
  let lost = 0
  let scoreFor = 0
  let scoreAgainst = 0
  for (const match of matches) {
    if (match.sets.length === 0) continue
    const isA = sameSide(match.sideA, champion)
    const isB = !isA && sameSide(match.sideB, champion)
    if (!isA && !isB) continue

    let setsA = 0
    let setsB = 0
    let gamesA = 0
    let gamesB = 0
    for (const set of match.sets) {
      gamesA += set.gamesA
      gamesB += set.gamesB
      if (set.gamesA > set.gamesB) setsA++
      else if (set.gamesB > set.gamesA) setsB++
    }
    const championWonSets = isA ? setsA > setsB : setsB > setsA
    const championLostSets = isA ? setsB > setsA : setsA > setsB
    if (championWonSets) won++
    else if (championLostSets) lost++
    // La rama que faltaba. En pádel es inalcanzable con un resultado guardado
    // —lo prohíbe `match_sets_no_draw` (0034)— y por eso el récord de pádel no
    // se mueve un carácter.
    else drawn++
    scoreFor += isA ? gamesA : gamesB
    scoreAgainst += isA ? gamesB : gamesA
  }

  const diff = scoreFor - scoreAgainst
  const sign = diff >= 0 ? '+' : ''
  const partidos = allowsDraw ? `${won}–${drawn}–${lost}` : `${won}–${lost}`
  return `${partidos} · ${sign}${diff} ${scoreUnit(format)}`
}

/** Los nombres del lado unidos con `&`: uno solo cuando la disciplina es de a uno. */
export function sideNames(side: Side, nameById: ReadonlyMap<string, string>): string {
  return members(side)
    .map((entryId) => nameById.get(entryId) ?? '?')
    .join(' & ')
}
