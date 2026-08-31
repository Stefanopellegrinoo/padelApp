import { describe, it, expect } from 'vitest'
import { defaultConfig, type SideSize } from '@/core'
import { createMatchday, generatePairs, setAttendance } from './matchday'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser, type TestUser } from './test/users'

// ── scaffolding local a este archivo ────────────────────────────────────────
// Mismo patrón que `db/entries.db.test.ts`, `db/close.db.test.ts`, etc.: cada
// `*.db.test.ts` trae su propio `fillerPlayers`, no hay un helper compartido.
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
 * Arma una temporada de 8 presentes (MIN_PLAYERS, `core/constants.ts`: menos
 * y `generatePairs` rechaza la fecha), abre una fecha y genera parejas y
 * partidos por el camino real (`generatePairs`, no un insert a mano) — mismo
 * flujo que `db/entries.db.test.ts:56-77` y `db/close.db.test.ts:535-551`.
 * Devuelve el primer partido armado, para ejercitar `match_participants`
 * sobre un partido de verdad, con RLS real de por medio.
 */
async function unaFechaJugada({
  admin,
  pairSize,
}: {
  admin: TestUser
  pairSize: SideSize
}): Promise<{ matchId: string; entryIds: string[] }> {
  const filler = await fillerPlayers(8)
  const { seasonId, entryIds, disciplineId } = await createSeason({
    admin,
    squad: filler,
    disciplines: [
      {
        kind: pairSize === 1 ? 'FIFA' : 'PADEL',
        pairSize,
        config: defaultConfig(8, pairSize),
      },
    ],
  })

  const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10', disciplineId)
  for (const entryId of entryIds) {
    await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
  }
  await generatePairs(admin.client, matchdayId)

  const db = adminClient()
  const { data: match, error } = await db
    .from('matches')
    .select('id')
    .eq('matchday_id', matchdayId)
    .limit(1)
    .single()
  if (error || match === null) {
    throw new Error(`No se pudo leer el partido de test: ${error?.message}`)
  }

  return { matchId: match.id, entryIds }
}

describe('friendships', () => {
  it('guarda una sola fila por par, con los jugadores ordenados', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const [a, b] =
      uno.playerId < dos.playerId ? [uno.playerId, dos.playerId] : [dos.playerId, uno.playerId]

    const db = adminClient()
    const { error } = await db
      .from('friendships')
      .insert({ player_a: a, player_b: b, requested_by: a })
    expect(error).toBeNull()

    const { error: repetida } = await db
      .from('friendships')
      .insert({ player_a: a, player_b: b, requested_by: b })
    expect(repetida?.code).toBe('23505')
  })

  it('rechaza una amistad con uno mismo', async () => {
    const uno = await createTestUser()
    const a = uno.playerId

    const db = adminClient()
    const { error } = await db
      .from('friendships')
      .insert({ player_a: a, player_b: a, requested_by: a })
    expect(error?.code).toBe('23514')
  })

  it('rechaza el par desordenado, para que no entren dos filas del mismo par', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const [a, b] =
      uno.playerId < dos.playerId ? [uno.playerId, dos.playerId] : [dos.playerId, uno.playerId]

    const db = adminClient()
    const { error } = await db
      .from('friendships')
      .insert({ player_a: b, player_b: a, requested_by: a })
    expect(error?.code).toBe('23514')
  })

  // Los tres tests de acá abajo usan el cliente logueado (`.client`), no
  // `adminClient()`: son los únicos que de verdad pasan por las políticas
  // RLS de escritura, no por los CHECK/UNIQUE de la tabla.
  it('un caller no puede insertar una amistad que ya nace aceptada', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const [a, b] =
      uno.playerId < dos.playerId ? [uno.playerId, dos.playerId] : [dos.playerId, uno.playerId]

    const { error } = await uno.client.from('friendships').insert({
      player_a: a,
      player_b: b,
      requested_by: uno.playerId,
      accepted_at: new Date().toISOString(),
    })

    expect(error).not.toBeNull()
  })

  it('quien recibe una solicitud no puede reapuntarla a un par fabricado', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const tres = await createTestUser()
    const [a, b] =
      uno.playerId < dos.playerId ? [uno.playerId, dos.playerId] : [dos.playerId, uno.playerId]

    const { data: creada, error: pedidoError } = await uno.client
      .from('friendships')
      .insert({ player_a: a, player_b: b, requested_by: uno.playerId })
      .select('id')
      .single()
    expect(pedidoError).toBeNull()

    // `dos` es la contraparte: recibió la solicitud de `uno`, nunca la pidió.
    const [fa, fb] =
      dos.playerId < tres.playerId ? [dos.playerId, tres.playerId] : [tres.playerId, dos.playerId]
    await dos.client
      .from('friendships')
      .update({
        player_a: fa,
        player_b: fb,
        requested_by: tres.playerId,
        accepted_at: new Date().toISOString(),
      })
      .eq('id', creada?.id ?? '')

    const { data: fila } = await adminClient()
      .from('friendships')
      .select('player_a, player_b, requested_by, accepted_at')
      .eq('id', creada?.id ?? '')
      .single()
    expect(fila?.player_a).toBe(a)
    expect(fila?.player_b).toBe(b)
    expect(fila?.requested_by).toBe(uno.playerId)
    expect(fila?.accepted_at).toBeNull()
  })

  it('aceptar una solicitud genuina sigue funcionando', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const [a, b] =
      uno.playerId < dos.playerId ? [uno.playerId, dos.playerId] : [dos.playerId, uno.playerId]

    const { data: creada, error: pedidoError } = await uno.client
      .from('friendships')
      .insert({ player_a: a, player_b: b, requested_by: uno.playerId })
      .select('id')
      .single()
    expect(pedidoError).toBeNull()

    const { error: aceptarError } = await dos.client
      .from('friendships')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', creada?.id ?? '')
    expect(aceptarError).toBeNull()

    const { data: fila } = await adminClient()
      .from('friendships')
      .select('accepted_at')
      .eq('id', creada?.id ?? '')
      .single()
    expect(fila?.accepted_at).not.toBeNull()
  })
})

