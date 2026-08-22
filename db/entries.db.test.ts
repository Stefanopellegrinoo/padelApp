import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@/core'
import { addSquadSeat, removeSeat, renameSeat, unlinkSeat } from './entries'
import {
  closeMatchday,
  createMatchday,
  generatePairs,
  openMatchday,
  saveResult,
  setAttendance,
} from './matchday'
import { entriesOf, seasonHeader, seasonRules } from './read'
import { createSeason, deleteSeason, renameSeason, updateSeasonRules } from './season'
import { adminClient } from './test/admin'
import { createSeason as buildSeasonScene } from './test/factories'
import { createTestUser, type TestUser } from './test/users'

// ── scaffolding local a este archivo ────────────────────────────────────────

function squadNames(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `Jugador ${index + 1}`)
}

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

async function seasonExists(seasonId: string): Promise<boolean> {
  const db = adminClient()
  const { data } = await db.from('seasons').select('id').eq('id', seasonId).maybeSingle()
  return data !== null
}

async function seasonCountOf(userId: string): Promise<number> {
  const db = adminClient()
  const { count, error } = await db
    .from('seasons')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', userId)
  if (error) throw new Error(error.message)
  return count ?? 0
}

/** Una temporada jugada y cerrada: es el escenario donde sacar a alguien tiene que fallar. */
async function seasonWithHistory(): Promise<{ admin: TestUser; seasonId: string; squad: string[] }> {
  const admin = await createTestUser()
  const players = await fillerPlayers(8)
  const config = { ...defaultConfig(8), regularMatchdays: 1, countBestOf: 1 }
  const { seasonId, entryIds } = await buildSeasonScene({ admin, config, squad: players })

  const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05')
  for (const entryId of entryIds) {
    await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
  }
  await generatePairs(admin.client, matchdayId)
  await openMatchday(admin.client, matchdayId)

  const db = adminClient()
  const { data: matches } = await db.from('matches').select('id').eq('matchday_id', matchdayId)
  for (const match of matches ?? []) {
    await saveResult(admin.client, match.id, [{ gamesA: 4, gamesB: 0 }])
  }
  await closeMatchday(admin.client, matchdayId)

  return { admin, seasonId, squad: entryIds }
}

// ── createSeason ────────────────────────────────────────────────────────────

