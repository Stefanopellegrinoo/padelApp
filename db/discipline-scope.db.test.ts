import { describe, it, expect } from 'vitest'
import { defaultConfig, pair, type SeasonConfig } from '@/core'
import {
  cancelMatchday,
  createMatchday,
  generatePairs,
  matchdayContextFor,
  openMatchday,
  pairingContextFor,
  reopenMatchday,
  setAttendance,
  syncGuestSeat,
} from './matchday'
import { awardsOf, closedHistoryAll, matchdaysOf, seasonHeader } from './read'
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
  //`matchdays_discipline_size` (0028, REQ-D5-1) exige que `pair_size` de la
  // fecha coincida con el de SU disciplina — este helper crea fechas para
  // disciplinas pair_size=1 (W30, C15 abajo) y pair_size=2 (el resto), así
  // que no puede confiar en el default de columna (2).
  const { data: discipline, error: disciplineError } = await db
    .from('disciplines')
    .select('pair_size')
    .eq('id', disciplineId)
    .single()
  if (disciplineError || discipline === null) throw new Error(disciplineError?.message)
  const { data, error } = await db
    .from('matchdays')
    .insert({ season_id: seasonId, discipline_id: disciplineId, number, status, pair_size: discipline.pair_size })
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

// `b: null` para un lado de uno (`pairs_side_shape`, 0028): `pair_size` se
// deriva de la forma que el propio caller pide, mismo criterio que el check.
async function insertPair(matchdayId: string, seasonId: string, a: string, b: string | null): Promise<void> {
  const db = adminClient()
  const { error } = await db
    .from('pairs')
    .insert({ matchday_id: matchdayId, season_id: seasonId, entry_a: a, entry_b: b, pair_size: b === null ? 1 : 2 })
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

//── C1/C2 (0019_discipline_status_moves.sql) — el camino REAL, no fabricado ─
// Antes de 0019, disciplines.status nunca se movía: el estado derivado
// hubiera dicho SETUP para un torneo con una disciplina en curso. Este test
// llega al estado "pádel ACTIVE, FIFA SETUP" abriendo una fecha de verdad
// (generatePairs + openMatchday), no con un update de service_role — es
// justo el escenario que REQ-D3-3 pide y que el marcó
// sin cobertura end-to-end.
describe('estado derivado real: abrir una fecha por el camino real', () => {
  it('abrir la primera fecha de pádel mueve su disciplina a ACTIVE sin tocar a FIFA, y el header lo refleja', async () => {
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
    expect((await seasonHeader(admin.client, seasonId)).status).toBe('SETUP')

    //`disciplineId` explícito (S26, guarda de ambigüedad): la temporada
    // tiene dos disciplinas, así que omitirlo ahora tira en vez de adivinar
    // — la fecha que este test necesita es de pádel.
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10', padelId)
    for (const entryId of entryIds) {
      await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
    }
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)

    expect(await disciplineStatus(padelId)).toBe('ACTIVE')
    expect(await disciplineStatus(fifaId), 'FIFA no arrancó: nadie le abrió una fecha').toBe('SETUP')

    // El caso exacto de REQ-D3-3: una disciplina ACTIVE y otra SETUP -> ACTIVE.
    expect((await seasonHeader(admin.client, seasonId)).status).toBe('ACTIVE')
  })
})

// El test de C1/C2 de arriba YA ejercita esto de rebote (createMatchday con
// 2 disciplinas, antes rompía con PGRST116 vía `.single()` sobre season_id),
// pero su asunto declarado es derivedSeasonStatus, no createMatchday. Este
// test tiene una sola pregunta: ¿a qué disciplina queda scopeada la fecha
// nueva? — y la responde leyendo `discipline_id` directo, no por rebote de
// otro assert.
describe('createMatchday resuelve la disciplina por defecto', () => {
  it('sin disciplineId y con una sola disciplina, la fecha queda scopeada a esa disciplina', async () => {
    const admin = await createTestUser()
    const filler = await fillerPlayers(8)
    const { seasonId, disciplineId } = await createSeason({ admin, config: defaultConfig(8), squad: filler })

    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')

    const db = adminClient()
    const { data: matchday, error } = await db
      .from('matchdays')
      .select('discipline_id')
      .eq('id', matchdayId)
      .single()
    if (error || matchday === null) throw new Error(error?.message)
    expect(matchday.discipline_id).toBe(disciplineId)
  })

  // Con UNA sola disciplina, "no elegir" no es
  // ambiguo — hay una sola respuesta posible (el test de arriba). Con MÁS de
  // una, adivinar en silencio es exactamente la clase de bug que ya causó
  // C9, C12 y el de `matchdaysOf` en esta cadena: este test ANTES
  // aseveraba ese default a propósito ("la fecha nueva queda scopeada a la
  // primera disciplina por position, no a la última creada") — ya no es el
  // comportamiento correcto, así que se reescribe en vez de mantenerlo: la
  // ambigüedad ahora es un error, no una resolución silenciosa.
  it('sin disciplineId y con más de una disciplina, tira en vez de adivinar', async () => {
    const admin = await createTestUser()
    const filler = await fillerPlayers(8)
    const { seasonId } = await createSeason({
      admin,
      config: defaultConfig(8),
      squad: filler,
      disciplines: [{ kind: 'FIFA' }, { kind: 'PADEL' }],
    })

    await expect(createMatchday(admin.client, seasonId, '2026-08-10')).rejects.toThrow(/más de una disciplina/)
  })
})

