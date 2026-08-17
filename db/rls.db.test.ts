import { createClient } from '@supabase/supabase-js'
import { describe, it, expect } from 'vitest'
import type { Database, Json } from './database.types'
import { adminClient } from './test/admin'
import { createTestUser } from './test/users'
import { createSeason } from './test/factories'
import { defaultConfig } from '../core/config'

const TABLES = [
  'players',
  'seasons',
  'disciplines',
  'matchdays',
  'entries',
  'attendances',
  'pair_locks',
  'pairs',
  'matches',
  'match_sets',
  'awards',
] as const

// Cliente sin sesión: es el rol `anon` de PostgREST, no un `authenticated` de
// mentira. No confundir con `adminClient()`, que es `service_role`.
function anonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (url === undefined || anonKey === undefined) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY.')
  }
  return createClient<Database>(url, anonKey)
}

// Arma fecha + 2 parejas + 1 partido con la llave de service_role: es
// escenario para los tests de match_sets, no algo que un test deba ejercitar
// con RLS.
async function buildMatch(seasonId: string, entryIds: string[], status: 'OPEN' | 'CLOSED') {
  const db = adminClient()
  const [a, b, c, d] = entryIds
  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    throw new Error('Hacen falta 4 entries para armar un partido de test.')
  }

  // Una sola disciplina por temporada mientras el tripwire (0015) siga
  // puesto: no hace falta que el caller la pase, se la busca acá.
  const { data: discipline, error: disciplineError } = await db
    .from('disciplines')
    .select('id')
    .eq('season_id', seasonId)
    .single()
  if (disciplineError || discipline === null) throw new Error(disciplineError?.message)

  const { data: matchday, error: matchdayError } = await db
    .from('matchdays')
    .insert({ season_id: seasonId, discipline_id: discipline.id, number: 1, status })
    .select('id')
    .single()
  if (matchdayError || matchday === null) throw new Error(matchdayError?.message)

  const { data: pairA, error: pairAError } = await db
    .from('pairs')
    .insert({ matchday_id: matchday.id, season_id: seasonId, entry_a: a, entry_b: b })
    .select('id')
    .single()
  if (pairAError || pairA === null) throw new Error(pairAError?.message)

  const { data: pairB, error: pairBError } = await db
    .from('pairs')
    .insert({ matchday_id: matchday.id, season_id: seasonId, entry_a: c, entry_b: d })
    .select('id')
    .single()
  if (pairBError || pairB === null) throw new Error(pairBError?.message)

  const { data: match, error: matchError } = await db
    .from('matches')
    .insert({ matchday_id: matchday.id, round: 1, pair_a: pairA.id, pair_b: pairB.id })
    .select('id')
    .single()
  if (matchError || match === null) throw new Error(matchError?.message)

  // Una fila en attendances, pair_locks y awards: son las tres tablas que
  // buildMatch todavía no tocaba, y los tests de cobertura por tabla las
  // necesitan pobladas.
  const { error: attendanceError } = await db.from('attendances').insert({
    matchday_id: matchday.id,
    entry_id: a,
    season_id: seasonId,
    discipline_id: discipline.id,
    status: 'PLAYING',
  })
  if (attendanceError) throw new Error(attendanceError.message)

  const { error: pairLockError } = await db
    .from('pair_locks')
    .insert({ matchday_id: matchday.id, entry_a: a, entry_b: c, season_id: seasonId })
  if (pairLockError) throw new Error(pairLockError.message)

  const { error: awardError } = await db
    .from('awards')
    .insert({ matchday_id: matchday.id, entry_id: a, season_id: seasonId, position: 1, points: 10 })
  if (awardError) throw new Error(awardError.message)

  return { matchdayId: matchday.id, matchId: match.id, pairAId: pairA.id, pairBId: pairB.id }
}

// Players sin cuenta, para completar un plantel de 4 sin dar de alta usuarios
// reales que ningún test necesita loguear.
async function fillerPlayers(count: number): Promise<string[]> {
  const db = adminClient()
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    const { data, error } = await db
      .from('players')
      .insert({ display_name: `Relleno de test ${Date.now()}-${i}` })
      .select('id')
      .single()
    if (error || data === null) throw new Error(error?.message)
    ids.push(data.id)
  }
  return ids
}