describe('createSeason', () => {
  it('leaves the season in SETUP with one seat per name, in the order they came', async () => {
    const admin = await createTestUser()
    const names = ['Marce', 'Nico', 'Gastón', 'Juanma', 'Seba', 'Pablo', 'Fede', 'Diego']

    const { seasonId } = await createSeason(admin.client, {
      name: 'Los Jueves 2026',
      squadNames: names,
      config: defaultConfig(8),
    })

    const header = await seasonHeader(admin.client, seasonId)
    expect(header.status).toBe('SETUP')
    expect(header.name).toBe('Los Jueves 2026')
    expect(header.isAdmin).toBe(true)

    const seats = (await entriesOf(admin.client, seasonId))
      .filter((entry) => entry.kind === 'SQUAD')
      .sort((left, right) => left.seedPosition - right.seedPosition)

    //El orden es el contrato: de acá sale el snapshot 0, o sea las primeras
    // parejas del año. `toContain` diría "están" y no "en qué lugar".
    expect(seats.map((seat) => seat.displayName)).toEqual(names)
    expect(seats.map((seat) => seat.seedPosition)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(seats.every((seat) => seat.playerId === null)).toBe(true)
  })

  //Antes, sólo `db/squad-position.db.test.ts` ejercitaba
  // este backfill de rebote (removerlo tumbaba 1 test AJENO sobre posiciones
  // de plantel, sin afirmar nada sobre createSeason en sí). `createMatchday`
  // depende de esta disciplina para resolver `discipline_id` (0015/0016):
  // sin ella, la primera fecha de cualquier torneo nuevo rompe con "No se
  // pudo leer la disciplina de la temporada."
  it('crea su propia disciplina PADEL con la config de la temporada', async () => {
    const admin = await createTestUser()
    const config = defaultConfig(8)

    const { seasonId } = await createSeason(admin.client, {
      name: 'Los Jueves 2026',
      squadNames: ['Marce', 'Nico', 'Gastón', 'Juanma', 'Seba', 'Pablo', 'Fede', 'Diego'],
      config,
    })

    const db = adminClient()
    const { data, error } = await db
      .from('disciplines')
      .select('kind, status, config')
      .eq('season_id', seasonId)
    if (error) throw new Error(error.message)

    expect(data).toHaveLength(1)
    expect(data?.[0]?.kind).toBe('PADEL')
    expect(data?.[0]?.status).toBe('SETUP')
    expect(data?.[0]?.config).toEqual(config)
  })

  // C35 (verify-report-go-no-go #4034): `seasons.config` es la columna que el
  // CONTRACT va a dropear, y `createSeason` era su único escritor de
  // producción — `disciplines.config` (arriba) es la fuente real desde PR 5.
  // `not null` sin default: sin la migración que la relaja, este insert ni
  // arrancaría sin la columna.
  it('no escribe seasons.config — es la columna que el CONTRACT va a dropear (C35, #4034)', async () => {
    const admin = await createTestUser()

    const { seasonId } = await createSeason(admin.client, {
      name: 'Sin escritor de seasons.config',
      squadNames: squadNames(8),
      config: defaultConfig(8),
    })

    const db = adminClient()
    const { data, error } = await db.from('seasons').select('config').eq('id', seasonId).single()
    if (error || data === null) throw new Error(error?.message)
    expect(data.config).toBeNull()
  })

  // El que arma el torneo casi siempre lo juega. El asiento propio se reclama
  // en el mismo insert del plantel, así que lo que hay que probar es que cae en
  // el asiento QUE ELIGIÓ y en ninguno más — errarle por uno lo ata al lugar de
  // otra persona, y eso recién se nota cuando el torneo ya está armado.
  it('seats the creator on the seat they picked', async () => {
    const admin = await createTestUser()
    const names = ['Marce', 'Nico', 'Gastón', 'Juanma', 'Seba', 'Pablo', 'Fede', 'Diego']

    const { seasonId } = await createSeason(admin.client, {
      name: 'Los Jueves 2026',
      squadNames: names,
      config: defaultConfig(8),
      mySeatIndex: 3,
    })

    const seats = (await entriesOf(admin.client, seasonId))
      .filter((entry) => entry.kind === 'SQUAD')
      .sort((left, right) => left.seedPosition - right.seedPosition)

    expect(seats[3]?.displayName).toBe('Juanma')
    expect(seats[3]?.playerId).toBe(admin.playerId)
    expect(seats.filter((seat) => seat.playerId !== null)).toHaveLength(1)
  })

  it('leaves every seat free when the creator only organises', async () => {
    const admin = await createTestUser()

    const { seasonId } = await createSeason(admin.client, {
      name: 'Los Jueves 2026',
      squadNames: squadNames(8),
      config: defaultConfig(8),
      mySeatIndex: null,
    })

    const seats = await entriesOf(admin.client, seasonId)
    expect(seats.every((seat) => seat.playerId === null)).toBe(true)
  })

  // Quien organiza y juega ya ocupó su asiento, así que el resto lo tiene que
  // ver tomado: si `season_invite` lo ofreciera, dos personas terminarían
  // peleándose un lugar que ya tiene dueño.
  it('shows the creator seat as taken on the join screen', async () => {
    const admin = await createTestUser()
    const other = await createTestUser()

    const { inviteToken } = await createSeason(admin.client, {
      name: 'Los Jueves 2026',
      squadNames: squadNames(8),
      config: defaultConfig(8),
      mySeatIndex: 0,
    })

    const { data } = await other.client.rpc('season_invite', { p_token: inviteToken })
    expect(data?.filter((seat) => seat.claimed)).toHaveLength(1)
    expect(data?.find((seat) => seat.seed_position === 0)?.claimed).toBe(true)
  })

  it('refuses a seat that is not in the squad, without writing anything', async () => {
    const admin = await createTestUser()

    await expect(
      createSeason(admin.client, {
        name: 'Los Jueves 2026',
        squadNames: squadNames(8),
        config: defaultConfig(8),
        mySeatIndex: 8,
      }),
    ).rejects.toThrow(/no está en el plantel/)

    expect(await seasonCountOf(admin.userId)).toBe(0)
  })

  it('returns an invite token the join screen can resolve', async () => {
    const admin = await createTestUser()
    const { inviteToken } = await createSeason(admin.client, {
      name: 'Los Jueves 2026',
      squadNames: squadNames(8),
      config: defaultConfig(8),
    })

    const { data, error } = await admin.client.rpc('season_invite', { p_token: inviteToken })
    expect(error).toBeNull()
    expect(data).toHaveLength(8)
  })

  it('writes nothing at all when the config is invalid', async () => {
    const admin = await createTestUser()
    const broken = { ...defaultConfig(8), points: [10, 10, 5, 3] }

    await expect(
      createSeason(admin.client, {
        name: 'Los Jueves 2026',
        squadNames: squadNames(8),
        config: broken,
      }),
    ).rejects.toThrow(/mayor a menor/)

    expect(await seasonCountOf(admin.userId)).toBe(0)
  })

  it('refuses a squad whose size does not match the config', async () => {
    const admin = await createTestUser()

    await expect(
      createSeason(admin.client, {
        name: 'Los Jueves 2026',
        squadNames: squadNames(9),
        config: defaultConfig(8),
      }),
    ).rejects.toThrow(/9 nombres/)

    expect(await seasonCountOf(admin.userId)).toBe(0)
  })

  // Una temporada sin asientos no se arregla desde ninguna pantalla: Ajustes
  // necesita el plantel para dibujarse, y la fila queda para siempre en la lista.
  it('rolls the season back when the squad cannot be written', async () => {
    const admin = await createTestUser()
    const names = [...squadNames(7), '   ']

    await expect(
      createSeason(admin.client, {
        name: 'Los Jueves 2026',
        squadNames: names,
        config: defaultConfig(8),
      }),
    ).rejects.toThrow(/Falta un nombre del plantel/)

    expect(await seasonCountOf(admin.userId)).toBe(0)
  })
})

// ── renameSeason y updateSeasonRules ────────────────────────────────────────

describe('renameSeason', () => {
  it('changes the name and refuses an empty one', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason(admin.client, {
      name: 'Los Jueves',
      squadNames: squadNames(8),
      config: defaultConfig(8),
    })

    await renameSeason(admin.client, seasonId, 'Los Jueves 2026')
    expect((await seasonHeader(admin.client, seasonId)).name).toBe('Los Jueves 2026')

    await expect(renameSeason(admin.client, seasonId, '  ')).rejects.toThrow(/necesita un nombre/)
  })
})

