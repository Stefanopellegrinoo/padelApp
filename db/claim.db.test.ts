import { createClient } from '@supabase/supabase-js'
import { describe, it, expect } from 'vitest'
import { defaultConfig } from '../core/config'
import type { Database, Json } from './database.types'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser, type TestUser } from './test/users'

// Cliente sin sesión: es el rol `anon` de PostgREST, no un `authenticated` de
// mentira.
function anonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (url === undefined || anonKey === undefined) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY.')
  }
  return createClient<Database>(url, anonKey)
}

// ── scaffolding local a este archivo ────────────────────────────────────────
// No va a db/test/factories.ts: `createSeason` de ahí sólo arma asientos ya
// reclamados (con `player_id` puesto). Los tests de este archivo necesitan
// asientos LIBRES, que es justo lo que `claim_seat` existe para cerrar.

async function createOpenSeason(
  admin: TestUser,
  seatNames: string[],
): Promise<{ seasonId: string; token: string; entryIds: string[] }> {
  const db = adminClient()
  const { data: season, error: seasonError } = await db
    .from('seasons')
    .insert({
      name: `Temporada de test ${Date.now()}`,
      created_by: admin.userId,
    })
    .select('id, invite_token')
    .single()
  if (seasonError || season === null) throw new Error(seasonError?.message)

  const { data: discipline, error: disciplineError } = await db
    .from('disciplines')
    .insert({ season_id: season.id, kind: 'PADEL', config: defaultConfig(seatNames.length) as unknown as Json })
    .select('id')
    .single()
  if (disciplineError || discipline === null) throw new Error(disciplineError?.message)

  const entryIds: string[] = []
  for (const name of seatNames) {
    const { data: entry, error: entryError } = await db
      .from('entries')
      // Sin `seed_position` (C37): el CHECK `entries_seed_shape` del contract
      // lo prohíbe para el SQUAD. El orden lo pone `discipline_entries`, abajo.
      .insert({ season_id: season.id, display_name: name, kind: 'SQUAD' })
      .select('id')
      .single()
    if (entryError || entry === null) throw new Error(entryError?.message)
    entryIds.push(entry.id)
  }

  // Cada asiento SQUAD entra también a la disciplina (W8, ronda
  // 3): sin esto un asiento de este scaffold queda sin fila en
  // discipline_entries y `seedAttendances` (que lee discipline_entries desde
  // PR 8) lo trata como si no jugara nada.
  if (entryIds.length > 0) {
    const { error: seatsError } = await db.from('discipline_entries').insert(
      entryIds.map((entryId, index) => ({
        discipline_id: discipline.id,
        entry_id: entryId,
        season_id: season.id,
        seed_position: index,
      })),
    )
    if (seatsError) throw new Error(seatsError.message)
  }

  return { seasonId: season.id, token: season.invite_token, entryIds }
}

async function addGuestEntry(seasonId: string): Promise<string> {
  const db = adminClient()
  const { data: discipline, error: disciplineError } = await db
    .from('disciplines')
    .select('id')
    .eq('season_id', seasonId)
    .single()
  if (disciplineError || discipline === null) throw new Error(disciplineError?.message)

  const { data: matchday, error: matchdayError } = await db
    .from('matchdays')
    .insert({ season_id: seasonId, discipline_id: discipline.id, number: 1 })
    .select('id')
    .single()
  if (matchdayError || matchday === null) throw new Error(matchdayError?.message)

  const { data: guest, error: guestError } = await db
    .from('entries')
    .insert({
      season_id: seasonId,
      matchday_id: matchday.id,
      kind: 'GUEST',
      display_name: 'Invitado de test',
      seed_position: 0,
    })
    .select('id')
    .single()
  if (guestError || guest === null) throw new Error(guestError?.message)
  return guest.id
}

