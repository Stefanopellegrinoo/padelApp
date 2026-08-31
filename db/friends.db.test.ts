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
})