describe('updateSeasonRules', () => {
  it('stores the text and stamps when it changed', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason(admin.client, {
      name: 'Los Jueves 2026',
      squadNames: squadNames(8),
      config: defaultConfig(8),
    })
    expect((await seasonRules(admin.client, seasonId)).updatedAt).toBeNull()

    await updateSeasonRules(admin.client, seasonId, 'Cancha 3, 20:30. Las pelotas las trae el último.')

    const rules = await seasonRules(admin.client, seasonId)
    expect(rules.text).toContain('Cancha 3')
    expect(rules.updatedAt).not.toBeNull()
  })
})

// ── db/entries.ts ───────────────────────────────────────────────────────────

describe('the squad seats', () => {
  it('adds a seat after the last one in the seed order', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason(admin.client, {
      name: 'Los Jueves 2026',
      squadNames: squadNames(8),
      config: defaultConfig(8),
    })

    const newId = await addSquadSeat(admin.client, seasonId, 'El Nueve')

    const seats = (await entriesOf(admin.client, seasonId)).filter((e) => e.kind === 'SQUAD')
    expect(seats).toHaveLength(9)
    expect(seats.find((seat) => seat.id === newId)?.seedPosition).toBe(8)
  })

  it('renames a seat without releasing whoever claimed it', async () => {
    const player = await createTestUser()
    const admin = await createTestUser()
    const filler = await fillerPlayers(7)
    const { seasonId, entryIds } = await buildSeasonScene({
      admin,
      squad: [player.playerId, ...filler],
    })

    await renameSeat(admin.client, entryIds[0]!, 'Marce')

    const seat = (await entriesOf(admin.client, seasonId)).find((e) => e.id === entryIds[0])
    expect(seat?.displayName).toBe('Marce')
    expect(seat?.playerId).toBe(player.playerId)
  })

  it('unlinks a claim and keeps the name', async () => {
    const player = await createTestUser()
    const admin = await createTestUser()
    const filler = await fillerPlayers(7)
    const { seasonId, entryIds } = await buildSeasonScene({
      admin,
      squad: [player.playerId, ...filler],
    })

    await unlinkSeat(admin.client, entryIds[0]!)

    const seat = (await entriesOf(admin.client, seasonId)).find((e) => e.id === entryIds[0])
    expect(seat?.playerId).toBeNull()
    expect(seat?.displayName).not.toBe('')
  })

  it('removes a seat that never played', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason(admin.client, {
      name: 'Los Jueves 2026',
      squadNames: squadNames(8),
      config: defaultConfig(8),
    })
    const newId = await addSquadSeat(admin.client, seasonId, 'El Nueve')

    await removeSeat(admin.client, newId)

    expect((await entriesOf(admin.client, seasonId)).filter((e) => e.kind === 'SQUAD')).toHaveLength(8)
  })

  // Spec 2.9: las fechas cerradas no se alteran nunca. Sacar a alguien que ya
  // jugó dejaría sus awards y sus parejas colgados.
  it('refuses to remove a seat that already has history, and the award survives', async () => {
    const { admin, seasonId, squad } = await seasonWithHistory()

    await expect(removeSeat(admin.client, squad[0]!)).rejects.toThrow(/ya jugó alguna fecha/)

    const db = adminClient()
    const { count } = await db
      .from('awards')
      .select('id', { count: 'exact', head: true })
      .eq('entry_id', squad[0]!)
    expect(count).toBe(1)
    expect((await entriesOf(admin.client, seasonId)).some((e) => e.id === squad[0])).toBe(true)
  })

  it('lets nobody but the admin touch the seats', async () => {
    const player = await createTestUser()
    const admin = await createTestUser()
    const filler = await fillerPlayers(7)
    const { seasonId, entryIds } = await buildSeasonScene({
      admin,
      squad: [player.playerId, ...filler],
    })
    const seatId = entryIds[1]!

    await expect(addSquadSeat(player.client, seasonId, 'Colado')).rejects.toThrow()

    //ANTES estas dos no tiraban. Un update que
    // RLS filtra no afecta ninguna fila y eso NO es un error en PostgREST, así
    // que a quien no organiza se le decía que guardó y al recargar volvía el
    // valor viejo. Con `count: 'exact'` avisan, que es lo que la pantalla
    // necesita para no mentir.
    await expect(renameSeat(player.client, seatId, 'Robado')).rejects.toThrow(
      /sólo puede hacerlo quien organiza/,
    )
    await expect(unlinkSeat(player.client, entryIds[0]!)).rejects.toThrow(
      /sólo puede hacerlo quien organiza/,
    )
    //Nota: `removeSeat` es un DELETE y sigue sin avisar — mismo defecto,
    // no medido por la ronda 15 (que nombró cuatro updates). Se deja como
    // estaba en vez de cambiarlo a ojo; el estado de abajo prueba que tampoco
    // borra nada.
    await removeSeat(player.client, seatId)

    const seats = await entriesOf(admin.client, seasonId)
    expect(seats.filter((e) => e.kind === 'SQUAD')).toHaveLength(8)
    expect(seats.find((e) => e.id === seatId)?.displayName).not.toBe('Robado')
    expect(seats.find((e) => e.id === entryIds[0])?.playerId).toBe(player.playerId)
  })
})


