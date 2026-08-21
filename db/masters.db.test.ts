import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  computeRanking,
  defaultConfig,
  mastersChampion,
  mastersQualifiers,
  members,
  pair,
  sameSide,
  snapshotForMatchday,
  type DisciplineId,
  type MastersFour,
  type SeasonConfig,
  type Side,
} from '@/core'
import type { Json } from './database.types'
import { updateDisciplineConfig } from './discipline'
import {
  addGuest,
  clearPairs,
  closeMatchday,
  createMasters,
  createMatchday,
  generateMastersPairs,
  generatePairs,
  lockPair,
  openMatchday,
  reopenMatchday,
  saveResult,
  seedAttendances,
  setAttendance,
  setMyAttendance,
  syncGuestSeat,
} from './matchday'
import { attendancesOf, entriesOf, matchdayDetail, matchdaysOf, primaryDiscipline, seasonHeader } from './read'
import { awardsBefore, squadSeedOrder } from './season'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser, type TestUser } from './test/users'

// ── scaffolding local a este archivo ────────────────────────────────────────

/** Una temporada de una sola fecha regular: llegar al Masters cuesta una fecha, no doce. */
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

/**
 * SQL crudo contra la Postgres local, adentro del contenedor del stack de
 * Supabase. Mismo patrón y misma razón que `db/squad-position.db.test.ts`:
 * forzar los GUCs del planner (`enable_indexscan`, etc.) sólo se puede desde
 * una sesión de `psql`, no desde el cliente de test (PostgREST no expone
 * `set`). Acá además impersona al admin con `request.jwt.claim.sub` — el
 * mismo GUC que lee `auth.uid()` (0002_rls.sql) — porque `create_masters` es
 * `security definer` y su propio guard (`is_season_admin`) depende de él.
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

interface Scene {
  admin: TestUser
  player: TestUser
  seasonId: string
  disciplineId: DisciplineId
  squad: string[]
}

async function buildScene(config: SeasonConfig = shortSeason()): Promise<Scene> {
  const admin = await createTestUser()
  const player = await createTestUser()
  const filler = await fillerPlayers(config.squadSize - 1)
  const { seasonId, disciplineId, entryIds } = await createSeason({
    admin,
    config,
    squad: [player.playerId, ...filler],
  })
  return { admin, player, seasonId, disciplineId, squad: entryIds }
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

/**
 * Juega y cierra la temporada regular entera para dejarla lista para el Masters.
 *
 * `disciplineId` es opcional: todos los llamadores salvo el de N1 (heap
 * invertido, dos disciplinas) usan `buildScene()`, de una sola disciplina —
 * ahí omitirlo sigue sin ser ambiguo (S26, guarda de `createMatchday`).
 */
async function playRegularSeason(
  admin: TestUser,
  seasonId: string,
  squad: string[],
  disciplineId?: string,
): Promise<void> {
  const config = primaryDiscipline(await seasonHeader(admin.client, seasonId)).config
  for (let number = 1; number <= config.regularMatchdays; number++) {
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05', disciplineId)
    for (const entryId of squad) {
      await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
    }
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)
    for (const matchId of await matchIdsOf(matchdayId)) {
      await saveResult(admin.client, matchId, [{ gamesA: 4, gamesB: 0 }])
    }
    await closeMatchday(admin.client, matchdayId)
  }
}

async function qualifiersOf(
  admin: TestUser,
  seasonId: string,
  disciplineId: DisciplineId,
  mastersNumber: number,
): Promise<MastersFour> {
  const config = primaryDiscipline(await seasonHeader(admin.client, seasonId)).config
  const seedOrder = await squadSeedOrder(admin.client, disciplineId)
  const awards = await awardsBefore(admin.client, disciplineId, mastersNumber)
  const snapshot = snapshotForMatchday(mastersNumber, seedOrder, awards, config)
  return mastersQualifiers(computeRanking(awards, seedOrder, config, snapshot))
}

function sideKey(side: Side): string {
  return [...members(side)].sort().join('~')
}

// ── el Masters ──────────────────────────────────────────────────────────────