describe('RLS — lectura', () => {
  it('un extraño no ve la temporada', async () => {
    const admin = await createTestUser()
    const stranger = await createTestUser()
    const { seasonId } = await createSeason({ admin })

    const { data, error } = await stranger.client.from('seasons').select('*').eq('id', seasonId)

    // Bloqueado por RLS: lista vacía, no un error.
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('un extraño no ve el plantel', async () => {
    const admin = await createTestUser()
    const member = await createTestUser()
    const stranger = await createTestUser()
    const { seasonId } = await createSeason({ admin, squad: [member.playerId] })

    const { data, error } = await stranger.client
      .from('entries')
      .select('*')
      .eq('season_id', seasonId)

    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('un participante ve la temporada y el plantel', async () => {
    const admin = await createTestUser()
    const member = await createTestUser()
    const { seasonId } = await createSeason({ admin, squad: [member.playerId] })

    const season = await member.client.from('seasons').select('*').eq('id', seasonId)
    const entries = await member.client.from('entries').select('*').eq('season_id', seasonId)

    expect(season.error).toBeNull()
    expect(season.data).toHaveLength(1)
    expect(entries.error).toBeNull()
    expect(entries.data).toHaveLength(1)
  })

  it('nadie puede listar el invite_token de un torneo ajeno', async () => {
    const adminA = await createTestUser()
    const memberA = await createTestUser()
    await createSeason({ admin: adminA, squad: [memberA.playerId] })

    const adminB = await createTestUser()
    const { seasonId: seasonBId } = await createSeason({ admin: adminB })

    const { data, error } = await memberA.client
      .from('seasons')
      .select('invite_token')
      .eq('id', seasonBId)

    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('nadie puede leer el user_id de otro jugador', async () => {
    const userA = await createTestUser()
    const userB = await createTestUser()

    const { data, error } = await userA.client
      .from('players')
      .select('user_id')
      .eq('id', userB.playerId)

    // La columna está revocada a nivel tabla: el permiso se niega antes de
    // que RLS llegue a filtrar filas, así que acá SÍ hay error.
    expect(data).toBeNull()
    expect(error?.code).toBe('42501')
  })

  it('anon no ve una sola fila de ninguna de las once tablas', async () => {
    const anon = anonClient()

    for (const table of TABLES) {
      const { data, error } = await anon.from(table).select('*').limit(1)
      // anon queda afuera del grant de base: no tiene ni el privilegio de
      // tabla, así que esto es un permission denied, no una lista vacía por
      // RLS. Si algún día `anon` entrara al grant, este assert dejaría de
      // pasar (pasaría a dar data: []) y avisaría del agujero.
      expect(data, `tabla ${table}`).toBeNull()
      expect(error?.code, `tabla ${table}`).toBe('42501')
    }
  })

  it('a stranger reads no row of a season built across every table', async () => {
    const admin = await createTestUser()
    const stranger = await createTestUser()
    const filler = await fillerPlayers(4)
    const { seasonId, entryIds } = await createSeason({ admin, squad: filler })
    const { matchId } = await buildMatch(seasonId, entryIds, 'OPEN')

    const db = adminClient()
    const { error: setError } = await db
      .from('match_sets')
      .insert({ match_id: matchId, set_number: 1, games_a: 6, games_b: 3 })
    if (setError) throw new Error(setError.message)

    // `players` queda afuera a propósito: `players_read` es `using (true)`
    // (Task 7), así que cualquier autenticado ve el plantel global sin ser
    // parte de esta temporada. No es RLS deshabilitado, es el diseño — ya lo
    // cubre el test de escritura de abajo, donde un insert ajeno SÍ debe
    // fallar.
    for (const table of TABLES.filter((t) => t !== 'players')) {
      const { data, error } = await stranger.client.from(table).select('*').limit(1)
      expect(error, `tabla ${table}`).toBeNull()
      expect(data, `tabla ${table}`).toEqual([])
    }
  })
})

describe('RLS — escritura', () => {
  it('un participante no puede editar la temporada', async () => {
    const admin = await createTestUser()
    const member = await createTestUser()
    const { seasonId } = await createSeason({ admin, squad: [member.playerId] })

    const { data, error } = await member.client
      .from('seasons')
      .update({ name: 'Nombre robado' })
      .eq('id', seasonId)
      .select()

    // Bloqueado por RLS en UPDATE: cero filas afectadas, no un error.
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('un participante no puede cargar un resultado', async () => {
    const admin = await createTestUser()
    const member = await createTestUser()
    const filler = await fillerPlayers(3)
    const { seasonId, entryIds } = await createSeason({
      admin,
      squad: [member.playerId, ...filler],
    })
    const { matchId } = await buildMatch(seasonId, entryIds, 'OPEN')

    const { data, error } = await member.client
      .from('match_sets')
      .insert({ match_id: matchId, set_number: 1, games_a: 4, games_b: 2 })
      .select()

    // Bloqueado por el WITH CHECK en INSERT: sí es un error, código 42501.
    expect(data).toBeNull()
    expect(error?.code).toBe('42501')
  })

  it('el admin escribe todo lo de su torneo', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineId } = await createSeason({ admin })

    const rename = await admin.client
      .from('seasons')
      .update({ name: 'Nombre actualizado por el admin' })
      .eq('id', seasonId)
      .select()
    expect(rename.error).toBeNull()
    expect(rename.data).toHaveLength(1)

    const newEntry = await admin.client
      .from('entries')
      .insert({
        season_id: seasonId,
        display_name: 'Jugador nuevo',
        kind: 'SQUAD',
        seed_position: 0,
      })
      .select()
    expect(newEntry.error).toBeNull()
    expect(newEntry.data).toHaveLength(1)

    const newMatchday = await admin.client
      .from('matchdays')
      .insert({ season_id: seasonId, discipline_id: disciplineId, number: 1 })
      .select()
    expect(newMatchday.error).toBeNull()
    expect(newMatchday.data).toHaveLength(1)
  })

  it('el admin de un torneo no escribe en el de otro', async () => {
    const adminA = await createTestUser()
    await createSeason({ admin: adminA })

    const adminB = await createTestUser()
    const { seasonId: seasonBId } = await createSeason({ admin: adminB })

    const { data, error } = await adminA.client
      .from('entries')
      .insert({ season_id: seasonBId, display_name: 'Intruso', kind: 'SQUAD', seed_position: 99 })
      .select()

    expect(data).toBeNull()
    expect(error?.code).toBe('42501')
  })

  it('nadie puede mover matchdays.status con un update directo', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineId } = await createSeason({ admin })
    const db = adminClient()
    const { data: matchday, error: matchdayError } = await db
      .from('matchdays')
      .insert({ season_id: seasonId, discipline_id: disciplineId, number: 1 })
      .select('id')
      .single()
    if (matchdayError || matchday === null) throw new Error(matchdayError?.message)

    // El admin del torneo — a quien matchdays_write SÍ deja escribir la fila —
    // intenta mover `status` igual. Lo frena la columna, no la fila.
    const { data, error } = await admin.client
      .from('matchdays')
      .update({ status: 'OPEN' })
      .eq('id', matchday.id)
      .select()

    expect(data).toBeNull()
    expect(error?.code).toBe('42501')
  })

  it('no se puede cargar un resultado en una fecha cerrada', async () => {
    const admin = await createTestUser()
    const filler = await fillerPlayers(4)
    const { seasonId, entryIds } = await createSeason({ admin, squad: filler })
    const { matchId } = await buildMatch(seasonId, entryIds, 'CLOSED')

    const { data, error } = await admin.client
      .from('match_sets')
      .insert({ match_id: matchId, set_number: 1, games_a: 4, games_b: 2 })
      .select()

    // Es el admin de su propio torneo: lo frena `match_is_open`, no `is_season_admin`.
    expect(data).toBeNull()
    expect(error?.code).toBe('42501')
  })

  it('a participant who is not the admin cannot insert into any of the eleven tables', async () => {
    const admin = await createTestUser()
    const member = await createTestUser()
    const filler = await fillerPlayers(3)
    const { seasonId, disciplineId, entryIds } = await createSeason({
      admin,
      squad: [member.playerId, ...filler],
    })
    const { matchdayId, matchId, pairAId, pairBId } = await buildMatch(seasonId, entryIds, 'OPEN')

    // `a` es el asiento del propio member; buildMatch ya usó `a` (y `c`) para
    // la attendance/pair_lock/award del escenario, así que los intentos de
    // abajo usan `b` para no chocar con un unique y confundir 23505 con 42501.
    const [a, b, , d] = entryIds
    if (a === undefined || b === undefined || d === undefined) {
      throw new Error('Hacen falta 4 entries para probar la escritura ajena.')
    }

    const players = await member.client
      .from('players')
      .insert({ display_name: 'Jugador forjado' })
      .select()
    expect(players.data, 'tabla players').toBeNull()
    expect(players.error?.code, 'tabla players').toBe('42501')

    const seasons = await member.client
      .from('seasons')
      .insert({
        name: 'Temporada forjada',
        config: defaultConfig(8) as unknown as Json,
        created_by: admin.userId,
      })
      .select()
    expect(seasons.data, 'tabla seasons').toBeNull()
    expect(seasons.error?.code, 'tabla seasons').toBe('42501')

    const disciplines = await member.client
      .from('disciplines')
      .insert({ season_id: seasonId, kind: 'FIFA', config: {} })
      .select()
    expect(disciplines.data, 'tabla disciplines').toBeNull()
    expect(disciplines.error?.code, 'tabla disciplines').toBe('42501')

    const matchdays = await member.client
      .from('matchdays')
      .insert({ season_id: seasonId, discipline_id: disciplineId, number: 99 })
      .select()
    expect(matchdays.data, 'tabla matchdays').toBeNull()
    expect(matchdays.error?.code, 'tabla matchdays').toBe('42501')

    const entries = await member.client
      .from('entries')
      .insert({ season_id: seasonId, display_name: 'Intruso', kind: 'SQUAD', seed_position: 77 })
      .select()
    expect(entries.data, 'tabla entries').toBeNull()
    expect(entries.error?.code, 'tabla entries').toBe('42501')

    const attendances = await member.client
      .from('attendances')
      .insert({
        matchday_id: matchdayId,
        entry_id: b,
        season_id: seasonId,
        discipline_id: disciplineId,
        status: 'PLAYING',
      })
      .select()
    expect(attendances.data, 'tabla attendances').toBeNull()
    expect(attendances.error?.code, 'tabla attendances').toBe('42501')

    const pairLocks = await member.client
      .from('pair_locks')
      .insert({ matchday_id: matchdayId, entry_a: b, entry_b: d, season_id: seasonId })
      .select()
    expect(pairLocks.data, 'tabla pair_locks').toBeNull()
    expect(pairLocks.error?.code, 'tabla pair_locks').toBe('42501')

    const pairs = await member.client
      .from('pairs')
      .insert({ matchday_id: matchdayId, season_id: seasonId, entry_a: a, entry_b: b })
      .select()
    expect(pairs.data, 'tabla pairs').toBeNull()
    expect(pairs.error?.code, 'tabla pairs').toBe('42501')

    const matches = await member.client
      .from('matches')
      .insert({ matchday_id: matchdayId, round: 2, pair_a: pairAId, pair_b: pairBId })
      .select()
    expect(matches.data, 'tabla matches').toBeNull()
    expect(matches.error?.code, 'tabla matches').toBe('42501')

    const matchSets = await member.client
      .from('match_sets')
      .insert({ match_id: matchId, set_number: 1, games_a: 6, games_b: 3 })
      .select()
    expect(matchSets.data, 'tabla match_sets').toBeNull()
    expect(matchSets.error?.code, 'tabla match_sets').toBe('42501')

    const awards = await member.client
      .from('awards')
      .insert({ matchday_id: matchdayId, entry_id: b, season_id: seasonId, position: 2, points: 5 })
      .select()
    expect(awards.data, 'tabla awards').toBeNull()
    expect(awards.error?.code, 'tabla awards').toBe('42501')

    // seasons_delete es la política más peligrosa de ensanchar: `using (true)`
    // dejaría a cualquier autenticado borrar el torneo entero en cascada.
    // Bloqueado por RLS en DELETE: cero filas afectadas, no un error.
    const seasonDelete = await member.client.from('seasons').delete().eq('id', seasonId).select()
    expect(seasonDelete.error, 'tabla seasons (delete)').toBeNull()
    expect(seasonDelete.data, 'tabla seasons (delete)').toEqual([])
  })

  it('the admin loads a set into an open matchday', async () => {
    const admin = await createTestUser()
    const filler = await fillerPlayers(4)
    const { seasonId, entryIds } = await createSeason({ admin, squad: filler })
    const { matchId } = await buildMatch(seasonId, entryIds, 'OPEN')

    const { data, error } = await admin.client
      .from('match_sets')
      .insert({ match_id: matchId, set_number: 1, games_a: 6, games_b: 3 })
      .select()

    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })
})

describe('RLS — funciones', () => {
  it('anon no puede ejecutar ninguna de las cinco helpers', async () => {
    const anon = anonClient()
    const dummy = '00000000-0000-0000-0000-000000000000'

    const results = await Promise.all([
      anon.rpc('is_participant', { p_season: dummy }),
      anon.rpc('is_season_admin', { p_season: dummy }),
      anon.rpc('matchday_season', { p_matchday: dummy }),
      anon.rpc('match_season', { p_match: dummy }),
      anon.rpc('match_is_open', { p_match: dummy }),
    ])

    // Tiene que ser "permission denied for function" (42501), no cualquier
    // error: un revoke mal escrito igual falla por otro motivo y este test
    // pasaría en verde con el agujero abierto.
    for (const { error } of results) {
      expect(error?.code).toBe('42501')
    }
  })
})
