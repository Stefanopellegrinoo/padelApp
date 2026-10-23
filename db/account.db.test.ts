import { describe, expect, it } from 'vitest'
import { deleteMyAccount, transferSeasonAdmin } from './account'
import { EdgeError } from './errors'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser } from './test/users'

// Borrar la cuenta (requisito de App Store) "desvinculando": se va el login y
// las amistades, el jugador queda en los torneos con su nombre. Y como cada
// torneo tiene un solo admin, antes hay que poder pasarle la administración a
// otro (odd/tasks/borrar-cuenta.md, S1-S3).

const db = () => adminClient()

async function createdBy(seasonId: string): Promise<string> {
  const { data } = await db().from('seasons').select('created_by').eq('id', seasonId).single()
  return data!.created_by
}

describe('transfer_season_admin', () => {
  it('el admin le pasa la administración a un jugador con cuenta del torneo', async () => {
    const admin = await createTestUser()
    const other = await createTestUser()
    const { seasonId, entryIds } = await createSeason({ admin, squad: [admin.playerId, other.playerId] })

    await transferSeasonAdmin(admin.client, seasonId, entryIds[1]!)

    expect(await createdBy(seasonId)).toBe(other.userId)
  })

  it('quien no es admin no puede, y no cambia nada', async () => {
    const admin = await createTestUser()
    const other = await createTestUser()
    const { seasonId, entryIds } = await createSeason({ admin, squad: [admin.playerId, other.playerId] })

    await expect(transferSeasonAdmin(other.client, seasonId, entryIds[1]!)).rejects.toThrow(EdgeError)
    expect(await createdBy(seasonId)).toBe(admin.userId)
  })

  it('a un jugador sin cuenta no se le puede pasar', async () => {
    const admin = await createTestUser()
    const { data: sinCuenta } = await db()
      .from('players')
      .insert({ display_name: `Sin cuenta ${Date.now()}` })
      .select('id')
      .single()
    const { seasonId, entryIds } = await createSeason({ admin, squad: [admin.playerId, sinCuenta!.id] })

    await expect(transferSeasonAdmin(admin.client, seasonId, entryIds[1]!)).rejects.toThrow(/no tiene cuenta/)
    expect(await createdBy(seasonId)).toBe(admin.userId)
  })

  it('a un asiento de otro torneo no se le puede pasar', async () => {
    const admin = await createTestUser()
    const other = await createTestUser()
    const { seasonId } = await createSeason({ admin, squad: [admin.playerId] })
    const { entryIds: ajenos } = await createSeason({ admin: other, squad: [other.playerId] })

    await expect(transferSeasonAdmin(admin.client, seasonId, ajenos[0]!)).rejects.toThrow(EdgeError)
    expect(await createdBy(seasonId)).toBe(admin.userId)
  })
})

describe('delete_my_account', () => {
  it('borra el login y las amistades, y deja al jugador en el torneo con su nombre', async () => {
    const admin = await createTestUser()
    const leaving = await createTestUser()
    const { seasonId, entryIds } = await createSeason({ admin, squad: [admin.playerId, leaving.playerId] })
    await db().from('friendships').insert({
      player_a: [admin.playerId, leaving.playerId].sort()[0]!,
      player_b: [admin.playerId, leaving.playerId].sort()[1]!,
      requested_by: admin.playerId,
    })
    const { data: before } = await db().from('players').select('display_name').eq('id', leaving.playerId).single()

    await deleteMyAccount(leaving.client)

    const { data: authUser } = await db().auth.admin.getUserById(leaving.userId)
    expect(authUser.user).toBeNull()
    const { data: player } = await db().from('players').select('display_name, user_id').eq('id', leaving.playerId).single()
    expect(player).toEqual({ display_name: before!.display_name, user_id: null })
    const { data: entry } = await db().from('entries').select('player_id, season_id').eq('id', entryIds[1]!).single()
    expect(entry).toEqual({ player_id: leaving.playerId, season_id: seasonId })
    const { count } = await db()
      .from('friendships')
      .select('*', { count: 'exact', head: true })
      .or(`player_a.eq.${leaving.playerId},player_b.eq.${leaving.playerId}`)
    expect(count).toBe(0)
  })

  it('si es admin de un torneo no borra nada y dice cuál', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason({ admin, squad: [admin.playerId] })
    const { data: season } = await db().from('seasons').select('name').eq('id', seasonId).single()

    await expect(deleteMyAccount(admin.client)).rejects.toThrow(season!.name)

    const { data: authUser } = await db().auth.admin.getUserById(admin.userId)
    expect(authUser.user?.id).toBe(admin.userId)
    const { data: player } = await db().from('players').select('user_id').eq('id', admin.playerId).single()
    expect(player!.user_id).toBe(admin.userId)
  })

  it('después de pasar la administración, sí puede borrarla', async () => {
    const admin = await createTestUser()
    const other = await createTestUser()
    const { seasonId, entryIds } = await createSeason({ admin, squad: [admin.playerId, other.playerId] })

    await transferSeasonAdmin(admin.client, seasonId, entryIds[1]!)
    await deleteMyAccount(admin.client)

    const { data: authUser } = await db().auth.admin.getUserById(admin.userId)
    expect(authUser.user).toBeNull()
    expect(await createdBy(seasonId)).toBe(other.userId)
  })

  it('sin sesión no se puede llamar', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    const { error } = await anon.rpc('delete_my_account' as never)
    expect(error).not.toBeNull()
  })
})
