import { describe, expect, it } from 'vitest'
import { computeGlobalRanking, type DisciplineRanking } from './global-ranking'
import type { RankingRow } from './types'

function row(entryId: string, points: number): RankingRow {
  return { entryId, points, counted: [points], discarded: [] }
}

describe('computeGlobalRanking', () => {
  // REQ-D9-1, primer caso literal de spec: weight=1 en ambas -> suma directa.
  it('sums points straight across disciplines when every weight is 1', () => {
    const disciplines: DisciplineRanking[] = [
      { weight: 1, ranking: [row('e1', 5), row('e2', 2)] },
      { weight: 1, ranking: [row('e1', 3), row('e2', 4)] },
    ]
    const global = computeGlobalRanking(disciplines)
    expect(global.find((r) => r.entryId === 'e1')?.points).toBe(8)
    expect(global.find((r) => r.entryId === 'e2')?.points).toBe(6)
  })

  // REQ-D9-1, segundo caso literal: weight=0.5 -> aporta la mitad.
  it('halves the contribution of a discipline with weight 0.5', () => {
    const disciplines: DisciplineRanking[] = [
      { weight: 1, ranking: [row('e1', 5)] },
      { weight: 0.5, ranking: [row('e1', 4)] },
    ]
    const global = computeGlobalRanking(disciplines)
    expect(global.find((r) => r.entryId === 'e1')?.points).toBe(7) // 5 + 4*0.5
  })

  // REQ-D9-2: weight=0 excluye del global, pero no muta la fila de origen —
  // "su tabla propia sigue mostrando sus puntos reales".
  it('contributes zero for weight=0 without touching the discipline\'s own ranking rows', () => {
    const fifaRanking = [row('e1', 10)]
    const disciplines: DisciplineRanking[] = [
      { weight: 1, ranking: [row('e1', 5)] },
      { weight: 0, ranking: fifaRanking },
    ]
    const global = computeGlobalRanking(disciplines)
    expect(global.find((r) => r.entryId === 'e1')?.points).toBe(5)
    // La fila de origen de FIFA no cambió: su tabla propia sigue en 10.
    expect(fifaRanking[0]?.points).toBe(10)
  })

  it('includes an entry that only plays one discipline, contributing zero from the other', () => {
    const disciplines: DisciplineRanking[] = [
      { weight: 1, ranking: [row('e1', 5)] },
      { weight: 1, ranking: [row('e2', 9)] },
    ]
    const global = computeGlobalRanking(disciplines)
    expect(global.find((r) => r.entryId === 'e1')?.points).toBe(5)
    expect(global.find((r) => r.entryId === 'e2')?.points).toBe(9)
  })

  //`weight` es `numeric(4,2)` — 0.33 es un
  // valor legal y su producto en punto flotante NO es exacto
  // (10*0.33 === 3.3000000000000003 en JS). El único ejemplo de la spec
  // (0.5) es exacto en binario y no lo detecta.
  it('rounds the weighted total to two decimals instead of leaking float noise', () => {
    const disciplines: DisciplineRanking[] = [{ weight: 0.33, ranking: [row('e1', 10)] }]
    const global = computeGlobalRanking(disciplines)
    expect(global.find((r) => r.entryId === 'e1')?.points).toBe(3.3)
  })

  it('orders the result by global points, highest first', () => {
    const disciplines: DisciplineRanking[] = [
      { weight: 1, ranking: [row('e1', 5), row('e2', 9), row('e3', 1)] },
    ]
    const global = computeGlobalRanking(disciplines)
    expect(global.map((r) => r.entryId)).toEqual(['e2', 'e1', 'e3'])
  })

  // docs/tipos-de-torneo.md §2.4: la global no inventa un desempate — con los
  // mismos puntos hay empate, y `position` numera por COMPETENCIA (1, 2, 2,
  // 4), no correlativo (1, 2, 2, 3). e2 y e3 comparten 5 puntos: el puesto 3
  // queda consumido por el empate y e4 (3 puntos) cae directo al 4º.
  it('shares position between tied entries using competition numbering (1, 2, 2, 4)', () => {
    const disciplines: DisciplineRanking[] = [
      { weight: 1, ranking: [row('e1', 9), row('e2', 5), row('e3', 5), row('e4', 3)] },
    ]
    const global = computeGlobalRanking(disciplines)
    expect(global.map((r) => ({ entryId: r.entryId, position: r.position }))).toEqual([
      { entryId: 'e1', position: 1 },
      { entryId: 'e2', position: 2 },
      { entryId: 'e3', position: 2 },
      { entryId: 'e4', position: 4 },
    ])
  })

  // Mismo criterio en el primer puesto: dos líderes empatados comparten el
  // 1º, y el tercero (con menos puntos) es 3º, no 2º.
  it('shares first place when the top two entries are tied', () => {
    const disciplines: DisciplineRanking[] = [
      { weight: 1, ranking: [row('e1', 9), row('e2', 9), row('e3', 4)] },
    ]
    const global = computeGlobalRanking(disciplines)
    expect(global.map((r) => ({ entryId: r.entryId, position: r.position }))).toEqual([
      { entryId: 'e1', position: 1 },
      { entryId: 'e2', position: 1 },
      { entryId: 'e3', position: 3 },
    ])
  })

  // Los dos tests de arriba sólo usan grupos de EXACTAMENTE dos empatados —
  // no discriminan una implementación que "cierre" el grupo al llegar a dos
  // y siga numerando correlativo de ahí. e2/e3/e4 comparten 5 puntos (tres,
  // no dos): los tres tienen que ser 2º, y e5 (1 punto) recién es 5º —los
  // puestos 3 y 4 quedan consumidos por el trío, no vacantes.
  it('shares position across a tie group of THREE, not just pairs', () => {
    const disciplines: DisciplineRanking[] = [
      { weight: 1, ranking: [row('e1', 9), row('e2', 5), row('e3', 5), row('e4', 5), row('e5', 1)] },
    ]
    const global = computeGlobalRanking(disciplines)
    expect(global.map((r) => r.position)).toEqual([1, 2, 2, 2, 5])
  })

  // Empate en el ÚLTIMO lugar, sin nadie debajo que "delate" un salto de
  // numeración raro — el caso más fácil de dejar sin cubrir.
  it('shares position when the tie is at the very bottom of the table', () => {
    const disciplines: DisciplineRanking[] = [
      { weight: 1, ranking: [row('e1', 9), row('e2', 5), row('e3', 3), row('e4', 3)] },
    ]
    const global = computeGlobalRanking(disciplines)
    expect(global.map((r) => r.position)).toEqual([1, 2, 3, 3])
  })

  // BLOQUEA (review a ciegas): los tests de arriba usan siempre enteros y
  // weight=1. `weight` es `numeric(4,2)` de verdad (comentario de más
  // arriba, en `computeGlobalRanking`) — con weight fraccionario, dos
  // totales que SE VEN parecidos por poca precisión visual (3.4 y 3.3) son
  // puntajes DISTINTOS y no tienen que compartir puesto. Una implementación
  // que redondee al entero más cercano ANTES de comparar (en vez de comparar
  // los totales ya redondeados a centavos) los empataría falsamente.
  it('does not share position for close but distinct fractional totals (weight != 1)', () => {
    const disciplines: DisciplineRanking[] = [
      { weight: 0.1, ranking: [row('e1', 34), row('e2', 33), row('e3', 20)] },
    ]
    const global = computeGlobalRanking(disciplines)
    expect(global.map((r) => ({ points: r.points, position: r.position }))).toEqual([
      { points: 3.4, position: 1 },
      { points: 3.3, position: 2 },
      { points: 2, position: 3 },
    ])
  })
})
