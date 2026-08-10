import { createClient } from '@supabase/supabase-js'
import { describe, it, expect } from 'vitest'
import type { Database } from './database.types'
import { adminClient } from './test/admin'
import { createTestUser } from './test/users'
import { createSeason } from './test/factories'

const TABLES = [
  'players',
  'seasons',
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

  const { data: matchday, error: matchdayError } = await db
    .from('matchdays')
    .insert({ season_id: seasonId, number: 1, status })
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

  return { matchdayId: matchday.id, matchId: match.id }
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

  it('anon no ve una sola fila de ninguna de las diez tablas', async () => {
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
    const { seasonId } = await createSeason({ admin })

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
      .insert({ season_id: seasonId, number: 1 })
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
    const { seasonId } = await createSeason({ admin })
    const db = adminClient()
    const { data: matchday, error: matchdayError } = await db
      .from('matchdays')
      .insert({ season_id: seasonId, number: 1 })
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
