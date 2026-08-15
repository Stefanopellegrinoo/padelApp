import { describe, expect, it } from 'vitest'
import { defaultConfig, type SeasonConfig } from '@/core'
import {
  addGuest,
  cancelMatchday,
  closeMatchday,
  createMatchday,
  generatePairs,
  lockPair,
  openMatchday,
  saveResult,
  setAttendance,
} from './matchday'
import { attendancesOf, pairLocksOf } from './read'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser, type TestUser } from './test/users'

// ── scaffolding local a este archivo ────────────────────────────────────────
// Igual que en redraft.db.test.ts y reopen.db.test.ts: no va a
// db/test/factories.ts, esa lista de armadores sólo le sirve a la cancelación.

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

async function buildSeasonWithSquad(
  config: SeasonConfig,
  squadSize: number,
): Promise<{ admin: TestUser; seasonId: string; squad: string[] }> {
  const admin = await createTestUser()
  const players = await fillerPlayers(squadSize)
  const { seasonId, entryIds } = await createSeason({ admin, config, squad: players })
  return { admin, seasonId, squad: entryIds }
}

async function markAllPlaying(admin: TestUser, matchdayId: string, entryIds: string[]): Promise<void> {
  for (const entryId of entryIds) {
    await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
  }
}

interface MatchRow {
  id: string
  pair_a: string
  pair_b: string
}

async function matchesOf(matchdayId: string): Promise<MatchRow[]> {
  const db = adminClient()
  const { data, error } = await db
    .from('matches')
    .select('id, pair_a, pair_b')
    .eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return data ?? []
}

async function pairsOf(matchdayId: string): Promise<Array<{ id: string }>> {
  const db = adminClient()
  const { data, error } = await db.from('pairs').select('id').eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return data ?? []
}

