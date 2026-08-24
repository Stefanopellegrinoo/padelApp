import { describe, expect, it } from 'vitest'
import { defaultConfig, type SeasonConfig } from '@/core'
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

// ── PR20 rebanada D1 — el MARCADOR ABIERTO contra los escritores reales ──────
//
// Decisión #3933: un partido de FIFA se carga con goles, cualquier par de
// enteros >= 0. Este archivo lo ejerce por el camino de la app —`saveResult`,
// como `authenticated`, nunca `service_role`— porque quien prohíbe hoy un
// `3-1` NO es la base: `match_sets` guarda `games_a int check (games_a >= 0)`
// SIN tope superior (`0001_schema.sql:194-203`) y `match_sets_no_draw` quedó
// condicionado por `0034` a `(allows_draw or games_a <> games_b)`. O sea la
// base ya acepta un `3-1` y un `0-0`; quien los rechaza es `setError`.
//
// Por eso esta rebanada NO trae migración de schema. La única migración que
// trae (`0037`) es el backfill del jsonb, y su tripwire es el último test.
//
// `adminClient()` aparece sólo para LEER lo que se escribió, nunca para
// escribir lo que el test viene a probar.

/**
 * FIFA: marcador abierto y empates.
 *
 * Los dos números de pádel siguen puestos porque `MatchFormat` los declara
 * obligatorios — y son EXACTAMENTE los que prohíben un `3-1` en el camino
 * cerrado (con tie-break el set corta en `gamesPerSet` exacto). Dejarlos en
 * `4`/`true` y ver pasar un `3-1` es la prueba de que el camino abierto no los
 * lee.
 *
 * `allowsDraw: true` va aparte y a propósito: el empate es una regla
 * ORTOGONAL al marcador abierto, y la base la sigue exigiendo por su cuenta
 * (`match_sets_no_draw`, 0034).
 */
function fifaConfig(): SeasonConfig {
  return {
    ...defaultConfig(8),
    matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true, openScore: true },
    regularMatchdays: 1,
    countBestOf: 1,
  }
}

/** Pádel de siempre. El pin de no-regresión corre contra esto. */
function padelConfig(): SeasonConfig {
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
  seasonId: string
  disciplineId: string
  squad: string[]
}

async function buildScene(config: SeasonConfig, openScore: boolean): Promise<Scene> {
  const admin = await createTestUser()
  const players = await fillerPlayers(config.squadSize)
  const { seasonId, disciplineId, entryIds } = await createSeason({
    admin,
    config,
    squad: players,
    disciplines: openScore ? [{ kind: 'FIFA', allowsDraw: true }] : [{}],
  })
  return { admin, seasonId, disciplineId, squad: entryIds }
}

async function matchIdsOf(matchdayId: string): Promise<string[]> {
  const db = adminClient()
  const { data, error } = await db
    .from('matches')
    .select('id')
    .eq('matchday_id', matchdayId)
    .order('round', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => row.id)
}

async function setsOf(matchId: string): Promise<Array<{ games_a: number; games_b: number }>> {
  const db = adminClient()
  const { data, error } = await db
    .from('match_sets')
    .select('games_a, games_b')
    .eq('match_id', matchId)
    .order('set_number', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({ games_a: row.games_a, games_b: row.games_b }))
}

async function awardsOf(matchdayId: string): Promise<Array<{ position: number; points: number }>> {
  const db = adminClient()
  const { data, error } = await db
    .from('awards')
    .select('position, points')
    .eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return (data ?? [])
    .map((row) => ({ position: row.position, points: row.points }))
    .sort((left, right) => left.position - right.position || right.points - left.points)
}

async function playableMatchday(scene: Scene): Promise<string[]> {
  const { admin, seasonId, disciplineId, squad } = scene
  const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05', disciplineId)
  for (const entryId of squad) {
    await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
  }
  await generatePairs(admin.client, matchdayId)
  await openMatchday(admin.client, matchdayId)
  return [matchdayId, ...(await matchIdsOf(matchdayId))]
}

