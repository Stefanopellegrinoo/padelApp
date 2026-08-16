import { describe, it, expect } from 'vitest'
import { defaultConfig } from '@/core'
import { cancelMatchday, createMatchday, generatePairs, openMatchday, reopenMatchday, setAttendance } from './matchday'
import { awardsOf, closedHistoryAll, derivedSeasonStatus, matchdaysOf } from './read'
import { awardsBefore, closedHistory } from './season'
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

async function insertPair(matchdayId: string, seasonId: string, a: string, b: string): Promise<void> {
  const db = adminClient()
  const { error } = await db
    .from('pairs')
    .insert({ matchday_id: matchdayId, season_id: seasonId, entry_a: a, entry_b: b })
  if (error) throw new Error(error.message)
}

async function insertAward(
  matchdayId: string,
  seasonId: string,
  entryId: string,
  position: number,
  points: number,
): Promise<void> {
  const db = adminClient()
  const { error } = await db
    .from('awards')
    .insert({ matchday_id: matchdayId, season_id: seasonId, entry_id: entryId, position, points })
  if (error) throw new Error(error.message)
}

async function fillerPlayers(count: number): Promise<string[]> {
  const db = adminClient()
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    const { data, error } = await db
      .from('players')
      .insert({ display_name: `Relleno de test ${Date.now()}-${i}-${Math.random()}` })
      .select('id')
      .single()
    if (error || data === null) throw new Error(error?.message)
    ids.push(data.id)
  }
  return ids
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

// ── C1/C2 (0019_discipline_status_moves.sql) — el camino REAL, no fabricado ─
// Antes de 0019, disciplines.status nunca se movía: `derivedSeasonStatus`
// hubiera dicho SETUP para un torneo con una disciplina en curso. Este test
// llega al estado "pádel ACTIVE, FIFA SETUP" abriendo una fecha de verdad
// (generatePairs + openMatchday), no con un update de service_role — es
// justo el escenario que REQ-D3-3 pide y que el verify-report (C2) marcó
// sin cobertura end-to-end.
describe('estado derivado real: abrir una fecha por el camino real (C1, C2)', () => {
  it('abrir la primera fecha de pádel mueve su disciplina a ACTIVE sin tocar a FIFA, y derivedSeasonStatus lo refleja', async () => {
    const admin = await createTestUser()
    const filler = await fillerPlayers(8)
    const { seasonId, disciplineIds, entryIds } = await createSeason({
      admin,
      config: defaultConfig(8),
      squad: filler,
      disciplines: [{ kind: 'PADEL' }, { kind: 'FIFA' }],
    })
    const [padelId, fifaId] = disciplineIds
    if (padelId === undefined || fifaId === undefined) throw new Error('Faltan disciplinas.')

    // Recién creada: las dos disciplinas en SETUP, la temporada también.
    expect(await derivedSeasonStatus(admin.client, seasonId)).toBe('SETUP')

    // `createMatchday` resuelve la disciplina por defecto (`position` 0 =
    // pádel, ver `defaultDisciplineId`): la fecha que arma es de pádel.
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    for (const entryId of entryIds) {
      await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
    }
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)

    expect(await disciplineStatus(padelId)).toBe('ACTIVE')
    expect(await disciplineStatus(fifaId), 'FIFA no arrancó: nadie le abrió una fecha').toBe('SETUP')

    // El caso exacto de REQ-D3-3: una disciplina ACTIVE y otra SETUP -> ACTIVE.
    expect(await derivedSeasonStatus(admin.client, seasonId)).toBe('ACTIVE')
  })
})

