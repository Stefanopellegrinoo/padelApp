import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@/core'
import { addSquadSeat, removeSeat, renameSeat, unlinkSeat } from './entries'
import {
  closeMatchday,
  createMatchday,
  generatePairs,
  openMatchday,
  saveResult,
  setAttendance,
} from './matchday'
import { entriesOf, seasonHeader, seasonRules } from './read'
import { createSeason, renameSeason, updateSeasonRules } from './season'
import { adminClient } from './test/admin'
import { createSeason as buildSeasonScene } from './test/factories'
import { createTestUser, type TestUser } from './test/users'

// ── scaffolding local a este archivo ────────────────────────────────────────

function squadNames(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `Jugador ${index + 1}`)
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

async function seasonExists(seasonId: string): Promise<boolean> {
  const db = adminClient()
  const { data } = await db.from('seasons').select('id').eq('id', seasonId).maybeSingle()
  return data !== null
}

async function seasonCountOf(userId: string): Promise<number> {
  const db = adminClient()
  const { count, error } = await db
    .from('seasons')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', userId)
  if (error) throw new Error(error.message)
  return count ?? 0
}

/** Una temporada jugada y cerrada: es el escenario donde sacar a alguien tiene que fallar. */
async function seasonWithHistory(): Promise<{ admin: TestUser; seasonId: string; squad: string[] }> {
  const admin = await createTestUser()
  const players = await fillerPlayers(8)
  const config = { ...defaultConfig(8), regularMatchdays: 1, countBestOf: 1 }
  const { seasonId, entryIds } = await buildSeasonScene({ admin, config, squad: players })

  const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05')
  for (const entryId of entryIds) {
    await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
  }
  await generatePairs(admin.client, matchdayId)
  await openMatchday(admin.client, matchdayId)

  const db = adminClient()
  const { data: matches } = await db.from('matches').select('id').eq('matchday_id', matchdayId)
  for (const match of matches ?? []) {
    await saveResult(admin.client, match.id, [{ gamesA: 4, gamesB: 0 }])
  }
  await closeMatchday(admin.client, matchdayId)

  return { admin, seasonId, squad: entryIds }
}

// ── createSeason ────────────────────────────────────────────────────────────

describe('createSeason', () => {
  it('leaves the season in SETUP with one seat per name, in the order they came', async () => {
    const admin = await createTestUser()
    const names = ['Marce', 'Nico', 'Gastón', 'Juanma', 'Seba', 'Pablo', 'Fede', 'Diego']

    const { seasonId } = await createSeason(admin.client, {
      name: 'Los Jueves 2026',
      squadNames: names,
      config: defaultConfig(8),
    })

    const header = await seasonHeader(admin.client, seasonId)
    expect(header.status).toBe('SETUP')
    expect(header.name).toBe('Los Jueves 2026')
    expect(header.isAdmin).toBe(true)

    const seats = (await entriesOf(admin.client, seasonId))
      .filter((entry) => entry.kind === 'SQUAD')
      .sort((left, right) => left.seedPosition - right.seedPosition)

    // El orden es el contrato: de acá sale el snapshot 0, o sea las primeras
    // parejas del año. `toContain` diría "están" y no "en qué lugar".
    expect(seats.map((seat) => seat.displayName)).toEqual(names)
    expect(seats.map((seat) => seat.seedPosition)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(seats.every((seat) => seat.playerId === null)).toBe(true)
  })

  it('returns an invite token the join screen can resolve', async () => {
    const admin = await createTestUser()
    const { inviteToken } = await createSeason(admin.client, {
      name: 'Los Jueves 2026',
      squadNames: squadNames(8),
      config: defaultConfig(8),
    })

    const { data, error } = await admin.client.rpc('season_invite', { p_token: inviteToken })
    expect(error).toBeNull()
    expect(data).toHaveLength(8)
  })

  it('writes nothing at all when the config is invalid', async () => {
    const admin = await createTestUser()
    const broken = { ...defaultConfig(8), points: [10, 10, 5, 3] }

    await expect(
      createSeason(admin.client, {
        name: 'Los Jueves 2026',
        squadNames: squadNames(8),
        config: broken,
      }),
    ).rejects.toThrow(/mayor a menor/)

    expect(await seasonCountOf(admin.userId)).toBe(0)
  })

  it('refuses a squad whose size does not match the config', async () => {
    const admin = await createTestUser()

    await expect(
      createSeason(admin.client, {
        name: 'Los Jueves 2026',
        squadNames: squadNames(9),
        config: defaultConfig(8),
      }),
    ).rejects.toThrow(/9 nombres/)

    expect(await seasonCountOf(admin.userId)).toBe(0)
  })

  // Una temporada sin asientos no se arregla desde ninguna pantalla: Ajustes
  // necesita el plantel para dibujarse, y la fila queda para siempre en la lista.
  it('rolls the season back when the squad cannot be written', async () => {
    const admin = await createTestUser()
    const names = [...squadNames(7), '   ']

    await expect(
      createSeason(admin.client, {
        name: 'Los Jueves 2026',
        squadNames: names,
        config: defaultConfig(8),
      }),
    ).rejects.toThrow(/Falta un nombre del plantel/)

    expect(await seasonCountOf(admin.userId)).toBe(0)
  })
})

// ── renameSeason y updateSeasonRules ────────────────────────────────────────

describe('renameSeason', () => {
  it('changes the name and refuses an empty one', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason(admin.client, {
      name: 'Los Jueves',
      squadNames: squadNames(8),
      config: defaultConfig(8),
    })

    await renameSeason(admin.client, seasonId, 'Los Jueves 2026')
    expect((await seasonHeader(admin.client, seasonId)).name).toBe('Los Jueves 2026')

    await expect(renameSeason(admin.client, seasonId, '  ')).rejects.toThrow(/necesita un nombre/)
  })
})