describe('marcador abierto: un partido se carga con goles (decisión #3933)', () => {
  it('guarda un 3-1 y un 0-0 en la misma fecha, y la fecha cierra', async () => {
    const scene = await buildScene(fifaConfig(), true)
    const [matchdayId, ...matchIds] = await playableMatchday(scene)
    if (matchdayId === undefined) throw new Error('No se creó la fecha.')
    const [uneven, goalless, ...rest] = matchIds
    if (uneven === undefined || goalless === undefined) {
      throw new Error('No se generaron suficientes partidos.')
    }

    // `3-1`: hoy muere en `setError` con "En un set a 4 games con tie-break,
    // 3-1 no es un resultado posible."
    await saveResult(scene.admin.client, uneven, [{ gamesA: 3, gamesB: 1 }])
    expect(await setsOf(uneven)).toEqual([{ games_a: 3, games_b: 1 }])

    // `0-0`: el resultado más común del fútbol, y el que la ronda 20 midió
    // como IMPOSIBLE en toda configuración del modelo de pádel.
    await saveResult(scene.admin.client, goalless, [{ gamesA: 0, gamesB: 0 }])
    expect(await setsOf(goalless)).toEqual([{ games_a: 0, games_b: 0 }])

    for (const matchId of rest) {
      await saveResult(scene.admin.client, matchId, [{ gamesA: 2, gamesB: 0 }])
    }

    await closeMatchday(scene.admin.client, matchdayId)
    expect(await awardsOf(matchdayId)).toHaveLength(8)
  })

  it('un marcador abierto es UN partido: dos resultados no se cargan', async () => {
    const scene = await buildScene(fifaConfig(), true)
    const [, matchId] = await playableMatchday(scene)
    if (matchId === undefined) throw new Error('No se generó ningún partido.')

    await expect(
      saveResult(scene.admin.client, matchId, [
        { gamesA: 3, gamesB: 1 },
        { gamesA: 1, gamesB: 0 },
      ]),
    ).rejects.toThrow(/un solo resultado/)
    expect(await setsOf(matchId)).toEqual([])
  })
})

// ── El pin de no-regresión: el pádel no se movió un milímetro ────────────────
// REQ-NR-1 (los mismos awards con la config por defecto, palabra por palabra en
// los mensajes) y REQ-NR-2 (la fecha sigue jugable de punta a punta). Estos
// dos pasan DESDE EL RED.
describe('no-regresión: el pádel sigue haciendo exactamente lo mismo (REQ-NR-1, REQ-NR-2)', () => {
  it('una fecha de pádel se juega y cierra con los mismos premios', async () => {
    const scene = await buildScene(padelConfig(), false)
    const [matchdayId, ...matchIds] = await playableMatchday(scene)
    if (matchdayId === undefined) throw new Error('No se creó la fecha.')

    for (const matchId of matchIds) {
      await saveResult(scene.admin.client, matchId, [{ gamesA: 4, gamesB: 0 }])
    }
    await closeMatchday(scene.admin.client, matchdayId)

    expect(await awardsOf(matchdayId)).toEqual([
      { position: 1, points: 10 },
      { position: 1, points: 10 },
      { position: 2, points: 6 },
      { position: 2, points: 6 },
      { position: 3, points: 3 },
      { position: 3, points: 3 },
      { position: 4, points: 1 },
      { position: 4, points: 1 },
    ])
  })

  it('un 3-1 en pádel sigue rebotando con el MISMO mensaje de hoy', async () => {
    const scene = await buildScene(padelConfig(), false)
    const [, matchId] = await playableMatchday(scene)
    if (matchId === undefined) throw new Error('No se generó ningún partido.')

    await expect(
      saveResult(scene.admin.client, matchId, [{ gamesA: 3, gamesB: 1 }]),
    ).rejects.toThrow('En un set a 4 games con tie-break, 3-1 no es un resultado posible.')
    expect(await setsOf(matchId)).toEqual([])
  })

  it('y un 0-0 en pádel también', async () => {
    const scene = await buildScene(padelConfig(), false)
    const [, matchId] = await playableMatchday(scene)
    if (matchId === undefined) throw new Error('No se generó ningún partido.')

    await expect(
      saveResult(scene.admin.client, matchId, [{ gamesA: 0, gamesB: 0 }]),
    ).rejects.toThrow(/no hay empates/)
    expect(await setsOf(matchId)).toEqual([])
  })
})

// ── El tripwire del backfill (`0037`) ────────────────────────────────────────
// Un campo nuevo con default permisivo esconde a los escritores que no lo
// escriben — pasó con `pair_size` y con `allows_draw`. Del lado
// de TypeScript la red es `tsc` (el campo es OBLIGATORIO en `MatchFormat`).
// Del lado del jsonb no hay compilador, así que la red es esta consulta: una
// fila de `disciplines` sin `openScore` en su config es una fila que el código
// lee como `undefined`.
//
// Mira el SEED a propósito y no la tabla entera: el seed corre DESPUÉS de las
// migraciones, así que es la única fila que el backfill de `0037` no alcanza y
// la única que puede quedarse atrás en silencio.
describe('backfill de openScore (0037)', () => {
  it('la disciplina del seed tiene openScore en su config', async () => {
    const db = adminClient()
    const { data, error } = await db
      .from('seasons')
      .select('id, disciplines(config)')
      .eq('invite_token', 'demo')
      .single()
    if (error || data === null) throw new Error(error?.message)

    // Ya no mira `seasons.config` (C35): esa columna no tiene un solo lector
    // de producción y el CONTRACT la dropea — el seed dejó de escribirla en
    // esta misma tanda. `disciplines.config` es la fuente real desde PR 5, y
    // es la única mitad de este tripwire que estaba mirando lo que importa.
    expect(data.disciplines.length).toBeGreaterThan(0)
    for (const discipline of data.disciplines) {
      const format = (discipline.config as { matchFormat?: Record<string, unknown> }).matchFormat
      expect(format).toHaveProperty('openScore', false)
    }
  })
})
