import { describe, it, expect } from 'vitest'
import { defaultConfig, type SeasonConfig } from '@/core'
import { closeMatchday, createMatchday, generatePairs, openMatchday, saveResult, setAttendance } from './matchday'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser, type TestUser } from './test/users'

// ── scaffolding local a este archivo, mismo criterio que close.db.test.ts:
// no va a db/test/factories.ts porque sólo le sirve al cierre de una fecha.

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
  const { data, error } = await db.from('matches').select('id, pair_a, pair_b').eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return data ?? []
}

async function playAllMatches(admin: TestUser, matchdayId: string): Promise<void> {
  const matches = await matchesOf(matchdayId)
  for (const match of matches) {
    await saveResult(admin.client, match.id, [{ gamesA: 4, gamesB: 0 }])
  }
}

async function awardsOf(matchdayId: string): Promise<Array<{ entry_id: string; position: number; points: number }>> {
  const db = adminClient()
  const { data, error } = await db.from('awards').select('entry_id, position, points').eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return data ?? []
}

// `admin.client` (authenticated), no `adminClient()` (service_role): el punto
// de este helper es probar que el grant + la RLS de `award_lines_read`
// alcanzan de verdad (#3957) -- con service_role el grant no se ejerce y un
// grant faltante pasaría igual.
async function awardLinesOf(
  admin: TestUser,
  matchdayId: string,
): Promise<Array<{ entry_id: string; ordinal: number; reason: string; points: number }>> {
  const { data, error } = await admin.client
    .from('award_lines')
    .select('entry_id, ordinal, reason, points')
    .eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return data ?? []
}

async function matchdayStatus(matchdayId: string): Promise<string> {
  const db = adminClient()
  const { data, error } = await db.from('matchdays').select('status').eq('id', matchdayId).single()
  if (error || data === null) throw new Error(error?.message)
  return data.status
}

describe('award_lines', () => {
  it('closeMatchday persiste una línea por award, y la suma da el total (REQ-D10-1)', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, squad)
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)
    await playAllMatches(admin, matchdayId)

    await closeMatchday(admin.client, matchdayId)

    const awards = await awardsOf(matchdayId)
    const lines = await awardLinesOf(admin, matchdayId)
    expect(awards.length).toBeGreaterThan(0)
    expect(lines.length).toBeGreaterThan(0)
    for (const award of awards) {
      const ownLines = lines.filter((line) => line.entry_id === award.entry_id)
      expect(ownLines.length).toBeGreaterThan(0)
      const sum = ownLines.reduce((total, line) => total + line.points, 0)
      expect(sum).toBe(award.points)
    }
  })

  /**
   * #3989 (guards en serie, tercera vez): un guard nuevo sólo probado a
   * través del wrapper TS queda sin cobertura apenas otro guard más adelante
   * lo tape. Éste llama al RPC `close_matchday` DIRECTO, salteando
   * `closeMatchday()` (TS) -- que nunca podría construir este payload, ya
   * que `computeAwards` siempre arma líneas que suman el total.
   */
  it('la RPC rechaza un desglose que no suma el total del premio (RPC directo, #3989)', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, squad)
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)
    await playAllMatches(admin, matchdayId)
    const entryId = squad[0]
    if (entryId === undefined) throw new Error('Falta un asiento para el test.')

    const { error } = await admin.client.rpc('close_matchday', {
      p_matchday: matchdayId,
      p_awards: [{ entryId, position: 1, points: 10, lines: [{ reason: 'el 1º de la fecha', points: 5 }] }],
    })

    expect(error?.message).toBe('El desglose no suma el total del premio.')
    expect(await matchdayStatus(matchdayId)).toBe('OPEN')
  })

  /**
   * REQ-D10-2: la fecha 1 de PnP-1000 cerró antes de que `award_lines`
   * existiera. Acá se simula con un `insert` directo en `awards` -- lo único
   * que la escribía antes de este cambio -- sin pasar por `close_matchday`,
   * así que no queda ninguna fila en `award_lines`. La UI (o cualquier
   * lectura) tiene que verla vacía, nunca romperse.
   */
  it('un award sin desglose (fecha cerrada antes del cambio) no tiene líneas y se lee sin error (REQ-D10-2)', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    const entryId = squad[0]
    if (entryId === undefined) throw new Error('Falta un asiento para el test.')
    const db = adminClient()
    const { error: statusError } = await db.from('matchdays').update({ status: 'CLOSED' }).eq('id', matchdayId)
    if (statusError) throw new Error(statusError.message)
    const { error: insertError } = await db
      .from('awards')
      .insert({ matchday_id: matchdayId, season_id: seasonId, entry_id: entryId, position: 1, points: 10 })
    if (insertError) throw new Error(insertError.message)

    const lines = await awardLinesOf(admin, matchdayId)

    expect(lines).toEqual([])
  })
})
