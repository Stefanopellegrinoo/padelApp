import { orderByPoints } from './order'
import type { EntryId, RankingRow } from './types'

/**
 * Una disciplina, tal como la tabla global la necesita: sus propias filas de
 * `computeRanking` (sin tocar) más el `weight` de `disciplines` (ya
 * convertido a `number` en el borde de lectura, `db/read.ts: toDisciplineHeader`
 * — PostgREST devuelve `numeric(4,2)` como string).
 */
export interface DisciplineRanking {
  weight: number
  ranking: readonly RankingRow[]
}

export interface GlobalRankingRow {
  entryId: EntryId
  points: number
}

/**
 * REQ-D9-1/D9-2: la tabla global suma, por persona, los puntos de cada
 * disciplina × su `weight` (default 1). `weight=0` hace que esa disciplina
 * aporte cero al global SIN tocar sus propias filas — `ranking` sólo se lee,
 * nunca se muta, así que "su tabla propia sigue mostrando sus puntos reales"
 * es gratis: es el mismo array que ya tenía el caller.
 *
 * Sin criterio de desempate propio (la spec no define uno para el global):
 * reusa `orderByPoints` con snapshot vacío, que cae a orden de llegada — el
 * mismo mecanismo que ya usa `computeRanking` para el caso sin snapshot.
 */
export function computeGlobalRanking(disciplines: readonly DisciplineRanking[]): GlobalRankingRow[] {
  const points = new Map<EntryId, number>()
  const order: EntryId[] = []

  for (const { weight, ranking } of disciplines) {
    for (const row of ranking) {
      if (!points.has(row.entryId)) {
        points.set(row.entryId, 0)
        order.push(row.entryId)
      }
      points.set(row.entryId, (points.get(row.entryId) as number) + row.points * weight)
    }
  }

  return orderByPoints(order, points, []).map((entryId) => ({
    entryId,
    points: points.get(entryId) as number,
  }))
}