describe('claim_seat', () => {
  it('attaches the seat to the calling player', async () => {
    const admin = await createTestUser()
    const claimer = await createTestUser()
    const { seasonId, token, entryIds } = await createOpenSeason(admin, ['Fulano'])
    const [entryId] = entryIds
    if (entryId === undefined) throw new Error('Falta el asiento de test.')

    const { data, error } = await claimer.client.rpc('claim_seat', {
      p_token: token,
      p_entry: entryId,
    })

    expect(error).toBeNull()
    expect(data).toBe(seasonId)

    const { data: entry } = await adminClient()
      .from('entries')
      .select('player_id')
      .eq('id', entryId)
      .single()
    expect(entry?.player_id).toBe(claimer.playerId)
  })

  // El que arma el torneo también lo juega. `claim_seat` nunca lo prohibió,
  // pero durante todo el Plan 4 no hubo forma de llegar: la pantalla de Unirse
  // daba por sentado que ver el plantel era tener asiento, y quien organiza ve
  // el plantel entero por ser admin. Este test fija la regla del lado que no se
  // puede saltear, para que no vuelva a depender de una pantalla.
  it('lets the season admin claim a seat too', async () => {
    const admin = await createTestUser()
    const { seasonId, token, entryIds } = await createOpenSeason(admin, ['Fulano', 'Mengano'])
    const [entryId] = entryIds
    if (entryId === undefined) throw new Error('Falta el asiento de test.')

    const { data, error } = await admin.client.rpc('claim_seat', {
      p_token: token,
      p_entry: entryId,
    })

    expect(error).toBeNull()
    expect(data).toBe(seasonId)

    const { data: entry } = await adminClient()
      .from('entries')
      .select('player_id')
      .eq('id', entryId)
      .single()
    expect(entry?.player_id).toBe(admin.playerId)
  })

  it('rejects a token that does not exist', async () => {
    const claimer = await createTestUser()

    const { error } = await claimer.client.rpc('claim_seat', {
      p_token: 'token-inexistente',
      p_entry: '00000000-0000-0000-0000-000000000000',
    })

    expect(error?.message).toMatch(/link de invitación no es válido/)
  })

  it('rejects a seat that already has an owner', async () => {
    const admin = await createTestUser()
    const owner = await createTestUser()
    const claimer = await createTestUser()
    const { token, entryIds } = await createOpenSeason(admin, ['Fulano'])
    const [entryId] = entryIds
    if (entryId === undefined) throw new Error('Falta el asiento de test.')

    const first = await owner.client.rpc('claim_seat', { p_token: token, p_entry: entryId })
    expect(first.error).toBeNull()

    const { error } = await claimer.client.rpc('claim_seat', { p_token: token, p_entry: entryId })

    expect(error?.message).toMatch(/ya lo reclamó otra persona/)
  })

  it('rejects a seat from another season even with a valid token', async () => {
    const adminA = await createTestUser()
    const adminB = await createTestUser()
    const claimer = await createTestUser()
    const { entryIds: entryIdsA } = await createOpenSeason(adminA, ['Fulano'])
    const { token: tokenB } = await createOpenSeason(adminB, ['Mengano'])
    const [entryIdA] = entryIdsA
    if (entryIdA === undefined) throw new Error('Falta el asiento de test.')

    const { error } = await claimer.client.rpc('claim_seat', {
      p_token: tokenB,
      p_entry: entryIdA,
    })

    expect(error?.message).toMatch(/ya lo reclamó otra persona/)
  })

  it('rejects someone who already has a seat in that tournament', async () => {
    const admin = await createTestUser()
    const claimer = await createTestUser()
    const { token, entryIds } = await createOpenSeason(admin, ['Fulano', 'Mengano'])
    const [firstEntry, secondEntry] = entryIds
    if (firstEntry === undefined || secondEntry === undefined) {
      throw new Error('Faltan asientos de test.')
    }

    const first = await claimer.client.rpc('claim_seat', { p_token: token, p_entry: firstEntry })
    expect(first.error).toBeNull()

    const { error } = await claimer.client.rpc('claim_seat', {
      p_token: token,
      p_entry: secondEntry,
    })

    expect(error?.message).toMatch(/Ya tenés un lugar en este torneo/)
  })

  it('does not let you claim a guest seat', async () => {
    const admin = await createTestUser()
    const claimer = await createTestUser()
    const { seasonId, token } = await createOpenSeason(admin, [])
    const guestEntryId = await addGuestEntry(seasonId)

    const { error } = await claimer.client.rpc('claim_seat', {
      p_token: token,
      p_entry: guestEntryId,
    })

    expect(error?.message).toMatch(/ya lo reclamó otra persona/)
  })

  it('two simultaneous claims on the same seat: only one gets in', async () => {
    const admin = await createTestUser()
    const claimerA = await createTestUser()
    const claimerB = await createTestUser()
    const { token, entryIds } = await createOpenSeason(admin, ['Fulano'])
    const [entryId] = entryIds
    if (entryId === undefined) throw new Error('Falta el asiento de test.')

    const [resultA, resultB] = await Promise.all([
      claimerA.client.rpc('claim_seat', { p_token: token, p_entry: entryId }),
      claimerB.client.rpc('claim_seat', { p_token: token, p_entry: entryId }),
    ])

    const errors = [resultA.error, resultB.error]
    const succeeded = errors.filter((error) => error === null)
    const failed = errors.filter((error) => error !== null)
    expect(succeeded).toHaveLength(1)
    expect(failed).toHaveLength(1)
    expect(failed[0]?.message).toMatch(/ya lo reclamó otra persona/)
  })

  it('anon gets permission denied, not a business error', async () => {
    // 42501. Con anon, auth.uid() es NULL y la función tira "Entrá con tu
    // cuenta…", así que un test que asserte "tiró error" pasa en verde con el
    // grant abierto. El código del error es lo único que distingue las dos.
    const { error } = await anonClient().rpc('claim_seat', {
      p_token: 'cualquier-token',
      p_entry: '00000000-0000-0000-0000-000000000000',
    })

    expect(error?.code).toBe('42501')
  })
})

