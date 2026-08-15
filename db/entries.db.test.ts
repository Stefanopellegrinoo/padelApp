import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@/core'
import { addSquadSeat, removeSeat, renameSeat, unlinkSeat } from './entries'
import {
  addGuest,
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

    // El orden es el contrato: de acá sale el snapshot 0, o sea las primeras
    // parejas del año. `toContain` diría "están" y no "en qué lugar".
    expect(seats.map((seat) => seat.displayName)).toEqual(names)
    expect(seats.map((seat) => seat.seedPosition)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(seats.every((seat) => seat.playerId === null)).toBe(true)
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
    // Un update o un delete que RLS filtra no es un error: no afecta ninguna
    // fila. Por eso se asierta sobre el estado, no sobre el throw.
    await renameSeat(player.client, seatId, 'Robado')
    await unlinkSeat(player.client, entryIds[0]!)
    await removeSeat(player.client, seatId)

    const seats = await entriesOf(admin.client, seasonId)
    expect(seats.filter((e) => e.kind === 'SQUAD')).toHaveLength(8)
    expect(seats.find((e) => e.id === seatId)?.displayName).not.toBe('Robado')
    expect(seats.find((e) => e.id === entryIds[0])?.playerId).toBe(player.playerId)
  })
})

// Capability 2 (spec: "Ubicar al que llega en el orden de desempate"). El
// caso "al final, sin elegir nada" ya está cubierto arriba por "adds a seat
// after the last one in the seed order" — ese test llama a `addSquadSeat` con
// el cuarto argumento omitido, que es exactamente el default `null`, así que
// duplicarlo acá no suma cobertura (ponytail: reuse, no lo repito).
/**
 * SQL crudo contra la Postgres local, adentro del contenedor del stack de
 * Supabase (`supabase_db_<project_id>`; el project_id es "padelApp", vive en
 * supabase/config.toml — si alguien lo cambia, esto revienta ruidosamente, que
 * es lo que corresponde).
 *
 * Existe por una sola razón: tocar los GUCs del planner. PostgREST no expone
 * `set`, y supabase-js habla PostgREST, así que desde el cliente de test NO se
 * puede elegir el plan. Y sin elegir el plan no se puede escribir el test de
 * regresión de abajo.
 *
 * Va por `docker exec` y no por un `psql` del host a propósito: el stack local
 * ya exige Docker, un cliente de Postgres instalado en la máquina no. Y por
 * construcción pega contra el contenedor local, así que no hay forma de que se
 * escape a una base real ni salteándose `db/test/env.ts`.
 */
function localSql(sql: string): string {
  return execFileSync(
    'docker',
    [
      'exec', '-i', 'supabase_db_padelApp',
      'psql', '-U', 'postgres', '-d', 'postgres',
      '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-',
    ],
    { input: sql, encoding: 'utf8' },
  )
}

/** El plantel de la temporada, leído en orden de seed. */
async function squadInSeedOrder(user: TestUser, seasonId: string) {
  return (await entriesOf(user.client, seasonId))
    .filter((entry) => entry.kind === 'SQUAD')
    .sort((left, right) => left.seedPosition - right.seedPosition)
}

