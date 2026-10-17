import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { describe, it, expect } from 'vitest'
import { defaultConfig, type SeasonConfig } from '@/core'
import type { Database } from './database.types'
import {
  closeMatchday,
  createMatchday,
  generatePairs,
  openMatchday,
  saveResult,
  setAttendance,
} from './matchday'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser, type TestUser } from './test/users'

// ── scaffolding local a este archivo ────────────────────────────────────────
// No va a db/test/factories.ts: esa lista de archivos es la del plan 2, y estos
// armadores sólo le sirven a las tres funciones de 0007.

/** Una temporada de una sola fecha regular: cerrar el año cuesta una fecha, no doce. */
function shortSeason(): SeasonConfig {
  return { ...defaultConfig(8), regularMatchdays: 1, countBestOf: 1 }
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

interface Scene {
  admin: TestUser
  /** Un jugador del plantel con su asiento reclamado — el que marca su propia asistencia. */
  player: TestUser
  seasonId: string
  squad: string[]
}

/**
 * Una temporada de 8 donde el primer asiento es de `player` y el resto son
 * players sin cuenta, igual que un torneo real recién creado.
 */
async function buildScene(config: SeasonConfig = shortSeason()): Promise<Scene> {
  const admin = await createTestUser()
  const player = await createTestUser()
  const filler = await fillerPlayers(config.squadSize - 1)
  const { seasonId, entryIds } = await createSeason({
    admin,
    config,
    squad: [player.playerId, ...filler],
  })
  return { admin, player, seasonId, squad: entryIds }
}

async function attendanceOf(matchdayId: string, entryId: string): Promise<string | null> {
  const db = adminClient()
  const { data, error } = await db
    .from('attendances')
    .select('status')
    .eq('matchday_id', matchdayId)
    .eq('entry_id', entryId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data?.status ?? null
}

async function attendanceRowCount(matchdayId: string): Promise<number> {
  const db = adminClient()
  const { count, error } = await db
    .from('attendances')
    .select('id', { count: 'exact', head: true })
    .eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return count ?? 0
}

async function mastersCount(seasonId: string): Promise<number> {
  const db = adminClient()
  const { count, error } = await db
    .from('matchdays')
    .select('id', { count: 'exact', head: true })
    .eq('season_id', seasonId)
    .eq('kind', 'MASTERS')
  if (error) throw new Error(error.message)
  return count ?? 0
}

async function matchesOf(matchdayId: string): Promise<Array<{ id: string; pair_a: string }>> {
  const db = adminClient()
  const { data, error } = await db
    .from('matches')
    .select('id, pair_a')
    .eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return data ?? []
}

/** DRAFT → CLOSED con todo el plantel presente. El local gana siempre; acá sólo importa que cierre. */
async function playAndClose(admin: TestUser, matchdayId: string, squad: string[]): Promise<void> {
  for (const entryId of squad) {
    await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
  }
  await generatePairs(admin.client, matchdayId)
  await openMatchday(admin.client, matchdayId)
  for (const match of await matchesOf(matchdayId)) {
    await saveResult(admin.client, match.id, [{ gamesA: 4, gamesB: 0 }])
  }
  await closeMatchday(admin.client, matchdayId)
}

/** Sin sesión y con la llave `anon`: es exactamente el cliente de quien abre el link del grupo. */
function anonClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (url === undefined || anonKey === undefined) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY.')
  }
  return createClient<Database>(url, anonKey)
}

// ── set_my_attendance ───────────────────────────────────────────────────────

