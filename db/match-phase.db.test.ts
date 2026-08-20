import { describe, it, expect } from 'vitest'
import { defaultConfig } from '@/core'
import { createMatchday, generatePairs, setAttendance } from './matchday'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser, type TestUser } from './test/users'

// REQ-D7-1: una fecha de pádel con config default no cambia con el schema
// nuevo — todos los matches salen fase='GRUPO', grupo=1, idéntico a hoy.
// REQ-D7-3: la fase actual se DEDUCE (matchday_phase), sin columna nueva en
// matchdays.

// ── scaffolding local a este archivo, mismo criterio que generate.db.test.ts ─

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

async function armedMatchday(): Promise<{ admin: TestUser; matchdayId: string }> {
  const admin = await createTestUser()
  const players = await fillerPlayers(8)
  const { seasonId, entryIds } = await createSeason({
    admin,
    config: defaultConfig(8),
    squad: players,
  })
  const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
  for (const entryId of entryIds) {
    await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
  }
  await generatePairs(admin.client, matchdayId)
  return { admin, matchdayId }
}

async function matchesFaseYGrupo(
  matchdayId: string,
): Promise<Array<{ fase: string; grupo: number }>> {
  const db = adminClient()
  const { data, error } = await db
    .from('matches')
    .select('fase, grupo')
    .eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return data ?? []
}

describe('matches.fase / matches.grupo (REQ-D7-1)', () => {
  it('una fecha de pádel con config default arma todo en GRUPO/1', async () => {
    const { matchdayId } = await armedMatchday()

    const matches = await matchesFaseYGrupo(matchdayId)
    expect(matches.length).toBeGreaterThan(0)
    expect(matches.every((match) => match.fase === 'GRUPO')).toBe(true)
    expect(matches.every((match) => match.grupo === 1)).toBe(true)
  })
})

describe('matchday_phase (REQ-D7-3)', () => {
  it('un matchday recién armado devuelve GRUPO', async () => {
    const { admin, matchdayId } = await armedMatchday()

    // security definer, grant a `authenticated` (mismo idioma que
    // matchday_discipline, 0016): se llama con la sesión del admin, nunca
    // con service_role — con service_role el grant no se ejerce y el test
    // mentiría.
    const { data, error } = await admin.client.rpc('matchday_phase', { p_matchday: matchdayId })
    if (error) throw new Error(error.message)
    expect(data).toBe('GRUPO')
  })
})
