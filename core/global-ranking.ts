import { orderByPoints } from './order'
import type { EntryId, RankingRow } from './types'

/**
 * Una disciplina, tal como la tabla global la necesita: sus propias filas de
 * `computeRanking` (sin tocar) más el `weight` de `disciplines` — ya
 * `number` desde que sale de PostgREST (`db/read.ts: toDisciplineHeader`
 * hace un `Number` de cinturón (W21); no convierte
 * nada en la práctica).
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
 * Desempate (W18, `` ronda 6): la spec no define uno para el
 * global, así que se reusa `orderByPoints` con snapshot vacío — mismo
 * mecanismo que `computeRanking` para el caso sin snapshot, que cae al
 * orden de `order` (primera aparición). Eso NO es "orden de llegada" al
 * azar: cada `ranking` que entra acá ya trae, siempre, a TODO el plantel de
 * la temporada (`page.tsx` le pasa el mismo `squadIds` a cada disciplina),
 * así que el `ranking` de la PRIMERA disciplina de `disciplines` ya
 * contiene a todos y `order` termina siendo, en los hechos, el orden de esa
 * disciplina — puntos de la disciplina [0] desc, y a igualdad de eso,
 * `entries.seed_position` de la temporada. Es determinístico (medido, 21
 * renders idénticos) pero es una cadena que nadie eligió: la disciplina que
 * el caller ponga primero se queda con el voto de calidad del desempate
 * global. Cambiar el orden de `disciplines.position` invierte el podio sin
 * que cambie un solo punto.
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
      //`weight` es `numeric(4,2)`, dos
      // decimales es su precisión real — `points * weight` en punto
      // flotante puede ensuciar esa segunda posición (10*0.33 !== 3.3 en
      // JS). Redondear en cada acumulación, no sólo al mostrar, evita que
      // esa basura decida también el orden de dos totales que "de verdad"
      // empatan (7*0.7 !== 49*0.1 en JS, aunque valen lo mismo).
      const total = (points.get(row.entryId) as number) + row.points * weight
      points.set(row.entryId, Math.round(total * 100) / 100)
    }
  }

  return orderByPoints(order, points, []).map((entryId) => ({
    entryId,
    points: points.get(entryId) as number,
  }))
}