describe('set_my_attendance', () => {
  it('lets a squad player mark themselves absent on their own seat', async () => {
    const { admin, player, seasonId, squad } = await buildScene()
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-13')

    const { error } = await player.client.rpc('set_my_attendance', {
      p_matchday: matchdayId,
      p_status: 'ABSENT',
    })

    expect(error).toBeNull()
    expect(await attendanceOf(matchdayId, squad[0]!)).toBe('ABSENT')
  })

  it('updates the existing row instead of adding a second one', async () => {
    const { admin, player, seasonId, squad } = await buildScene()
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-13')

    await player.client.rpc('set_my_attendance', { p_matchday: matchdayId, p_status: 'ABSENT' })
    await player.client.rpc('set_my_attendance', { p_matchday: matchdayId, p_status: 'PLAYING' })

    expect(await attendanceOf(matchdayId, squad[0]!)).toBe('PLAYING')
    expect(await attendanceRowCount(matchdayId)).toBe(1)
  })

  it('refuses somebody who has no seat in the season', async () => {
    const { admin, seasonId } = await buildScene()
    const stranger = await createTestUser()
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-13')

    const { error } = await stranger.client.rpc('set_my_attendance', {
      p_matchday: matchdayId,
      p_status: 'ABSENT',
    })

    expect(error?.message).toContain('No tenés lugar en esta temporada.')
    expect(await attendanceRowCount(matchdayId)).toBe(0)
  })

  // La guardia que importa: con las parejas ya armadas, desanotarse deja la
  // fecha con más parejas que jugadores y no hay forma de arreglarla.
  it('refuses to touch a matchday that is already being played', async () => {
    const { admin, player, seasonId, squad } = await buildScene()
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-13')
    for (const entryId of squad) {
      await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
    }
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)

    const { error } = await player.client.rpc('set_my_attendance', {
      p_matchday: matchdayId,
      p_status: 'ABSENT',
    })

    expect(error?.message).toContain('La fecha ya está armada')
    expect(await attendanceOf(matchdayId, squad[0]!)).toBe('PLAYING')
  })

  it('refuses a status the matchday cannot hold', async () => {
    const { admin, player, seasonId } = await buildScene()
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-13')

    const { error } = await player.client.rpc('set_my_attendance', {
      p_matchday: matchdayId,
      p_status: 'MAYBE',
    })

    expect(error?.message).toContain('PLAYING o ABSENT')
  })
})

// ── create_masters ──────────────────────────────────────────────────────────

describe('create_masters', () => {
  it('creates the masters once the regular season is over', async () => {
    const { admin, seasonId, squad } = await buildScene()
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-13')
    await playAndClose(admin, matchdayId, squad)

    const { data, error } = await admin.client.rpc('create_masters', {
      p_season: seasonId,
      p_played_on: '2026-12-20',
    })

    expect(error).toBeNull()
    expect(data).toBeTruthy()

    const db = adminClient()
    const { data: masters } = await db
      .from('matchdays')
      .select('kind, status, number')
      .eq('id', data as unknown as string)
      .single()
    expect(masters?.kind).toBe('MASTERS')
    expect(masters?.status).toBe('DRAFT')
    expect(masters?.number).toBe(2)
  })

  it('refuses somebody who does not run the season', async () => {
    const { admin, player, seasonId, squad } = await buildScene()
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-13')
    await playAndClose(admin, matchdayId, squad)

    const { error } = await player.client.rpc('create_masters', {
      p_season: seasonId,
      p_played_on: '2026-12-20',
    })

    expect(error?.message).toContain('Sólo quien organiza')
    expect(await mastersCount(seasonId)).toBe(0)
  })

  it('says how many matchdays are still missing', async () => {
    const { admin, seasonId } = await buildScene({ ...shortSeason(), regularMatchdays: 3, countBestOf: 3 })

    const { error } = await admin.client.rpc('create_masters', {
      p_season: seasonId,
      p_played_on: '2026-12-20',
    })

    expect(error?.message).toContain('faltan 3')
    expect(await mastersCount(seasonId)).toBe(0)
  })

  it('never creates a second masters', async () => {
    const { admin, seasonId, squad } = await buildScene()
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-13')
    await playAndClose(admin, matchdayId, squad)

    await admin.client.rpc('create_masters', { p_season: seasonId, p_played_on: '2026-12-20' })
    const { error } = await admin.client.rpc('create_masters', {
      p_season: seasonId,
      p_played_on: '2026-12-21',
    })

    expect(error).not.toBeNull()
    expect(await mastersCount(seasonId)).toBe(1)
  })

  it('refuses while another matchday is still open', async () => {
    const { admin, seasonId, squad } = await buildScene()
    const first = await createMatchday(admin.client, seasonId, '2026-08-13')
    await playAndClose(admin, first, squad)
    // La temporada regular ya terminó, pero alguien abrió una fecha más.
    await createMatchday(admin.client, seasonId, '2026-08-20')

    const { error } = await admin.client.rpc('create_masters', {
      p_season: seasonId,
      p_played_on: '2026-12-20',
    })

    // El código exacto y no `not.toBeNull()`: con "la función no existe" también
    // hay error, y este test pasaría en verde sin probar nada. Lo que tiene que
    // frenar es `matchdays_one_live`, que es una violación de unique.
    expect(error?.code).toBe('23505')
    expect(await mastersCount(seasonId)).toBe(0)
  })
})

