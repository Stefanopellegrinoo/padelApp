import { describe, expect, it } from 'vitest'
import { defaultConfig, type MatchdayFormat, type SeasonConfig } from '@/core'
import { advancePhase, createMatchday, generatePairs, openMatchday, saveResult, setAttendance } from './matchday'
import { adminClient } from './test/admin'
import type { Json } from './database.types'
import { createSeason } from './test/factories'
import { createTestUser, type TestUser } from './test/users'

// ── scaffolding local a este archivo ────────────────────────────────────────
// Mismo patrón que db/close-with-bracket.db.test.ts: estos armadores sólo le
// sirven a este hallazgo (C30, verify-report-pr21 #4004 / decisión #4005), no
// van a db/test/factories.ts. A diferencia de `buildFifaScene` de aquel
// archivo, ACÁ la disciplina nace con `allowsDraw: true` a propósito: sin eso
// un empate en GRUPO tampoco se podría guardar, y el punto de este archivo es
// que SÍ se puede en GRUPO y NO afuera.

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

function fifaConfig(squadSize: number): SeasonConfig {
  return {
    ...defaultConfig(squadSize, 1),
    matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true, openScore: true },
    regularMatchdays: 1,
    countBestOf: 1,
    points: [8, 7, 6, 5, 4, 3, 2, 1],
  }
}

interface Scene {
  admin: TestUser
  seasonId: string
  entryIds: string[]
}

async function buildFifaSceneWithDraws(squadSize: number): Promise<Scene> {
  const admin = await createTestUser()
  const players = await fillerPlayers(squadSize)
  const { seasonId, entryIds } = await createSeason({
    admin,
    squad: players,
    disciplines: [{ kind: 'FIFA', pairSize: 1, allowsDraw: true, config: fifaConfig(squadSize) }],
  })
  return { admin, seasonId, entryIds }
}

async function markAllPlaying(admin: TestUser, matchdayId: string, entryIds: string[]): Promise<void> {
  for (const entryId of entryIds) {
    await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
  }
}

async function setFormato(matchdayId: string, formato: MatchdayFormat): Promise<void> {
  const db = adminClient()
  const { error } = await db
    .from('matchdays')
    .update({ formato: formato as unknown as Json })
    .eq('id', matchdayId)
  if (error) throw new Error(error.message)
}

interface MatchRow {
  id: string
  fase: string
  grupo: number
  round: number
  pair_a: string
  pair_b: string
}

async function matchesOf(matchdayId: string): Promise<MatchRow[]> {
  const db = adminClient()
  const { data, error } = await db
    .from('matches')
    .select('id, fase, grupo, round, pair_a, pair_b')
    .eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Arma la fecha GROUPS_KNOCKOUT con empates habilitados, la abre y juega el grupo entero (sin empates, para poder avanzar) hasta dejar la SEMI generada. */
async function openToSemis(): Promise<{ admin: TestUser; matchdayId: string; semi: MatchRow }> {
  const { admin, seasonId, entryIds } = await buildFifaSceneWithDraws(8)
  const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
  await markAllPlaying(admin, matchdayId, entryIds)
  await setFormato(matchdayId, { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 })
  await generatePairs(admin.client, matchdayId)
  await openMatchday(admin.client, matchdayId)

  // Todos los partidos de GRUPO con resultado decisivo -- ninguno empatado,
  // para poder avanzar de fase sin que este mismo guard interfiera acá.
  for (const match of await matchesOf(matchdayId)) {
    await saveResult(admin.client, match.id, [{ gamesA: 3, gamesB: 0 }])
  }
  await advancePhase(admin.client, matchdayId) // GRUPO -> SEMI

  const [semi] = (await matchesOf(matchdayId)).filter((match) => match.fase === 'SEMI')
  if (semi === undefined) throw new Error('Falta la semifinal.')
  return { admin, matchdayId, semi }
}

/**
 * C30 (verify-report-pr21, #4004) / decisión #4005: el empate es legal SÓLO
 * en la fase de GRUPO. Antes de este guard, `allows_draw=true` (derivado de
 * FIFA) dejaba guardar un 2-2 en CUALQUIER fase -- incluida una SEMI -- y
 * `winnerOf` (core/knockout.ts) reventaba con un `Error` pelado al avanzar o
 * cerrar. Acá adentro se juega SIEMPRE una FIFA con empates habilitados: la
 * disciplina permite el empate, la fase no.
 *
 * Por #3989 (guards en serie): un test que entra por `saveResult` (TS) sólo
 * prueba el guard de la APLICACIÓN -- si `matchError`/`setError` no supieran
 * de la fase, el rechazo sería el mismo mensaje genérico de siempre y el
 * guard de la BASE quedaría sin ejercitar. Por eso hace falta un segundo
 * test que inserte en `match_sets` DIRECTO, salteando `saveResult` -- mismo
 * patrón que `close-with-bracket.db.test.ts` usa para probar `close_matchday`
 * aislado del wrapper de TypeScript.
 */
describe('el empate sólo es legal en GRUPO (C30, decisión #4005)', () => {
  it('la pantalla rechaza un 2-2 en una SEMI con un mensaje claro (guard de aplicación)', async () => {
    const { admin, semi } = await openToSemis()

    await expect(saveResult(admin.client, semi.id, [{ gamesA: 2, gamesB: 2 }])).rejects.toThrow(
      /empate/,
    )
  })

  it('la base rechaza el mismo 2-2 insertado directo en match_sets, salteando saveResult', async () => {
    const { admin, semi } = await openToSemis()

    const { error } = await admin.client
      .from('match_sets')
      .insert({ match_id: semi.id, set_number: 1, games_a: 2, games_b: 2, allows_draw: true, fase: 'SEMI' })

    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/match_sets_no_draw/)
  })

  it('el mismo empate SÍ se guarda en GRUPO (no-regresión: la disciplina sigue permitiendo empate donde siempre pudo)', async () => {
    const { admin, seasonId, entryIds } = await buildFifaSceneWithDraws(8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, entryIds)
    await generatePairs(admin.client, matchdayId) // ROUND_ROBIN default: todo GRUPO
    await openMatchday(admin.client, matchdayId)
    const [match] = await matchesOf(matchdayId)
    if (match === undefined) throw new Error('Falta un partido.')

    await expect(saveResult(admin.client, match.id, [{ gamesA: 2, gamesB: 2 }])).resolves.toBeUndefined()
  })
})
