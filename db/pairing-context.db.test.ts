import { describe, it, expect } from 'vitest'
import { defaultConfig, pair, type SeasonConfig } from '@/core'
import { matchdayContextFor, pairingContextFor } from './matchday'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser, type TestUser } from './test/users'

// ── scaffolding local a este archivo ────────────────────────────────────────
// No va a db/test/factories.ts (Task 6): esa lista de archivos es la del plan,
// y estos armadores sólo le sirven a la composición del sorteo.

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

// Una sola disciplina por temporada mientras el tripwire (0015) siga puesto.
async function disciplineIdOf(seasonId: string): Promise<string> {
  const db = adminClient()
  const { data, error } = await db.from('disciplines').select('id').eq('season_id', seasonId).single()
  if (error || data === null) throw new Error(error?.message)
  return data.id
}

interface AwardInput {
  entryId: string
  position: number
  points: number
}

interface PairInput {
  a: string
  b: string
}

// Arma una fecha CERRADA con sus parejas y premios, con la llave de
// service_role: es escenario para el test, no algo que se ejercite con RLS.
async function closeMatchday(
  seasonId: string,
  number: number,
  pairs: PairInput[],
  awards: AwardInput[],
): Promise<string> {
  const db = adminClient()
  const disciplineId = await disciplineIdOf(seasonId)
  const { data: matchday, error } = await db
    .from('matchdays')
    .insert({ season_id: seasonId, discipline_id: disciplineId, number, status: 'CLOSED' })
    .select('id')
    .single()
  if (error || matchday === null) throw new Error(error?.message)

  for (const pair of pairs) {
    const { error: pairError } = await db
      .from('pairs')
      .insert({ matchday_id: matchday.id, season_id: seasonId, entry_a: pair.a, entry_b: pair.b })
    if (pairError) throw new Error(pairError.message)
  }
  for (const award of awards) {
    const { error: awardError } = await db.from('awards').insert({
      matchday_id: matchday.id,
      season_id: seasonId,
      entry_id: award.entryId,
      position: award.position,
      points: award.points,
    })
    if (awardError) throw new Error(awardError.message)
  }
  return matchday.id
}

// Arma la fecha que se está por armar: DRAFT (o el status que se pida) con su
// presentismo. También con service_role: presentismo es parte de la escena.
async function openMatchday(
  seasonId: string,
  number: number,
  playing: string[],
  absent: string[] = [],
  status: 'DRAFT' | 'CLOSED' = 'DRAFT',
): Promise<string> {
  const db = adminClient()
  const disciplineId = await disciplineIdOf(seasonId)
  const { data: matchday, error } = await db
    .from('matchdays')
    .insert({ season_id: seasonId, discipline_id: disciplineId, number, status })
    .select('id')
    .single()
  if (error || matchday === null) throw new Error(error?.message)

  for (const entryId of playing) {
    const { error: attError } = await db.from('attendances').insert({
      matchday_id: matchday.id,
      season_id: seasonId,
      discipline_id: disciplineId,
      entry_id: entryId,
      status: 'PLAYING',
    })
    if (attError) throw new Error(attError.message)
  }
  for (const entryId of absent) {
    const { error: attError } = await db.from('attendances').insert({
      matchday_id: matchday.id,
      season_id: seasonId,
      discipline_id: disciplineId,
      entry_id: entryId,
      status: 'ABSENT',
    })
    if (attError) throw new Error(attError.message)
  }
  return matchday.id
}

async function addGuest(
  seasonId: string,
  matchdayId: string,
  seedPosition: number,
): Promise<string> {
  const db = adminClient()
  const { data, error } = await db
    .from('entries')
    .insert({
      season_id: seasonId,
      matchday_id: matchdayId,
      kind: 'GUEST',
      display_name: `Invitado de test ${Date.now()}-${seedPosition}`,
      seed_position: seedPosition,
    })
    .select('id')
    .single()
  if (error || data === null) throw new Error(error?.message)
  return data.id
}

async function addLock(seasonId: string, matchdayId: string, a: string, b: string): Promise<void> {
  const db = adminClient()
  const { error } = await db
    .from('pair_locks')
    .insert({ season_id: seasonId, matchday_id: matchdayId, entry_a: a, entry_b: b })
  if (error) throw new Error(error.message)
}

