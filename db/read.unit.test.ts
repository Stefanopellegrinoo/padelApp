import { describe, expect, it } from 'vitest'
import { toDisciplineHeader } from './read'

/**
 * `Number(row.weight)` en `toDisciplineHeader` (W21, `verify-report` ronda
 * 6): medido contra PostgREST real, `disciplines.weight` YA llega como
 * `number` — el "PostgREST serializa numeric como string" que este archivo
 * afirmaba antes no existe. El `Number()` es un cinturón inofensivo para
 * una lectura que no pase por `fetch`+`JSON.parse`; esto sólo prueba que
 * ese cinturón es un no-op sobre un `number` real. El caso con dato REAL
 * (una fila leída de la base) vive en `db/read.db.test.ts`.
 */
describe('toDisciplineHeader', () => {
  it('leaves an already-numeric weight (e.g. the DB default of 1) untouched', () => {
    const header = toDisciplineHeader({
      id: 'd1',
      season_id: 's1',
      kind: 'PADEL',
      config: {},
      weight: 1,
      pair_size: 2,
    })
    expect(header.weight).toBe(1)
  })
})
