import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { defaultConfig } from '@/core'
import type { Database } from './database.types'
import {
  addGuest,
  closeMatchday,
  createMatchday,
  generatePairs,
  openMatchday,
  reopenMatchday,
  saveResult,
  setAttendance,
} from './matchday'
import {
  attendancesOf,
  awardsOf,
  closedHistoryAll,
  entriesOf,
  matchdayDetail,
  matchdaysOf,
  myEntryId,
  mySeasons,
  playerNames,
  publicRules,
  seasonAdminName,
  seasonAwardsOf,
  seasonHeader,
  seasonMatchdaysOf,
  seasonRules,
  seasonSquadOf,
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

/** Sin sesión y con la llave `anon`: el cliente de quien abre el link del grupo. */
function anonReadClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (url === undefined || anonKey === undefined) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY.')
  }
  return createClient<Database>(url, anonKey)
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
    const { seasonId: sid, disciplineId, entryIds } = await createSeason({
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
      .insert({
        season_id: seasonId,
        discipline_id: disciplineId,
        number: mastersNumber,
        kind: 'MASTERS',
        status: 'CLOSED',
      })
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

  // REQ-D9: la tabla global necesita el plantel y los premios de TODAS las
  // disciplinas, no de la default (`entriesOf`/`awardsOf`) — mismo criterio
  // que `seasonMatchdaysOf` (PR 10) sobre `matchdaysOf`.
  describe('seasonSquadOf y seasonAwardsOf', () => {
    it('el plantel es de la temporada entera, y los premios quedan agrupados por disciplina', async () => {
      const owner = await createTestUser()
      const players = await fillerPlayers(8)
      const { seasonId: multiId, entryIds, disciplineIds } = await createSeason({
        admin: owner,
        squad: players,
        disciplines: [{ kind: 'PADEL', weight: 1 }, { kind: 'FIFA', weight: 0.5 }],
      })
      const [padelId, fifaId] = disciplineIds
      if (padelId === undefined || fifaId === undefined) throw new Error('createSeason no armó las 2 disciplinas.')
      const firstEntryId = entryIds[0]
      if (firstEntryId === undefined) throw new Error('createSeason no armó el plantel.')

      // Solape parcial (REQ-D1-4): un asiento sólo juega pádel.
      const db = adminClient()
      await db.from('discipline_entries').delete().eq('discipline_id', fifaId).eq('entry_id', firstEntryId)

      // `seasonSquadOf` no lo excluye por eso: a diferencia de `entriesOf`, no
      // pasa por `discipline_entries` de UNA disciplina.
      expect(await seasonSquadOf(owner.client, multiId)).toEqual(entryIds)

      // Para cerrar una fecha hace falta el piso de MIN_PLAYERS (8): la
      // fecha de FIFA la juega el plantel completo, discipline_entries
      // intacto — el solape parcial ya quedó probado arriba, sin necesitar
      // cerrar una fecha para eso.
      async function closeOne(disciplineId: string, playedOn: string): Promise<void> {
        const { data: matchday, error } = await db
          .from('matchdays')
          .insert({
            season_id: multiId,
            discipline_id: disciplineId,
            number: 1,
            kind: 'REGULAR',
            status: 'DRAFT',
            played_on: playedOn,
          })
          .select('id')
          .single()
        if (error || matchday === null) throw new Error(error?.message)
        for (const entryId of entryIds) await setAttendance(owner.client, matchday.id, entryId, 'PLAYING')
        await generatePairs(owner.client, matchday.id)
        await openMatchday(owner.client, matchday.id)
        await playAllMatches(owner, matchday.id)
        await closeMatchday(owner.client, matchday.id)
      }

      // El asiento sin fila en discipline_entries de FIFA no puede jugar esa
      // fecha (0023: attendances_entry_discipline la rechaza) — se lo
      // restituye acá para poder cerrarla; el solape parcial ya quedó
      // probado arriba con seasonSquadOf, sin depender de esto.
      await db
        .from('discipline_entries')
        .insert({ discipline_id: fifaId, entry_id: firstEntryId, season_id: multiId, seed_position: 0 })

      // Mismo número (1) en las dos: REQ-D3-2 lo permite, y es el caso que C10
      // (verify-report ronda 5) probó que el redirect legacy desempataba mal —
      // `seasonAwardsOf` lo desambigua por `disciplineId`, no por `number` solo.
      await closeOne(padelId, '2026-03-01')
      await closeOne(fifaId, '2026-03-08')

      const matchdays = await seasonMatchdaysOf(owner.client, multiId)
      const seasonAwards = await seasonAwardsOf(owner.client, matchdays)
      expect(seasonAwards.get(padelId)?.get(1)).toHaveLength(8)
      expect(seasonAwards.get(fifaId)?.get(1)).toHaveLength(8)
    })
  })

  // ── lo que el Plan 4 necesita y el Plan 3 no había leído ──────────────────

  describe('attendancesOf', () => {
    it('returns only the rows of that matchday, with their status', async () => {
      const first = await attendancesOf(member.client, matchday1Id)
      expect(first.size).toBe(8)
      expect(first.get(squad[0]!)).toBe('PLAYING')

      await setAttendance(admin.client, matchday2Id, squad[0]!, 'ABSENT')
      const second = await attendancesOf(member.client, matchday2Id)
      expect(second.get(squad[0]!)).toBe('ABSENT')
      expect(second.size).toBe(1)
    })

    it('returns an empty map for a matchday nobody ticked, instead of throwing', async () => {
      const empty = await attendancesOf(member.client, mastersMatchdayId)
      expect(empty).toEqual(new Map())
    })
  })

  describe('entriesOf', () => {
    // Con un solo invitado el error de lado no se ve: los dos tienen que traer
    // SU fecha, no la misma.
    it('tells which matchday each guest belongs to, and leaves the squad null', async () => {
      const otherGuestId = await addGuest(admin.client, mastersMatchdayId, {
        displayName: 'Invitado del Masters',
      })
      const entries = await entriesOf(member.client, seasonId)

      const squadRow = entries.find((entry) => entry.id === squad[0])
      expect(squadRow?.matchdayId).toBeNull()
      expect(entries.find((entry) => entry.id === guestEntryId)?.matchdayId).toBe(matchday2Id)
      expect(entries.find((entry) => entry.id === otherGuestId)?.matchdayId).toBe(mastersMatchdayId)
    })
  })

  describe('matchdayDetail', () => {
    // Es el id de `matches`, que es lo que toma saveResult — y no el de `pairs`
    // ni un índice, que es el error que se ve igual de bien en pantalla.
    it('carries the match id that saveResult needs', async () => {
      const detail = await matchdayDetail(member.client, matchday1Id)
      const db = adminClient()
      const { data } = await db.from('matches').select('id').eq('matchday_id', matchday1Id)

      const fromDetail = detail.matches.map((match) => match.id).sort()
      const fromDatabase = (data ?? []).map((row) => row.id).sort()
      expect(fromDetail).toHaveLength(6)
      expect(fromDetail).toEqual(fromDatabase)
    })
  })

  describe('seasonHeader', () => {
    it('carries the invite token the wizard and the settings screen show', async () => {
      const header = await seasonHeader(admin.client, seasonId)
      expect(header.inviteToken).toBeTruthy()

      const { data } = await admin.client.rpc('season_invite', { p_token: header.inviteToken })
      expect(data?.length).toBeGreaterThan(0)
    })
  })

  describe('myEntryId', () => {
    it('resolves the caller\'s own seat, and null for somebody without one', async () => {
      expect(await myEntryId(member.client, seasonId)).toBe(squad[0])
      expect(await myEntryId(stranger.client, seasonId)).toBeNull()
    })
  })

  describe('playerNames', () => {
    it('maps player ids to their display name', async () => {
      const names = await playerNames(admin.client, [member.playerId])
      expect(names.get(member.playerId)).toBeTruthy()
    })

    it('does not go to the database for an empty list', async () => {
      expect(await playerNames(admin.client, [])).toEqual(new Map())
    })
  })

  describe('publicRules', () => {
    it('reads the rules with no session at all', async () => {
      const rules = await publicRules(anonReadClient(), seasonId)
      expect(rules?.name).toBeTruthy()
      expect(rules?.config.squadSize).toBe(8)
      expect(rules?.adminName).not.toBe('')
    })

    it('returns null for a link that leads nowhere', async () => {
      const rules = await publicRules(anonReadClient(), '00000000-0000-0000-0000-000000000000')
      expect(rules).toBeNull()
    })
  })

  describe('a stranger who is not part of the season', () => {
    it('reads nothing back from any of the eleven functions', async () => {
      const seasons = await mySeasons(stranger.client)
      expect(seasons.map((season) => season.id)).not.toContain(seasonId)

      await expect(seasonHeader(stranger.client, seasonId)).rejects.toThrow()
      await expect(seasonRules(stranger.client, seasonId)).rejects.toThrow()
      await expect(seasonAdminName(stranger.client, seasonId)).rejects.toThrow()

      expect(await entriesOf(stranger.client, seasonId)).toEqual([])
      expect(await matchdaysOf(stranger.client, seasonId)).toEqual([])
      // W16 (verify-report ronda 5): `seasonMatchdaysOf` (PR 10) es una
      // lectura nueva de temporada entera y no tenía test de RLS propio —
      // su gemela `matchdaysOf` sí, arriba. No pasa por `defaultDisciplineId`
      // (a diferencia de `matchdaysOf`): filtra directo por `season_id`, y
      // RLS devuelve 0 filas para quien no participa, sin error.
      expect(await seasonMatchdaysOf(stranger.client, seasonId)).toEqual([])

      await expect(matchdayDetail(stranger.client, matchday1Id)).rejects.toThrow()

      expect(await closedHistoryAll(stranger.client, seasonId)).toEqual([])
      expect(await awardsOf(stranger.client, seasonId)).toEqual(new Map())

      // seasonSquadOf/seasonAwardsOf (REQ-D9): mismo criterio que
      // seasonMatchdaysOf arriba — filtran directo por season_id, RLS da 0
      // filas para quien no participa, sin error. Se le pasa a
      // seasonAwardsOf la lista REAL de fechas cerradas (vista por admin),
      // no una lista vacía: lo que prueba es que RLS bloquea la tabla
      // `awards` para el extraño aunque conozca los ids de matchday.
      expect(await seasonSquadOf(stranger.client, seasonId)).toEqual([])
      const realMatchdays = await seasonMatchdaysOf(admin.client, seasonId)
      expect(await seasonAwardsOf(stranger.client, realMatchdays)).toEqual(new Map())
    })
  })
})
