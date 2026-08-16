import { describe, it, expect } from 'vitest'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser } from './test/users'

// ── PR 1 — fundamento de `disciplines` ──────────────────────────────────────
// Todavía no hay wizard multi-disciplina (llega en PR 11): estos tests
// ejercitan la tabla y sus permisos directamente, con el mismo scaffolding de
// service_role que el resto de `db/*.db.test.ts`.

describe('disciplines', () => {
  it('la temporada nace con exactamente una disciplina PADEL con la forma documentada', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineId, disciplineIds } = await createSeason({ admin })
    expect(disciplineIds).toEqual([disciplineId])

    const db = adminClient()
    const { data, error } = await db
      .from('disciplines')
      .select('id, season_id, kind, status, weight, pair_size, allows_draw, has_masters, position')
      .eq('season_id', seasonId)
    if (error) throw new Error(error.message)

    expect(data).toHaveLength(1)
    const row = data?.[0]
    expect(row?.id).toBe(disciplineId)
    expect(row?.kind).toBe('PADEL')
    expect(row?.status).toBe('SETUP')
    // numeric(4,2) viaja como string por PostgREST (riesgo documentado en el diseño).
    expect(Number(row?.weight)).toBe(1)
    expect(row?.pair_size).toBe(2)
    expect(row?.allows_draw).toBe(false)
    expect(row?.has_masters).toBe(true)
    expect(row?.position).toBe(0)
  })

  // El tripwire vive hasta que PR 4 (0018) lo saca en el mismo archivo que
  // arregla reopen_matchday/cancel_matchday. Mientras tanto una temporada NO
  // puede tener dos disciplinas — es la garantía que evita que reopen/cancel
  // se rompan por season_id antes de que estén scopeadas por discipline_id.
  it('el tripwire disciplines_one_per_season rechaza una segunda disciplina para la misma temporada', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason({ admin })

    const db = adminClient()
    const { error } = await db
      .from('disciplines')
      .insert({ season_id: seasonId, kind: 'FIFA', config: {} })

    expect(error?.code).toBe('23505')
  })

  // Sin el grant de columna, esto rebota con "permission denied for table
  // matchdays" — el mismo agujero silencioso que documenta 0002_rls.sql:236,
  // ahora sobre una columna nueva.
  it('un admin autenticado puede insertar discipline_id en matchdays (grant de columna, REQ-NR-6)', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineId } = await createSeason({ admin })

    const { data, error } = await admin.client
      .from('matchdays')
      .insert({ season_id: seasonId, number: 1, discipline_id: disciplineId })
      .select('id')
      .single()

    expect(error).toBeNull()
    expect(data?.id).toBeTypeOf('string')
  })
})
