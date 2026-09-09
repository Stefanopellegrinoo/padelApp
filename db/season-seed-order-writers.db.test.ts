/**
 * Guardia de escritura de `season_seed_order` (0080_season_seed_order.sql,
 * torneo-multi-disciplina tanda 1) — mirror explícito de
 * `db/entries-seed-writers.db.test.ts`, que hace lo mismo con
 * `entries.seed_position` para el SQUAD.
 *
 * El riesgo real acá no es un crash: es que un escritor de plantel olvide
 * esta tabla EN SILENCIO — el asiento sigue existiendo, pero ordena mal para
 * siempre en Unirse, Ajustes › Plantel y la tabla global, sin que ningún
 * error lo avise. Este archivo prueba, contra los escritores de producción
 * que tocan el plantel SQUAD (`createSeason`, y en las próximas tandas de
 * este mismo cambio `addSquadSeat`/`promoteGuest`), que cada SQUAD de la
 * temporada tiene EXACTAMENTE una fila en `season_seed_order` y que las
 * posiciones son 0..N-1 contiguas sin duplicados.
 *
 * Todas las consultas van ESCOPEADAS por `season_id`. `db/discipline.
 * db.test.ts:234-248` (`countOrphanedSquadEntries`) mide, contra la base
 * completa y sin escopear, que una aserción así es inestable con la suite
 * corriendo en paralelo (`vitest.db.config.ts`: "los tests comparten una
 * base, aíslan por temporada, no por proceso") — huérfanos fantasma en 3 de
 * ~7 corridas, no una regresión real. Este archivo no repite eso: cada
 * `select` de acá lleva su propio `.eq('season_id', ...)`.
 */
import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@/core'
import { createSeason } from './season'
import { adminClient } from './test/admin'
import { createTestUser } from './test/users'

async function seedOrderPositions(seasonId: string): Promise<number[]> {
  const db = adminClient()
  const { data, error } = await db
    .from('season_seed_order')
    .select('seed_position')
    .eq('season_id', seasonId)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => row.seed_position)
}

async function squadEntryIdsOf(seasonId: string): Promise<string[]> {
  const db = adminClient()
  const { data, error } = await db
    .from('entries')
    .select('id')
    .eq('season_id', seasonId)
    .eq('kind', 'SQUAD')
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => row.id)
}

/** 0..N-1, contiguo, sin duplicados: la única forma legal de que quede una tabla de N SQUAD. */
function expectContiguous(positions: number[], count: number): void {
  expect(positions).toHaveLength(count)
  expect([...positions].sort((a, b) => a - b)).toEqual(Array.from({ length: count }, (_, index) => index))
}

describe('createSeason escribe season_seed_order desde el orden GLOBAL de squadNames', () => {
  it('cada SQUAD tiene exactamente una fila, 0..N-1 contiguo', async () => {
    const admin = await createTestUser()
    const squadNames = Array.from({ length: 6 }, (_, index) => `Jugador ${index + 1}`)
    const { seasonId } = await createSeason(admin.client, {
      name: 'Torneo con season_seed_order',
      squadNames,
      config: defaultConfig(6),
    })

    expectContiguous(await seedOrderPositions(seasonId), 6)
    expect(await squadEntryIdsOf(seasonId)).toHaveLength(6)
  })

  // La trampa que este cambio existe para evitar: `disciplines[0].seedNames`
  // (PR anterior) es un orden POR DISCIPLINA, no el de la temporada. Si
  // `createSeason` copiara ese orden acá, una primaria con `seedNames`
  // propio volvería a secuestrar en silencio la pantalla de Unirse — la
  // razón entera de esta migración.
  it('usa squadNames, nunca el seedNames de ninguna disciplina', async () => {
    const admin = await createTestUser()
    const names = Array.from({ length: 4 }, (_, index) => `Jugador ${index + 1}`)
    const config = defaultConfig(4)
    const { seasonId } = await createSeason(admin.client, {
      name: 'Torneo con orden propio por disciplina',
      squadNames: names,
      config,
      disciplines: [{ kind: 'PADEL', config, seedNames: [names[3]!, names[2]!, names[1]!, names[0]!] }],
    })

    const db = adminClient()
    const { data: order, error: orderError } = await db
      .from('season_seed_order')
      .select('entry_id, seed_position')
      .eq('season_id', seasonId)
      .order('seed_position', { ascending: true })
    if (orderError) throw new Error(orderError.message)
    const { data: entryRows, error: entriesError } = await db
      .from('entries')
      .select('id, display_name')
      .eq('season_id', seasonId)
    if (entriesError) throw new Error(entriesError.message)
    const nameOf = new Map((entryRows ?? []).map((row) => [row.id, row.display_name]))

    // El orden de season_seed_order es el de `names` (squadNames), no el
    // invertido que `seedNames` le pidió a PADEL.
    expect((order ?? []).map((row) => nameOf.get(row.entry_id))).toEqual(names)
  })
})