describe('pairingContextFor', () => {
  it('orders by the best-of-N ranking, not the raw sum', async () => {
    // Decision 3: A juega 10, 10, 1 en las fechas 1-3; B juega 7, 7, 7.
    //   suma cruda: 21 y 21, empate.
    //   mejores 2 (countBestOf: 2): A = 20, B = 14 — gana A claramente.
    const config: SeasonConfig = {
      squadSize: 8,
      matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true, openScore: false },
      points: [10, 7, 5, 1],
      regularMatchdays: 4,
      countBestOf: 2,
      tiebreakSnapshotEvery: 4,
    }
    const { admin, seasonId, squad } = await buildSeasonWithSquad(config, 8)
    const [b, a, fillerX, fillerY] = squad
    if (b === undefined || a === undefined || fillerX === undefined || fillerY === undefined) {
      throw new Error('Faltan asientos para el test.')
    }

    await closeMatchday(seasonId, 1, [], [
      { entryId: a, position: 1, points: 10 },
      { entryId: b, position: 2, points: 7 },
    ])
    await closeMatchday(seasonId, 2, [], [
      { entryId: a, position: 1, points: 10 },
      { entryId: b, position: 2, points: 7 },
    ])
    await closeMatchday(
      seasonId,
      3,
      [{ a: fillerX, b: fillerY }],
      [
        { entryId: fillerX, position: 1, points: 10 },
        { entryId: a, position: 4, points: 1 },
        { entryId: b, position: 2, points: 7 },
      ],
    )
    const matchdayId = await openMatchday(seasonId, 4, squad)

    const context = await pairingContextFor(admin.client, matchdayId)

    expect(context.input.points.get(a)).toBe(20)
    expect(context.input.points.get(b)).toBe(14)
  })

  it('uses the snapshot in force for the matchday being built', async () => {
    const config: SeasonConfig = { ...defaultConfig(8), tiebreakSnapshotEvery: 1 }
    const { admin, seasonId, squad } = await buildSeasonWithSquad(config, 8)
    const [q1, q2, q3, q4, q5, q6, q7, q8] = squad
    if (
      q1 === undefined ||
      q2 === undefined ||
      q3 === undefined ||
      q4 === undefined ||
      q5 === undefined ||
      q6 === undefined ||
      q7 === undefined ||
      q8 === undefined
    ) {
      throw new Error('Faltan asientos para el test.')
    }

    await closeMatchday(
      seasonId,
      1,
      [{ a: q1, b: q2 }],
      [
        { entryId: q1, position: 1, points: 1 },
        { entryId: q2, position: 2, points: 20 },
        { entryId: q3, position: 2, points: 50 },
        { entryId: q4, position: 2, points: 10 },
        { entryId: q5, position: 2, points: 40 },
        { entryId: q6, position: 2, points: 8 },
        { entryId: q7, position: 2, points: 30 },
        { entryId: q8, position: 2, points: 2 },
      ],
    )
    const matchdayId = await openMatchday(seasonId, 2, squad)

    const context = await pairingContextFor(admin.client, matchdayId)

    expect(context.input.snapshot).toEqual([q3, q5, q7, q2, q4, q6, q8, q1])
  })

  it('derives the defenders from the previous matchday awards', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const [p1, p2] = squad
    if (p1 === undefined || p2 === undefined) throw new Error('Faltan asientos para el test.')

    await closeMatchday(
      seasonId,
      1,
      [{ a: p1, b: p2 }],
      [
        { entryId: p1, position: 1, points: 10 },
        { entryId: p2, position: 1, points: 10 },
      ],
    )
    const matchdayId = await openMatchday(seasonId, 2, squad)

    const context = await pairingContextFor(admin.client, matchdayId)

    expect(context.input.defenders).toEqual(pair(p1, p2))
    expect(context.input.defendersAlreadyRepeated).toBe(false)
    expect(context.input.previousPairs).toEqual([pair(p1, p2)])
  })

  it('marks defendersAlreadyRepeated when the pair carried over two matchdays', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const [p1, p2] = squad
    if (p1 === undefined || p2 === undefined) throw new Error('Faltan asientos para el test.')

    await closeMatchday(seasonId, 1, [{ a: p1, b: p2 }], [])
    await closeMatchday(
      seasonId,
      2,
      [{ a: p1, b: p2 }],
      [
        { entryId: p1, position: 1, points: 10 },
        { entryId: p2, position: 1, points: 10 },
      ],
    )
    const matchdayId = await openMatchday(seasonId, 3, squad)

    const context = await pairingContextFor(admin.client, matchdayId)

    expect(context.input.defenders).toEqual(pair(p1, p2))
    expect(context.input.defendersAlreadyRepeated).toBe(true)
  })

  it('has no defenders on the first matchday', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await openMatchday(seasonId, 1, squad)

    const context = await pairingContextFor(admin.client, matchdayId)

    expect(context.input.defenders).toBeNull()
    expect(context.input.defendersAlreadyRepeated).toBe(false)
    expect(context.input.previousPairs).toEqual([])
  })

  it('has no defenders when the previous matchday never closed', async () => {
    // Este estado NO se puede alcanzar por la app: matchdays_one_live no deja
    // dos fechas vivas y no existe (todavía) un flujo real que abra una fecha
    // con la anterior sin cerrar. Se arma a mano: la fecha 2 —la que se
    // "está armando" para el test— se fuerza a CLOSED, así conviven con la 1
    // en DRAFT sin pisar el índice único. Defensa en profundidad de
    // closedHistory, no un flujo real.
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    await openMatchday(seasonId, 1, [])
    const matchdayId = await openMatchday(seasonId, 2, squad, [], 'CLOSED')

    const context = await pairingContextFor(admin.client, matchdayId)

    expect(context.input.defenders).toBeNull()
    expect(context.input.defendersAlreadyRepeated).toBe(false)
  })

  it('puts guests at the tail of present, in their seed position', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(10), 10)
    const playing = squad.slice(0, 8)
    const absent = squad.slice(8)
    const matchdayId = await openMatchday(seasonId, 1, playing, absent)

    const first = playing[0]
    if (first === undefined) throw new Error('Falta el primer jugador para el test.')
    const guest1 = await addGuest(seasonId, matchdayId, 0)
    const guest2 = await addGuest(seasonId, matchdayId, 1)
    await addLock(seasonId, matchdayId, guest1, first)

    const context = await pairingContextFor(admin.client, matchdayId)

    expect(context.input.present).toEqual([...playing, guest1, guest2])
  })

  it('carries locked pairs into fixedPairs', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const playing = squad.slice(0, 7)
    const absent = squad.slice(7)
    const partner = playing[0]
    if (partner === undefined) throw new Error('Falta un jugador para el test.')
    const matchdayId = await openMatchday(seasonId, 1, playing, absent)
    const guest = await addGuest(seasonId, matchdayId, 0)
    await addLock(seasonId, matchdayId, guest, partner)

    const context = await pairingContextFor(admin.client, matchdayId)

    expect(context.input.fixedPairs).toEqual([pair(guest, partner)])
  })

  it('ignores absent players', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(10), 10)
    const playing = squad.slice(0, 8)
    const absent = squad.slice(8)
    const matchdayId = await openMatchday(seasonId, 1, playing, absent)

    const context = await pairingContextFor(admin.client, matchdayId)

    expect(context.input.present).toEqual(playing)
    for (const entryId of absent) {
      expect(context.input.present).not.toContain(entryId)
    }
  })

  it('fails with an invalid config before touching the snapshot', async () => {
    const config: SeasonConfig = { ...defaultConfig(8), tiebreakSnapshotEvery: 0 }
    const { admin, seasonId } = await buildSeasonWithSquad(config, 8)
    const matchdayId = await openMatchday(seasonId, 1, [])

    await expect(matchdayContextFor(admin.client, matchdayId)).rejects.toThrow(
      /refrescar cada 1 fecha o más/,
    )
  })

  it('fails when the matchday pairs exceed the points list', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await openMatchday(seasonId, 1, squad)
    const first = squad[0]
    if (first === undefined) throw new Error('Falta un jugador para el test.')
    const guest1 = await addGuest(seasonId, matchdayId, 0)
    await addGuest(seasonId, matchdayId, 1)
    await addLock(seasonId, matchdayId, guest1, first)

    await expect(pairingContextFor(admin.client, matchdayId)).rejects.toThrow(
      /parejas del torneo/,
    )
  })

  it('fails with two loose guests', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await openMatchday(seasonId, 1, squad)
    await addGuest(seasonId, matchdayId, 0)
    await addGuest(seasonId, matchdayId, 1)

    await expect(pairingContextFor(admin.client, matchdayId)).rejects.toThrow(
      /invitados sueltos/,
    )
  })
})

