import { describe, it, expect } from 'vitest'
import { defaultConfig, type SeasonConfig } from '@/core'
import { addGuest, createMatchday, generatePairs, openMatchday, setAttendance } from './matchday'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser, type TestUser } from './test/users'

// ── scaffolding local a este archivo ────────────────────────────────────────
// No va a db/test/factories.ts: esa lista de archivos es la del plan, y estos
// armadores sólo le sirven al armado de una fecha.

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

// Traba una pareja con la llave de service_role: es escenario para el test de
// generatePairs, no algo que un test deba ejercitar con RLS.
async function addLock(seasonId: string, matchdayId: string, a: string, b: string): Promise<void> {
  const db = adminClient()
  const { error } = await db
    .from('pair_locks')
    .insert({ season_id: seasonId, matchday_id: matchdayId, entry_a: a, entry_b: b })
  if (error) throw new Error(error.message)
}

// `entry_b: string | null` desde 0028 (REQ-D5-1): la fila real ya lo permite,
// aunque esta suite sólo ejercita pádel (pair_size=2, siempre no-nulo).
async function pairsOf(
  matchdayId: string,
): Promise<Array<{ id: string; entry_a: string; entry_b: string | null }>> {
  const db = adminClient()
  const { data, error } = await db
    .from('pairs')
    .select('id, entry_a, entry_b')
    .eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return data ?? []
}

async function matchesOf(
  matchdayId: string,
): Promise<Array<{ round: number; pair_a: string; pair_b: string }>> {
  const db = adminClient()
  const { data, error } = await db
    .from('matches')
    .select('round, pair_a, pair_b')
    .eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return data ?? []
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

async function markAllPlaying(adminClientHandle: TestUser, matchdayId: string, entryIds: string[]) {
  for (const entryId of entryIds) {
    await setAttendance(adminClientHandle.client, matchdayId, entryId, 'PLAYING')
  }
}

describe('generatePairs', () => {
  it('guarda las parejas y el fixture completo', async () => {
    // 8 jugadores → 4 parejas, 6 partidos, 3 rondas
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, squad)

    await generatePairs(admin.client, matchdayId)

    const pairs = await pairsOf(matchdayId)
    const matches = await matchesOf(matchdayId)
    expect(pairs).toHaveLength(4)
    expect(matches).toHaveLength(6)
    expect(new Set(matches.map((match) => match.round)).size).toBe(3)

    // Cada pareja enfrenta a cada otra exactamente una vez: no sólo 6 filas,
    // sino 6 enfrentamientos distintos entre las 4 parejas guardadas.
    const seenPairings = new Set<string>()
    for (const match of matches) {
      const key = [match.pair_a, match.pair_b].sort().join('-')
      expect(seenPairings.has(key)).toBe(false)
      seenPairings.add(key)
    }
    expect(seenPairings.size).toBe(6)
    const pairIds = pairs.map((pair) => pair.id).sort()
    const matchPairIds = [...new Set(matches.flatMap((match) => [match.pair_a, match.pair_b]))].sort()
    expect(matchPairIds).toEqual(pairIds)
  })

  it('con 12 guarda 6 parejas y 15 partidos en 5 rondas', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(12), 12)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, squad)

    await generatePairs(admin.client, matchdayId)

    const pairs = await pairsOf(matchdayId)
    const matches = await matchesOf(matchdayId)
    expect(pairs).toHaveLength(6)
    expect(matches).toHaveLength(15)
    expect(new Set(matches.map((match) => match.round)).size).toBe(5)
  })

  it('regenerar reemplaza lo anterior, no lo duplica', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, squad)

    await generatePairs(admin.client, matchdayId)
    await generatePairs(admin.client, matchdayId)

    const pairs = await pairsOf(matchdayId)
    const matches = await matchesOf(matchdayId)
    expect(pairs).toHaveLength(4)
    expect(matches).toHaveLength(6)
  })

  it('no genera sobre una fecha abierta', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, squad)
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)

    await expect(generatePairs(admin.client, matchdayId)).rejects.toThrow(/en armado/)
  })

  it('respeta una pareja trabada de dos invitados', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const playing = squad.slice(0, 6)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, playing)
    const guest1 = await addGuest(admin.client, matchdayId, { displayName: 'Invitado Uno' })
    const guest2 = await addGuest(admin.client, matchdayId, { displayName: 'Invitado Dos' })
    await addLock(seasonId, matchdayId, guest1, guest2)

    await generatePairs(admin.client, matchdayId)

    const pairs = await pairsOf(matchdayId)
    const guestPair = pairs.some(
      (pair) =>
        (pair.entry_a === guest1 && pair.entry_b === guest2) ||
        (pair.entry_a === guest2 && pair.entry_b === guest1),
    )
    expect(guestPair).toBe(true)
  })

  it('respeta una pareja trabada de invitado con jugador del torneo', async () => {
    // Es la implementación del spec 2.6: así el admin "mueve" al invitado.
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const playing = squad.slice(0, 7)
    const partner = playing[0]
    if (partner === undefined) throw new Error('Falta un jugador para el test.')
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, playing)
    const guest = await addGuest(admin.client, matchdayId, { displayName: 'Invitado' })
    await addLock(seasonId, matchdayId, guest, partner)

    await generatePairs(admin.client, matchdayId)

    const pairs = await pairsOf(matchdayId)
    const mixedPair = pairs.some(
      (pair) =>
        (pair.entry_a === guest && pair.entry_b === partner) ||
        (pair.entry_a === partner && pair.entry_b === guest),
    )
    expect(mixedPair).toBe(true)
  })
})