describe('season_invite', () => {
  it('returns the seats with their claimed status', async () => {
    const admin = await createTestUser()
    const claimer = await createTestUser()
    // Un tercero que no participa del torneo: es justo a quien security
    // definer tiene que dejar ver esta lista sin pasar por is_participant.
    const viewer = await createTestUser()
    const { token, entryIds } = await createOpenSeason(admin, ['Fulano', 'Mengano'])
    const [freeEntry, takenEntry] = entryIds
    if (freeEntry === undefined || takenEntry === undefined) {
      throw new Error('Faltan asientos de test.')
    }
    const claimResult = await claimer.client.rpc('claim_seat', {
      p_token: token,
      p_entry: takenEntry,
    })
    expect(claimResult.error).toBeNull()

    const { data, error } = await viewer.client.rpc('season_invite', { p_token: token })

    expect(error).toBeNull()
    const free = data?.find((row) => row.entry_id === freeEntry)
    const taken = data?.find((row) => row.entry_id === takenEntry)
    expect(free?.claimed).toBe(false)
    expect(taken?.claimed).toBe(true)
  })

  it('does not return the invite_token', async () => {
    const admin = await createTestUser()
    const viewer = await createTestUser()
    const { token } = await createOpenSeason(admin, ['Fulano'])

    const { data, error } = await viewer.client.rpc('season_invite', { p_token: token })

    expect(error).toBeNull()
    expect(data?.[0]).not.toHaveProperty('invite_token')
  })

  it('anon gets permission denied', async () => {
    // Sin el revoke a PUBLIC, esta llamada devuelve el plantel entero de
    // cualquier torneo a cualquiera que tenga el link. No hay error de
    // negocio que la tape: o el grant está cerrado o no lo está.
    const { error } = await anonClient().rpc('season_invite', { p_token: 'cualquier-token' })

    expect(error?.code).toBe('42501')
  })

  // PR 9 (0025): `disciplines` sale de discipline_entries, no de `entries`.
  // `createOpenSeason` (scaffolding de este archivo) no lo llena — sólo le
  // sirve a claim_seat, que no necesita disciplinas—, así que este caso usa
  // la factory, que sí las llena desde PR 7.
  it('devuelve las disciplinas de cada asiento', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason({ admin, squad: [admin.playerId] })
    const db = adminClient()
    const { data: season, error: seasonError } = await db
      .from('seasons')
      .select('invite_token')
      .eq('id', seasonId)
      .single()
    if (seasonError || season === null) throw new Error(seasonError?.message)

    const { data, error } = await admin.client.rpc('season_invite', { p_token: season.invite_token })

    expect(error).toBeNull()
    expect(data?.[0]?.disciplines).toEqual(['PADEL'])
  })

  // El picker seguía ordenando por
  // `entries.seed_position` (temporada, dual-write tail-only desde PR 7), no
  // por el orden real de `discipline_entries` (disciplina) — "antes de Juan"
  // quedaba bien guardado en la base y mal mostrado en la pantalla de Unirse.
  it('ordena por discipline_entries, no por entries.seed_position: "antes de Juan" aparece antes de Juan', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineIds } = await createSeason({ admin, disciplines: [{ kind: 'PADEL' }] })
    const [padelId] = disciplineIds
    if (padelId === undefined) throw new Error('Falta la disciplina.')

    const seat = async (name: string, before?: string): Promise<string> => {
      const { data, error } = await admin.client.rpc('add_squad_seat', {
        p_season: seasonId,
        p_name: name,
        p_disciplines: [padelId],
        ...(before === undefined ? {} : { p_before: before }),
      })
      if (error !== null || data === null) throw new Error(error?.message)
      return data
    }

    const juan = await seat('Juan')
    const pedro = await seat('Pedro')
    // "antes de Juan": entries.seed_position sigue siendo tail-only (Nuevo
    // queda última fila ahí), pero discipline_entries sí lo corre adelante.
    const nuevo = await seat('Nuevo', juan)

    const db = adminClient()
    const { data: season, error: seasonError } = await db
      .from('seasons')
      .select('invite_token')
      .eq('id', seasonId)
      .single()
    if (seasonError || season === null) throw new Error(seasonError?.message)

    const { data: picker, error: pickerError } = await admin.client.rpc('season_invite', {
      p_token: season.invite_token,
    })
    if (pickerError) throw new Error(pickerError.message)

    expect((picker ?? []).map((row) => row.entry_id)).toEqual([nuevo, juan, pedro])
  })
})
