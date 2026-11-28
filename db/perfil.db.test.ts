import { afterAll, describe, expect, it } from 'vitest'
import { setMyDiscoverable } from './buscar'
import { addFriend, createCasualMatch, type CasualPlayerInput, type CasualResultInput } from './friends'
import { perfilDe } from './perfil'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser, type TestUser } from './test/users'

/**
 * El perfil de un jugador (odd/tasks/amigos-faciles.md, T9, S9): `player_profile`
 * (0127) y `perfilDe`. Se ve con las mismas reglas que el nombre
 * (`player_display_names`, 0103: vos, el admin de un torneo donde juega, un
 * torneo compartido, un amigo o un pedido, un partido casual) o si el jugador
 * se puede encontrar por el buscador (@usuario, interruptor prendido y cuenta).
 * De cualquier otro no devuelve nada. Nunca el `user_id`: sólo si la cuenta
 * sigue.
 *
 * La base local no se resetea: los @usuario llevan un prefijo que ninguna
 * corrida usó y al final se sacan.
 */

const db = () => adminClient()
const conUsuario: string[] = []

let counter = 0
function freshPrefix(): string {
  return `f${(Date.now() + counter++).toString(36).slice(-5)}${Math.random().toString(36).slice(2, 4)}`.replace(
    /[^a-z0-9]/g,
    'x',
  )
}

async function setUsername(playerId: string, username: string): Promise<void> {
  const { error } = await db().from('players').update({ username }).eq('id', playerId)
  if (error) throw new Error(error.message)
  conUsuario.push(playerId)
}

async function setName(playerId: string, displayName: string): Promise<void> {
  const { error } = await db().from('players').update({ display_name: displayName }).eq('id', playerId)
  if (error) throw new Error(error.message)
}

async function profile(user: TestUser, playerId: string) {
  const { data, error } = await user.client.rpc('player_profile', { p_player: playerId })
  expect(error).toBeNull()
  return data ?? []
}

async function deleteAccount(user: TestUser): Promise<void> {
  const { error } = await user.client.rpc('delete_my_account')
  if (error) throw new Error(error.message)
}

async function friends(a: TestUser, b: TestUser): Promise<void> {
  expect(await addFriend(a.client, b.playerId)).toBe('sent')
  expect(await addFriend(b.client, a.playerId)).toBe('friends')
}

const rival = (playerId: string): CasualPlayerInput => ({ side: 'theirs', playerId, guestName: null })
const fifa = (outcome: 'won' | 'lost'): CasualResultInput => ({
  sport: 'FIFA',
  playedOn: '2026-08-30',
  outcome,
  scoreMine: outcome === 'won' ? '3' : '1',
  scoreTheirs: outcome === 'won' ? '1' : '3',
  teamMine: 'River',
  teamTheirs: 'Boca',
  setsToWin: '',
  gamesPerSet: '',
  sets: '',
})

afterAll(async () => {
  if (conUsuario.length > 0) await db().from('players').update({ username: null }).in('id', conUsuario)
})

describe('player_profile — con quién se ve', () => {
  it('el tuyo', async () => {
    const yo = await createTestUser()
    await setName(yo.playerId, 'Yo Mismo')
    expect(await profile(yo, yo.playerId)).toEqual([
      { id: yo.playerId, display_name: 'Yo Mismo', username: null, has_account: true },
    ])
  })

  it('el de alguien de un torneo que administrás, aunque no juegues', async () => {
    const admin = await createTestUser()
    const jugador = await createTestUser()
    await createSeason({ admin, squad: [jugador.playerId] })
    expect((await profile(admin, jugador.playerId)).map((fila) => fila.id)).toEqual([jugador.playerId])
  })

  it('el de alguien con quien compartís un torneo', async () => {
    const admin = await createTestUser()
    const yo = await createTestUser()
    const otro = await createTestUser()
    await createSeason({ admin, squad: [yo.playerId, otro.playerId] })
    expect((await profile(yo, otro.playerId)).map((fila) => fila.id)).toEqual([otro.playerId])
  })

  it('el de un amigo, y también con un pedido pendiente en cualquier dirección', async () => {
    const yo = await createTestUser()
    const amigo = await createTestUser()
    const pedido = await createTestUser()
    await friends(yo, amigo)
    expect(await addFriend(pedido.client, yo.playerId)).toBe('sent')

    expect((await profile(yo, amigo.playerId)).map((fila) => fila.id)).toEqual([amigo.playerId])
    expect((await profile(yo, pedido.playerId)).map((fila) => fila.id)).toEqual([pedido.playerId])
    expect((await profile(pedido, yo.playerId)).map((fila) => fila.id)).toEqual([yo.playerId])
  })

  it('el de alguien con quien jugaste un partido casual, aunque ya no sean amigos', async () => {
    const yo = await createTestUser()
    const otro = await createTestUser()
    await friends(yo, otro)
    await createCasualMatch(yo.client, [rival(otro.playerId)], fifa('won'))
    const { error } = await db().from('friendships').delete().or(`player_a.eq.${yo.playerId},player_b.eq.${yo.playerId}`)
    if (error) throw new Error(error.message)

    expect((await profile(yo, otro.playerId)).map((fila) => fila.id)).toEqual([otro.playerId])
  })

  it('el de un extraño que se puede encontrar por su @usuario', async () => {
    const p = freshPrefix()
    const yo = await createTestUser()
    const extraño = await createTestUser()
    await setName(extraño.playerId, 'Extraño Buscable')
    await setUsername(extraño.playerId, `${p}busc`)
    expect(await profile(yo, extraño.playerId)).toEqual([
      { id: extraño.playerId, display_name: 'Extraño Buscable', username: `${p}busc`, has_account: true },
    ])
  })
})

