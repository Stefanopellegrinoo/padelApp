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

  it('orders the result by global points, highest first', () => {
    const disciplines: DisciplineRanking[] = [
      { weight: 1, ranking: [row('e1', 5), row('e2', 9), row('e3', 1)] },
    ]
    const global = computeGlobalRanking(disciplines)
    expect(global.map((r) => r.entryId)).toEqual(['e2', 'e1', 'e3'])
  })
})
