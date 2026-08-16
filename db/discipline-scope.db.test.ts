import { describe, it, expect } from 'vitest'
import { cancelMatchday, reopenMatchday } from './matchday'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser } from './test/users'

// ── PR 4 — el tripwire cae, reopen/cancel ya scopean por disciplina ────────
// Antes de este archivo, `disciplines_one_per_season` (0015) hacía IMPOSIBLE
// construir el escenario que estos tests necesitan: dos disciplinas del
// mismo torneo, cada una con su propio calendario. 0018 saca ese índice y
// arregla reopen_matchday/cancel_matchday en el MISMO archivo — acá se prueba
// que las dos cosas pasaron juntas.
//
// Los matchdays se insertan directo con service_role, en el estado que cada
// test necesita (CLOSED, DRAFT vacía, OPEN con datos): no hace falta pasar
// por generatePairs/openMatchday/closeMatchday para probar el SCOPING de las
// dos funciones, que es lo único que cambió acá.

async function insertMatchday(
  seasonId: string,
  disciplineId: string,
  number: number,
  status: 'DRAFT' | 'OPEN' | 'CLOSED',
): Promise<string> {
  const db = adminClient()
  const { data, error } = await db
    .from('matchdays')
    .insert({ season_id: seasonId, discipline_id: disciplineId, number, status })
    .select('id')
    .single()
  if (error || data === null) throw new Error(error?.message)
  return data.id
}

async function matchdayExists(matchdayId: string): Promise<boolean> {
  const db = adminClient()
  const { data, error } = await db.from('matchdays').select('id').eq('id', matchdayId).maybeSingle()
  if (error) throw new Error(error.message)
  return data !== null
}

async function matchdayStatus(matchdayId: string): Promise<string> {
  const db = adminClient()
  const { data, error } = await db.from('matchdays').select('status').eq('id', matchdayId).single()
  if (error || data === null) throw new Error(error?.message)
  return data.status
}

async function disciplineStatus(disciplineId: string): Promise<string> {
  const db = adminClient()
  const { data, error } = await db.from('disciplines').select('status').eq('id', disciplineId).single()
  if (error || data === null) throw new Error(error?.message)
  return data.status
}

describe('dos disciplinas concurrentes (PR 4)', () => {
  it('el tripwire ya no existe: una temporada admite pádel y FIFA a la vez (REQ-D1-1, REQ-D4-3)', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineIds } = await createSeason({
      admin,
      disciplines: [{ kind: 'PADEL' }, { kind: 'FIFA' }],
    })

    expect(disciplineIds).toHaveLength(2)
    const db = adminClient()
    const { data, error } = await db.from('disciplines').select('id').eq('season_id', seasonId)
    if (error) throw new Error(error.message)
    expect(data).toHaveLength(2)
  })

  it('dos fechas OPEN simultáneas, una por disciplina, no violan matchdays_one_live (REQ-D3-1)', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineIds } = await createSeason({
      admin,
      disciplines: [{ kind: 'PADEL' }, { kind: 'FIFA' }],
    })
    const [padelId, fifaId] = disciplineIds
    if (padelId === undefined || fifaId === undefined) throw new Error('Faltan disciplinas.')

    const padelOpen = await insertMatchday(seasonId, padelId, 1, 'OPEN')
    const fifaOpen = await insertMatchday(seasonId, fifaId, 1, 'OPEN')

    expect(await matchdayStatus(padelOpen)).toBe('OPEN')
    expect(await matchdayStatus(fifaOpen)).toBe('OPEN')
  })

  it('el número de fecha es único por disciplina, no por temporada (REQ-D3-2)', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineIds } = await createSeason({
      admin,
      disciplines: [{ kind: 'PADEL' }, { kind: 'FIFA' }],
    })
    const [padelId, fifaId] = disciplineIds
    if (padelId === undefined || fifaId === undefined) throw new Error('Faltan disciplinas.')

    const padelThree = await insertMatchday(seasonId, padelId, 3, 'DRAFT')
    const fifaThree = await insertMatchday(seasonId, fifaId, 3, 'DRAFT')

    expect(padelThree).not.toBe(fifaThree)
  })

  it('reopen_matchday sólo borra la DRAFT vacía de su propia disciplina (REQ-D4-1)', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineIds } = await createSeason({
      admin,
      disciplines: [{ kind: 'PADEL' }, { kind: 'FIFA' }],
    })
    const [padelId, fifaId] = disciplineIds
    if (padelId === undefined || fifaId === undefined) throw new Error('Faltan disciplinas.')

    await insertMatchday(seasonId, padelId, 1, 'CLOSED')
    const padelToReopen = await insertMatchday(seasonId, padelId, 2, 'CLOSED')
    const padelEmptyDraft = await insertMatchday(seasonId, padelId, 3, 'DRAFT')
    const fifaEmptyDraft = await insertMatchday(seasonId, fifaId, 1, 'DRAFT')

    await reopenMatchday(admin.client, padelToReopen)

    expect(await matchdayStatus(padelToReopen)).toBe('OPEN')
    expect(await matchdayExists(padelEmptyDraft)).toBe(false)
    expect(await matchdayExists(fifaEmptyDraft)).toBe(true)
  })

  it('reopen_matchday no se frena por una fecha sin cerrar de OTRA disciplina (REQ-D4-1)', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineIds } = await createSeason({
      admin,
      disciplines: [{ kind: 'PADEL' }, { kind: 'FIFA' }],
    })
    const [padelId, fifaId] = disciplineIds
    if (padelId === undefined || fifaId === undefined) throw new Error('Faltan disciplinas.')

    await insertMatchday(seasonId, padelId, 1, 'CLOSED')
    const padelToReopen = await insertMatchday(seasonId, padelId, 2, 'CLOSED')
    // FIFA con una fecha sin cerrar: bajo el season_id-scoping viejo, esto
    // rebotaba la reapertura de pádel citando datos de FIFA.
    await insertMatchday(seasonId, fifaId, 1, 'OPEN')

    await reopenMatchday(admin.client, padelToReopen)

    expect(await matchdayStatus(padelToReopen)).toBe('OPEN')
  })

  it('cancel_matchday revierte disciplines.status a SETUP scopeado por disciplina (REQ-D4-2)', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineIds } = await createSeason({
      admin,
      disciplines: [{ kind: 'PADEL' }, { kind: 'FIFA' }],
    })
    const [padelId, fifaId] = disciplineIds
    if (padelId === undefined || fifaId === undefined) throw new Error('Faltan disciplinas.')

    // Nada en el alcance de PR 1-4 escribe disciplines.status = ACTIVE
    // todavía (eso es open_matchday, de una fase posterior): se fabrica acá
    // con service_role, igual que en core/season.test.ts y en
    // db/discipline.db.test.ts.
    const db = adminClient()
    const { error: statusError } = await db
      .from('disciplines')
      .update({ status: 'ACTIVE' })
      .in('id', [padelId, fifaId])
    if (statusError) throw new Error(statusError.message)

    const padelOpen = await insertMatchday(seasonId, padelId, 1, 'OPEN')
    // FIFA "con fechas jugadas": dos CLOSED, para que quede activa.
    await insertMatchday(seasonId, fifaId, 1, 'CLOSED')
    await insertMatchday(seasonId, fifaId, 2, 'CLOSED')

    await cancelMatchday(admin.client, padelOpen)

    expect(await matchdayExists(padelOpen)).toBe(false)
    expect(await disciplineStatus(padelId)).toBe('SETUP')
    expect(await disciplineStatus(fifaId), 'FIFA no lo bloquea ni lo altera').toBe('ACTIVE')
  })
})
