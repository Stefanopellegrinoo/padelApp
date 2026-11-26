import { createClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it } from 'vitest'
import { fichaSeed } from '@/core'
import type { Database } from './database.types'
import { createMatchday, openMatchday, seedAttendances, setAttendance } from './matchday'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser, type TestUser } from './test/users'

/**
 * La seguridad de los pinos de bowling (S4) y las reglas de `close_matchday`
 * para una fecha `RANKING`, directo contra la base y sin pasar por la app:
 * quién lee y escribe `matchday_scores` (0109) y qué premios acepta el cierre
 * (0111). Fija lo que midió la verificación independiente de T4. Cada test
 * arma su temporada y la borra al terminar, junto con sus usuarios y jugadores.
 */

// La ficha de bowling de verdad: 6 jugadores, de a uno, puntos 10/7/5/3/2/1.
const SEED = fichaSeed('BOWLING', 6, 'INDIVIDUAL')
const POINTS = SEED.config.points

const RLS_DENIED = 'new row violates row-level security policy for table "matchday_scores"'

// Cliente sin sesión: es el rol `anon` de PostgREST, no un `authenticated` de
// mentira. No confundir con `adminClient()`, que es `service_role`.
function anonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (url === undefined || anonKey === undefined) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY.')
  }
  return createClient<Database>(url, anonKey)
}

// Lo que cada test crea, para borrarlo en `afterEach` aunque el test falle.
const created = { seasons: [] as string[], users: [] as string[], players: [] as string[] }

afterEach(async () => {
  const db = adminClient()
  for (const id of created.seasons.splice(0)) await db.from('seasons').delete().eq('id', id)
  for (const id of created.players.splice(0)) await db.from('players').delete().eq('id', id)
  for (const id of created.users.splice(0)) await db.auth.admin.deleteUser(id)
})

async function user(): Promise<TestUser> {
  const u = await createTestUser()
  created.users.push(u.userId)
  return u
}

async function fillerPlayers(count: number): Promise<string[]> {
  const db = adminClient()
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    const { data, error } = await db
      .from('players')
      .insert({ display_name: `Pinos RLS de test ${Date.now()}-${i}-${Math.random()}` })
      .select('id')
      .single()
    if (error || data === null) throw new Error(error?.message)
    created.players.push(data.id)
    ids.push(data.id)
  }
  return ids
}

interface Scene {
  admin: TestUser
  /** El primero del plantel, con cuenta propia. */
  player: TestUser
  seasonId: string
  matchdayId: string
  /** Seis asientos; el último (`squad[5]`) está AUSENTE en la fecha. */
  squad: string[]
}

/** Temporada de bowling de 6 con una fecha en DRAFT: presentes los cinco primeros, ausente el sexto. */
async function bowlingFecha(): Promise<Scene> {
  const admin = await user()
  const player = await user()
  const players = [player.playerId, ...(await fillerPlayers(5))]
  const { seasonId, disciplineId, entryIds } = await createSeason({
    admin,
    config: SEED.config,
    squad: players,
    disciplines: [
      { kind: 'BOWLING', config: SEED.config, pairSize: 1, allowsDraw: false, formatoDefault: SEED.formatoDefault },
    ],
  })
  created.seasons.push(seasonId)
  const matchdayId = await createMatchday(admin.client, seasonId, '2026-11-20', disciplineId)
  await seedAttendances(admin.client, matchdayId)
  await setAttendance(admin.client, matchdayId, entryIds[5]!, 'ABSENT')
  return { admin, player, seasonId, matchdayId, squad: entryIds }
}

const row = (scene: Scene, entryId: string, score: number) => ({
  matchday_id: scene.matchdayId,
  entry_id: entryId,
  season_id: scene.seasonId,
  score,
})

async function scoresOf(matchdayId: string): Promise<Record<string, number>> {
  const { data, error } = await adminClient()
    .from('matchday_scores')
    .select('entry_id, score')
    .eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return Object.fromEntries((data ?? []).map((r) => [r.entry_id, r.score]))
}

async function statusOf(matchdayId: string): Promise<string> {
  const { data, error } = await adminClient().from('matchdays').select('status').eq('id', matchdayId).single()
  if (error || data === null) throw new Error(error?.message)
  return data.status
}

async function awardsOf(matchdayId: string): Promise<Array<[number, number]>> {
  const { data, error } = await adminClient()
    .from('awards')
    .select('position, points')
    .eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return (data ?? []).map((a): [number, number] => [a.position, a.points]).sort((x, y) => x[0] - y[0] || y[1] - x[1])
}