// Borrar el torneo es lo más destructivo que hace la app: no hay papelera ni
// forma de deshacerlo. Se prueba sobre una temporada JUGADA, que es el caso que
// puede fallar — `awards.entry_id` y `pair_locks` referencian `entries` con
// `on delete no action`, y a simple vista eso frenaría la cascada.
describe('deleteSeason', () => {
  it('takes the whole season with it, history included', async () => {
    const { admin, seasonId } = await seasonWithHistory()
    const db = adminClient()

    const before = await db
      .from('awards')
      .select('id, matchdays!inner(season_id)', { count: 'exact', head: true })
      .eq('matchdays.season_id', seasonId)
    expect(before.count ?? 0).toBeGreaterThan(0)

    await deleteSeason(admin.client, seasonId)

    expect(await seasonExists(seasonId)).toBe(false)
    for (const table of ['matchdays', 'entries', 'pair_locks'] as const) {
      const { count } = await db
        .from(table)
        .select('*', { count: 'exact', head: true })
        .eq('season_id', seasonId)
      expect(count, `quedaron filas en ${table}`).toBe(0)
    }
  })

  // Sin el `count`, PostgREST devuelve "todo bien" cuando RLS filtró la fila:
  // el jugador vería su torneo desaparecer de la pantalla y volver al recargar.
  it('refuses somebody who is in the season but did not create it', async () => {
    const { seasonId, squad } = await seasonWithHistory()
    const intruder = await createTestUser()
    const [firstSeat] = squad
    if (firstSeat === undefined) throw new Error('Falta el asiento de test.')
    await adminClient().from('entries').update({ player_id: intruder.playerId }).eq('id', firstSeat)

    await expect(deleteSeason(intruder.client, seasonId)).rejects.toThrow(/sólo puede hacerlo quien lo creó/)

    expect(await seasonExists(seasonId)).toBe(true)
  })

  it('refuses a stranger with no seat at all', async () => {
    const { seasonId } = await seasonWithHistory()
    const stranger = await createTestUser()

    await expect(deleteSeason(stranger.client, seasonId)).rejects.toThrow(/sólo puede hacerlo quien lo creó/)

    expect(await seasonExists(seasonId)).toBe(true)
  })
})