describe('openMatchday', () => {
  it('pasa de DRAFT a OPEN', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, squad)
    await generatePairs(admin.client, matchdayId)

    await openMatchday(admin.client, matchdayId)

    expect(await matchdayStatus(matchdayId)).toBe('OPEN')
  })

  it('no abre sin parejas generadas', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, squad)

    await expect(openMatchday(admin.client, matchdayId)).rejects.toThrow(/generarlas/)
  })

  it('no abre con un invitado sin nombre', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const playing = squad.slice(0, 7)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, playing)
    await addGuest(admin.client, matchdayId, { displayName: '' })
    await generatePairs(admin.client, matchdayId)

    await expect(openMatchday(admin.client, matchdayId)).rejects.toThrow(/nombre/)
  })

  it('no abre una fecha ya abierta', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, squad)
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)

    await expect(openMatchday(admin.client, matchdayId)).rejects.toThrow(/ya no está en armado/)
  })

  it('no deja dos fechas abiertas en la misma temporada', async () => {
    // Se apoya en el índice matchdays_one_live: el test tiene que ver el
    // error, no un segundo OPEN — no se puede ni crear la segunda fecha
    // mientras la primera siga sin cerrar.
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, squad)
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)

    await expect(createMatchday(admin.client, seasonId, '2026-08-17')).rejects.toThrow(
      /sin cerrar/,
    )
  })

  it('no abre si las parejas guardadas no son las de los presentes de ahora', async () => {
    // 8 presentes → generar parejas → marcar a dos más como PLAYING, que
    // sigue permitido porque la fecha está en DRAFT.
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(10), 10)
    const initial = squad.slice(0, 8)
    const extra = squad.slice(8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, initial)
    await generatePairs(admin.client, matchdayId)
    await markAllPlaying(admin, matchdayId, extra)

    await expect(openMatchday(admin.client, matchdayId)).rejects.toThrow(/Volvé a generarlas/)
  })

  it('un jugador no puede abrir la fecha', async () => {
    const admin = await createTestUser()
    const member = await createTestUser()
    const filler = await fillerPlayers(7)
    const { seasonId, entryIds } = await createSeason({
      admin,
      config: defaultConfig(8),
      squad: [member.playerId, ...filler],
    })
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    for (const entryId of entryIds) {
      await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
    }
    await generatePairs(admin.client, matchdayId)

    await expect(openMatchday(member.client, matchdayId)).rejects.toThrow(
      /Sólo quien organiza la temporada/,
    )
  })
})
