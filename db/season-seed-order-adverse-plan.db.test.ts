/**
 * WU6 (tanda 5, round 3 review fix): mirror de la regresión del `+1` que
 * `db/squad-position.db.test.ts:401-479` prueba para `shift_seeds_up`
 * (0023, por disciplina), acá para `shift_season_seeds_up`
 * (0080_season_seed_order.sql, por temporada) — la misma función, el mismo
 * parking de dos pasadas, la misma tabla (`season_seed_order` en vez de
 * `discipline_entries`) y por eso el mismo riesgo: `v_park = max + 1`
 * choca consigo mismo en `p_from = 0`, posición M+1, SÓLO si el motor
 * visita esa fila antes que la parkeada ahí — depende del plan, así que un
 * test sin forzar el plan adverso da falso verde con `entries`/
 * `season_seed_order` cargadas (Index Scan) y falso rojo recién en un
 * deploy nuevo.
 *
 * Confirmado a mano: con `v_park = max + 1` en vez de `max + 2`, y el Seq
 * Scan + heap descendente de acá abajo forzados, `shift_season_seeds_up`
 * choca contra `season_seed_order_seed` con `duplicate key ...
 * (season_id, seed_position)=(…, 4)`. Sin forzar el plan, la misma
 * mutación pasa 1 de cada 3 corridas de `db/claim.db.test.ts` (medido: 1
 * pass, 2 fail en tres corridas) — pura suerte de qué plan elige el
 * planner ese día.
 */
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@/core'
import { addSquadSeat } from './entries'
import { createSeason } from './season'
import { adminClient } from './test/admin'
import { createTestUser } from './test/users'

/** Mismo helper y mismo motivo que `db/squad-position.db.test.ts`: tocar los GUCs del planner es cosa de `psql`, no de PostgREST. */
function localSql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', 'supabase_db_padelApp', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
    { input: sql, encoding: 'utf8' },
  )
}

async function seasonSeedOrder(seasonId: string): Promise<Array<{ id: string; seedPosition: number }>> {
  const db = adminClient()
  const { data, error } = await db
    .from('season_seed_order')
    .select('entry_id, seed_position')
    .eq('season_id', seasonId)
    .order('seed_position', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({ id: row.entry_id, seedPosition: row.seed_position }))
}

describe('shift_season_seeds_up bajo el plan adverso (WU6, mirror de shift_seeds_up)', () => {
  it('corre la cola desde 0 aunque el motor recorra las filas al revés (Seq Scan, heap descendente)', async () => {
    const admin = await createTestUser()
    const squadNames = Array.from({ length: 8 }, (_, index) => `Jugador ${index + 1}`)
    const { seasonId } = await createSeason(admin.client, {
      name: 'Los Jueves 2026 (season_seed_order)',
      squadNames,
      config: defaultConfig(8),
    })

    const original = await seasonSeedOrder(seasonId)
    expect(original).toHaveLength(8)

    // Reinsertado al revés -- posición 7 primero -- para que hasta un Seq
    // Scan recorra el heap de arriba para abajo.
    const db = adminClient()
    const { error: deleteError } = await db.from('season_seed_order').delete().eq('season_id', seasonId)
    if (deleteError) throw new Error(deleteError.message)
    const { error: seedError } = await db.from('season_seed_order').insert(
      [...original].reverse().map((seat) => ({ season_id: seasonId, entry_id: seat.id, seed_position: seat.seedPosition })),
    )
    if (seedError) throw new Error(seedError.message)

    const heap = localSql(`select seed_position from public.season_seed_order where season_id = '${seasonId}' order by ctid;`)
      .trim()
      .split('\n')
      .map(Number)
    expect(heap).toEqual([7, 6, 5, 4, 3, 2, 1, 0])

    const output = localSql(`
      set enable_indexscan = off;
      set enable_bitmapscan = off;
      explain (costs off) update public.season_seed_order set seed_position = seed_position - 9
       where season_id = '${seasonId}' and seed_position >= 9;
      select public.shift_season_seeds_up('${seasonId}'::uuid, 0);
    `)
    expect(output).toContain('Seq Scan on season_seed_order')

    const after = await seasonSeedOrder(seasonId)
    expect(after.map((e) => e.seedPosition)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(after.map((e) => e.id)).toEqual(original.map((e) => e.id))

    const heapAfter = localSql(`select seed_position from public.season_seed_order where season_id = '${seasonId}' order by ctid;`)
      .trim()
      .split('\n')
      .map(Number)
    expect(heapAfter).toEqual([8, 7, 6, 5, 4, 3, 2, 1])
  })

  // `addSquadSeat` con `p_before = null` no llama a `shift_season_seeds_up`
  // -- alcanza para que este archivo pruebe que la función SIGUE viva y
  // grantada para quien tiene que llamarla (0081), sin repetir el escenario
  // adverso de arriba.
  it('add_squad_seat sigue pudiendo llamar a shift_season_seeds_up (p_before real)', async () => {
    const admin = await createTestUser()
    const squadNames = Array.from({ length: 4 }, (_, index) => `Jugador ${index + 1}`)
    const { seasonId } = await createSeason(admin.client, {
      name: 'Los Jueves 2026 (season_seed_order, p_before)',
      squadNames,
      config: defaultConfig(4),
    })
    const [first] = await seasonSeedOrder(seasonId)
    if (first === undefined) throw new Error('Falta un asiento de referencia.')

    await addSquadSeat(admin.client, seasonId, 'El quinto', first.id)

    const after = await seasonSeedOrder(seasonId)
    expect(after.find((e) => e.id === first.id)?.seedPosition).toBe(1)
  })
})
