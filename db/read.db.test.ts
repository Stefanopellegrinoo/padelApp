import { beforeAll, describe, expect, it } from 'vitest'
import { defaultConfig } from '@/core'
import {
  addGuest,
  closeMatchday,
  createMatchday,
  generatePairs,
  openMatchday,
  saveResult,
  setAttendance,
} from './matchday'
import {
  awardsOf,
  closedHistoryAll,
  entriesOf,
  matchdayDetail,
  matchdaysOf,
  mySeasons,
  seasonAdminName,
  seasonHeader,
  seasonRules,
} from './read'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser, type TestUser } from './test/users'

// ── scaffolding local a este archivo ────────────────────────────────────────
// No va a db/test/factories.ts: sólo le sirve al armado de esta escena.

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

/** Carga un 4-0 en cada partido de la fecha para poder cerrarla. */
async function playAllMatches(admin: TestUser, matchdayId: string): Promise<void> {
  const db = adminClient()
  const { data, error } = await db.from('matches').select('id').eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  for (const match of data ?? []) {
    await saveResult(admin.client, match.id, [{ gamesA: 4, gamesB: 0 }])
  }
}

describe('db/read', () => {
  let admin: TestUser
  let member: TestUser
  let stranger: TestUser
  let seasonId: string
  let otherSeasonId: string
  let squad: string[]
  let matchday1Id: string
  let matchday2Id: string
  let guestEntryId: string
  let mastersMatchdayId: string
  let mastersNumber: number

  beforeAll(async () => {
    admin = await createTestUser()
    member = await createTestUser()
    stranger = await createTestUser()

    const fillers = await fillerPlayers(7)
    const { seasonId: sid, entryIds } = await createSeason({
      admin,
      config: defaultConfig(8),
      squad: [member.playerId, ...fillers],
    })
    seasonId = sid
    squad = entryIds

    // Fecha 1: plantel completo, jugada y cerrada.
    matchday1Id = await createMatchday(admin.client, seasonId, '2026-01-01')
    for (const entryId of squad) {
      await setAttendance(admin.client, matchday1Id, entryId, 'PLAYING')
    }
    await generatePairs(admin.client, matchday1Id)
    await openMatchday(admin.client, matchday1Id)
    await playAllMatches(admin, matchday1Id)
    await closeMatchday(admin.client, matchday1Id)

    // Fecha 2: se queda en armado, con un invitado y sin parejas sorteadas.
    matchday2Id = await createMatchday(admin.client, seasonId, '2026-01-08')
    guestEntryId = await addGuest(admin.client, matchday2Id, { displayName: 'Invitado de test' })

    // El Masters: se inserta ya CLOSED con la llave de service_role — no hay
    // función de este plan que lo juegue, y el índice de "una fecha viva" sólo
    // restringe a las que no están CLOSED.
    mastersNumber = 999
    const db = adminClient()
    const { data: masters, error: mastersError } = await db
      .from('matchdays')
      .insert({ season_id: seasonId, number: mastersNumber, kind: 'MASTERS', status: 'CLOSED' })
      .select('id')
      .single()
    if (mastersError || masters === null) throw new Error(mastersError?.message)
    mastersMatchdayId = masters.id

    // Una temporada de otro grupo, para el caso "no la de otro grupo".
    const otherAdmin = await createTestUser()
    const other = await createSeason({ admin: otherAdmin })
    otherSeasonId = other.seasonId
  }, 60_000)

  describe('mySeasons', () => {
    it('returns the season where I have a seat, and not another group\'s', async () => {
      const seasons = await mySeasons(member.client)
      const ids = seasons.map((season) => season.id)
      expect(ids).toContain(seasonId)
      expect(ids).not.toContain(otherSeasonId)
    })
  })

  describe('seasonHeader', () => {
    it('marks isAdmin true for whoever created the season', async () => {
      const header = await seasonHeader(admin.client, seasonId)
      expect(header.id).toBe(seasonId)
      expect(header.isAdmin).toBe(true)
      expect(header.regularMatchdays).toBe(defaultConfig(8).regularMatchdays)
    })

    it('marks isAdmin false for a player who is not the creator', async () => {
      const header = await seasonHeader(member.client, seasonId)
      expect(header.isAdmin).toBe(false)
    })
  })

  describe('seasonRules', () => {
    it('reads the rules text of the season', async () => {
      const rules = await seasonRules(member.client, seasonId)
      expect(rules.text).toBe('')
      expect(rules.updatedAt).toBeNull()
    })
  })

  describe('seasonAdminName', () => {
    it("resolves the display name of whoever created the season, not the caller's", async () => {
      const db = adminClient()
      const { data: adminPlayer, error } = await db
        .from('players')
        .select('display_name')
        .eq('id', admin.playerId)
        .single()
      if (error || adminPlayer === null) throw new Error(error?.message)

      const name = await seasonAdminName(member.client, seasonId)
      expect(name).toBe(adminPlayer.display_name)
    })
  })

  describe('entriesOf', () => {
    it('brings the squad and the guests, with a null playerId for a seat nobody claimed', async () => {
      const entries = await entriesOf(member.client, seasonId)
      const squadEntries = entries.filter((entry) => entry.kind === 'SQUAD')
      const guestEntries = entries.filter((entry) => entry.kind === 'GUEST')

      expect(squadEntries).toHaveLength(8)
      expect(squadEntries.every((entry) => entry.playerId !== null)).toBe(true)

      const guest = guestEntries.find((entry) => entry.id === guestEntryId)
      expect(guest).toBeDefined()
      expect(guest?.playerId).toBeNull()
    })
  })

  describe('matchdaysOf', () => {
    it('comes ordered by number, and the Masters appears with its kind', async () => {
      const matchdays = await matchdaysOf(member.client, seasonId)
      const numbers = matchdays.map((matchday) => matchday.number)
      expect(numbers).toEqual([...numbers].sort((left, right) => left - right))

      const masters = matchdays.find((matchday) => matchday.id === mastersMatchdayId)
      expect(masters?.kind).toBe('MASTERS')
    })
  })

  describe('matchdayDetail', () => {
    it('a closed matchday brings pairs, matches and full sets', async () => {
      const detail = await matchdayDetail(member.client, matchday1Id)
      expect(detail.matchday.status).toBe('CLOSED')
      expect(detail.pairs).toHaveLength(4)
      expect(detail.matches.length).toBeGreaterThan(0)
      expect(detail.matches.every((match) => match.sets.length > 0)).toBe(true)
      expect(detail.guestIds).toEqual([])
    })

    it('a draft matchday brings empty pairs without blowing up', async () => {
      const detail = await matchdayDetail(member.client, matchday2Id)
      expect(detail.matchday.status).toBe('DRAFT')
      expect(detail.pairs).toEqual([])
      expect(detail.matches).toEqual([])
      expect(detail.guestIds).toEqual([guestEntryId])
    })
  })

  describe('closedHistoryAll', () => {
    it('excludes matchdays that are not closed, and excludes the Masters', async () => {
      const history = await closedHistoryAll(member.client, seasonId)
      expect(history).toHaveLength(1)
      expect(history[0]?.number).toBe(1)
      expect(history.some((matchday) => matchday.number === mastersNumber)).toBe(false)
    })
  })

  describe('awardsOf', () => {
    it('returns a map indexed by matchday number', async () => {
      const awards = await awardsOf(member.client, seasonId)
      expect(awards.has(1)).toBe(true)
      expect(awards.get(1)).toHaveLength(8)
    })
  })

  describe('a stranger who is not part of the season', () => {
    it('reads nothing back from any of the nine functions', async () => {
      const seasons = await mySeasons(stranger.client)
      expect(seasons.map((season) => season.id)).not.toContain(seasonId)

      await expect(seasonHeader(stranger.client, seasonId)).rejects.toThrow()
      await expect(seasonRules(stranger.client, seasonId)).rejects.toThrow()
      await expect(seasonAdminName(stranger.client, seasonId)).rejects.toThrow()

      expect(await entriesOf(stranger.client, seasonId)).toEqual([])
      expect(await matchdaysOf(stranger.client, seasonId)).toEqual([])

      await expect(matchdayDetail(stranger.client, matchday1Id)).rejects.toThrow()

      expect(await closedHistoryAll(stranger.client, seasonId)).toEqual([])
      expect(await awardsOf(stranger.client, seasonId)).toEqual(new Map())
    })
  })
})
