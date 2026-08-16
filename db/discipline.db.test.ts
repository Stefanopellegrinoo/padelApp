import { describe, it, expect } from 'vitest'
import { createMatchday } from './matchday'
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

// ── PR 2 — matchdays scopeadas por disciplina ───────────────────────────────
// El tripwire de PR 1 sigue puesto: todavía no hay forma de tener dos
// disciplinas en la misma temporada para probar el scoping en los dos
// sentidos (eso es PR 4, cuando cae el índice). Lo que sí es de PR 2: que
// `createMatchday` escribe `discipline_id` sola, que `matchday_discipline`
// existe y contesta bien, y que la columna es de verdad NOT NULL.
describe('matchdays.discipline_id (PR 2)', () => {
  it('createMatchday escribe discipline_id sin que el caller lo pase (REQ-D3-1/2)', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineId } = await createSeason({ admin })

    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')

    const db = adminClient()
    const { data, error } = await db
      .from('matchdays')
      .select('discipline_id')
      .eq('id', matchdayId)
      .single()
    if (error || data === null) throw new Error(error?.message)
    expect(data.discipline_id).toBe(disciplineId)
  })

  it('matchday_discipline(p_matchday) devuelve la disciplina de la fecha', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineId } = await createSeason({ admin })
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')

    const { data, error } = await admin.client.rpc('matchday_discipline', { p_matchday: matchdayId })

    expect(error).toBeNull()
    expect(data).toBe(disciplineId)
  })

  it('discipline_id es NOT NULL: un insert que lo omite falla (REQ-NR-3)', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason({ admin })

    const db = adminClient()
    // `database.types.ts` ya exige discipline_id acá — bien, es justo lo que
    // este test pinnea —, pero el caso real es un caller que lo saltea (SQL a
    // mano, un tipo desactualizado). El cast fuerza ese payload inválido.
    const { error } = await db
      .from('matchdays')
      .insert({ season_id: seasonId, number: 1 } as never)

    expect(error?.code).toBe('23502')
  })
})