describe('updateSeasonRules', () => {
  it('stores the text and stamps when it changed', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason(admin.client, {
      name: 'Los Jueves 2026',
      squadNames: squadNames(8),
      config: defaultConfig(8),
    })
    expect((await seasonRules(admin.client, seasonId)).updatedAt).toBeNull()

    await updateSeasonRules(admin.client, seasonId, 'Cancha 3, 20:30. Las pelotas las trae el último.')

    const rules = await seasonRules(admin.client, seasonId)
    expect(rules.text).toContain('Cancha 3')
    expect(rules.updatedAt).not.toBeNull()
  })
})

// ── db/entries.ts ───────────────────────────────────────────────────────────

describe('the squad seats', () => {
  it('adds a seat after the last one in the seed order', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason(admin.client, {
      name: 'Los Jueves 2026',
      squadNames: squadNames(8),
      config: defaultConfig(8),
    })

    const newId = await addSquadSeat(admin.client, seasonId, 'El Nueve')

    const seats = (await entriesOf(admin.client, seasonId)).filter((e) => e.kind === 'SQUAD')
    expect(seats).toHaveLength(9)
    expect(seats.find((seat) => seat.id === newId)?.seedPosition).toBe(8)
  })

  it('renames a seat without releasing whoever claimed it', async () => {
    const player = await createTestUser()
    const admin = await createTestUser()
    const filler = await fillerPlayers(7)
    const { seasonId, entryIds } = await buildSeasonScene({
      admin,
      squad: [player.playerId, ...filler],
    })

    await renameSeat(admin.client, entryIds[0]!, 'Marce')

    const seat = (await entriesOf(admin.client, seasonId)).find((e) => e.id === entryIds[0])
    expect(seat?.displayName).toBe('Marce')
    expect(seat?.playerId).toBe(player.playerId)
  })

  it('unlinks a claim and keeps the name', async () => {
    const player = await createTestUser()
    const admin = await createTestUser()
    const filler = await fillerPlayers(7)
    const { seasonId, entryIds } = await buildSeasonScene({
      admin,
      squad: [player.playerId, ...filler],
    })

    await unlinkSeat(admin.client, entryIds[0]!)

    const seat = (await entriesOf(admin.client, seasonId)).find((e) => e.id === entryIds[0])
    expect(seat?.playerId).toBeNull()
    expect(seat?.displayName).not.toBe('')
  })

  it('removes a seat that never played', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason(admin.client, {
      name: 'Los Jueves 2026',
      squadNames: squadNames(8),
      config: defaultConfig(8),
    })
    const newId = await addSquadSeat(admin.client, seasonId, 'El Nueve')

    await removeSeat(admin.client, newId)

    expect((await entriesOf(admin.client, seasonId)).filter((e) => e.kind === 'SQUAD')).toHaveLength(8)
  })

  // Spec 2.9: las fechas cerradas no se alteran nunca. Sacar a alguien que ya
  // jugó dejaría sus awards y sus parejas colgados.
  it('refuses to remove a seat that already has history, and the award survives', async () => {
    const { admin, seasonId, squad } = await seasonWithHistory()

    await expect(removeSeat(admin.client, squad[0]!)).rejects.toThrow(/ya jugó alguna fecha/)

    const db = adminClient()
    const { count } = await db
      .from('awards')
      .select('id', { count: 'exact', head: true })
      .eq('entry_id', squad[0]!)
    expect(count).toBe(1)
    expect((await entriesOf(admin.client, seasonId)).some((e) => e.id === squad[0])).toBe(true)
  })

  it('lets nobody but the admin touch the seats', async () => {
    const player = await createTestUser()
    const admin = await createTestUser()
    const filler = await fillerPlayers(7)
    const { seasonId, entryIds } = await buildSeasonScene({
      admin,
      squad: [player.playerId, ...filler],
    })
    const seatId = entryIds[1]!

    await expect(addSquadSeat(player.client, seasonId, 'Colado')).rejects.toThrow()
    // Un update o un delete que RLS filtra no es un error: no afecta ninguna
    // fila. Por eso se asierta sobre el estado, no sobre el throw.
    await renameSeat(player.client, seatId, 'Robado')
    await unlinkSeat(player.client, entryIds[0]!)
    await removeSeat(player.client, seatId)

    const seats = await entriesOf(admin.client, seasonId)
    expect(seats.filter((e) => e.kind === 'SQUAD')).toHaveLength(8)
    expect(seats.find((e) => e.id === seatId)?.displayName).not.toBe('Robado')
    expect(seats.find((e) => e.id === entryIds[0])?.playerId).toBe(player.playerId)
  })
})
