import { describe, expect, it } from 'vitest'
import { defaultConfig, type SeasonConfig } from '@/core'
import {
  closeMatchday,
  createMasters,
  createMatchday,
  generateMastersPairs,
  generatePairs,
  openMatchday,
  saveResult,
  setAttendance,
} from './matchday'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser, type TestUser } from './test/users'

// ── Bloqueante #2 del CONTRACT (verify-report-pre-contract, #4026) ──────────
//
// `seasons.status` sigue existiendo (el `drop column` es del contract, no de
// esta tanda) pero deja de tener ESCRITOR de producción: las cuatro funciones
// que lo tocaban (`open_matchday`, `close_matchday`, `reopen_matchday`,
// `cancel_matchday`) quedan restateadas sin esa línea. El estado real vive en
// `disciplines.status` desde `0019_discipline_status_moves.sql`; este archivo
// prueba, contra cada escritor de producción como `authenticated`, que
// `seasons.status` ya no se mueve un milímetro mientras `disciplines.status`
// sigue haciendo exactamente lo que siempre hizo.

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

async function seasonStatus(seasonId: string): Promise<string> {
  const db = adminClient()
  const { data, error } = await db.from('seasons').select('status').eq('id', seasonId).single()
  if (error || data === null) throw new Error(error?.message)
  return data.status
}

async function disciplineStatus(disciplineId: string): Promise<string> {
  const db = adminClient()
  const { data, error } = await db
    .from('disciplines')
    .select('status')
    .eq('id', disciplineId)
    .single()
  if (error || data === null) throw new Error(error?.message)
  return data.status
}

function shortSeason(): SeasonConfig {
  return { ...defaultConfig(8), regularMatchdays: 1, countBestOf: 1 }
}

async function matchIdsOf(matchdayId: string): Promise<string[]> {
  const db = adminClient()
  const { data, error } = await db.from('matches').select('id').eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => row.id)
}

async function playAllMatches(admin: TestUser, matchdayId: string): Promise<void> {
  for (const matchId of await matchIdsOf(matchdayId)) {
    await saveResult(admin.client, matchId, [{ gamesA: 4, gamesB: 0 }])
  }
}

describe('seasons.status ya no tiene escritor de producción (REQ-D3-3)', () => {
  it('open_matchday mueve disciplines.status a ACTIVE y deja seasons.status intacto', async () => {
    const admin = await createTestUser()
    const players = await fillerPlayers(8)
    const { seasonId, disciplineId, entryIds } = await createSeason({
      admin,
      config: defaultConfig(8),
      squad: players,
    })
    expect(await seasonStatus(seasonId)).toBe('SETUP')

    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05')
    for (const entryId of entryIds) {
      await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
    }
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)

    expect(await disciplineStatus(disciplineId)).toBe('ACTIVE')
    expect(await seasonStatus(seasonId)).toBe('SETUP')
  })

  it('close_matchday termina disciplines.status al cerrar el Masters y deja seasons.status intacto', async () => {
    const admin = await createTestUser()
    const players = await fillerPlayers(8)
    const config = shortSeason()
    const { seasonId, disciplineId, entryIds } = await createSeason({ admin, config, squad: players })

    const regularId = await createMatchday(admin.client, seasonId, '2026-03-05')
    for (const entryId of entryIds) {
      await setAttendance(admin.client, regularId, entryId, 'PLAYING')
    }
    await generatePairs(admin.client, regularId)
    await openMatchday(admin.client, regularId)
    await playAllMatches(admin, regularId)
    await closeMatchday(admin.client, regularId)

    const mastersId = await createMasters(admin.client, seasonId, '2026-12-20')
    await generateMastersPairs(admin.client, mastersId)
    await openMatchday(admin.client, mastersId)
    await playAllMatches(admin, mastersId)

    expect(await seasonStatus(seasonId)).toBe('SETUP')

    await closeMatchday(admin.client, mastersId)

    expect(await disciplineStatus(disciplineId)).toBe('FINISHED')
    expect(await seasonStatus(seasonId)).toBe('SETUP')
  })
})
