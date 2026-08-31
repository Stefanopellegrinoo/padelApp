import { describe, it, expect } from 'vitest'
import { adminClient } from './test/admin'
import { createTestUser } from './test/users'

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