// ── C4 — lecturas de producción scopeadas por disciplina, no por temporada ─
// Antes del fix, las cinco funciones de abajo filtraban `matchdays` por
// `season_id`: con dos disciplinas compartiendo número de fecha (posible
// desde que 0018 sacó el tripwire), `closedHistory` rompía con PGRST116
// ("the result contains 2 rows") y `matchdaysOf`/`closedHistoryAll`/
// `awardsOf` devolvían filas de las DOS disciplinas mezcladas. Acá se prueba
// que cada una queda scopeada a UNA sola disciplina — la que corresponde —
// aunque la otra tenga exactamente el mismo número de fecha.
describe('lecturas de producción scopeadas por disciplina, no por temporada (C4)', () => {
  async function twoDisciplineSeason() {
    const admin = await createTestUser()
    const filler = await fillerPlayers(4)
    const { seasonId, disciplineIds, entryIds } = await createSeason({
      admin,
      squad: filler,
      disciplines: [{ kind: 'PADEL' }, { kind: 'FIFA' }],
    })
    const [padelId, fifaId] = disciplineIds
    const [a, b, c, d] = entryIds
    if (
      padelId === undefined ||
      fifaId === undefined ||
      a === undefined ||
      b === undefined ||
      c === undefined ||
      d === undefined
    ) {
      throw new Error('Falta escenario de test.')
    }
    return { admin, seasonId, padelId, fifaId, a, b, c, d }
  }

  it('closedHistory no cruza dos fechas número 1 de disciplinas distintas (antes: PGRST116)', async () => {
    const { admin, seasonId, padelId, fifaId, a, b, c, d } = await twoDisciplineSeason()

    const padelMd = await insertMatchday(seasonId, padelId, 1, 'CLOSED')
    const fifaMd = await insertMatchday(seasonId, fifaId, 1, 'CLOSED')
    await insertPair(padelMd, seasonId, a, b)
    await insertPair(fifaMd, seasonId, c, d)

    const padelHistory = await closedHistory(admin.client, padelId, 1)
    expect(padelHistory?.pairs).toEqual([{ a, b }])

    const fifaHistory = await closedHistory(admin.client, fifaId, 1)
    expect(fifaHistory?.pairs).toEqual([{ a: c, b: d }])
  })

  it('matchdaysOf no duplica la fecha 1 cuando hay dos disciplinas', async () => {
    const { admin, seasonId, padelId, fifaId } = await twoDisciplineSeason()

    const padelMd = await insertMatchday(seasonId, padelId, 1, 'DRAFT')
    await insertMatchday(seasonId, fifaId, 1, 'DRAFT')

    const list = await matchdaysOf(admin.client, seasonId)
    expect(list).toHaveLength(1)
    expect(list[0]?.id).toBe(padelMd)
    expect(list[0]?.disciplineId).toBe(padelId)
  })

  it('awardsBefore no mezcla los premios de la otra disciplina', async () => {
    const { admin, seasonId, padelId, fifaId, a, c } = await twoDisciplineSeason()

    const padelClosed = await insertMatchday(seasonId, padelId, 1, 'CLOSED')
    const fifaClosed = await insertMatchday(seasonId, fifaId, 1, 'CLOSED')
    await insertAward(padelClosed, seasonId, a, 1, 10)
    await insertAward(fifaClosed, seasonId, c, 1, 99)

    const before = await awardsBefore(admin.client, padelId, 2)
    expect(before.get(1)).toEqual([{ entryId: a, position: 1, points: 10 }])
  })

  it('closedHistoryAll trae sólo las fechas cerradas de la disciplina por defecto', async () => {
    const { admin, seasonId, padelId, fifaId, a, b, c, d } = await twoDisciplineSeason()

    const padelClosed = await insertMatchday(seasonId, padelId, 1, 'CLOSED')
    const fifaClosed = await insertMatchday(seasonId, fifaId, 1, 'CLOSED')
    await insertPair(padelClosed, seasonId, a, b)
    await insertPair(fifaClosed, seasonId, c, d)

    const history = await closedHistoryAll(admin.client, seasonId)
    expect(history).toHaveLength(1)
    expect(history[0]?.pairs).toEqual([{ a, b }])
  })

  it('awardsOf trae sólo los premios de la disciplina por defecto', async () => {
    const { admin, seasonId, padelId, fifaId, a, c } = await twoDisciplineSeason()

    const padelClosed = await insertMatchday(seasonId, padelId, 1, 'CLOSED')
    const fifaClosed = await insertMatchday(seasonId, fifaId, 1, 'CLOSED')
    await insertAward(padelClosed, seasonId, a, 1, 10)
    await insertAward(fifaClosed, seasonId, c, 1, 99)

    const map = await awardsOf(admin.client, seasonId)
    expect(map.get(1)).toEqual([{ entryId: a, position: 1, points: 10 }])
  })
})