describe('player_profile — con quién no', () => {
  it('un extraño con el interruptor apagado', async () => {
    const p = freshPrefix()
    const yo = await createTestUser()
    const oculto = await createTestUser()
    await setUsername(oculto.playerId, `${p}ocul`)
    await setMyDiscoverable(oculto.client, false)
    expect(await profile(yo, oculto.playerId)).toEqual([])
  })

  it('un extraño sin @usuario', async () => {
    const yo = await createTestUser()
    const sinUsuario = await createTestUser()
    expect(await profile(yo, sinUsuario.playerId)).toEqual([])
  })

  it('un jugador tipeado que nadie reclamó, sin contexto', async () => {
    const yo = await createTestUser()
    const { data: tipeado, error } = await db()
      .from('players')
      .insert({ display_name: `Tipeado ${Date.now()}` })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    expect(await profile(yo, tipeado.id)).toEqual([])
  })

  it('un extraño que borró su cuenta, aunque tuviera @usuario', async () => {
    const p = freshPrefix()
    const yo = await createTestUser()
    const seFue = await createTestUser()
    await setUsername(seFue.playerId, `${p}fue`)
    await deleteAccount(seFue)
    expect(await profile(yo, seFue.playerId)).toEqual([])
  })

  it('un id que no existe', async () => {
    const yo = await createTestUser()
    expect(await profile(yo, '00000000-0000-0000-0000-000000000000')).toEqual([])
  })
})

describe('player_profile — qué devuelve', () => {
  it('quien borró su cuenta sale con has_account en false, si hay contexto', async () => {
    const admin = await createTestUser()
    const yo = await createTestUser()
    const seFue = await createTestUser()
    await createSeason({ admin, squad: [yo.playerId, seFue.playerId] })
    await deleteAccount(seFue)

    const filas = await profile(yo, seFue.playerId)
    expect(filas.map((fila) => [fila.id, fila.has_account])).toEqual([[seFue.playerId, false]])
  })

  it('sólo id, display_name, username y has_account: nunca el user_id', async () => {
    const p = freshPrefix()
    const yo = await createTestUser()
    const otro = await createTestUser()
    await setUsername(otro.playerId, `${p}clav`)

    const [fila] = await profile(yo, otro.playerId)
    expect(Object.keys(fila ?? {}).sort()).toEqual(['display_name', 'has_account', 'id', 'username'])
    expect(JSON.stringify(fila)).not.toContain(otro.userId)
  })
})

