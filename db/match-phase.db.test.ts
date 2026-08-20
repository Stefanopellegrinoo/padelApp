import { execFileSync } from 'node:child_process'
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

/**
 * `matchday_phase` está revocada de public/anon/authenticated Y de
 * service_role (W5, medido: ni siquiera `adminClient()` la puede invocar por
 * PostgREST — "permission denied for function"). Mismo motivo y misma
 * herramienta que `localSql` en squad-position.db.test.ts: para probar la
 * DEDUCCIÓN sin pasar por ningún grant hace falta la sesión de `postgres`
 * dentro del contenedor local, no un cliente PostgREST.
 */
function localSql(sql: string): string {
  return execFileSync(
    'docker',
    [
      'exec', '-i', 'supabase_db_padelApp',
      'psql', '-U', 'postgres', '-d', 'postgres',
      '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-',
    ],
    { input: sql, encoding: 'utf8' },
  )
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
    const { matchdayId } = await armedMatchday()

    // Lo que REQ-D7-3 pide probar es la DEDUCCIÓN, no un grant — y nadie
    // tiene el grant (W5): ni `authenticated` ni `service_role` (medido).
    // `localSql` corre como `postgres`, afuera del ACL que PostgREST exige.
    const output = localSql(`select public.matchday_phase('${matchdayId}'::uuid);`)
    expect(output.trim()).toBe('GRUPO')
  })

  // Mismo patrón que discipline.db.test.ts: "matchday_discipline no es
  // alcanzable por RPC: nadie tiene el grant". Fija la decisión de W5 acá
  // también — si mañana alguien le devuelve el grant sin traer un
  // consumidor real, este test se entera en rojo.
  it('no es alcanzable por RPC desde authenticated: nadie tiene el grant', async () => {
    const { admin, matchdayId } = await armedMatchday()

    const { data, error } = await admin.client.rpc('matchday_phase', { p_matchday: matchdayId })

    expect(data).toBeNull()
    expect(error?.code).toBe('42501')
  })
})