describe('the masters', () => {
  it('lays out six pairs and three matches where everyone plays once with everyone', async () => {
    const { admin, seasonId, disciplineId, squad } = await buildScene()
    await playRegularSeason(admin, seasonId, squad)

    const mastersId = await createMasters(admin.client, seasonId, '2026-12-20')
    await generateMastersPairs(admin.client, mastersId)

    const detail = await matchdayDetail(admin.client, mastersId)
    expect(detail.sides).toHaveLength(6)
    expect(detail.matches).toHaveLength(3)

    const four = await qualifiersOf(admin, seasonId, disciplineId, detail.matchday.number)

    // Las 6 parejas son las 6 combinaciones posibles de 4 jugadores, sin repetir.
    const expected = new Set<string>()
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) expected.add(sideKey(pair(four[i]!, four[j]!)))
    }
    expect(new Set(detail.sides.map(sideKey))).toEqual(expected)

    // Y cada clasificado aparece en exactamente 3 de ellas.
    for (const entryId of four) {
      const appearances = detail.sides.filter((side) => members(side).includes(entryId))
      expect(appearances).toHaveLength(3)
    }
  })

  it('follows the fixture of the spec: 1+4 vs 2+3, 1+3 vs 2+4, 1+2 vs 3+4', async () => {
    const { admin, seasonId, disciplineId, squad } = await buildScene()
    await playRegularSeason(admin, seasonId, squad)

    const mastersId = await createMasters(admin.client, seasonId, '2026-12-20')
    await generateMastersPairs(admin.client, mastersId)

    const detail = await matchdayDetail(admin.client, mastersId)
    const [one, two, three, four] = await qualifiersOf(admin, seasonId, disciplineId, detail.matchday.number)
    const byRound = [...detail.matches].sort((left, right) => left.round - right.round)

    const facing = (round: number): Set<string> =>
      new Set([sideKey(byRound[round]!.sideA), sideKey(byRound[round]!.sideB)])

    expect(facing(0)).toEqual(new Set([sideKey(pair(one, four)), sideKey(pair(two, three))]))
    expect(facing(1)).toEqual(new Set([sideKey(pair(one, three)), sideKey(pair(two, four))]))
    expect(facing(2)).toEqual(new Set([sideKey(pair(one, two)), sideKey(pair(three, four))]))
  })

  // Antes de este plan `openMatchday` corría assertMatchdaySize sobre un
  // `present` vacío y el Masters no se podía abrir nunca.
  it('opens without a single attendance row', async () => {
    const { admin, seasonId, squad } = await buildScene()
    await playRegularSeason(admin, seasonId, squad)

    const mastersId = await createMasters(admin.client, seasonId, '2026-12-20')
    await generateMastersPairs(admin.client, mastersId)
    expect(await attendancesOf(admin.client, mastersId)).toEqual(new Map())

    await openMatchday(admin.client, mastersId)

    const masters = (await matchdaysOf(admin.client, seasonId)).find((m) => m.id === mastersId)
    expect(masters?.status).toBe('OPEN')
  })

  // Antes de este plan closeMatchday mandaba seis awards y close_matchday los
  // rebotaba con "El Masters no reparte puntos": el año no podía terminar.
  it('closes without paying a single point, and ends the year', async () => {
    const { admin, seasonId, disciplineId, squad } = await buildScene()
    await playRegularSeason(admin, seasonId, squad)

    const mastersId = await createMasters(admin.client, seasonId, '2026-12-20')
    await generateMastersPairs(admin.client, mastersId)
    await openMatchday(admin.client, mastersId)
    for (const matchId of await matchIdsOf(mastersId)) {
      await saveResult(admin.client, matchId, [{ gamesA: 4, gamesB: 0 }])
    }

    await closeMatchday(admin.client, mastersId)

    const db = adminClient()
    const { count } = await db
      .from('awards')
      .select('id', { count: 'exact', head: true })
      .eq('matchday_id', mastersId)
    expect(count).toBe(0)
    expect((await seasonHeader(admin.client, seasonId)).status).toBe('FINISHED')

    //(0019_discipline_status_moves.sql): cerrar el Masters termina TAMBIÉN
    // la disciplina que lo jugó, mismo trinquete que seasons.status de arriba.
    const { data: discipline, error } = await db
      .from('disciplines')
      .select('status')
      .eq('id', disciplineId)
      .single()
    if (error || discipline === null) throw new Error(error?.message)
    expect(discipline.status).toBe('FINISHED')
  })

  //(0019_discipline_status_moves.sql): reabrir el Masters revierte
  // disciplines.status a ACTIVE, gemelo del trinquete ya probado en
  // db/season.db.test.ts para seasons.status.
  it('reopening the masters returns disciplines.status to ACTIVE', async () => {
    const { admin, disciplineId, seasonId, squad } = await buildScene()
    await playRegularSeason(admin, seasonId, squad)

    const mastersId = await createMasters(admin.client, seasonId, '2026-12-20')
    await generateMastersPairs(admin.client, mastersId)
    await openMatchday(admin.client, mastersId)
    for (const matchId of await matchIdsOf(mastersId)) {
      await saveResult(admin.client, matchId, [{ gamesA: 4, gamesB: 0 }])
    }
    await closeMatchday(admin.client, mastersId)

    const db = adminClient()
    const disciplineStatus = async (): Promise<string> => {
      const { data, error } = await db.from('disciplines').select('status').eq('id', disciplineId).single()
      if (error || data === null) throw new Error(error?.message)
      return data.status
    }
    expect(await disciplineStatus()).toBe('FINISHED')

    await reopenMatchday(admin.client, mastersId)

    expect(await disciplineStatus()).toBe('ACTIVE')
    expect((await seasonHeader(admin.client, seasonId)).status).toBe('ACTIVE')
  })

  it('crowns the player who won the most matches', async () => {
    const { admin, seasonId, disciplineId, squad } = await buildScene()
    await playRegularSeason(admin, seasonId, squad)

    const mastersId = await createMasters(admin.client, seasonId, '2026-12-20')
    await generateMastersPairs(admin.client, mastersId)
    await openMatchday(admin.client, mastersId)

    const detail = await matchdayDetail(admin.client, mastersId)
    const four = await qualifiersOf(admin, seasonId, disciplineId, detail.matchday.number)
    const target = four[3]! // el 4º del año: sin él no se distingue de un empate roto por ranking

    // El 4º gana sus tres partidos, así que gana limpio y no por desempate.
    for (const match of detail.matches) {
      const targetIsA = members(match.sideA).includes(target)
      await saveResult(
        admin.client,
        match.id,
        targetIsA ? [{ gamesA: 4, gamesB: 1 }] : [{ gamesA: 1, gamesB: 4 }],
      )
    }

    const after = await matchdayDetail(admin.client, mastersId)
    expect(mastersChampion(four, after.matches)).toBe(target)
  })
})


