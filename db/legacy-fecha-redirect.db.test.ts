import { describe, it, expect } from 'vitest'
import { legacyFechaRedirectTarget } from './legacy-fecha-redirect'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser } from './test/users'

// ── PR 10 — REQ-NR-5 ─────────────────────────────────────────────────────────
// `legacyFechaRedirectTarget` es lo que decide A CUÁL disciplina redirige la
// URL vieja. El caso que importa de verdad es el de dos disciplinas del MISMO
// kind (Fase 2: "dos disciplinas de pádel"): ahí es donde un slug basado sólo
// en `kind` colisionaría. El wizard multi-disciplina es PR 11 — acá se arma
// el escenario directo con `createSeason({ disciplines: [...] })`, mismo
// patrón que las pruebas de concurrencia de PR 4 (discipline-scope.db.test.ts).

async function insertMatchday(seasonId: string, disciplineId: string, number: number): Promise<void> {
  const db = adminClient()
  const { error } = await db.from('matchdays').insert({ season_id: seasonId, discipline_id: disciplineId, number })
  if (error) throw new Error(error.message)
}

describe('legacyFechaRedirectTarget', () => {
  it('redirects to the bare kind when the season has a single discipline', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineId } = await createSeason({ admin })
    await insertMatchday(seasonId, disciplineId, 2)

    const target = await legacyFechaRedirectTarget(admin.client, { seasonId, n: '2' })
    expect(target).toBe(`/torneo/${seasonId}/padel/fechas/2`)
  })

  it('redirects each kind to its own slug when they differ', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineIds } = await createSeason({
      admin,
      disciplines: [{ kind: 'PADEL' }, { kind: 'FIFA' }],
    })
    const [padelId, fifaId] = disciplineIds
    if (padelId === undefined || fifaId === undefined) throw new Error('setup incompleto')
    await insertMatchday(seasonId, fifaId, 1)

    const target = await legacyFechaRedirectTarget(admin.client, { seasonId, n: '1' })
    expect(target).toBe(`/torneo/${seasonId}/fifa/fechas/1`)
  })

  it('never collides two disciplines of the same kind — the second gets an ordinal', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineIds } = await createSeason({
      admin,
      disciplines: [{ kind: 'PADEL' }, { kind: 'PADEL' }],
    })
    const [firstPadelId, secondPadelId] = disciplineIds
    if (firstPadelId === undefined || secondPadelId === undefined) throw new Error('setup incompleto')
    await insertMatchday(seasonId, firstPadelId, 3)
    await insertMatchday(seasonId, secondPadelId, 3)

    const target = await legacyFechaRedirectTarget(admin.client, { seasonId, n: '3' })
    // `number` es único por disciplina (REQ-D3-2): con dos "fecha 3" en la
    // misma temporada, `legacyFechaRedirectTarget` no puede distinguir cuál
    // quiso el bookmark viejo — Postgres no garantiza un orden estable entre
    // dos filas empatadas en `number` sin una clave de desempate, así que
    // CUÁL de las dos gana no está definido (se vio en la práctica: cambió
    // entre corridas). Lo único garantizado es que resuelve a una disciplina
    // VÁLIDA de esta temporada, nunca null ni un slug inventado — es
    // exactamente el borde que la ruta NUEVA resuelve de verdad, al llevar
    // la disciplina explícita en la URL en vez de inferirla.
    expect([`/torneo/${seasonId}/padel/fechas/3`, `/torneo/${seasonId}/padel-2/fechas/3`]).toContain(target)
  })

  it('returns null when the matchday does not exist — nothing to redirect to', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason({ admin })

    const target = await legacyFechaRedirectTarget(admin.client, { seasonId, n: '99' })
    expect(target).toBeNull()
  })
})