// ── C37: entriesOf sin disciplina resoluble ─────────────────────────────────
// La rama `effectiveDisciplineId === null` de `entriesOf` usaba
// `entries.seed_position` para TODO el plantel — la última lectura de esa
// columna para el SQUAD, que el contract relaja a `null`. Devolvía `null` en
// un campo tipado `number`.
//
// La rama NO tenía un solo testigo: medido borrándola entera, la suite
// quedaba en 425/425. Éste es el que le faltaba, y el que fija que el fallback
// no puede perder a nadie — es lo único que separa "no hay orden que dar" de
// "el plantel desapareció de la pantalla".
describe('entriesOf sin disciplina resoluble (C37)', () => {
  it('devuelve el plantel entero con un orden propio, sin leer entries.seed_position', async () => {
    const admin = await createTestUser()
    const { seasonId, entryIds, disciplineIds } = await buildSeasonScene({
      admin,
      squad: await fillerPlayers(4),
    })
    const [disciplineId] = disciplineIds
    if (disciplineId === undefined || entryIds.length !== 4) throw new Error('La escena no se armó.')

    // `entries.seed_position` miente a propósito: si la rama la sigue
    // leyendo, los `seedPosition` salen 10,20,30,40 en vez de 0,1,2,3.
    const db = adminClient()
    for (const [index, entryId] of entryIds.entries()) {
      const { error } = await db
        .from('entries')
        .update({ seed_position: (index + 1) * 10 })
        .eq('id', entryId)
      if (error) throw new Error(error.message)
    }

    // Sin disciplina, `defaultDisciplineId` da `null` — el caso que la rama
    // dice cubrir. `discipline_entries` cascadea con ella.
    const { error: deleteError } = await db.from('disciplines').delete().eq('id', disciplineId)
    if (deleteError) throw new Error(deleteError.message)

    const seats = await entriesOf(admin.client, seasonId)
    expect(seats).toHaveLength(4)
    expect(seats.map((seat) => seat.seedPosition)).toEqual([0, 1, 2, 3])
  })
})
