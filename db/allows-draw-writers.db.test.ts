import { describe, expect, it } from 'vitest'
import { defaultConfig, type SeasonConfig } from '@/core'
import {
  closeMatchday,
  createMasters,
  createMatchday,
  generatePairs,
  openMatchday,
  saveResult,
  setAttendance,
} from './matchday'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser, type TestUser } from './test/users'

//── W61 — la cadena de `allows_draw` contra los
// ESCRITORES DE PRODUCCIÓN, no contra inserts de test ────────────────────────
//
// `0034` agregó `matchdays.allows_draw`, `matches.allows_draw` y
// `match_sets.allows_draw`, cada una atada a su fila padre por una FK
// compuesta. Los tres tests que dejó la rebanada A arman esa cadena a mano con
// `service_role`, mandando `allows_draw` en cada insert, así que 317 verdes
// convivían con la capacidad entera rota: NINGÚN escritor real escribe la
// columna, y el default (`false`) rebota contra la FK en los CUATRO escalones.
//
// Medido por la ronda 19, ejerciendo las funciones reales:
//   createMatchday  → violates FK "matchdays_discipline_draw"
//   insertMatches   → violates FK "matches_matchday_draw"  (y deja pairs=4, matches=0)
//   replaceSets     → violates FK "match_sets_match_draw"  (aun con un 4-2, no un empate)
//   create_masters  → violates FK "matchdays_discipline_draw"  (SQL, 0021:72-73)
//
// Este archivo ejerce `createMatchday`, `generatePairs`, `saveResult`,
// `closeMatchday` y `create_masters` COMO LOS USA LA APP, y como
// `authenticated` (`admin.client`), nunca `service_role` — el único camino que
// ejercita los column-grants en vez de esquivarlos. `adminClient()` aparece
// sólo para ARMAR escenario (leer filas, plantar una fecha ya cerrada), nunca
// para escribir lo que el test viene a probar.

/**
 * Un formato donde un EMPATE es expresable con el modelo de hoy.
 *
 * `setError` valida el marcador contra `gamesPerSet`/`tieBreak`, que son
 * reglas de PÁDEL: con tie-break el set corta en `gamesPerSet` exacto. Un
 * empate sólo pasa esa validación cuando los dos llegan a `gamesPerSet`, o sea
 * `gamesPerSet = 2` y un 2-2.
 *
 * `openScore: false` A PROPÓSITO, y por eso este helper NO se reemplazó cuando
 * `openScore` aterrizó (PR20 rebanada D1): lo que este archivo prueba es la
 * cadena de FK de `allows_draw` contra los escritores reales, y esa cadena
 * tiene que seguir andando por el camino CERRADO. El marcador abierto tiene su
 * propio archivo (`db/open-score.db.test.ts`).
 *
 *De paso: el techo estaba declarado más chico
 * que el real. La regla medida no es "sólo el 2-2 de un set a 2" sino `N-N`
 * para cualquier `gamesPerSet` CON tie-break —el formato de pádel por defecto
 * ya admite un `4-4`— y ningún empate sin él.
 */
function drawConfig(): SeasonConfig {
  return {
    ...defaultConfig(8),
    matchFormat: { setsToWin: 1, gamesPerSet: 2, tieBreak: true, openScore: false },
    regularMatchdays: 1,
    countBestOf: 1,
  }
}

/** Pádel de siempre, con una sola fecha regular para llegar barato al Masters. */
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

async function buildScene(config: SeasonConfig, allowsDraw: boolean): Promise<Scene> {
  const admin = await createTestUser()
  const players = await fillerPlayers(config.squadSize)
  const { seasonId, disciplineId, entryIds } = await createSeason({
    admin,
    config,
    squad: players,
    disciplines: allowsDraw ? [{ kind: 'FIFA', allowsDraw: true }] : [{}],
  })
  return { admin, seasonId, disciplineId, squad: entryIds }
}