// ── season_public_rules ─────────────────────────────────────────────────────

describe('season_public_rules', () => {
  it('gives the rules to somebody with no account at all', async () => {
    const { admin, seasonId } = await buildScene()
    const db = adminClient()
    await db
      .from('seasons')
      .update({ name: 'Los Jueves 2026', rules_text: 'Cancha 3, 20:30.' })
      .eq('id', seasonId)

    const { data, error } = await anonClient().rpc('season_public_rules', { p_season: seasonId })

    expect(error).toBeNull()
    const row = data?.[0]
    expect(row?.name).toBe('Los Jueves 2026')
    expect(row?.rules_text).toBe('Cancha 3, 20:30.')
    expect(row?.config).toBeTruthy()
    expect(row?.admin_name).not.toBe('')
  })

  it('returns nothing, not an error, for a link that leads nowhere', async () => {
    const { data, error } = await anonClient().rpc('season_public_rules', {
      p_season: '00000000-0000-0000-0000-000000000000',
    })

    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  // PR 5 (0022, REQ-D2-1): la config real vive en `disciplines.config`.
  //
  // Este test PLANTABA una config divergente en `seasons.config` para probar
  // que lo que volvía era la disciplina y no la temporada desincronizada. El
  // CONTRACT (`0066`) dropeó esa columna, así que ya no hay de qué divergir:
  // la afirmación pasó de "elige bien entre dos fuentes" a "devuelve la única
  // que hay", y perdió su poder discriminante.
  //
  // Se conserva igual porque lo que sigue midiendo es real —que
  // `season_public_rules`, la ÚNICA superficie pública de la app, devuelve la
  // config correcta— pero conviene saber qué dejó de cubrir. Fue el único de
  // los NUEVE guardias del contract que `test:db` no vio caer: pasaba en
  // verde con la columna ya dropeada, y lo cazó el typecheck.
  it('lee la config de la disciplina (PR 5)', async () => {
    const admin = await createTestUser()
    const padelConfig = defaultConfig(8)
    const { seasonId } = await createSeason({ admin, config: padelConfig })

    const { data, error } = await anonClient().rpc('season_public_rules', { p_season: seasonId })

    expect(error).toBeNull()
    const row = data?.[0]
    expect((row?.config as SeasonConfig | undefined)?.regularMatchdays).toBe(
      padelConfig.regularMatchdays,
    )
  })

  // Es la ÚNICA superficie pública de la app: que abra las reglas no puede
  // abrir de paso quién juega, quién ganó ni cuánto suma cada uno.
  it('does not open anything else to an anonymous reader', async () => {
    const { admin, seasonId, squad } = await buildScene()
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-13')
    await playAndClose(admin, matchdayId, squad)

    const anon = anonClient()
    const entries = await anon.from('entries').select('id').eq('season_id', seasonId)
    const matchdays = await anon.from('matchdays').select('id').eq('season_id', seasonId)
    const awards = await anon.from('awards').select('id').eq('season_id', seasonId)
    const seasons = await anon.from('seasons').select('id').eq('id', seasonId)

    for (const result of [entries, matchdays, awards, seasons]) {
      expect(result.data ?? []).toEqual([])
    }
  })
})
