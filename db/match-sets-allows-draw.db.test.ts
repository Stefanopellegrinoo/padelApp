import { describe, expect, it } from 'vitest'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser } from './test/users'

// Persistir un partido empatado sólo si `disciplines.allows_draw = true`;
// seguir rechazándolo si es `false`. `match_sets` sólo conoce `match_id`, así
// que `allows_draw` viaja `disciplines → matchdays → matches → match_sets`,
// misma cadena de FK compuestas que `pairs-side-shape.db.test.ts` ya prueba
// para `pair_size`.
//
// Prueba empírica (RED, no comiteada): contra el schema pre-0034/0035, un
// `insert` en `matchdays`/`matches`/`match_sets` que manda `allows_draw`
// rebota con PGRST204 (columna inexistente) — la cadena todavía no existe.
// El test de abajo que EXIGE `allows_draw=true` en cada salto es la versión
// permanente de esa prueba: falla (RED) contra el schema sin la cadena y
// pasa (GREEN) una vez que 0034+0035 la agregan y validan.
//
// El test de no-regresión (allows_draw=false) NO manda ese campo en ningún
// insert — depende sólo de los defaults (`false` en las tres columnas
// nuevas, igual que `disciplines.allows_draw` por default) —, así que corre
// SIN CAMBIOS antes y después de la migración: es el pin que fija que el
// arreglo no se vuelve permisivo de más.

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

async function insertMatchday(
  seasonId: string,
  disciplineId: string,
  number: number,
  opts: { allowsDraw?: boolean } = {},
): Promise<string> {
  const db = adminClient()
  const { data: discipline, error: disciplineError } = await db
    .from('disciplines')
    .select('pair_size')
    .eq('id', disciplineId)
    .single()
  if (disciplineError || discipline === null) throw new Error(disciplineError?.message)
  const { data, error } = await db
    .from('matchdays')
    .insert({
      season_id: seasonId,
      discipline_id: disciplineId,
      number,
      pair_size: discipline.pair_size,
      ...(opts.allowsDraw === undefined ? {} : { allows_draw: opts.allowsDraw }),
    })
    .select('id')
    .single()
  if (error || data === null) throw new Error(error?.message)
  return data.id
}

async function insertPair(
  matchdayId: string,
  seasonId: string,
  entryA: string,
  entryB: string,
): Promise<string> {
  const db = adminClient()
  const { data, error } = await db
    .from('pairs')
    .insert({ matchday_id: matchdayId, season_id: seasonId, entry_a: entryA, entry_b: entryB, pair_size: 2 })
    .select('id')
    .single()
  if (error || data === null) throw new Error(error?.message)
  return data.id
}

async function insertMatch(
  matchdayId: string,
  pairA: string,
  pairB: string,
  opts: { allowsDraw?: boolean } = {},
): Promise<string> {
  const db = adminClient()
  const { data, error } = await db
    .from('matches')
    .insert({
      matchday_id: matchdayId,
      round: 1,
      pair_a: pairA,
      pair_b: pairB,
      ...(opts.allowsDraw === undefined ? {} : { allows_draw: opts.allowsDraw }),
    })
    .select('id')
    .single()
  if (error || data === null) throw new Error(error?.message)
  return data.id
}

async function insertDrawSet(
  matchId: string,
  opts: { allowsDraw?: boolean } = {},
): Promise<{ error: { message: string } | null }> {
  const db = adminClient()
  const { error } = await db.from('match_sets').insert({
    match_id: matchId,
    set_number: 1,
    games_a: 2,
    games_b: 2,
    ...(opts.allowsDraw === undefined ? {} : { allows_draw: opts.allowsDraw }),
  })
  return { error }
}

describe('match_sets_no_draw condicionado por allows_draw (REQ-D6-1)', () => {
  it('persiste un 2-2 cuando la disciplina permite empate', async () => {
    const admin = await createTestUser()
    const filler = await fillerPlayers(4)
    const { seasonId, disciplineIds, entryIds } = await createSeason({
      admin,
      squad: filler,
      disciplines: [{ kind: 'FIFA', allowsDraw: true }],
    })
    const [fifaId] = disciplineIds
    const [a, b, c, d] = entryIds
    if (fifaId === undefined || a === undefined || b === undefined || c === undefined || d === undefined) {
      throw new Error('Falta escenario de test.')
    }
    const matchdayId = await insertMatchday(seasonId, fifaId, 1, { allowsDraw: true })
    const pairA = await insertPair(matchdayId, seasonId, a, b)
    const pairB = await insertPair(matchdayId, seasonId, c, d)
    const matchId = await insertMatch(matchdayId, pairA, pairB, { allowsDraw: true })

    const { error } = await insertDrawSet(matchId, { allowsDraw: true })

    expect(error).toBeNull()
  })

  it('sigue rechazando un 2-2 cuando la disciplina NO permite empate (no-regresión)', async () => {
    const admin = await createTestUser()
    const filler = await fillerPlayers(4)
    const { seasonId, disciplineId, entryIds } = await createSeason({ admin, squad: filler })
    const [a, b, c, d] = entryIds
    if (a === undefined || b === undefined || c === undefined || d === undefined) {
      throw new Error('Falta escenario de test.')
    }
    const matchdayId = await insertMatchday(seasonId, disciplineId, 1)
    const pairA = await insertPair(matchdayId, seasonId, a, b)
    const pairB = await insertPair(matchdayId, seasonId, c, d)
    const matchId = await insertMatch(matchdayId, pairA, pairB)

    const { error } = await insertDrawSet(matchId)

    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/match_sets_no_draw/)
  })
})

// ── Tercer column-grant sobre matchdays (discipline_id 0015, pair_size 0028,
// allows_draw 0034) — misma trampa, `matchdays` tiene grants por columna
// (0002_rls.sql:236-238) y sin ésta el insert falla con "permission denied
// for table matchdays", mensaje que no nombra la columna. Corre como
// `authenticated`, NUNCA `service_role` — lo único que puede ejercitar el
// grant en vez de esquivarlo.
describe('grant insert (allows_draw) on matchdays to authenticated', () => {
  it('un admin autenticado puede insertar allows_draw en matchdays', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineId } = await createSeason({
      admin,
      disciplines: [{ kind: 'FIFA', allowsDraw: true }],
    })

    const { data, error } = await admin.client
      .from('matchdays')
      .insert({ season_id: seasonId, discipline_id: disciplineId, number: 1, allows_draw: true })
      .select('id')
      .single()

    expect(error).toBeNull()
    expect(data?.id).toBeTypeOf('string')
  })
})