describe('perfilDe', () => {
  it('null si no se puede ver, o si el id no es válido', async () => {
    const yo = await createTestUser()
    const extraño = await createTestUser()
    expect(await perfilDe(yo.client, extraño.playerId)).toBeNull()
    expect(await perfilDe(yo.client, 'no-es-un-uuid')).toBeNull()
  })

  it('el tuyo dice que sos vos, sin amistad ni torneos', async () => {
    const yo = await createTestUser()
    await setName(yo.playerId, 'Yo Perfil')
    expect(await perfilDe(yo.client, yo.playerId)).toEqual({
      playerId: yo.playerId,
      displayName: 'Yo Perfil',
      username: null,
      hasAccount: true,
      esVos: true,
      amistad: null,
      torneos: [],
      caraACara: null,
    })
  })

  it('un extraño buscable: sin amistad, sin torneos y sin cara a cara', async () => {
    const p = freshPrefix()
    const yo = await createTestUser()
    const extraño = await createTestUser()
    await setName(extraño.playerId, 'Buscable Pérez')
    await setUsername(extraño.playerId, `${p}perf`)

    expect(await perfilDe(yo.client, extraño.playerId)).toEqual({
      playerId: extraño.playerId,
      displayName: 'Buscable Pérez',
      username: `${p}perf`,
      hasAccount: true,
      esVos: false,
      amistad: { kind: 'none' },
      torneos: [],
      caraACara: null,
    })
  })

  it('los torneos compartidos, el más nuevo primero, con su deporte y su id; no los que no comparten', async () => {
    const admin = await createTestUser()
    const yo = await createTestUser()
    const otro = await createTestUser()
    const viejo = await createSeason({ admin, squad: [yo.playerId, otro.playerId], disciplines: [{ kind: 'FIFA' }] })
    const nuevo = await createSeason({
      admin,
      squad: [yo.playerId, otro.playerId],
      disciplines: [{ kind: 'PADEL' }, { kind: 'TENIS' }],
    })
    const soloSuyo = await createSeason({ admin, squad: [otro.playerId] })
    for (const [seasonId, name, createdAt] of [
      [viejo.seasonId, 'Copa del Jueves', '2026-01-01T00:00:00Z'],
      [nuevo.seasonId, 'Los Pibes del Martes', '2026-06-01T00:00:00Z'],
      [soloSuyo.seasonId, 'Solo Suyo', '2026-09-01T00:00:00Z'],
    ] as const) {
      const { error } = await db().from('seasons').update({ name, created_at: createdAt }).eq('id', seasonId)
      if (error) throw new Error(error.message)
    }

    const perfil = await perfilDe(yo.client, otro.playerId)
    expect(perfil?.torneos).toEqual([
      { seasonId: nuevo.seasonId, name: 'Los Pibes del Martes', sports: ['PADEL', 'TENIS'] },
      { seasonId: viejo.seasonId, name: 'Copa del Jueves', sports: ['FIFA'] },
    ])
    expect(perfil?.amistad).toEqual({ kind: 'none' })
    expect(perfil?.caraACara).toBeNull()
  })

  it('el estado de la amistad: enviado, recibido y amigos con el cara a cara', async () => {
    const yo = await createTestUser()
    const mandado = await createTestUser()
    const pidio = await createTestUser()
    const amigo = await createTestUser()
    await setName(amigo.playerId, 'Amigo Perfil')
    expect(await addFriend(yo.client, mandado.playerId)).toBe('sent')
    expect(await addFriend(pidio.client, yo.playerId)).toBe('sent')
    await friends(yo, amigo)
    await createCasualMatch(yo.client, [rival(amigo.playerId)], fifa('won'))
    await createCasualMatch(yo.client, [rival(amigo.playerId)], fifa('won'))
    await createCasualMatch(yo.client, [rival(amigo.playerId)], fifa('lost'))

    expect((await perfilDe(yo.client, mandado.playerId))?.amistad?.kind).toBe('sent')
    expect((await perfilDe(yo.client, mandado.playerId))?.caraACara).toBeNull()
    const recibido = await perfilDe(yo.client, pidio.playerId)
    expect(recibido?.amistad?.kind).toBe('received')
    expect(recibido?.caraACara).toBeNull()

    const deAmigo = await perfilDe(yo.client, amigo.playerId)
    expect(deAmigo?.amistad?.kind).toBe('friends')
    expect(deAmigo?.caraACara?.contra).toEqual({ won: 2, lost: 1, drew: 0 })
    expect(deAmigo?.caraACara?.juntos).toEqual({ won: 0, lost: 0, drew: 0 })
    expect(deAmigo?.caraACara?.ultimo?.playedOn).toBe('2026-08-30')
  })

  it('quien borró su cuenta: sin amistad posible, con sus torneos', async () => {
    const admin = await createTestUser()
    const yo = await createTestUser()
    const seFue = await createTestUser()
    const torneo = await createSeason({ admin, squad: [yo.playerId, seFue.playerId] })
    await deleteAccount(seFue)

    const perfil = await perfilDe(yo.client, seFue.playerId)
    expect(perfil?.hasAccount).toBe(false)
    expect(perfil?.amistad).toBeNull()
    expect(perfil?.torneos.map((t) => t.seasonId)).toEqual([torneo.seasonId])
  })
})
