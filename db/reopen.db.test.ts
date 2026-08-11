import { describe, it, expect } from 'vitest'
import { computeRanking, defaultConfig, type SeasonConfig } from '@/core'
import {
  addGuest,
  closeMatchday,
  createMatchday,
  generatePairs,
  openMatchday,
  reopenMatchday,
  saveResult,
  setAttendance,
} from './matchday'
import { awardsBefore, squadSeedOrder } from './season'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser, type TestUser } from './test/users'

// ── scaffolding local a este archivo ────────────────────────────────────────
// Igual que en close.db.test.ts: no va a db/test/factories.ts, esa lista de
// archivos es la del plan, y estos armadores sólo le sirven a la reapertura.

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

/** Carga un 4-0 en cada partido de la fecha, con `winnerOf` decidiendo quién gana. */
async function playAllMatches(
  admin: TestUser,
  matchdayId: string,
  winnerOf: (pairA: string, pairB: string) => string,
): Promise<void> {
  const matches = await matchesOf(matchdayId)
  for (const match of matches) {
    const winner = winnerOf(match.pair_a, match.pair_b)
    const sets = winner === match.pair_a ? [{ gamesA: 4, gamesB: 0 }] : [{ gamesA: 0, gamesB: 4 }]
    await saveResult(admin.client, match.id, sets)
  }
}