describe('generateMastersPairs pair_size guard', () => {
  it('rejects a MASTERS matchday of a pair_size=1 discipline with an honest message, before touching pairs', async () => {
    const admin = await createTestUser()
    const filler = await fillerPlayers(8)
    const { seasonId, disciplineId } = await createSeason({
      admin,
      squad: filler,
      disciplines: [{ kind: 'FIFA', pairSize: 1 }],
    })
    const db = adminClient()
    const { data: matchday, error: matchdayError } = await db
      .from('matchdays')
      .insert({ season_id: seasonId, discipline_id: disciplineId, number: 1, kind: 'MASTERS', pair_size: 1 })
      .select('id')
      .single()
    if (matchdayError || matchday === null) throw new Error(matchdayError?.message)

    await expect(generateMastersPairs(admin.client, matchday.id)).rejects.toThrow(
      'El Masters se juega de a parejas: una disciplina de a uno no lo arma.',
    )
  })
})

// ── W87 (verify-report-pre-contract #4026) ──────────────────────────────────
// `create_masters` leía `seasons.config.regularMatchdays`, y `seasons.config`
// no tiene escritor de producción desde PR6: `updateDisciplineConfig`
// (db/discipline.ts), el único camino real de "Fechas" en Ajustes, sólo toca
// `disciplines.config`. El portón del Masters y la pantalla (que SÍ lee
// `discipline.config.regularMatchdays`, `fechas/page.tsx:114`) podían quedar
// diciendo dos cosas distintas.
function tenMatchdaySeason(): SeasonConfig {
  return { ...defaultConfig(8), regularMatchdays: 10, countBestOf: 10 }
}