async function matchSetsOf(matchIds: string[]): Promise<Array<{ id: string }>> {
  if (matchIds.length === 0) return []
  const db = adminClient()
  const { data, error } = await db.from('match_sets').select('id').in('match_id', matchIds)
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Carga un 4-1 en cada partido de la fecha, con `winnerOf` decidiendo quién gana. */
async function playAllMatches(
  admin: TestUser,
  matchdayId: string,
  winnerOf: (pairA: string, pairB: string) => string,
): Promise<void> {
  const matches = await matchesOf(matchdayId)
  for (const match of matches) {
    const winner = winnerOf(match.pair_a, match.pair_b)
    const sets = winner === match.pair_a ? [{ gamesA: 4, gamesB: 1 }] : [{ gamesA: 1, gamesB: 4 }]
    await saveResult(admin.client, match.id, sets)
  }
}

async function matchdayStatus(matchdayId: string): Promise<string> {
  const db = adminClient()
  const { data, error } = await db
    .from('matchdays')
    .select('status')
    .eq('id', matchdayId)
    .single()
  if (error || data === null) throw new Error(error?.message)
  return data.status
}

async function matchdayExists(matchdayId: string): Promise<boolean> {
  const db = adminClient()
  const { data, error } = await db.from('matchdays').select('id').eq('id', matchdayId).maybeSingle()
  if (error) throw new Error(error.message)
  return data !== null
}

async function awardsOf(
  matchdayId: string,
): Promise<Array<{ entry_id: string; position: number; points: number }>> {
  const db = adminClient()
  const { data, error } = await db
    .from('awards')
    .select('entry_id, position, points')
    .eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return data ?? []
}

async function guestEntriesOf(matchdayId: string): Promise<Array<{ id: string; display_name: string }>> {
  const db = adminClient()
  const { data, error } = await db
    .from('entries')
    .select('id, display_name')
    .eq('matchday_id', matchdayId)
    .eq('kind', 'GUEST')
  if (error) throw new Error(error.message)
  return data ?? []
}

/** El plantel de la temporada — sólo SQUAD, nunca tocado por cancelar una fecha (spec 1.3). */
async function squadEntriesOf(
  seasonId: string,
): Promise<Array<{ id: string; seed_position: number; display_name: string }>> {
  const db = adminClient()
  const { data, error } = await db
    .from('entries')
    .select('id, seed_position, display_name')
    .eq('season_id', seasonId)
    .eq('kind', 'SQUAD')
    .order('seed_position', { ascending: true })
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Arma y confirma una fecha regular DENTRO de una temporada ya existente. */
async function openMatchdayIn(
  admin: TestUser,
  seasonId: string,
  squad: string[],
  playedOn: string,
): Promise<string> {
  const matchdayId = await createMatchday(admin.client, seasonId, playedOn)
  await markAllPlaying(admin, matchdayId, squad)
  await generatePairs(admin.client, matchdayId)
  await openMatchday(admin.client, matchdayId)
  return matchdayId
}

/** Arma, juega y cierra una fecha regular DENTRO de una temporada ya existente. */
async function closedMatchdayIn(
  admin: TestUser,
  seasonId: string,
  squad: string[],
  playedOn: string,
): Promise<string> {
  const matchdayId = await openMatchdayIn(admin, seasonId, squad, playedOn)
  await playAllMatches(admin, matchdayId, (pairA) => pairA)
  await closeMatchday(admin.client, matchdayId)
  return matchdayId
}

describe('cancelMatchday', () => {
  it('borra una fecha DRAFT con asistencias, invitados y una pareja trabada', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, squad)

    const guestA = await addGuest(admin.client, matchdayId, { displayName: 'Invitado A' })
    const guestB = await addGuest(admin.client, matchdayId, { displayName: 'Invitado B' })
    await lockPair(admin.client, matchdayId, guestA, guestB)

    expect(await attendancesOf(admin.client, matchdayId)).not.toHaveLength(0)
    expect(await guestEntriesOf(matchdayId)).toHaveLength(2)
    expect(await pairLocksOf(admin.client, matchdayId)).toHaveLength(1)

    await cancelMatchday(admin.client, matchdayId)

    expect(await matchdayExists(matchdayId)).toBe(false)
    expect(await attendancesOf(admin.client, matchdayId)).toHaveLength(0)
    expect(await guestEntriesOf(matchdayId)).toHaveLength(0)
    expect(await pairLocksOf(admin.client, matchdayId)).toHaveLength(0)
  })

  it('borra una fecha OPEN con parejas, partidos y resultados ya cargados', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await openMatchdayIn(admin, seasonId, squad, '2026-08-10')

    const [firstMatch] = await matchesOf(matchdayId)
    if (firstMatch === undefined) throw new Error('Falta un partido de test.')
    await saveResult(admin.client, firstMatch.id, [{ gamesA: 4, gamesB: 1 }])
    const matchIdsBefore = (await matchesOf(matchdayId)).map((match) => match.id)

    expect(await pairsOf(matchdayId)).not.toHaveLength(0)
    expect(matchIdsBefore).not.toHaveLength(0)
    expect(await matchSetsOf(matchIdsBefore)).not.toHaveLength(0)

    await cancelMatchday(admin.client, matchdayId)

    expect(await matchdayExists(matchdayId)).toBe(false)
    expect(await pairsOf(matchdayId)).toHaveLength(0)
    expect(await matchesOf(matchdayId)).toHaveLength(0)
    expect(await matchSetsOf(matchIdsBefore)).toHaveLength(0)
  })

  it('rechaza una fecha cerrada (CLOSED), y el mensaje manda a reabrir, no a borrar', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await closedMatchdayIn(admin, seasonId, squad, '2026-08-10')

    await expect(cancelMatchday(admin.client, matchdayId)).rejects.toThrow(/reabr/i)

    expect(await matchdayStatus(matchdayId)).toBe('CLOSED')
  })

  it('cancelar una fecha no toca ninguna otra fecha de la temporada ni el plantel', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const closedId = await closedMatchdayIn(admin, seasonId, squad, '2026-08-10')
    const awardsBefore = await awardsOf(closedId)
    const squadBefore = await squadEntriesOf(seasonId)
    expect(awardsBefore).not.toHaveLength(0)

    const openId = await openMatchdayIn(admin, seasonId, squad, '2026-08-17')

    await cancelMatchday(admin.client, openId)

    expect(await matchdayExists(openId)).toBe(false)
    expect(await matchdayStatus(closedId)).toBe('CLOSED')
    expect(await awardsOf(closedId)).toEqual(awardsBefore)
    expect(await squadEntriesOf(seasonId)).toEqual(squadBefore)
  })

  it('un jugador del plantel, sin ser el admin, recibe "sólo quien organiza" y no mueve nada', async () => {
    const admin = await createTestUser()
    const member = await createTestUser()
    const filler = await fillerPlayers(7)
    const { seasonId, entryIds } = await createSeason({
      admin,
      config: defaultConfig(8),
      squad: [member.playerId, ...filler],
    })
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, entryIds)

    await expect(cancelMatchday(member.client, matchdayId)).rejects.toThrow(/Sólo quien organiza/)

    expect(await matchdayExists(matchdayId)).toBe(true)
    expect(await matchdayStatus(matchdayId)).toBe('DRAFT')
  })

  it('un desconocido recibe "sólo quien organiza" y no borra nada', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await openMatchdayIn(admin, seasonId, squad, '2026-08-10')
    const stranger = await createTestUser()

    const { error } = await stranger.client.rpc('cancel_matchday', { p_matchday: matchdayId })

    expect(error?.message).toMatch(/Sólo quien organiza/)
    expect(await matchdayExists(matchdayId)).toBe(true)
  })

  it('un DELETE directo sobre matchdays sigue sin poder nada: sólo la función abre la puerta', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await openMatchdayIn(admin, seasonId, squad, '2026-08-10')

    const { data, error } = await admin.client.from('matchdays').delete().eq('id', matchdayId).select()

    expect(data).toBeNull()
    expect(error?.code).toBe('42501')
    expect(await matchdayExists(matchdayId)).toBe(true)
  })
})
