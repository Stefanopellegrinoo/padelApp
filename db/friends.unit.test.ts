import { describe, expect, it } from 'vitest'
import type { Client } from './client'
import { historyWith } from './friends'

/**
 * PostgREST corta CADA select en `PGRST_DB_MAX_ROWS` (1000,
 * `supabase/config.toml`) y no avisa -- mismo tripwire que `mySeasons`
 * (`db/read.ts:341-374`). No se puede reproducir contra Supabase real sin
 * insertar miles de partidos entre dos jugadores, así que se prueba contra
 * un cliente falso que sí puede devolver la respuesta truncada exacta que
 * dispara el bug -- mismo criterio que `db/discipline.unit.test.ts`.
 */
function fakeClient(options: {
  me: string
  rows: Array<{ match_id: string; matchday_id: string; side: string; player_id: string }>
  count: number | null
}): Client {
  const builder = {
    select: () => builder,
    in: () => builder,
    order: () => builder,
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data: options.rows, error: null, count: options.count }).then(
        resolve,
        reject,
      ),
  }

  const from = (table: string) => {
    if (table === 'match_participants') return builder
    throw new Error(`fakeClient: tabla no soportada en este test: ${table}`)
  }
  const rpc = () => Promise.resolve({ data: options.me, error: null })

  return { from, rpc } as unknown as Client
}

describe('historyWith — tripwire de truncamiento de PostgREST', () => {
  it('falla ruidoso si el select viene truncado, en vez de perder un partido en silencio', async () => {
    const me = 'jugador-yo'
    const amigo = 'jugador-amigo'
    // Dos partidos completos serían 4 filas (2 por partido); acá sólo llegan
    // 3 -- falta la fila del amigo en el segundo partido. Sin el guard, ese
    // partido desaparece del historial sin ningún error: un conteo más chico
    // y confiadamente equivocado.
    const client = fakeClient({
      me,
      rows: [
        { match_id: 'm1', matchday_id: 'f1', side: 'A', player_id: me },
        { match_id: 'm1', matchday_id: 'f1', side: 'B', player_id: amigo },
        { match_id: 'm2', matchday_id: 'f1', side: 'A', player_id: me },
      ],
      count: 4,
    })

    await expect(historyWith(client, amigo)).rejects.toThrow(/no se pud/i)
  })

  it('con el conteo completo, no hace ruido y arma el historial normal', async () => {
    const me = 'jugador-yo'
    const amigo = 'jugador-amigo'
    const client = fakeClient({
      me,
      rows: [
        { match_id: 'm1', matchday_id: 'f1', side: 'A', player_id: me },
        { match_id: 'm1', matchday_id: 'f1', side: 'B', player_id: amigo },
      ],
      count: 2,
    })

    await expect(historyWith(client, amigo)).resolves.toEqual([
      { matchId: 'm1', matchdayId: 'f1', together: false },
    ])
  })
})