/** DRAFT → CLOSED con todo el plantel presente y el mismo lado ganando siempre. */
async function playMatchdayToClose(
  admin: TestUser,
  matchdayId: string,
  entryIds: string[],
): Promise<void> {
  await markAllPlaying(admin, matchdayId, entryIds)
  await generatePairs(admin.client, matchdayId)
  await openMatchday(admin.client, matchdayId)
  await playAllMatches(admin, matchdayId, (pairA) => pairA)
  await closeMatchday(admin.client, matchdayId)
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
  const { data, error } = await db
    .from('matchdays')
    .select('id')
    .eq('id', matchdayId)
    .maybeSingle()
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

async function attendancesOf(
  matchdayId: string,
): Promise<Array<{ entry_id: string; status: string }>> {
  const db = adminClient()
  const { data, error } = await db
    .from('attendances')
    .select('entry_id, status')
    .eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return data ?? []
}

async function guestEntriesOf(
  matchdayId: string,
): Promise<Array<{ id: string; display_name: string }>> {
  const db = adminClient()
  const { data, error } = await db
    .from('entries')
    .select('id, display_name')
    .eq('matchday_id', matchdayId)
    .eq('kind', 'GUEST')
  if (error) throw new Error(error.message)
  return data ?? []
}

const sortByEntry = <T extends { entry_id: string }>(rows: T[]): T[] =>
  [...rows].sort((left, right) => left.entry_id.localeCompare(right.entry_id))

describe('reopenMatchday', () => {
  it('borra los awards y vuelve a OPEN', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await playMatchdayToClose(admin, matchdayId, squad)
    expect(await matchdayStatus(matchdayId)).toBe('CLOSED')
    expect(await awardsOf(matchdayId)).not.toHaveLength(0)

    await reopenMatchday(admin.client, matchdayId)

    expect(await matchdayStatus(matchdayId)).toBe('OPEN')
    expect(await awardsOf(matchdayId)).toHaveLength(0)
  })

  it('el ranking vuelve a lo que era antes de esa fecha', async () => {
    const config = defaultConfig(8)
    const { admin, seasonId, squad } = await buildSeasonWithSquad(config, 8)
    const md1 = await createMatchday(admin.client, seasonId, '2026-08-10')
    await playMatchdayToClose(admin, md1, squad)

    // El ranking "de cara a la fecha 3" es el mismo input que usaría un sorteo
    // de esa fecha: sólo lo cerrado antes de ella cuenta.
    const seedOrder = await squadSeedOrder(admin.client, seasonId)
    const rankingBeforeMd2 = computeRanking(
      await awardsBefore(admin.client, seasonId, 3),
      seedOrder,
      config,
      seedOrder,
    )

    const md2 = await createMatchday(admin.client, seasonId, '2026-08-17')
    await playMatchdayToClose(admin, md2, squad)

    const rankingWithMd2 = computeRanking(
      await awardsBefore(admin.client, seasonId, 3),
      seedOrder,
      config,
      seedOrder,
    )
    expect(rankingWithMd2).not.toEqual(rankingBeforeMd2)

    await reopenMatchday(admin.client, md2)

    const rankingAfterReopen = computeRanking(
      await awardsBefore(admin.client, seasonId, 3),
      seedOrder,
      config,
      seedOrder,
    )
    expect(rankingAfterReopen).toEqual(rankingBeforeMd2)
  })

  it('rechaza reabrir una fecha del medio', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const md1 = await createMatchday(admin.client, seasonId, '2026-08-10')
    await playMatchdayToClose(admin, md1, squad)
    const md2 = await createMatchday(admin.client, seasonId, '2026-08-17')
    await playMatchdayToClose(admin, md2, squad)

    await expect(reopenMatchday(admin.client, md1)).rejects.toThrow(/última fecha cerrada/)

    expect(await matchdayStatus(md1)).toBe('CLOSED')
  })

  it('rechaza reabrir si hay otra fecha sin cerrar', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const md1 = await createMatchday(admin.client, seasonId, '2026-08-10')
    await playMatchdayToClose(admin, md1, squad)
    const md2 = await createMatchday(admin.client, seasonId, '2026-08-17')
    await markAllPlaying(admin, md2, squad)
    await generatePairs(admin.client, md2)
    await openMatchday(admin.client, md2) // md2 queda OPEN, sin cerrar

    await expect(reopenMatchday(admin.client, md1)).rejects.toThrow(/ya tiene datos cargados/)

    expect(await matchdayStatus(md1)).toBe('CLOSED')
    expect(await matchdayStatus(md2)).toBe('OPEN')
  })

  it('rechaza reabrir una fecha que no está cerrada', async () => {
    const { admin, seasonId } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')

    await expect(reopenMatchday(admin.client, matchdayId)).rejects.toThrow(/no está cerrada/)
  })

  it('reabrir y volver a cerrar da exactamente los mismos awards', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await playMatchdayToClose(admin, matchdayId, squad)
    const awardsBeforeReopen = sortByEntry(await awardsOf(matchdayId))

    await reopenMatchday(admin.client, matchdayId)
    await closeMatchday(admin.client, matchdayId)

    const awardsAfterRecierre = sortByEntry(await awardsOf(matchdayId))
    expect(awardsAfterRecierre).toEqual(awardsBeforeReopen)
  })

  it('borra la fecha siguiente si está vacía y reabre', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const md1 = await createMatchday(admin.client, seasonId, '2026-08-10')
    await playMatchdayToClose(admin, md1, squad)
    const md2 = await createMatchday(admin.client, seasonId, '2026-08-17') // DRAFT vacía

    await reopenMatchday(admin.client, md1)

    expect(await matchdayStatus(md1)).toBe('OPEN')
    expect(await matchdayExists(md2)).toBe(false)
  })

  it('no borra la fecha siguiente si ya tiene asistencias', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const md1 = await createMatchday(admin.client, seasonId, '2026-08-10')
    await playMatchdayToClose(admin, md1, squad)
    const md2 = await createMatchday(admin.client, seasonId, '2026-08-17')
    const first = squad[0]
    if (first === undefined) throw new Error('Falta un asiento para el test.')
    await setAttendance(admin.client, md2, first, 'PLAYING')
    const attendancesBefore = await attendancesOf(md2)

    await expect(reopenMatchday(admin.client, md1)).rejects.toThrow(/ya tiene datos cargados/)

    expect(await matchdayExists(md2)).toBe(true)
    expect(await matchdayStatus(md2)).toBe('DRAFT')
    expect(await attendancesOf(md2)).toEqual(attendancesBefore)
  })

  it('no borra la fecha siguiente si ya tiene un invitado cargado', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const md1 = await createMatchday(admin.client, seasonId, '2026-08-10')
    await playMatchdayToClose(admin, md1, squad)
    const md2 = await createMatchday(admin.client, seasonId, '2026-08-17')
    await addGuest(admin.client, md2, { displayName: 'Invitado' })
    const guestsBefore = await guestEntriesOf(md2)

    await expect(reopenMatchday(admin.client, md1)).rejects.toThrow(/ya tiene datos cargados/)

    expect(await matchdayExists(md2)).toBe(true)
    expect(await guestEntriesOf(md2)).toEqual(guestsBefore)
  })

  it('un jugador recibe "sólo quien organiza", no "la fecha no existe"', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await playMatchdayToClose(admin, matchdayId, squad)
    const stranger = await createTestUser()

    const { error } = await stranger.client.rpc('reopen_matchday', { p_matchday: matchdayId })

    expect(error?.message).toMatch(/Sólo quien organiza/)
  })
})