// ── C37: el orden de entrada al sorteo es el de la DISCIPLINA ───────────────
// `playingEntryIds` (`db/matchday.ts`) ordenaba `present` por
// `entries.seed_position`, la numeración de LA TEMPORADA. Dos problemas en la
// misma línea:
//
//   1. Esa columna se relaja para el SQUAD en el contract (C37) y su `?? 0`
//      degradaba en SILENCIO — sin error, con el orden del sorteo al azar.
//   2. Ya hoy es la numeración equivocada: el orden real del plantel de una
//      disciplina vive en `discipline_entries` desde PR 7, y es el mismo
//      defecto que C9 arregló en `entriesOf` sin llegar hasta acá.
//
// `attendances_entry_discipline` (FK a `discipline_entries`) garantiza que
// todo presente tiene fila en la disciplina de la fecha, así que ordenar por
// ahí no puede perder a nadie.
describe('pairingContextFor > el orden de present (C37)', () => {
  it('sale de discipline_entries, no de entries.seed_position', async () => {
    const { admin, seasonId, squad } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const disciplineId = await disciplineIdOf(seasonId)
    const matchdayId = await openMatchday(seasonId, 1, squad)

    // La disciplina queda al revés que `entries.seed_position`, que sigue en
    // 0..7. Parking de dos pasadas para no chocar `discipline_entries_seed`.
    const db = adminClient()
    const reversed = [...squad].reverse()
    for (const [index, entryId] of reversed.entries()) {
      const { error } = await db
        .from('discipline_entries')
        .update({ seed_position: index + 100 })
        .eq('discipline_id', disciplineId)
        .eq('entry_id', entryId)
      if (error) throw new Error(error.message)
    }
    for (const [index, entryId] of reversed.entries()) {
      const { error } = await db
        .from('discipline_entries')
        .update({ seed_position: index })
        .eq('discipline_id', disciplineId)
        .eq('entry_id', entryId)
      if (error) throw new Error(error.message)
    }

    const context = await pairingContextFor(admin.client, matchdayId)
    expect(context.input.present).toEqual(reversed)
  })
})