describe('anon no toca los pinos', () => {
  it('ni lee ni escribe matchday_scores, ni ejecuta sus funciones', async () => {
    const scene = await bowlingFecha()
    await openMatchday(scene.admin.client, scene.matchdayId)
    const anon = anonClient()

    const select = await anon.from('matchday_scores').select('*')
    expect(select.error?.code).toBe('42501')
    expect(select.error?.message).toBe('permission denied for table matchday_scores')

    const insert = await anon.from('matchday_scores').insert(row(scene, scene.squad[0]!, 100))
    expect(insert.error?.code).toBe('42501')
    expect(insert.error?.message).toBe('permission denied for table matchday_scores')

    const isOpen = await anon.rpc('matchday_score_is_open', { p_matchday: scene.matchdayId, p_entry: scene.squad[0]! })
    expect(isOpen.error?.code).toBe('42501')
    expect(isOpen.error?.message).toBe('permission denied for function matchday_score_is_open')

    const close = await anon.rpc('close_matchday', { p_matchday: scene.matchdayId, p_awards: [] })
    expect(close.error?.code).toBe('42501')
    expect(close.error?.message).toBe('permission denied for function close_matchday')

    expect(await scoresOf(scene.matchdayId)).toEqual({})
    expect(await statusOf(scene.matchdayId)).toBe('OPEN')
  })
})

describe('quién escribe los pinos (matchday_scores_write)', () => {
  it('quien organiza: no en DRAFT, sí en juego, nunca para un ausente, y sólo de 0 a 9999', async () => {
    const scene = await bowlingFecha()
    const [a, b] = scene.squad
    const absent = scene.squad[5]!

    const draft = await scene.admin.client.from('matchday_scores').insert(row(scene, a!, 100))
    expect(draft.error?.code).toBe('42501')
    expect(draft.error?.message).toBe(RLS_DENIED)
    expect(await scoresOf(scene.matchdayId)).toEqual({})

    await openMatchday(scene.admin.client, scene.matchdayId)
    const open = await scene.admin.client.from('matchday_scores').insert(row(scene, a!, 200))
    expect(open.error).toBeNull()

    const toAbsent = await scene.admin.client.from('matchday_scores').insert(row(scene, absent, 100))
    expect(toAbsent.error?.code).toBe('42501')
    expect(toAbsent.error?.message).toBe(RLS_DENIED)

    for (const bad of [-1, 10000]) {
      const out = await scene.admin.client.from('matchday_scores').insert(row(scene, b!, bad))
      expect(out.error?.code).toBe('23514')
      expect(out.error?.message).toContain('matchday_scores_score_range')
    }

    expect(await scoresOf(scene.matchdayId)).toEqual({ [a!]: 200 })
  })

  it('alguien de afuera no lee ni escribe', async () => {
    const scene = await bowlingFecha()
    const stranger = await user()
    const [a, b] = scene.squad
    await openMatchday(scene.admin.client, scene.matchdayId)
    await scene.admin.client.from('matchday_scores').insert(row(scene, a!, 200))

    const read = await stranger.client.from('matchday_scores').select('*').eq('matchday_id', scene.matchdayId)
    expect(read.error).toBeNull()
    expect(read.data).toEqual([])

    const insert = await stranger.client.from('matchday_scores').insert(row(scene, b!, 150))
    expect(insert.error?.code).toBe('42501')
    expect(insert.error?.message).toBe(RLS_DENIED)

    const update = await stranger.client
      .from('matchday_scores')
      .update({ score: 5 })
      .eq('matchday_id', scene.matchdayId)
      .select()
    expect(update.data).toEqual([])

    const del = await stranger.client.from('matchday_scores').delete().eq('matchday_id', scene.matchdayId).select()
    expect(del.data).toEqual([])

    expect(await scoresOf(scene.matchdayId)).toEqual({ [a!]: 200 })
  })

  it('un jugador del torneo lee; escribe sólo con "los jugadores cargan", y nunca para un ausente', async () => {
    const scene = await bowlingFecha()
    const [mine, other] = scene.squad
    const absent = scene.squad[5]!
    await openMatchday(scene.admin.client, scene.matchdayId)
    await scene.admin.client.from('matchday_scores').insert(row(scene, mine!, 200))

    const read = await scene.player.client
      .from('matchday_scores')
      .select('entry_id, score')
      .eq('matchday_id', scene.matchdayId)
    expect(read.error).toBeNull()
    expect(read.data).toEqual([{ entry_id: mine, score: 200 }])

    const insert = await scene.player.client.from('matchday_scores').insert(row(scene, other!, 120))
    expect(insert.error?.code).toBe('42501')
    expect(insert.error?.message).toBe(RLS_DENIED)
    const update = await scene.player.client
      .from('matchday_scores')
      .update({ score: 5 })
      .eq('matchday_id', scene.matchdayId)
      .select()
    expect(update.data).toEqual([])
    expect(await scoresOf(scene.matchdayId)).toEqual({ [mine!]: 200 })

    await adminClient().from('seasons').update({ players_can_score: true }).eq('id', scene.seasonId)

    const present = await scene.player.client.from('matchday_scores').insert(row(scene, other!, 150))
    expect(present.error).toBeNull()

    const toAbsent = await scene.player.client.from('matchday_scores').insert(row(scene, absent, 150))
    expect(toAbsent.error?.code).toBe('42501')
    expect(toAbsent.error?.message).toBe(RLS_DENIED)

    expect(await scoresOf(scene.matchdayId)).toEqual({ [mine!]: 200, [other!]: 150 })
  })
})

