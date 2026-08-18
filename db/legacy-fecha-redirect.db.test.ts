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
    // Orden de INSERCIÓN a propósito invertido respecto del orden de
    // DISCIPLINA (`position`): la fila de `secondPadelId` (position=1) se
    // graba primero. Un desempate que dependiera del orden físico/de
    // inserción de `matchdays` (el bug de C10) resolvería acá a
    // `secondPadelId` — el fix real usa el orden de `header.disciplines`
    // (`position, created_at`), no el de inserción, así que el resultado
    // correcto sigue siendo `firstPadelId` pase lo que pase con `matchdays`.
    await insertMatchday(seasonId, secondPadelId, 3)
    await insertMatchday(seasonId, firstPadelId, 3)

    const target = await legacyFechaRedirectTarget(admin.client, { seasonId, n: '3' })
    // C10 (verify-report ronda 5): `number` es único por disciplina
    // (REQ-D3-2), no por temporada — con dos "fecha 3" en la misma
    // temporada, el desempate ya NO es "cualquier disciplina válida": la
    // primera del orden de la temporada (`position, created_at`) gana,
    // porque es la que existía cuando el bookmark viejo se guardó. La
    // factory inserta cada disciplina en su propio insert con `position:
    // index` (arriba, ver `db/test/factories.ts`), así que `firstPadelId`
    // queda en `position=0` — determinístico, no un empate real de la
    // factory (ese es el riesgo S13 de `createSeason` en PRODUCCIÓN, que
    // inserta N filas en un solo statement; no aplica acá).
    expect(target).toBe(`/torneo/${seasonId}/padel/fechas/3`)
  })

  it('returns null when the matchday does not exist — nothing to redirect to', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason({ admin })

    const target = await legacyFechaRedirectTarget(admin.client, { seasonId, n: '99' })
    expect(target).toBeNull()
  })
})
