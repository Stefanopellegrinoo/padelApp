import { describe, expect, it } from 'vitest'
import type { MatchdayFormat } from '@/core'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser } from './test/users'

/**
 * `matchdays.formato` (0040, REQ-D8-1) es el CUARTO column-grant de la misma
 * trampa que `discipline_id` (0015), `pair_size` (0028) y `allows_draw`
 * (0034): `matchdays` tiene grants a nivel COLUMNA (0002_rls.sql:236-238), y
 * sin el grant un insert/update de `authenticated` que manda `formato` falla
 * con "permission denied for table matchdays" — un mensaje que no nombra la
 * columna.
 *
 * A diferencia de los otros tres, `formato` es el ÚNICO que también necesita
 * `grant update`: el formato se elige DESPUÉS de crear la fecha, ANTES de
 * armar (REQ-D8-1, "editable antes de armar") — los otros tres se fijan al
 * crear y no cambian más. Un test que sólo cubra `insert` no alcanza.
 *
 * Los dos verbos se ejercitan con `admin.client` (rol `authenticated`),
 * NUNCA con `adminClient()` (`service_role`): con `service_role` PostgREST no
 * aplica RLS ni column grants, y el test pasaría en verde mintiendo.
 */
async function scene() {
  const admin = await createTestUser()
  const { seasonId, disciplineId } = await createSeason({ admin })
  return { admin, seasonId, disciplineId }
}

const groupsFormat: MatchdayFormat = { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 }

describe('matchdays.formato — column-grant contra authenticated (REQ-D8-1)', () => {
  it('authenticated crea una fecha mandando formato explícito, sin "permission denied"', async () => {
    const { admin, seasonId, disciplineId } = await scene()

    const { data, error } = await admin.client
      .from('matchdays')
      .insert({
        season_id: seasonId,
        discipline_id: disciplineId,
        number: 1,
        played_on: '2026-03-05',
        pair_size: 2,
        allows_draw: false,
        formato: { kind: 'ROUND_ROBIN' },
      })
      .select('id')
      .single()

    expect(error).toBeNull()
    expect(data).not.toBeNull()
  })

  it('authenticated actualiza el formato de una fecha ya creada (editable antes de armar)', async () => {
    const { admin, seasonId, disciplineId } = await scene()
    const { data: created, error: createError } = await admin.client
      .from('matchdays')
      .insert({
        season_id: seasonId,
        discipline_id: disciplineId,
        number: 1,
        played_on: '2026-03-05',
        pair_size: 2,
        allows_draw: false,
      })
      .select('id')
      .single()
    if (createError || created === null) throw new Error(createError?.message)

    const { error: updateError } = await admin.client
      .from('matchdays')
      .update({ formato: groupsFormat })
      .eq('id', created.id)
    expect(updateError).toBeNull()

    const db = adminClient()
    const { data, error } = await db.from('matchdays').select('formato').eq('id', created.id).single()
    if (error || data === null) throw new Error(error?.message)
    expect(data.formato).toEqual(groupsFormat)
  })

  it('una fecha nueva nace con formato ROUND_ROBIN por default (REQ-D7-1, no-regresión)', async () => {
    const { admin, seasonId, disciplineId } = await scene()
    const { data: created, error } = await admin.client
      .from('matchdays')
      .insert({
        season_id: seasonId,
        discipline_id: disciplineId,
        number: 1,
        played_on: '2026-03-05',
        pair_size: 2,
        allows_draw: false,
      })
      .select('formato')
      .single()
    if (error || created === null) throw new Error(error?.message)

    expect(created.formato).toEqual({ kind: 'ROUND_ROBIN' })
  })
})
