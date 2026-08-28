import { describe, expect, it } from 'vitest'
import {
  computeRanking,
  defaultConfig,
  mastersChampion,
  mastersQualifiers,
  samePair,
  snapshotForMatchday,
  type MastersFour,
  type Pair,
  type SeasonConfig,
} from '@/core'
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
  removeLooseGuestSeat,
  saveResult,
  seedAttendances,
  setAttendance,
  setMyAttendance,
  syncGuestSeat,
} from './matchday'
import { attendancesOf, entriesOf, matchdayDetail, matchdaysOf, seasonHeader } from './read'
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

interface Scene {
  admin: TestUser
  player: TestUser
  seasonId: string
  squad: string[]
}

async function buildScene(config: SeasonConfig = shortSeason()): Promise<Scene> {
  const admin = await createTestUser()
  const player = await createTestUser()
  const filler = await fillerPlayers(config.squadSize - 1)
  const { seasonId, entryIds } = await createSeason({
    admin,
    config,
    squad: [player.playerId, ...filler],
  })
  return { admin, player, seasonId, squad: entryIds }
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

/** Juega y cierra la temporada regular entera para dejarla lista para el Masters. */
async function playRegularSeason(admin: TestUser, seasonId: string, squad: string[]): Promise<void> {
  const config = (await seasonHeader(admin.client, seasonId)).config
  for (let number = 1; number <= config.regularMatchdays; number++) {
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05')
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

async function qualifiersOf(admin: TestUser, seasonId: string, mastersNumber: number): Promise<MastersFour> {
  const config = (await seasonHeader(admin.client, seasonId)).config
  const seedOrder = await squadSeedOrder(admin.client, seasonId)
  const awards = await awardsBefore(admin.client, seasonId, mastersNumber)
  const snapshot = snapshotForMatchday(mastersNumber, seedOrder, awards, config)
  return mastersQualifiers(computeRanking(awards, seedOrder, config, snapshot))
}

function pairKey(pair: Pair): string {
  return [pair.a, pair.b].sort().join('~')
}

// ── el Masters ──────────────────────────────────────────────────────────────

describe('the masters', () => {
  it('lays out six pairs and three matches where everyone plays once with everyone', async () => {
    const { admin, seasonId, squad } = await buildScene()
    await playRegularSeason(admin, seasonId, squad)

    const mastersId = await createMasters(admin.client, seasonId, '2026-12-20')
    await generateMastersPairs(admin.client, mastersId)

    const detail = await matchdayDetail(admin.client, mastersId)
    expect(detail.pairs).toHaveLength(6)
    expect(detail.matches).toHaveLength(3)

    const four = await qualifiersOf(admin, seasonId, detail.matchday.number)

    // Las 6 parejas son las 6 combinaciones posibles de 4 jugadores, sin repetir.
    const expected = new Set<string>()
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) expected.add(pairKey({ a: four[i]!, b: four[j]! }))
    }
    expect(new Set(detail.pairs.map(pairKey))).toEqual(expected)

    // Y cada clasificado aparece en exactamente 3 de ellas.
    for (const entryId of four) {
      const appearances = detail.pairs.filter((pair) => pair.a === entryId || pair.b === entryId)
      expect(appearances).toHaveLength(3)
    }
  })

  it('follows the fixture of the spec: 1+4 vs 2+3, 1+3 vs 2+4, 1+2 vs 3+4', async () => {
    const { admin, seasonId, squad } = await buildScene()
    await playRegularSeason(admin, seasonId, squad)

    const mastersId = await createMasters(admin.client, seasonId, '2026-12-20')
    await generateMastersPairs(admin.client, mastersId)

    const detail = await matchdayDetail(admin.client, mastersId)
    const [one, two, three, four] = await qualifiersOf(admin, seasonId, detail.matchday.number)
    const byRound = [...detail.matches].sort((left, right) => left.round - right.round)

    const facing = (round: number): Set<string> =>
      new Set([pairKey(byRound[round]!.pairA), pairKey(byRound[round]!.pairB)])

    expect(facing(0)).toEqual(new Set([pairKey({ a: one, b: four }), pairKey({ a: two, b: three })]))
    expect(facing(1)).toEqual(new Set([pairKey({ a: one, b: three }), pairKey({ a: two, b: four })]))
    expect(facing(2)).toEqual(new Set([pairKey({ a: one, b: two }), pairKey({ a: three, b: four })]))
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
    const { admin, seasonId, squad } = await buildScene()
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
  })

  it('crowns the player who won the most matches', async () => {
    const { admin, seasonId, squad } = await buildScene()
    await playRegularSeason(admin, seasonId, squad)

    const mastersId = await createMasters(admin.client, seasonId, '2026-12-20')
    await generateMastersPairs(admin.client, mastersId)
    await openMatchday(admin.client, mastersId)

    const detail = await matchdayDetail(admin.client, mastersId)
    const four = await qualifiersOf(admin, seasonId, detail.matchday.number)
    const target = four[3]! // el 4º del año: sin él no se distingue de un empate roto por ranking

    // El 4º gana sus tres partidos, así que gana limpio y no por desempate.
    for (const match of detail.matches) {
      const targetIsA = match.pairA.a === target || match.pairA.b === target
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

  // El asiento que la paridad exige no se puede perder por un click: sacarlo
  // con el plantel impar tiene que devolver la fecha a donde estaba, no
  // dejarla en 7 y sin poder generar parejas.
  it('vuelve a poner el asiento cuando le sacan el invitado automático con el plantel impar', async () => {
    const { admin, seasonId, squad } = await buildScene()
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05')
    await seedAttendances(admin.client, matchdayId)
    await setAttendance(admin.client, matchdayId, squad[7]!, 'ABSENT')
    await syncGuestSeat(admin.client, matchdayId)

    const guestId = (await entriesOf(admin.client, seasonId)).find(
      (entry) => entry.kind === 'GUEST' && entry.matchdayId === matchdayId,
    )!.id

    await removeLooseGuestSeat(admin.client, matchdayId, guestId)

    const guests = (await entriesOf(admin.client, seasonId)).filter(
      (entry) => entry.kind === 'GUEST' && entry.matchdayId === matchdayId,
    )
    expect(guests).toHaveLength(1)
    expect(guests[0]?.displayName).toBe('')
  })
})

describe('clearPairs', () => {
  it('throws away a draw that the roster has already outdated', async () => {
    const { admin, seasonId, squad } = await buildScene()
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05')
    await seedAttendances(admin.client, matchdayId)
    await generatePairs(admin.client, matchdayId)
    expect((await matchdayDetail(admin.client, matchdayId)).pairs).toHaveLength(4)

    await clearPairs(admin.client, matchdayId)

    const detail = await matchdayDetail(admin.client, matchdayId)
    expect(detail.pairs).toEqual([])
    expect(detail.matches).toEqual([])
  })

  it('refuses to touch a matchday that is already being played', async () => {
    const { admin, seasonId } = await buildScene()
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05')
    await seedAttendances(admin.client, matchdayId)
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)

    await expect(clearPairs(admin.client, matchdayId)).rejects.toThrow(/en armado/)
    expect((await matchdayDetail(admin.client, matchdayId)).pairs).toHaveLength(4)
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
    expect(detail.pairs).toHaveLength(4)
    expect(detail.guestIds).toEqual([guestId])
    expect(detail.pairs.some((pair) => samePair(pair, { a: guestId, b: guestId }))).toBe(false)
  })
})