describe('addSquadSeat colocando el nuevo asiento (spec 2.1, 2.2, 2.4, 2.5, 2.6)', () => {
  it('insertar antes de un asiento corre la cola +1 sin tocar el orden relativo de los demás', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason(admin.client, {
      name: 'Los Jueves 2026',
      squadNames: squadNames(8),
      config: defaultConfig(8),
    })
    const before = (await entriesOf(admin.client, seasonId))
      .filter((e) => e.kind === 'SQUAD')
      .sort((a, b) => a.seedPosition - b.seedPosition)

    // "Antes de" el 3er asiento (índice 2, seed_position 2 con seed 0-index).
    const target = before[2]
    if (target === undefined) throw new Error('Falta el asiento de test.')

    const newId = await addSquadSeat(admin.client, seasonId, 'El Nuevo', target.id)

    const after = (await entriesOf(admin.client, seasonId))
      .filter((e) => e.kind === 'SQUAD')
      .sort((a, b) => a.seedPosition - b.seedPosition)

    // El nuevo cae exactamente donde estaba `target`, que ahora es el siguiente.
    const expectedNames = before.map((e) => e.displayName)
    expectedNames.splice(2, 0, 'El Nuevo')
    expect(after.map((e) => e.displayName)).toEqual(expectedNames)
    expect(after.find((e) => e.id === newId)?.seedPosition).toBe(2)

    // Spec 2.2: el orden relativo entre los 8 preexistentes no cambió — nadie
    // saltó por encima de nadie, sólo se corrieron un lugar.
    expect(after.filter((e) => e.id !== newId).map((e) => e.id)).toEqual(before.map((e) => e.id))

    // Spec 2.4: no queda ni un hueco ni un duplicado en seed_position — el
    // corrimiento de dos pasadas (parking) es atómico adentro de la función.
    expect(after.map((e) => e.seedPosition)).toEqual(Array.from({ length: 9 }, (_, i) => i))
  })

  it('insertar antes del primero deja al nuevo en la punta (p_from = 0)', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason(admin.client, {
      name: 'Los Jueves 2026',
      squadNames: squadNames(8),
      config: defaultConfig(8),
    })
    const before = await squadInSeedOrder(admin, seasonId)
    const first = before[0]
    if (first === undefined) throw new Error('Falta el asiento de test.')

    const newId = await addSquadSeat(admin.client, seasonId, 'El Primero', first.id)

    const after = await squadInSeedOrder(admin, seasonId)
    expect(after.map((e) => e.displayName)).toEqual(['El Primero', ...before.map((e) => e.displayName)])
    expect(after.find((e) => e.id === newId)?.seedPosition).toBe(0)
    expect(after.map((e) => e.seedPosition)).toEqual(Array.from({ length: 9 }, (_, i) => i))
  })

  it('insertar antes del último asiento corre sólo al último', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason(admin.client, {
      name: 'Los Jueves 2026',
      squadNames: squadNames(8),
      config: defaultConfig(8),
    })
    const before = await squadInSeedOrder(admin, seasonId)
    const last = before[before.length - 1]
    if (last === undefined) throw new Error('Falta el asiento de test.')

    const newId = await addSquadSeat(admin.client, seasonId, 'El Penúltimo', last.id)

    const after = await squadInSeedOrder(admin, seasonId)
    const expectedNames = before.map((e) => e.displayName)
    expectedNames.splice(before.length - 1, 0, 'El Penúltimo')
    expect(after.map((e) => e.displayName)).toEqual(expectedNames)
    expect(after.find((e) => e.id === newId)?.seedPosition).toBe(7)
    expect(after.find((e) => e.id === last.id)?.seedPosition).toBe(8)
    expect(after.map((e) => e.seedPosition)).toEqual(Array.from({ length: 9 }, (_, i) => i))
  })

  // Este es el caso que justifica que `p_before` sea un uuid y no un entero
  // (0013_squad_seat_position.sql): con huecos, "posición 4" no quiere decir
  // nada, pero "antes de Jugador 5" sigue queriendo decir exactamente eso. El
  // hueco que dejó `removeSeat` tiene que SOBREVIVIR al alta: renumerarlo sería
  // reescribir el orden de desempate inicial de todo el plantel.
  it('inserta en un plantel con huecos de removeSeat sin renumerar ni tapar el hueco', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason(admin.client, {
      name: 'Los Jueves 2026',
      squadNames: squadNames(8),
      config: defaultConfig(8),
    })
    const original = await squadInSeedOrder(admin, seasonId)
    const removed = original[2]
    const target = original[4]
    if (removed === undefined || target === undefined) throw new Error('Faltan asientos de test.')

    await removeSeat(admin.client, removed.id)
    const withHole = await squadInSeedOrder(admin, seasonId)
    expect(withHole.map((e) => e.seedPosition)).toEqual([0, 1, 3, 4, 5, 6, 7])

    const newId = await addSquadSeat(admin.client, seasonId, 'El Nuevo', target.id)

    const after = await squadInSeedOrder(admin, seasonId)
    // El hueco en 2 sigue ahí; sólo se corrió la cola desde 4 para arriba.
    expect(after.map((e) => e.seedPosition)).toEqual([0, 1, 3, 4, 5, 6, 7, 8])
    expect(after.find((e) => e.id === newId)?.seedPosition).toBe(4)
    expect(after.map((e) => e.displayName)).toEqual([
      'Jugador 1', 'Jugador 2', 'Jugador 4', 'El Nuevo',
      'Jugador 5', 'Jugador 6', 'Jugador 7', 'Jugador 8',
    ])
    // Ningún preexistente se pasó por encima de otro.
    expect(after.filter((e) => e.id !== newId).map((e) => e.id)).toEqual(withHole.map((e) => e.id))
  })

  // ── regresión del `+1` ────────────────────────────────────────────────────
  // El corrimiento con `v_park = max + 1` chocaba consigo mismo en un ÚNICO
  // caso: `p_from = 0`, en la posición M+1, y sólo si el motor visitaba esa
  // fila antes que la que estaba parkeada ahí. O sea: dependía del plan.
  //
  // Por eso un test de "insertar en 0" a secas no sirve como regresión. Con la
  // tabla `entries` cargada —y para cuando corre esta suite tiene más de mil
  // filas— el planner elige Index Scan, que sube por seed_position y esquiva el
  // choque de casualidad. El test daría verde acá y rojo en un deploy nuevo con
  // 8 asientos. Así que acá se fuerzan las DOS condiciones adversas a mano: el
  // heap al revés y el Seq Scan.
  //
  // Con el `+2` los rangos quedan disjuntos para todo `p_from` y el orden de
  // visita deja de importar — pero el test se queda igual, porque es el único
  // que distingue "está arreglado" de "el planner me está tapando el bug".
  it('corre la cola desde 0 aunque el motor recorra las filas al revés (Seq Scan, heap descendente)', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason(admin.client, {
      name: 'Los Jueves 2026',
      squadNames: squadNames(8),
      config: defaultConfig(8),
    })

    // `createSeason` inserta los asientos en orden ascendente, y con ese heap
    // hasta un Seq Scan recorre de 0 para arriba. Se rearma al revés: la fila
    // de seed_position 7 se escribe PRIMERO.
    const db = adminClient()
    await db.from('entries').delete().eq('season_id', seasonId).eq('kind', 'SQUAD')
    const { error: seedError } = await db.from('entries').insert(
      [7, 6, 5, 4, 3, 2, 1, 0].map((position) => ({
        season_id: seasonId,
        kind: 'SQUAD' as const,
        display_name: `J${position}`,
        seed_position: position,
      })),
    )
    if (seedError !== null) throw new Error(seedError.message)

    // Que el heap QUEDÓ al revés no se asume: si el insert múltiple dejara de
    // escribir en el orden del array, este test seguiría en verde sin probar
    // nada. `ctid` es el orden físico, que es el que recorre un Seq Scan.
    const heap = localSql(
      `select seed_position from public.entries
        where season_id = '${seasonId}' and kind = 'SQUAD' order by ctid;`,
    )
      .trim()
      .split('\n')
      .map(Number)
    expect(heap).toEqual([7, 6, 5, 4, 3, 2, 1, 0])

    // Los GUCs y el corrimiento viajan en la MISMA sesión: sin index scan ni
    // bitmap scan, al motor no le queda otra que el Seq Scan. El `explain` es
    // el mismo UPDATE que corre la pasada 2 y está para que, si algún día el
    // plan dejara de ser Seq Scan, el test lo diga en vez de pasar de arriba.
    const output = localSql(`
      set enable_indexscan = off;
      set enable_bitmapscan = off;
      explain (costs off) update public.entries set seed_position = seed_position - 9
       where season_id = '${seasonId}' and kind = 'SQUAD' and seed_position >= 9;
      select public.shift_seeds_up('${seasonId}'::uuid, 0);
    `)
    expect(output).toContain('Seq Scan on entries')

    const after = await squadInSeedOrder(admin, seasonId)
    expect(after.map((e) => e.seedPosition)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(after.map((e) => e.displayName)).toEqual(['J0', 'J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'J7'])
  })

  it('rechaza un p_before que no es un asiento SQUAD de esta temporada, y no mueve nada', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason(admin.client, {
      name: 'Los Jueves 2026',
      squadNames: squadNames(8),
      config: defaultConfig(8),
    })
    const before = (await entriesOf(admin.client, seasonId)).filter((e) => e.kind === 'SQUAD')

    // Caso 1: un uuid que no existe en absoluto.
    await expect(
      addSquadSeat(admin.client, seasonId, 'Nuevo', '00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow(/no está en el plantel/)

    // Caso 2: un asiento real, pero de OTRA temporada.
    const otherAdmin = await createTestUser()
    const { seasonId: otherSeasonId } = await createSeason(otherAdmin.client, {
      name: 'Otra temporada',
      squadNames: squadNames(8),
      config: defaultConfig(8),
    })
    const foreignSeat = (await entriesOf(otherAdmin.client, otherSeasonId)).find((e) => e.kind === 'SQUAD')
    if (foreignSeat === undefined) throw new Error('Falta el asiento ajeno de test.')
    await expect(addSquadSeat(admin.client, seasonId, 'Nuevo', foreignSeat.id)).rejects.toThrow(
      /no está en el plantel/,
    )

    // Caso 3: un entry real de ESTA temporada, pero GUEST — no SQUAD.
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    const guestId = await addGuest(admin.client, matchdayId, { displayName: 'Invitado' })
    await expect(addSquadSeat(admin.client, seasonId, 'Nuevo', guestId)).rejects.toThrow(
      /no está en el plantel/,
    )

    // Ninguno de los tres intentos movió ni agregó nada al plantel.
    expect((await entriesOf(admin.client, seasonId)).filter((e) => e.kind === 'SQUAD')).toEqual(before)
  })

  it('sólo el admin puede elegir dónde cae el nuevo asiento', async () => {
    const player = await createTestUser()
    const admin = await createTestUser()
    const filler = await fillerPlayers(4)
    const { seasonId, entryIds } = await buildSeasonScene({
      admin,
      squad: [player.playerId, ...filler],
    })

    await expect(addSquadSeat(player.client, seasonId, 'Colado', entryIds[1]!)).rejects.toThrow(
      /Sólo quien organiza/,
    )

    expect((await entriesOf(admin.client, seasonId)).filter((e) => e.kind === 'SQUAD')).toHaveLength(5)
  })

  // Decisión de diseño 3: `shift_seeds_up` es una función plana sin ningún
  // grant — ni a `authenticated` — porque sus únicas llamadoras son funciones
  // `security definer` que ya validaron admin. Si esto alguna vez apareciera
  // llamable por RPC, cualquier autenticado podría correr el plantel de
  // CUALQUIER temporada sin pasar por `is_season_admin`.
  it('shift_seeds_up no es alcanzable por RPC: nadie tiene el grant', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason(admin.client, {
      name: 'Los Jueves 2026',
      squadNames: squadNames(8),
      config: defaultConfig(8),
    })

    const { data, error } = await admin.client.rpc('shift_seeds_up', { p_season: seasonId, p_from: 2 })

    expect(data).toBeNull()
    expect(error?.code).toBe('42501')
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