describe('create_masters reads disciplines.config, not seasons.config', () => {
  it('lets the Masters be armed after the FECHAS the admin edited in Ajustes, not the stale value nobody writes back to seasons.config', async () => {
    const { admin, seasonId, disciplineId, squad } = await buildScene(tenMatchdaySeason())

    // "Fechas" en Ajustes: el único escritor real de producción, y sólo toca
    // disciplines.config (docblock de updateDisciplineConfig). seasons.config
    // se queda en regularMatchdays=10 para siempre.
    await updateDisciplineConfig(admin.client, disciplineId, {
      ...tenMatchdaySeason(),
      regularMatchdays: 1,
      countBestOf: 1,
    })

    // Juega y cierra sólo 1 fecha: playRegularSeason lee la config vigente de
    // la DISCIPLINA (primaryDiscipline(header).config), que ahora dice 1.
    await playRegularSeason(admin, seasonId, squad)

    const mastersId = await createMasters(admin.client, seasonId, '2026-12-20')

    const db = adminClient()
    const { data: matchday, error } = await db
      .from('matchdays')
      .select('kind, discipline_id')
      .eq('id', mastersId)
      .single()
    if (error || matchday === null) throw new Error(error?.message)
    expect(matchday.kind).toBe('MASTERS')
    expect(matchday.discipline_id).toBe(disciplineId)
  })
})