//── C12 — createMatchday con disciplineId explícito ─
//(arriba) prueba el caso de una sola disciplina; esto prueba el lado que
// faltaba: el escritor puede apuntar CADA fecha a la disciplina que le
// corresponde, y dos disciplinas pueden tener cada una su fecha sin cerrar A
// LA VEZ pasando por el mismo `createMatchday` real (no fabricado) —
// REQ-D3-1 de punta a punta, no sólo a nivel de índice. Las dos llamadas
// pasan `disciplineId` explícito (S26, guarda de ambigüedad): con dos
// disciplinas, omitirlo ya no resuelve por default, tira.
describe('createMatchday con disciplineId explícito', () => {
  it('la fecha nueva queda en la disciplina que se le pasa, y las dos coexisten sin cerrar', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineIds } = await createSeason({
      admin,
      disciplines: [{ kind: 'PADEL' }, { kind: 'FIFA' }],
    })
    const [padelId, fifaId] = disciplineIds
    if (padelId === undefined || fifaId === undefined) throw new Error('Faltan disciplinas.')

    const padelMatchdayId = await createMatchday(admin.client, seasonId, '2026-08-10', padelId)
    const fifaMatchdayId = await createMatchday(admin.client, seasonId, '2026-08-10', fifaId)

    const db = adminClient()
    const { data: rows, error } = await db
      .from('matchdays')
      .select('id, discipline_id')
      .in('id', [padelMatchdayId, fifaMatchdayId])
    if (error) throw new Error(error.message)
    const disciplineOf = new Map((rows ?? []).map((row) => [row.id, row.discipline_id]))
    expect(disciplineOf.get(padelMatchdayId)).toBe(padelId)
    expect(disciplineOf.get(fifaMatchdayId)).toBe(fifaId)
  })
})

//── C4 — lecturas de producción scopeadas por disciplina, no por temporada ─
// Antes del fix, las cinco funciones de abajo filtraban `matchdays` por
// `season_id`: con dos disciplinas compartiendo número de fecha (posible
// desde que 0018 sacó el tripwire), `closedHistory` rompía con PGRST116
// ("the result contains 2 rows") y `matchdaysOf`/`closedHistoryAll`/
// `awardsOf` devolvían filas de las DOS disciplinas mezcladas. Acá se prueba
// que cada una queda scopeada a UNA sola disciplina — la que corresponde —
// aunque la otra tenga exactamente el mismo número de fecha.
describe('lecturas de producción scopeadas por disciplina, no por temporada', () => {
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
    expect(padelHistory?.sides).toEqual([pair(a, b)])

    const fifaHistory = await closedHistory(admin.client, fifaId, 1)
    expect(fifaHistory?.sides).toEqual([pair(c, d)])
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
    expect(before.get(1)).toEqual([{ entryId: a, position: 1, points: 10, lines: [] }])
  })

  it('closedHistoryAll trae sólo las fechas cerradas de la disciplina por defecto', async () => {
    const { admin, seasonId, padelId, fifaId, a, b, c, d } = await twoDisciplineSeason()

    const padelClosed = await insertMatchday(seasonId, padelId, 1, 'CLOSED')
    const fifaClosed = await insertMatchday(seasonId, fifaId, 1, 'CLOSED')
    await insertPair(padelClosed, seasonId, a, b)
    await insertPair(fifaClosed, seasonId, c, d)

    const history = await closedHistoryAll(admin.client, seasonId)
    expect(history).toHaveLength(1)
    expect(history[0]?.sides).toEqual([pair(a, b)])
  })

  it('awardsOf trae sólo los premios de la disciplina por defecto', async () => {
    const { admin, seasonId, padelId, fifaId, a, c } = await twoDisciplineSeason()

    const padelClosed = await insertMatchday(seasonId, padelId, 1, 'CLOSED')
    const fifaClosed = await insertMatchday(seasonId, fifaId, 1, 'CLOSED')
    await insertAward(padelClosed, seasonId, a, 1, 10)
    await insertAward(fifaClosed, seasonId, c, 1, 99)

    const map = await awardsOf(admin.client, seasonId)
    expect(map.get(1)).toEqual([{ entryId: a, position: 1, points: 10, lines: [] }])
  })
})

