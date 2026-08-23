/**
 * Archivo-guardia de `entries.seed_position` PARA EL SQUAD — espejo exacto de
 * `db/season-status-writers.db.test.ts`, que hizo lo mismo con
 * `seasons.status` y dejó esa columna medible como genuinamente limpia.
 *
 * El CONTRACT (design #3801, paso 11) relaja la columna y la ata a `kind`:
 *
 *   drop index public.entries_seed;
 *   alter table public.entries alter column seed_position drop not null;
 *   update public.entries set seed_position = null where kind = 'SQUAD';
 *   alter table public.entries add constraint entries_seed_shape check (
 *     (kind = 'GUEST' and seed_position is not null) or
 *     (kind = 'SQUAD' and seed_position is null));
 *
 * O sea: después del contract, un SQUAD con `seed_position` no null es un
 * error de la base, no una degradación. Estos tests existen para que ese
 * `add constraint` no encuentre un solo escritor vivo, y para que la próxima
 * tanda que agregue uno se entere ACÁ y no aplicando la DDL.
 *
 * El orden del plantel NO se pierde: vive en `discipline_entries.seed_position`
 * desde PR 7, y el orden a nivel TORNEO es el de la disciplina primaria
 * (decisión #4044) — `db/read.ts: seasonSeedOrder`.
 *
 * Un GUEST SÍ conserva su `seed_position`, y es correlativo POR FECHA: el
 * contract se lo exige `not null`. `addGuestSeat` (`db/matchday.ts`) es su
 * escritor y no se toca.
 *
 * Cuando llegue el contract, este archivo se borra junto con la columna.
 */
import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@/core'
import { addSquadSeat } from './entries'
import { createSeason } from './season'
import { adminClient } from './test/admin'
import { createTestUser } from './test/users'

async function squadSeeds(seasonId: string): Promise<(number | null)[]> {
  const db = adminClient()
  const { data, error } = await db
    .from('entries')
    .select('seed_position')
    .eq('season_id', seasonId)
    .eq('kind', 'SQUAD')
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => row.seed_position)
}

describe('nadie escribe entries.seed_position en un asiento SQUAD (C37)', () => {
  it('createSeason crea el plantel sin seed_position', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason(admin.client, {
      name: 'Torneo sin seed en entries',
      squadNames: Array.from({ length: 8 }, (_, index) => `Jugador ${index + 1}`),
      config: defaultConfig(8),
    })

    expect(await squadSeeds(seasonId)).toEqual(Array.from({ length: 8 }, () => null))
  })

  it('add_squad_seat agrega el asiento sin seed_position', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason(admin.client, {
      name: 'Torneo que suma un asiento',
      squadNames: Array.from({ length: 8 }, (_, index) => `Jugador ${index + 1}`),
      config: defaultConfig(8),
    })

    const newId = await addSquadSeat(admin.client, seasonId, 'El noveno')

    const db = adminClient()
    const { data, error } = await db.from('entries').select('seed_position, kind').eq('id', newId).single()
    if (error) throw new Error(error.message)
    expect(data.kind).toBe('SQUAD')
    expect(data.seed_position).toBeNull()
    expect(await squadSeeds(seasonId)).toEqual(Array.from({ length: 9 }, () => null))
  })
})
