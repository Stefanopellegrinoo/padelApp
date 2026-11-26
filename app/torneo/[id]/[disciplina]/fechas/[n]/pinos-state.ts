import { parseRankingScore, rankScores } from '@/core'

/**
 * Lo puro de una fecha por pinos (bowling, S4): leer lo que se tipeó, contar
 * lo que falta y armar el ranking en vivo. Aparte de `pinos.tsx` para tener
 * test sin montar nada, como `carga-state.ts` y `armado-state.ts`.
 */

/** Un presente de la fecha, con su total si ya lo cargó. */
export interface JugadorPinosVM {
  entryId: string
  name: string
  /** Quien mira: su fila va en amarillo. */
  vos: boolean
  score: number | null
}

/** `null` si todavía no hay nada escrito; un total que se puede guardar; o por qué no. Es `parseRankingScore` (core). */
export const leerPinos = parseRankingScore

/** Lo que falta para cerrar, dicho arriba de "Cerrar la fecha". */
export function faltanPinos(remaining: number): string {
  if (remaining === 0) return 'Todos cargaron sus pinos'
  return remaining === 1 ? 'Falta 1 jugador' : `Faltan ${remaining} jugadores`
}

/** Una fila del ranking, ya escrita. */
export interface FilaPinos {
  key: string
  nombre: string
  esVos: boolean
  /** El puesto compartido ("2" para los dos de 180); un guión sin pinos. */
  puesto: string
  pinos: string
}

/**
 * El ranking del día: los que cargaron, ordenados con `rankScores` —la MISMA
 * función con la que se cierra, así que la tabla en vivo y los puntos no
 * pueden decir cosas distintas—, y abajo los que faltan, sin puesto. Quien no
 * cargó no ocupa lugar: no le corre el puesto a nadie.
 */
export function tablaDePinos(jugadores: readonly JugadorPinosVM[]): FilaPinos[] {
  const byId = new Map(jugadores.map((jugador) => [jugador.entryId, jugador]))
  const cargados = rankScores(
    jugadores.flatMap((jugador) => (jugador.score === null ? [] : [{ entryId: jugador.entryId, score: jugador.score }])),
  )
  const filas = cargados.map((row) => {
    const jugador = byId.get(row.side.a)
    return {
      key: row.side.a,
      nombre: jugador?.name ?? '?',
      esVos: jugador?.vos ?? false,
      puesto: String(row.position),
      pinos: String(row.dayPoints),
    }
  })
  const faltan = jugadores
    .filter((jugador) => jugador.score === null)
    .map((jugador) => ({ key: jugador.entryId, nombre: jugador.name, esVos: jugador.vos, puesto: '—', pinos: '—' }))
  return [...filas, ...faltan]
}