// Antes de esta tanda, `matchdayContextFor`/`pairingContextFor` pasaban un
// `2` literal a `assertValidConfig`/`assertMatchdaySize` aunque
// `disciplineConfig` ya leía la fila de `disciplines` donde vive `pair_size`
// — el valor real estaba a una columna del select que ya corría. Medido
// antes del fix: esta misma escena tiraba "El plantel tiene que ser un
// número par." contra una disciplina de a uno con plantel impar.
describe('matchdayContextFor/pairingContextFor leen el pair_size real', () => {
  it('una disciplina pair_size=1 con plantel impar no tropieza con la paridad de a dos', async () => {
    const admin = await createTestUser()
    const filler = await fillerPlayers(9)
    const config: SeasonConfig = {
      ...defaultConfig(8),
      squadSize: 9,
      points: [10, 9, 8, 7, 6, 5, 4, 3, 2],
    }
    const { seasonId, disciplineIds, entryIds } = await createSeason({
      admin,
      squad: filler,
      disciplines: [{ kind: 'FIFA', pairSize: 1, config }],
    })
    const [fifaId] = disciplineIds
    if (fifaId === undefined) throw new Error('Falta la disciplina.')
    const matchdayId = await insertMatchday(seasonId, fifaId, 1, 'DRAFT')
    for (const entryId of entryIds) {
      await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
    }

    const context = await matchdayContextFor(admin.client, matchdayId)
    expect(context.pairSize).toBe(1)

    const pairingContext = await pairingContextFor(admin.client, matchdayId)
    expect(pairingContext.input.present).toHaveLength(9)
  })
})

//── C15 — syncGuestSeat no inventa invitados en 1v1 ─
// Antes de esta tanda, `syncGuestSeat` calculaba `isOdd` sobre el headcount
// sin mirar `pair_size`: en una disciplina de a uno, un plantel impar es
// NORMAL (cada presente es su propio lado) y no le falta nadie — pero la
// función igual insertaba un GUEST fantasma (nombre vacío) y borraba el
// sorteo de paso. Medido antes del fix: 0 filas GUEST antes, 1 después.
describe('syncGuestSeat no inventa un invitado en una disciplina de a uno', () => {
  it('con pair_size=1 y presentes impares, no crea GUEST ni toca las parejas', async () => {
    const admin = await createTestUser()
    const filler = await fillerPlayers(9)
    const { seasonId, disciplineIds, entryIds } = await createSeason({
      admin,
      squad: filler,
      disciplines: [{ kind: 'FIFA', pairSize: 1 }],
    })
    const [fifaId] = disciplineIds
    if (fifaId === undefined) throw new Error('Falta la disciplina.')
    const matchdayId = await insertMatchday(seasonId, fifaId, 1, 'DRAFT')
    for (const entryId of entryIds) {
      await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
    }
    const [a] = entryIds
    if (a === undefined) throw new Error('Falta un asiento.')
    // Lado de uno real (pair_size=1, entry_b null) — antes de 0028 esto se
    // representaba con un segundo entry_b prestado porque la columna era
    // `not null`; ahora la fila se puede escribir con la forma que le
    // corresponde a esta disciplina.
    await insertPair(matchdayId, seasonId, a, null)

    await syncGuestSeat(admin.client, matchdayId)

    const db = adminClient()
    const { data: guests, error: guestsError } = await db
      .from('entries')
      .select('id')
      .eq('matchday_id', matchdayId)
      .eq('kind', 'GUEST')
    if (guestsError) throw new Error(guestsError.message)
    expect(guests).toHaveLength(0)

    const { data: pairs, error: pairsError } = await db
      .from('pairs')
      .select('id')
      .eq('matchday_id', matchdayId)
    if (pairsError) throw new Error(pairsError.message)
    expect(pairs).toHaveLength(1)
  })
})
