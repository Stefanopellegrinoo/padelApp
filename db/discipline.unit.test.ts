import { describe, expect, it } from 'vitest'
import type { DisciplineId } from '@/core'
import type { Client } from './client'
import { updateDisciplineRules } from './discipline'

/**
 * W2 (verify-report reglas-por-disciplina): el update de `disciplines` usa
 * `count: 'exact'` + `count === 0` para distinguir "guardado" de "RLS no
 * encontró nada" (PostgREST no trata eso como error). El dual-write a
 * `seasons` que sigue sólo miraba `error !== null` -- silencioso ante un
 * update que matchea cero filas.
 *
 * No se puede reproducir contra Supabase real (`test:db`): `disciplines_write`
 * (`is_season_admin`) y `seasons_update` chequean el MISMO
 * `seasons.created_by = auth.uid()` sobre la MISMA fila (la que ya validó el
 * `.eq('season_id', seasonId)` del primer update), así que hoy no pueden
 * divergir -- es justo lo que dice el hallazgo ("coincidentally identical").
 * Mismo criterio que `db/client.unit.test.ts` ya usa para
 * `fetchWithFreshTokenRetry`: cuando la condición no se puede provocar a
 * pedido contra la base real, se prueba contra un cliente falso que sí puede
 * devolver la respuesta exacta que dispara el bug.
 */
function fakeClient(options: {
  disciplinesUpdateCount: number
  defaultDisciplineId: string
  seasonsUpdateResult: { error: { message: string } | null; count: number | null }
}): Client {
  const disciplinesBuilder = () => {
    let kind: 'update' | 'select' = 'update'
    const builder = {
      update: () => {
        kind = 'update'
        return builder
      },
      select: () => {
        kind = 'select'
        return builder
      },
      eq: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: () =>
        Promise.resolve({ data: { id: options.defaultDisciplineId }, error: null }),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(
          kind === 'update'
            ? { error: null, count: options.disciplinesUpdateCount }
            : { data: { id: options.defaultDisciplineId }, error: null },
        ).then(resolve, reject),
    }
    return builder
  }

  const seasonsBuilder = () => {
    const builder = {
      update: () => builder,
      eq: () => builder,
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(options.seasonsUpdateResult).then(resolve, reject),
    }
    return builder
  }

  const from = (table: string) => {
    if (table === 'disciplines') return disciplinesBuilder()
    if (table === 'seasons') return seasonsBuilder()
    throw new Error(`fakeClient: tabla no soportada en este test: ${table}`)
  }

  return { from } as unknown as Client
}

const EDGE_ERROR_MESSAGE = /no se pudo|no se pudieron/i

describe('updateDisciplineRules — dual-write a seasons (W2)', () => {
  const seasonId = 'season-1'
  const disciplineId = 'discipline-1' as DisciplineId

  it('cuenta las filas del update a seasons y no se calla si matchea cero (RED antes del fix)', async () => {
    const client = fakeClient({
      disciplinesUpdateCount: 1,
      defaultDisciplineId: disciplineId,
      seasonsUpdateResult: { error: null, count: 0 },
    })

    await expect(updateDisciplineRules(client, seasonId, disciplineId, 'texto')).rejects.toThrow(
      EDGE_ERROR_MESSAGE,
    )
  })

  it('con count > 0 en seasons, el dual-write resuelve sin error', async () => {
    const client = fakeClient({
      disciplinesUpdateCount: 1,
      defaultDisciplineId: disciplineId,
      seasonsUpdateResult: { error: null, count: 1 },
    })

    await expect(
      updateDisciplineRules(client, seasonId, disciplineId, 'texto'),
    ).resolves.toBeUndefined()
  })
})