describe('friendships — RLS', () => {
  it('un tercero no ve la amistad ajena', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const ajeno = await createTestUser()
    const [a, b] =
      uno.playerId < dos.playerId ? [uno.playerId, dos.playerId] : [dos.playerId, uno.playerId]

    const { data: fila } = await adminClient()
      .from('friendships')
      .insert({ player_a: a, player_b: b, requested_by: a })
      .select('id')
      .single()

    // Chequeo positivo primero: si la lectura fuera negada para todos (no
    // sólo acotada a los miembros), `uno` también vería `[]` y este test
    // pasaría igual sin haber probado nada — como de hecho pasaba con la
    // versión anterior, que sólo miraba a `ajeno`.
    const { data: propia } = await uno.client.from('friendships').select('id')
    expect(propia).toEqual([{ id: fila!.id }])

    const { data: ajena } = await ajeno.client.from('friendships').select('id')
    expect(ajena).toEqual([])
  })

  it('nadie puede inventar una amistad entre dos terceros', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const ajeno = await createTestUser()
    const [a, b] =
      uno.playerId < dos.playerId ? [uno.playerId, dos.playerId] : [dos.playerId, uno.playerId]

    const { error } = await ajeno.client
      .from('friendships')
      .insert({ player_a: a, player_b: b, requested_by: a })
    expect(error?.code).toBe('42501')
  })

  it('quien pidió no puede aceptar su propia solicitud', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const [a, b] =
      uno.playerId < dos.playerId ? [uno.playerId, dos.playerId] : [dos.playerId, uno.playerId]
    const pidio = uno.playerId === a ? uno : dos

    const { data: fila } = await adminClient()
      .from('friendships')
      .insert({ player_a: a, player_b: b, requested_by: a })
      .select('id')
      .single()

    const { data } = await pidio.client
      .from('friendships')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', fila!.id)
      .select('id')
    expect(data).toEqual([])
  })
})

describe('match_participants', () => {
  it('devuelve los cuatro jugadores de un partido de parejas, con su lado', async () => {
    const admin = await createTestUser()
    const { matchId } = await unaFechaJugada({ admin, pairSize: 2 })

    const { data, error } = await adminClient()
      .from('match_participants')
      .select('match_id, side, player_id')
      .eq('match_id', matchId)
    if (error) throw new Error(error.message)

    expect(data).toHaveLength(4)
    expect(new Set(data!.map((f) => f.side))).toEqual(new Set(['A', 'B']))
  })

  it('NO pierde el partido de a uno, donde entry_b viene en null', async () => {
    const admin = await createTestUser()
    const { matchId } = await unaFechaJugada({ admin, pairSize: 1 })

    const { data } = await adminClient()
      .from('match_participants')
      .select('match_id, side')
      .eq('match_id', matchId)

    expect(data).toHaveLength(2)
  })

  it('no le muestra a un tercero los partidos de una temporada ajena', async () => {
    const admin = await createTestUser()
    const ajeno = await createTestUser()
    const { matchId } = await unaFechaJugada({ admin, pairSize: 2 })

    // Chequeo positivo primero, mismo criterio que la RLS de `friendships`
    // arriba (`'un tercero no ve la amistad ajena'`): si la vista negara la
    // lectura para CUALQUIER autenticado (no sólo para quien no participa),
    // `admin` también vería `[]` y este test pasaría igual sin haber probado
    // el aislamiento — sólo que la vista estaría rota, no protegida.
    const { data: propia } = await admin.client
      .from('match_participants')
      .select('match_id')
      .eq('match_id', matchId)
    expect(propia).toHaveLength(4)

    const { data } = await ajeno.client
      .from('match_participants')
      .select('match_id')
      .eq('match_id', matchId)
    expect(data).toEqual([])
  })
})
