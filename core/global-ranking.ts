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
  /**
   * Puesto de COMPETENCIA (1, 2, 2, 4 — no 1, 2, 2, 3): comparte número con
   * cualquier otra fila de los mismos `points`, saltando el o los puestos
   * que ese empate consume. Decisión del dueño (`docs/tipos-de-torneo.md`
   * §2.4): la global no inventa un criterio de desempate propio — con los
   * mismos puntos hay empate, y el número lo dice.
   */
  position: number
}

/**
 * REQ-D9-1/D9-2: la tabla global suma, por persona, los puntos de cada
 * disciplina × su `weight` (default 1). `weight=0` hace que esa disciplina
 * aporte cero al global SIN tocar sus propias filas — `ranking` sólo se lee,
 * nunca se muta, así que "su tabla propia sigue mostrando sus puntos reales"
 * es gratis: es el mismo array que ya tenía el caller.
 *
 * Puesto compartido, no desempate inventado (`docs/tipos-de-torneo.md` §2.4):
 * la spec no define un criterio de desempate para la global, y la resolución
 * no fue inventarle uno — fue dejar de pretender que hay un ganador entre dos
 * empatados. `position` (abajo) numera por competencia; el ORDEN de las filas
 * entre empatados es una cosa DISTINTA y sigue como estaba.
 *
 * Ese orden sigue siendo `orderByPoints` con snapshot vacío — mismo mecanismo
 * que `computeRanking` para el caso sin snapshot, que cae al orden de `order`
 * (primera aparición). Eso NO es "orden de llegada" al azar: cada `ranking`
 * que entra acá ya trae, siempre, a TODO el plantel de la temporada
 * (`page.tsx` le pasa el mismo `squadIds` a cada disciplina), así que el
 * `ranking` de la PRIMERA disciplina de `disciplines` ya contiene a todos y
 * `order` termina siendo, en los hechos, el orden de esa disciplina — puntos
 * de la disciplina [0] desc, y a igualdad de eso, el orden de `season_seed_order`
 * (`seasonSeedOrder`, `db/read.ts` — tabla propia desde 0080, torneo-multi-
 * disciplina tanda 1; NI `discipline_entries` de ninguna disciplina en
 * particular NI `entries.seed_position`, que la decisión #4044/C37 dejó sin
 * valor para el SQUAD). Es determinístico (medido, 21 renders idénticos), pero desde
 * que `position` se comparte YA NO decide el podio: antes, la disciplina que
 * el caller pusiera primero se quedaba con el voto de calidad del desempate
 * global (cambiar `disciplines.position` invertía quién se veía 2º y quién
 * 3º). Ahora los dos muestran el mismo `position` — cambiar ese orden sólo
 * reordena cuál de los dos empatados se dibuja arriba, cosmético.
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

  const ordered = orderByPoints(order, points, [])

  // Numeración de competencia: sólo avanza el puesto cuando los puntos
  // bajan. Dos en 2º (mismos puntos) hacen que el siguiente sea 4º, no 3º —
  // el puesto 3 quedó "consumido" por el empate, no vacante.
  // `entryPoints !== previousPoints` ya cubre la primera vuelta sola:
  // comparar un `number` contra el `null` inicial de `previousPoints` da
  // `true` sin necesitar un `previousPoints === null` aparte.
  let position = 0
  let previousPoints: number | null = null
  return ordered.map((entryId, index) => {
    const entryPoints = points.get(entryId) as number
    if (entryPoints !== previousPoints) {
      position = index + 1
    }
    previousPoints = entryPoints
    return { entryId, points: entryPoints, position }
  })
}