describe('close_matchday con pinos (0111)', () => {
  it('rechaza lo que no sale de los pinos, acepta los puestos compartidos y después congela los pinos', async () => {
    const scene = await bowlingFecha()
    const [a, b, c, d, e] = scene.squad
    const absent = scene.squad[5]!
    await openMatchday(scene.admin.client, scene.matchdayId)
    for (const [entryId, score] of [[a!, 200], [b!, 180], [c!, 180], [d!, 150]] as const) {
      const { error } = await scene.admin.client.from('matchday_scores').insert(row(scene, entryId, score))
      expect(error).toBeNull()
    }

    const award = (entryId: string, position: number, points: number) => ({
      entryId,
      position,
      points,
      lines: [{ reason: `${position}° de la fecha`, points }],
    })
    // 200, 180, 180, 150, 100: los dos de 180 comparten el 2° y el siguiente queda 4° (S4).
    const good = [
      award(a!, 1, POINTS[0]!),
      award(b!, 2, POINTS[1]!),
      award(c!, 2, POINTS[1]!),
      award(d!, 4, POINTS[3]!),
      award(e!, 5, POINTS[4]!),
    ]
    const close = (awards: unknown) =>
      scene.admin.client.rpc('close_matchday', { p_matchday: scene.matchdayId, p_awards: awards as never })

    // `e` todavía no tiene pinos.
    expect((await close(good)).error?.message).toBe('Faltan pinos por cargar.')
    await scene.admin.client.from('matchday_scores').insert(row(scene, e!, 100))

    const wrong = [
      // Desempatado en vez de compartido.
      good.map((g, i) => award(g.entryId, i + 1, POINTS[i]!)),
      // Empate compartido pero el siguiente queda 3° en vez de 4°.
      good.map((g) => (g.entryId === d ? award(d!, 3, POINTS[2]!) : g)),
      // Puesto bien, puntos de otro puesto.
      good.map((g) => (g.entryId === e ? award(e!, 5, POINTS[0]!) : g)),
      // Falta uno de los presentes.
      good.slice(0, 4),
    ]
    for (const awards of wrong) {
      expect((await close(awards)).error?.message).toBe('Los puestos o los puntos no salen de los pinos cargados.')
    }
    expect((await close([...good, award(absent, 6, POINTS[5]!)])).error?.message).toBe(
      'Hay puntos para alguien que no jugó esta fecha.',
    )
    expect(await statusOf(scene.matchdayId)).toBe('OPEN')
    expect(await awardsOf(scene.matchdayId)).toEqual([])

    expect((await close(good)).error).toBeNull()
    expect(await statusOf(scene.matchdayId)).toBe('CLOSED')
    expect(await awardsOf(scene.matchdayId)).toEqual([
      [1, 10],
      [2, 7],
      [2, 7],
      [4, 3],
      [5, 2],
    ])

    // Cerrada: los pinos quedan como estaban, ni quien organiza los toca.
    const frozen = { [a!]: 200, [b!]: 180, [c!]: 180, [d!]: 150, [e!]: 100 }
    const update = await scene.admin.client
      .from('matchday_scores')
      .update({ score: 1 })
      .eq('matchday_id', scene.matchdayId)
      .select()
    expect(update.data).toEqual([])
    const insert = await scene.admin.client.from('matchday_scores').insert(row(scene, absent, 1))
    expect(insert.error?.code).toBe('42501')
    expect(insert.error?.message).toBe(RLS_DENIED)
    const del = await scene.admin.client.from('matchday_scores').delete().eq('matchday_id', scene.matchdayId).select()
    expect(del.data).toEqual([])
    expect(await scoresOf(scene.matchdayId)).toEqual(frozen)
  })
})
