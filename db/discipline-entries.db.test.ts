import { describe, expect, it } from 'vitest'
import type { Client } from './client'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser } from './test/users'

/** playerIds sueltos, sin usuario: alcanza para llenar `squad` de la factory. */
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

// ── PR 7 — discipline_entries (REQ-D1-3, REQ-D1-4) ──────────────────────────
// `entries` sigue siendo el plantel del TORNEO (REQ-D1-3: una persona, un
// asiento, sin duplicar por disciplina). `discipline_entries` es el
// subconjunto por disciplina, con su propio `seed_position` — este archivo
// prueba que las dos cosas son ciertas contra la base real, no sólo que
// compilan.

interface DisciplineSeat {
  entry_id: string
  seed_position: number
}

async function seatsOf(disciplineId: string): Promise<DisciplineSeat[]> {
  const db = adminClient()
  const { data, error } = await db
    .from('discipline_entries')
    .select('entry_id, seed_position')
    .eq('discipline_id', disciplineId)
    .order('seed_position', { ascending: true })
  if (error) throw new Error(error.message)
  return data ?? []
}

describe('discipline_entries — backfill de createSeason (REQ-D1-3)', () => {
  it('cada SQUAD de una temporada nueva entra a su disciplina con el mismo seed_position que en entries', async () => {
    const admin = await createTestUser()
    const { seasonId, entryIds, disciplineId } = await createSeason({
      admin,
      squad: await fillerPlayers(4),
    })

    const seats = await seatsOf(disciplineId)
    expect(seats).toHaveLength(4)
    expect(seats.map((seat) => seat.entry_id)).toEqual(entryIds)
    expect(seats.map((seat) => seat.seed_position)).toEqual([0, 1, 2, 3])

    // Una fila en `entries` por asiento — el plantel es del TORNEO, no se
    // duplica por disciplina.
    const db = adminClient()
    const { data: entryRows, error } = await db.from('entries').select('id').eq('season_id', seasonId)
    if (error) throw new Error(error.message)
    expect(entryRows).toHaveLength(4)
  })
})

describe('discipline_entries — un asiento en dos disciplinas, orden independiente (REQ-D1-3)', () => {
  it('la misma persona tiene seed_position distinto en cada disciplina que juega', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineIds } = await createSeason({
      admin,
      disciplines: [{ kind: 'PADEL' }, { kind: 'FIFA' }],
    })
    const [padelId, fifaId] = disciplineIds
    if (padelId === undefined || fifaId === undefined) throw new Error('Faltan disciplinas.')

    // A y C juegan las dos disciplinas; B sólo pádel — mismo entry, misma
    // fila en `entries`, seed_position que DIVERGE por disciplina apenas se
    // intercala un asiento que no juega las dos.
    const seatA = await addSeat(admin.client, seasonId, 'A', [padelId, fifaId])
    const seatB = await addSeat(admin.client, seasonId, 'B', [padelId])
    const seatC = await addSeat(admin.client, seasonId, 'C', [padelId, fifaId])

    const padelSeats = await seatsOf(padelId)
    const fifaSeats = await seatsOf(fifaId)

    expect(padelSeats.map((seat) => [seat.entry_id, seat.seed_position])).toEqual([
      [seatA, 0],
      [seatB, 1],
      [seatC, 2],
    ])
    // B nunca entró a FIFA: C queda en seed_position 1 ahí, no 2 — el orden de
    // una disciplina no arrastra al de la otra.
    expect(fifaSeats.map((seat) => [seat.entry_id, seat.seed_position])).toEqual([
      [seatA, 0],
      [seatC, 1],
    ])

    // Una sola fila en `entries` por persona, aunque juegue las dos.
    const db = adminClient()
    const { data: entryRows, error } = await db.from('entries').select('id').eq('season_id', seasonId)
    if (error) throw new Error(error.message)
    expect(entryRows).toHaveLength(3)
  })
})

describe('discipline_entries — solape parcial de plantel (REQ-D1-4)', () => {
  it('8 juegan pádel, 6 juegan FIFA, con 4 compartidos: discipline_entries refleja exactamente eso', async () => {
    const admin = await createTestUser()
    const { disciplineIds, seasonId } = await createSeason({
      admin,
      disciplines: [{ kind: 'PADEL' }, { kind: 'FIFA' }],
    })
    const [padelId, fifaId] = disciplineIds
    if (padelId === undefined || fifaId === undefined) throw new Error('Faltan disciplinas.')

    // 4 comparten las dos disciplinas, 4 juegan sólo pádel (8 en total) y 2
    // juegan sólo FIFA (6 en total: los 4 compartidos + estos 2). Secuencial
    // y no `Promise.all`: `add_squad_seat` lee `max(seed_position)` sin
    // trabar la tabla (ponytail documentado en 0013/0023) — dos altas
    // concurrentes del mismo plantel chocan contra `entries_seed`, que es
    // justo el ruido que este test no quiere probar.
    const both = await addSeats(admin.client, seasonId, ['Ambos 1', 'Ambos 2', 'Ambos 3', 'Ambos 4'], [
      padelId,
      fifaId,
    ])
    const padelOnly = await addSeats(admin.client, seasonId, ['Pádel 1', 'Pádel 2', 'Pádel 3', 'Pádel 4'], [
      padelId,
    ])
    const fifaOnly = await addSeats(admin.client, seasonId, ['FIFA 1', 'FIFA 2'], [fifaId])

    const padelSeats = new Set((await seatsOf(padelId)).map((seat) => seat.entry_id))
    const fifaSeats = new Set((await seatsOf(fifaId)).map((seat) => seat.entry_id))

    expect(padelSeats.size).toBe(8)
    expect(fifaSeats.size).toBe(6)
    for (const entryId of both) {
      expect(padelSeats.has(entryId)).toBe(true)
      expect(fifaSeats.has(entryId)).toBe(true)
    }
    for (const entryId of padelOnly) {
      expect(padelSeats.has(entryId)).toBe(true)
      expect(fifaSeats.has(entryId)).toBe(false)
    }
    for (const entryId of fifaOnly) {
      expect(padelSeats.has(entryId)).toBe(false)
      expect(fifaSeats.has(entryId)).toBe(true)
    }
  })
})

/** `add_squad_seat` con `p_disciplines`: la firma que la TS wrapper (db/entries.ts) todavía no expone. RPC directo, mismo patrón que el resto de esta suite. */
async function addSeat(
  client: Client,
  seasonId: string,
  name: string,
  disciplineIds: string[],
): Promise<string> {
  const { data, error } = await client.rpc('add_squad_seat', {
    p_season: seasonId,
    p_name: name,
    p_disciplines: disciplineIds,
  })
  if (error !== null || data === null) throw new Error(error?.message ?? 'add_squad_seat no devolvió id.')
  return data
}

/** Varios `addSeat`, uno detrás del otro — nunca en paralelo, ver el comentario de arriba. */
async function addSeats(
  client: Client,
  seasonId: string,
  names: string[],
  disciplineIds: string[],
): Promise<string[]> {
  const ids: string[] = []
  for (const name of names) {
    ids.push(await addSeat(client, seasonId, name, disciplineIds))
  }
  return ids
}