describe('create_masters discipline resolution', () => {
  // 0016_matchday_scope.sql:85 resolvía `v_discipline` con un
  // `select ... into` SIN `order by` ni `limit`: con una sola disciplina por
  // temporada (el tripwire de 0015) daba siempre lo mismo por casualidad,
  // pero con dos filas el resultado depende del plan que elija el planner.
  // `defaultDisciplineId` (db/season.ts) ya tiene el criterio correcto
  // (`position, created_at`); create_masters tiene que coincidir SIEMPRE, no
  // sólo cuando el planner elige Index Scan.
  it('picks the same discipline as defaultDisciplineId even under a Seq Scan over a reversed heap', async () => {
    const config = shortSeason()
    const admin = await createTestUser()
    const filler = await fillerPlayers(config.squadSize - 1)
    const { seasonId, entryIds: squad } = await createSeason({
      admin,
      config,
      squad: [admin.playerId, ...filler],
      disciplines: [{ kind: 'PADEL' }],
    })

    // Heap invertido respecto de `position`, mismo truco que
    // squad-position.db.test.ts: un solo insert múltiple escribe las dos
    // filas en el orden del array, así que FIFA (position 1) queda
    // físicamente ANTES que PADEL (position 0). `order by position` sigue
    // dando PADEL; un Seq Scan sin `order by` da FIFA.
    const db = adminClient()
    await db.from('disciplines').delete().eq('season_id', seasonId)
    const { data: disciplines, error: disciplinesError } = await db
      .from('disciplines')
      .insert([
        { season_id: seasonId, kind: 'FIFA', config: config as unknown as Json, position: 1 },
        { season_id: seasonId, kind: 'PADEL', config: config as unknown as Json, position: 0 },
      ])
      .select('id, kind')
    if (disciplinesError || disciplines === null) throw new Error(disciplinesError?.message)
    const padelId = disciplines.find((row) => row.kind === 'PADEL')?.id
    const fifaId = disciplines.find((row) => row.kind === 'FIFA')?.id
    if (padelId === undefined || fifaId === undefined) throw new Error('Faltó una disciplina de test.')

    // El heap quedó como se pide: no se asume, se mide (mismo criterio que
    // squad-position.db.test.ts:228-230).
    const heap = localSql(
      `select kind from public.disciplines where season_id = '${seasonId}' order by ctid;`,
    )
      .trim()
      .split('\n')
    expect(heap).toEqual(['FIFA', 'PADEL'])

    // El criterio correcto (el que ya usa defaultDisciplineId) sigue dando
    // PADEL pase lo que pase con el heap: es la referencia contra la que
    // create_masters tiene que coincidir.
    const { data: authoritative } = await db
      .from('disciplines')
      .select('id')
      .eq('season_id', seasonId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    expect(authoritative?.id).toBe(padelId)

    // El `delete` de disciplines de arriba se llevó en cascada las filas de
    // `discipline_entries` del plantel (PR 7): sin reponerlas para el padelId
    // NUEVO, `setAttendance` (adentro de `playRegularSeason`) choca contra
    // `attendances_entry_discipline` (PR 8) apenas intenta marcar presente.
    const { error: seatsError } = await db.from('discipline_entries').insert(
      squad.map((entryId, index) => ({
        discipline_id: padelId,
        entry_id: entryId,
        season_id: seasonId,
        seed_position: index,
      })),
    )
    if (seatsError) throw new Error(seatsError.message)

    // Cierra la única fecha regular de PADEL — FIFA se queda sin ninguna. Si
    // create_masters resolviera FIFA por error, vería 0 fechas cerradas en
    // vez de la 1 que pide `regularMatchdays` y explotaría con "faltan 1".
    await playRegularSeason(admin, seasonId, squad, padelId)

    // GUCs y llamada en la MISMA sesión de psql, mismo motivo que
    // squad-position.db.test.ts:240-243: sin index scan ni bitmap scan al
    // motor no le queda otra que el Seq Scan, que recorre el heap tal cual
    // quedó escrito arriba.
    const output = localSql(`
      set enable_indexscan = off;
      set enable_bitmapscan = off;
      set enable_indexonlyscan = off;
      set request.jwt.claim.sub = '${admin.userId}';
      select public.create_masters('${seasonId}'::uuid, '2026-12-20'::date);
    `)
    const mastersId = output.trim()
    expect(mastersId).toMatch(/^[0-9a-f-]{36}$/)

    const { data: masters, error: mastersError } = await db
      .from('matchdays')
      .select('discipline_id')
      .eq('id', mastersId)
      .single()
    if (mastersError || masters === null) throw new Error(mastersError?.message)
    expect(masters.discipline_id).toBe(padelId)
  })
})

// ── el armado de una fecha regular ──────────────────────────────────────────

describe('seedAttendances', () => {
  it('marks the whole squad as coming, once', async () => {
    const { admin, seasonId, squad } = await buildScene()
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05')

    await seedAttendances(admin.client, matchdayId)
    await seedAttendances(admin.client, matchdayId)

    const attendances = await attendancesOf(admin.client, matchdayId)
    expect(attendances.size).toBe(squad.length)
    expect([...attendances.values()].every((status) => status === 'PLAYING')).toBe(true)
  })

  // Lo que el jugador avisó desde la Tabla no se pisa cuando el admin entra al armado.
  it('does not overwrite an ABSENT somebody already reported', async () => {
    const { admin, player, seasonId, squad } = await buildScene()
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05')
    await setMyAttendance(player.client, matchdayId, 'ABSENT')

    await seedAttendances(admin.client, matchdayId)

    const attendances = await attendancesOf(admin.client, matchdayId)
    expect(attendances.get(squad[0]!)).toBe('ABSENT')
    expect(attendances.size).toBe(squad.length)
  })
})

describe('syncGuestSeat', () => {
  it('adds one nameless guest when the count comes out odd', async () => {
    const { admin, seasonId, squad } = await buildScene()
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05')
    await seedAttendances(admin.client, matchdayId)
    await setAttendance(admin.client, matchdayId, squad[7]!, 'ABSENT')

    await syncGuestSeat(admin.client, matchdayId)
    await syncGuestSeat(admin.client, matchdayId)

    const guests = (await entriesOf(admin.client, seasonId)).filter(
      (entry) => entry.kind === 'GUEST' && entry.matchdayId === matchdayId,
    )
    expect(guests).toHaveLength(1)
    expect(guests[0]?.displayName).toBe('')
  })

  it('takes the nameless guest away when the count comes out even again', async () => {
    const { admin, seasonId, squad } = await buildScene()
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05')
    await seedAttendances(admin.client, matchdayId)
    await setAttendance(admin.client, matchdayId, squad[7]!, 'ABSENT')
    await syncGuestSeat(admin.client, matchdayId)

    await setAttendance(admin.client, matchdayId, squad[7]!, 'PLAYING')
    await syncGuestSeat(admin.client, matchdayId)

    const guests = (await entriesOf(admin.client, seasonId)).filter(
      (entry) => entry.kind === 'GUEST' && entry.matchdayId === matchdayId,
    )
    expect(guests).toEqual([])
  })

  // Alguien lo cargó a propósito: sacarlo porque cambió un tilde pierde el dato.
  it('leaves a guest who already has a name alone', async () => {
    const { admin, seasonId, squad } = await buildScene()
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05')
    await seedAttendances(admin.client, matchdayId)
    await setAttendance(admin.client, matchdayId, squad[7]!, 'ABSENT')
    await syncGuestSeat(admin.client, matchdayId)

    const guestId = (await entriesOf(admin.client, seasonId)).find(
      (entry) => entry.kind === 'GUEST' && entry.matchdayId === matchdayId,
    )!.id
    const { nameGuest } = await import('./matchday')
    await nameGuest(admin.client, guestId, 'Pablo')

    await setAttendance(admin.client, matchdayId, squad[7]!, 'PLAYING')
    await syncGuestSeat(admin.client, matchdayId)

    const guests = (await entriesOf(admin.client, seasonId)).filter(
      (entry) => entry.kind === 'GUEST' && entry.matchdayId === matchdayId,
    )
    expect(guests).toHaveLength(1)
    expect(guests[0]?.displayName).toBe('Pablo')
  })

  // Una pareja invitada suma DOS y no cambia la paridad, así que no cuenta para
  // decidir si falta uno. Contándola, una fecha de 7 + pareja quedaba en 9.
  it('still adds the nameless guest when an invited pair is already on the matchday', async () => {
    const { admin, seasonId, squad } = await buildScene()
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05')
    await seedAttendances(admin.client, matchdayId)
    await setAttendance(admin.client, matchdayId, squad[7]!, 'ABSENT')

    const one = await addGuest(admin.client, matchdayId, { displayName: 'Rulo' })
    const two = await addGuest(admin.client, matchdayId, { displayName: 'Tincho' })
    await lockPair(admin.client, matchdayId, one, two)

    await syncGuestSeat(admin.client, matchdayId)

    const guests = (await entriesOf(admin.client, seasonId)).filter(
      (entry) => entry.kind === 'GUEST' && entry.matchdayId === matchdayId,
    )
    // Los 7 del plantel + la pareja + el relleno = 10, que es par y se puede armar.
    expect(guests).toHaveLength(3)
    expect(guests.filter((guest) => guest.displayName === '')).toHaveLength(1)
  })

  it('leaves an invited pair alone when the squad count is even', async () => {
    const { admin, seasonId } = await buildScene()
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05')
    await seedAttendances(admin.client, matchdayId)

    const one = await addGuest(admin.client, matchdayId, { displayName: 'Rulo' })
    const two = await addGuest(admin.client, matchdayId, { displayName: 'Tincho' })
    await lockPair(admin.client, matchdayId, one, two)

    await syncGuestSeat(admin.client, matchdayId)

    const guests = (await entriesOf(admin.client, seasonId)).filter(
      (entry) => entry.kind === 'GUEST' && entry.matchdayId === matchdayId,
    )
    // 8 + 2 = 10: no falta ni sobra nadie.
    expect(guests).toHaveLength(2)
  })
})

describe('clearPairs', () => {
  it('throws away a draw that the roster has already outdated', async () => {
    const { admin, seasonId, squad } = await buildScene()
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05')
    await seedAttendances(admin.client, matchdayId)
    await generatePairs(admin.client, matchdayId)
    expect((await matchdayDetail(admin.client, matchdayId)).sides).toHaveLength(4)

    await clearPairs(admin.client, matchdayId)

    const detail = await matchdayDetail(admin.client, matchdayId)
    expect(detail.sides).toEqual([])
    expect(detail.matches).toEqual([])
  })

  it('refuses to touch a matchday that is already being played', async () => {
    const { admin, seasonId } = await buildScene()
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05')
    await seedAttendances(admin.client, matchdayId)
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)

    await expect(clearPairs(admin.client, matchdayId)).rejects.toThrow(/en armado/)
    expect((await matchdayDetail(admin.client, matchdayId)).sides).toHaveLength(4)
  })
})

describe('a matchday drawn with a guest', () => {
  it('goes from seven confirmed to a matchday of eight', async () => {
    const { admin, seasonId, squad } = await buildScene()
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05')
    await seedAttendances(admin.client, matchdayId)
    await setAttendance(admin.client, matchdayId, squad[7]!, 'ABSENT')
    await syncGuestSeat(admin.client, matchdayId)

    const guestId = (await entriesOf(admin.client, seasonId)).find(
      (entry) => entry.kind === 'GUEST' && entry.matchdayId === matchdayId,
    )!.id
    const { nameGuest } = await import('./matchday')

    // Spec 2.6: con el invitado sin nombre se arman las parejas pero no se abre.
    await generatePairs(admin.client, matchdayId)
    await expect(openMatchday(admin.client, matchdayId)).rejects.toThrow(/nombre al invitado/)

    await nameGuest(admin.client, guestId, 'Pablo')
    await openMatchday(admin.client, matchdayId)

    const detail = await matchdayDetail(admin.client, matchdayId)
    expect(detail.sides).toHaveLength(4)
    expect(detail.guestIds).toEqual([guestId])
    expect(detail.sides.some((side) => sameSide(side, pair(guestId, guestId)))).toBe(false)
  })
})
