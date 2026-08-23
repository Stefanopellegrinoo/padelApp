/**
 * La frase que explica por qué un lado quedó abajo de otro, aparte de la
 * pantalla para que se pueda testear: `page.tsx` es un server component
 * `async` que abre el cliente de Supabase al montarse, así que la suite pura
 * no lo puede importar. Mismo precedente de extracción que `tabla-congelada.ts`
 * en esta misma carpeta.
 *
 * **Por qué salió de `page.tsx`**: esta función espeja A MANO el primer
 * criterio de orden de `computeStandings`, y adentro de la pantalla no tenía
 * UNA SOLA aserción. Es la regla que este proyecto aprendió tres veces (W59,
 * el aviso de D1, W66): extraer a un módulo puro mueve el riesgo al punto de
 * unión, y acá el punto de unión es la frase — la tabla puede ordenar por una
 * cosa mientras el pie explica otra sin que nada se ponga rojo.
 */

import { members, scoreDiffLabel, usesSetsDiff, type SeasonConfig, type Side, type SideSize, type SideStanding } from '@/core'

/**
 * El nombre de un lado: los dos nombres unidos con `&` cuando es una pareja, y
 * el nombre solo cuando la disciplina se juega de a uno — donde "Fulano &
 * undefined" era exactamente lo que salía antes de que `Side` existiera.
 */
export function sideLabel(side: Side, nameOf: ReadonlyMap<string, string>): string {
  return members(side)
    .map((entryId) => nameOf.get(entryId) ?? '?')
    .join(' & ')
}

/**
 * Si la tabla se resolvió por desempate, arma la frase con el criterio real que
 * cortó, mirando `PairStanding` (posición, partidos ganados, diferencia de
 * games) de a pares consecutivos: el patrón del handoff describe exactamente el
 * caso de "empataron en partidos ganados, cortó la diferencia de games".
 */
export function tiebreakNote(
  standings: SideStanding[],
  config: SeasonConfig,
  nameOf: Map<string, string>,
  sideSize: SideSize,
): string | null {
  const label = (side: Side) => sideLabel(side, nameOf)
  //El slice anterior normalizó "parejas"→
  // "jugadores" en cinco lugares y dejó éste, que es el único texto largo de
  // la pantalla — "Jugador de test 3 QUEDARON 3° ... EMPATARON en partidos
  // ganados" sobre una persona sola.
  const quedaron = sideSize === 1 ? 'quedó' : 'quedaron'
  const empataron = sideSize === 1 ? 'empató' : 'empataron'
  // El MISMO criterio que corre `computeStandings`, importado y no copiado
  // (PR20 rebanada D2): eran dos `setsToWin > 1` en dos archivos, y arreglar
  // uno solo los hacía discrepar — la tabla ordenando por una cosa y la frase
  // de abajo explicando otra.
  const bySetsDiff = usesSetsDiff(config.matchFormat)
  // Importado y no copiado: la página de Reglas narra el MISMO desempate con
  // la MISMA frase, y eran dos copias del ternario en dos archivos.
  const scoreDiff = scoreDiffLabel(config.matchFormat)

  for (let i = 1; i < standings.length; i++) {
    const better = standings[i - 1]
    const worse = standings[i]
    if (better === undefined || worse === undefined) continue
    // `dayPoints`, no `won`: es el PRIMER criterio real del sort desde PR20
    // rebanada B. Mirar `won` acá dejaba a la frase explicando un escalón que
    // ya no es el que ordena — con empates, dos lados con los mismos ganados
    // pueden estar separados por puntos, y la frase diría que empataron.
    if (better.dayPoints !== worse.dayPoints) continue
    if (bySetsDiff && better.setsDiff !== worse.setsDiff) continue

    // Nivelados en PUNTOS no es lo mismo que nivelados en partidos ganados:
    // uno pudo ganar uno y el otro empatar tres. Sin empates permitidos
    // `dayPoints === won`, así que esto es siempre "partidos ganados" y el
    // pádel no cambia una letra — verificado, no supuesto.
    const nivelados = better.won === worse.won ? 'partidos ganados' : 'puntos de la fecha'

    if (better.gamesDiff !== worse.gamesDiff) {
      return `${label(worse.side)} ${quedaron} ${worse.position}° por ${scoreDiff}: ${empataron} en ${nivelados} con ${label(better.side)}.`
    }

    //Nota: con todo empatado (partidos ganados y diferencia de games) el
    // corte real pasa por el resultado directo o, en un triple empate, por el
    // snapshot — ambos viven adentro de `computeStandings` y no se reexponen.
    // No hay copy contractual para ese caso puntual y no ocurre con el formato
    // a un set por defecto (sin empates posibles); si hiciera falta, se
    // exporta el criterio exacto desde `core/standings.ts`.
    return `${label(worse.side)} ${quedaron} ${worse.position}° por el desempate de la fecha: ${empataron} en ${nivelados} y en ${scoreDiff} con ${label(better.side)}.`
  }
  return null
}
