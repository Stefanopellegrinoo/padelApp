import { describe, expect, it } from 'vitest'
import { createMatchday, seedAttendances, setAttendance } from './matchday'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser } from './test/users'

// ── PR 8 — attendances.discipline_id (cierra el agujero que D1 abre) ───────
// Sin `attendances_entry_discipline` (0024) se podía marcar presente, en una
// fecha de FIFA, a alguien que sólo juega pádel: `attendances` sólo exigía
// que el asiento fuera de LA TEMPORADA, no de LA DISCIPLINA de esa fecha.

describe('attendances.discipline_id — FK contra discipline_entries (PR 8)', () => {
  it('marcar presente a alguien fuera de su disciplina falla por FK violation', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineIds } = await createSeason({
      admin,
      disciplines: [{ kind: 'PADEL' }, { kind: 'FIFA' }],
    })
    const [padelId, fifaId] = disciplineIds
    if (padelId === undefined || fifaId === undefined) throw new Error('Faltan disciplinas.')

    // El asiento entra SÓLO a pádel.
    const { data: padelOnlyEntry, error: seatError } = await admin.client.rpc('add_squad_seat', {
      p_season: seasonId,
      p_name: 'Sólo pádel',
      p_disciplines: [padelId],
    })
    if (seatError !== null || padelOnlyEntry === null) throw new Error(seatError?.message)

    const fifaMatchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    // `createMatchday` resuelve `discipline_id` con `defaultDisciplineId`
    // (`position, created_at` — pádel primero); se reasigna la fecha a FIFA a
    // mano para no depender de un wizard multi-disciplina que todavía no
    // existe (PR 11).
    const db = adminClient()
    const { error: reassignError } = await db
      .from('matchdays')
      .update({ discipline_id: fifaId })
      .eq('id', fifaMatchdayId)
    if (reassignError) throw new Error(reassignError.message)

    // S7, verify-report ronda 3: matcher específico, no cualquier rechazo —
    // sin él, este `rejects.toThrow()` pasaría igual con cualquier otro error.
    await expect(
      setAttendance(admin.client, fifaMatchdayId, padelOnlyEntry, 'PLAYING'),
    ).rejects.toThrow(/attendances_entry_discipline/)

    // Nada quedó escrito: el rechazo es de la base, sin fila a medias.
    const { data: attendanceRows, error: readError } = await db
      .from('attendances')
      .select('id')
      .eq('matchday_id', fifaMatchdayId)
    if (readError) throw new Error(readError.message)
    expect(attendanceRows).toHaveLength(0)
  })

  it('marcar presente a alguien QUE SÍ juega esa disciplina funciona', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineIds } = await createSeason({
      admin,
      disciplines: [{ kind: 'PADEL' }, { kind: 'FIFA' }],
    })
    const [padelId, fifaId] = disciplineIds
    if (padelId === undefined || fifaId === undefined) throw new Error('Faltan disciplinas.')

    const { data: bothEntry, error: seatError } = await admin.client.rpc('add_squad_seat', {
      p_season: seasonId,
      p_name: 'Las dos',
      p_disciplines: [padelId, fifaId],
    })
    if (seatError !== null || bothEntry === null) throw new Error(seatError?.message)

    const fifaMatchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    const db = adminClient()
    const { error: reassignError } = await db
      .from('matchdays')
      .update({ discipline_id: fifaId })
      .eq('id', fifaMatchdayId)
    if (reassignError) throw new Error(reassignError.message)

    await setAttendance(admin.client, fifaMatchdayId, bothEntry, 'PLAYING')

    const { data: attendanceRows, error: readError } = await db
      .from('attendances')
      .select('entry_id, discipline_id, status')
      .eq('matchday_id', fifaMatchdayId)
    if (readError) throw new Error(readError.message)
    expect(attendanceRows).toEqual([{ entry_id: bothEntry, discipline_id: fifaId, status: 'PLAYING' }])
  })

  // W6, verify-report ronda 3: `seedAttendances` pasó de leer el plantel de LA
  // TEMPORADA a leer `discipline_entries` de LA DISCIPLINA (PR 8,
  // db/matchday.ts), pero ningún test lo probaba — la factory siembra TODOS
  // los asientos en TODAS las disciplinas, así que las dos lecturas coinciden
  // en cada escenario existente. El único caso donde difieren es el solape
  // parcial, que este test arma a mano con `add_squad_seat`.
  it('seedAttendances siembra sólo el plantel de LA DISCIPLINA de la fecha, no el de toda la temporada', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineIds } = await createSeason({
      admin,
      disciplines: [{ kind: 'PADEL' }, { kind: 'FIFA' }],
    })
    const [padelId, fifaId] = disciplineIds
    if (padelId === undefined || fifaId === undefined) throw new Error('Faltan disciplinas.')

    const { data: padelOnlyEntry, error: padelOnlyError } = await admin.client.rpc('add_squad_seat', {
      p_season: seasonId,
      p_name: 'Sólo pádel',
      p_disciplines: [padelId],
    })
    if (padelOnlyError !== null || padelOnlyEntry === null) throw new Error(padelOnlyError?.message)

    const { data: bothEntry, error: bothError } = await admin.client.rpc('add_squad_seat', {
      p_season: seasonId,
      p_name: 'Las dos',
      p_disciplines: [padelId, fifaId],
    })
    if (bothError !== null || bothEntry === null) throw new Error(bothError?.message)

    const fifaMatchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    const db = adminClient()
    const { error: reassignError } = await db
      .from('matchdays')
      .update({ discipline_id: fifaId })
      .eq('id', fifaMatchdayId)
    if (reassignError) throw new Error(reassignError.message)

    await seedAttendances(admin.client, fifaMatchdayId)

    const { data: attendanceRows, error: readError } = await db
      .from('attendances')
      .select('entry_id')
      .eq('matchday_id', fifaMatchdayId)
    if (readError) throw new Error(readError.message)

    const seeded = new Set((attendanceRows ?? []).map((row) => row.entry_id))
    // Si `seedAttendances` volviera a leer `entries` por `season_id`+`kind`
    // (el código anterior a PR 8), el resto de la suite seguiría 258/258
    // verde y sólo este test lo notaría: sembraría también al que sólo juega
    // pádel.
    expect(seeded.has(bothEntry)).toBe(true)
    expect(seeded.has(padelOnlyEntry)).toBe(false)
  })
})