async function countOf(table: 'pairs' | 'matches', matchdayId: string): Promise<number> {
  const db = adminClient()
  const { count, error } = await db
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return count ?? 0
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

/**
 * Deja la temporada lista para el Masters sin jugar nada: planta una fecha
 * REGULAR ya CLOSED con `service_role`. `create_masters` sólo cuenta fechas
 * cerradas (`0021:57-64`), no las lee, así que esto alcanza y no arrastra el
 * pipeline entero a un test que viene a mirar UN insert.
 */
async function plantClosedMatchday(
  seasonId: string,
  disciplineId: string,
  pairSize: number,
  allowsDraw: boolean,
): Promise<void> {
  const db = adminClient()
  const { error } = await db.from('matchdays').insert({
    season_id: seasonId,
    discipline_id: disciplineId,
    number: 1,
    kind: 'REGULAR',
    status: 'CLOSED',
    played_on: '2026-03-05',
    pair_size: pairSize,
    allows_draw: allowsDraw,
  })
  if (error) throw new Error(error.message)
}

describe('la cadena de allows_draw contra los escritores de producción (W61, REQ-D6-1)', () => {
  it('una disciplina con empates se crea, sortea, guarda un 2-2 y cierra', async () => {
    const { admin, seasonId, disciplineId, squad } = await buildScene(drawConfig(), true)

    // 1. createMatchday — hoy muere con `matchdays_discipline_draw`.
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05', disciplineId)
    for (const entryId of squad) {
      await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
    }

    // 2. generatePairs → insertMatches — hoy muere con `matches_matchday_draw`
    // DESPUÉS de escribir las 4 parejas, dejando la fecha a medio armar.
    await generatePairs(admin.client, matchdayId)
    expect(await countOf('pairs', matchdayId)).toBe(4)
    expect(await countOf('matches', matchdayId)).toBe(6)

    await openMatchday(admin.client, matchdayId)
    const matchIds = await matchIdsOf(matchdayId)
    const [drawn, ...rest] = matchIds
    if (drawn === undefined) throw new Error('No se generó ningún partido.')

    // 3. saveResult → replaceSets — hoy muere con `match_sets_match_draw`
    // incluso con un resultado que NO es empate.
    await saveResult(admin.client, drawn, [{ gamesA: 2, gamesB: 2 }])
    expect(await setsOf(drawn)).toEqual([{ games_a: 2, games_b: 2 }])
    for (const matchId of rest) {
      await saveResult(admin.client, matchId, [{ gamesA: 2, gamesB: 0 }])
    }

    // 4. y la fecha cierra con el empate adentro.
    await closeMatchday(admin.client, matchdayId)
    expect(await awardsOf(matchdayId)).toHaveLength(8)
    expect(new Set((await awardsOf(matchdayId)).map((award) => award.position))).toEqual(
      new Set([1, 2, 3, 4]),
    )
  })

  it('create_masters escribe allows_draw de su disciplina', async () => {
    const { admin, seasonId, disciplineId } = await buildScene(drawConfig(), true)
    await plantClosedMatchday(seasonId, disciplineId, 2, true)

    const mastersId = await createMasters(admin.client, seasonId, '2026-12-20')

    const db = adminClient()
    const { data, error } = await db
      .from('matchdays')
      .select('allows_draw, pair_size, kind')
      .eq('id', mastersId)
      .single()
    if (error || data === null) throw new Error(error?.message)
    expect(data).toEqual({ allows_draw: true, pair_size: 2, kind: 'MASTERS' })
  })

  //La MISMA línea de insert
  // de `create_masters` tampoco escribe `pair_size`, así que sobre una
  // disciplina de a uno muere con `matchdays_discipline_size` desde `0028`.
  // Dos cadenas rotas en el mismo insert; se cierran juntas.
  it('create_masters escribe pair_size de su disciplina', async () => {
    const admin = await createTestUser()
    const players = await fillerPlayers(8)
    const { seasonId, disciplineId } = await createSeason({
      admin,
      config: { ...padelConfig(), points: [10, 8, 6, 5, 4, 3, 2, 1] },
      squad: players,
      disciplines: [{ kind: 'FIFA', pairSize: 1 }],
    })
    await plantClosedMatchday(seasonId, disciplineId, 1, false)

    const mastersId = await createMasters(admin.client, seasonId, '2026-12-20')

    const db = adminClient()
    const { data, error } = await db
      .from('matchdays')
      .select('allows_draw, pair_size, kind')
      .eq('id', mastersId)
      .single()
    if (error || data === null) throw new Error(error?.message)
    expect(data).toEqual({ allows_draw: false, pair_size: 1, kind: 'MASTERS' })
  })
})

// ── El pin de no-regresión: el pádel no se movió un milímetro ────────────────
//REQ-NR-1 (los mismos awards con la config por defecto) y REQ-NR-2 (la fecha
// sigue jugable de punta a punta). Ninguno de estos tres manda `allows_draw` a
// ningún lado: dependen sólo de los defaults, así que corren SIN CAMBIOS antes
// y después del arreglo, igual que el pin que dejó la rebanada A.
describe('no-regresión: el pádel sigue haciendo exactamente lo mismo (REQ-NR-1, REQ-NR-2)', () => {
  it('una fecha de pádel se crea, sortea, juega y cierra con los mismos premios', async () => {
    const { admin, seasonId, disciplineId, squad } = await buildScene(padelConfig(), false)

    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05', disciplineId)
    for (const entryId of squad) {
      await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
    }
    await generatePairs(admin.client, matchdayId)
    expect(await countOf('pairs', matchdayId)).toBe(4)
    expect(await countOf('matches', matchdayId)).toBe(6)

    await openMatchday(admin.client, matchdayId)
    for (const matchId of await matchIdsOf(matchdayId)) {
      await saveResult(admin.client, matchId, [{ gamesA: 4, gamesB: 0 }])
    }
    await closeMatchday(admin.client, matchdayId)

    // `defaultConfig(8)` reparte [10, 6, 3, 1] entre 4 parejas: dos personas
    // por posición. Es el premio EXACTO, no un conteo.
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

  it('un 2-2 en pádel sigue rebotando', async () => {
    const { admin, seasonId, disciplineId, squad } = await buildScene(padelConfig(), false)

    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05', disciplineId)
    for (const entryId of squad) {
      await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
    }
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)
    const [matchId] = await matchIdsOf(matchdayId)
    if (matchId === undefined) throw new Error('No se generó ningún partido.')

    await expect(saveResult(admin.client, matchId, [{ gamesA: 2, gamesB: 2 }])).rejects.toThrow(
      /no hay empates/,
    )
    expect(await setsOf(matchId)).toEqual([])
  })

  it('create_masters sobre una disciplina de pádel por defecto sigue andando', async () => {
    const { admin, seasonId, disciplineId } = await buildScene(padelConfig(), false)
    await plantClosedMatchday(seasonId, disciplineId, 2, false)

    const mastersId = await createMasters(admin.client, seasonId, '2026-12-20')

    const db = adminClient()
    const { data, error } = await db
      .from('matchdays')
      .select('allows_draw, pair_size, kind')
      .eq('id', mastersId)
      .single()
    if (error || data === null) throw new Error(error?.message)
    expect(data).toEqual({ allows_draw: false, pair_size: 2, kind: 'MASTERS' })
  })
})
