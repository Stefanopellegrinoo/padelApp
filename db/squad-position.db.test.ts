import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@/core'
import { addSquadSeat, removeSeat } from './entries'
import { addGuest, createMatchday } from './matchday'
import { entriesOf } from './read'
import { createSeason, defaultDisciplineId, squadSeedOrder } from './season'
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

// Capability 2 (spec: "Ubicar al que llega en el orden de desempate"). Vive en
// su propio archivo y no en `db/entries.db.test.ts`: sumarle estos tests lo
// dejaba en 746 líneas contra un techo de 800 (200-400 típico), y
// esta capability es un `describe` autocontenido con su propio scaffolding.
//
// El caso "al final, sin elegir nada" NO se repite acá: ya está cubierto en
// `db/entries.db.test.ts` por "adds a seat after the last one in the seed
// order", que llama a `addSquadSeat` con el cuarto argumento omitido, o sea
// exactamente el default `null` (es reuse, no lo repito).
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

/**
 * El plantel de la temporada, en el orden que devuelve `entriesOf` (el lector
 * de producción): desde C6 es el mismo orden que
 * `discipline_entries` para SQUAD, no el dual-write de `entries.seed_position`.
 */
async function squadInSeedOrder(user: TestUser, seasonId: string) {
  return (await entriesOf(user.client, seasonId))
    .filter((entry) => entry.kind === 'SQUAD')
    .sort((left, right) => left.seedPosition - right.seedPosition)
}

/**
 * El plantel de UNA disciplina, en orden de `discipline_entries.seed_position`
 * — la fuente REAL del orden desde PR 7 (0023_discipline_entries.sql):
 * `shift_seeds_up`/`add_squad_seat` ya no corren el parking sobre `entries`,
 * así que las pruebas de posicionamiento tienen que mirar acá, no en
 * `squadInSeedOrder`.
 */
async function disciplineSeedOrder(
  seasonId: string,
): Promise<Array<{ id: string; displayName: string; seedPosition: number }>> {
  const db = adminClient()
  const disciplineId = await defaultDisciplineId(db, seasonId)
  if (disciplineId === null) throw new Error('La temporada no tiene disciplina.')

  const { data: seats, error: seatsError } = await db
    .from('discipline_entries')
    .select('entry_id, seed_position')
    .eq('discipline_id', disciplineId)
    .order('seed_position', { ascending: true })
  if (seatsError) throw new Error(seatsError.message)

  const { data: entryRows, error: entriesError } = await db
    .from('entries')
    .select('id, display_name')
    .in(
      'id',
      (seats ?? []).map((seat) => seat.entry_id),
    )
  if (entriesError) throw new Error(entriesError.message)
  const nameById = new Map((entryRows ?? []).map((row) => [row.id, row.display_name]))

  return (seats ?? []).map((seat) => ({
    id: seat.entry_id,
    displayName: nameById.get(seat.entry_id) ?? '?',
    seedPosition: seat.seed_position,
  }))
}

describe('addSquadSeat colocando el nuevo asiento (spec 2.1, 2.2, 2.4, 2.5, 2.6)', () => {
  // Desde PR 7 (0023_discipline_entries.sql) el posicionamiento REAL vive en
  // `discipline_entries`, no en `entries`: `shift_seeds_up`/`add_squad_seat`
  // dejaron de correr el parking sobre `entries` (dual-write, siempre al
  // final — ver el test dedicado más abajo). Estos cuatro tests migran su
  // lectura de `squadInSeedOrder`/`entriesOf` a `disciplineSeedOrder`, mismo
  // criterio que documenta 0023: "el test que fuerza el plan adverso migra a
  // discipline_entries en la misma PR".
  it('insertar antes de un asiento corre la cola +1 sin tocar el orden relativo de los demás', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason(admin.client, {
      name: 'Los Jueves 2026',
      squadNames: squadNames(8),
      config: defaultConfig(8),
    })
    const before = await disciplineSeedOrder(seasonId)

    // "Antes de" el 3er asiento (índice 2, seed_position 2 con seed 0-index).
    const target = before[2]
    if (target === undefined) throw new Error('Falta el asiento de test.')

    const newId = await addSquadSeat(admin.client, seasonId, 'El Nuevo', target.id)

    const after = await disciplineSeedOrder(seasonId)

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
    const before = await disciplineSeedOrder(seasonId)
    const first = before[0]
    if (first === undefined) throw new Error('Falta el asiento de test.')

    const newId = await addSquadSeat(admin.client, seasonId, 'El Primero', first.id)

    const after = await disciplineSeedOrder(seasonId)
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
    const before = await disciplineSeedOrder(seasonId)
    const last = before[before.length - 1]
    if (last === undefined) throw new Error('Falta el asiento de test.')

    const newId = await addSquadSeat(admin.client, seasonId, 'El Penúltimo', last.id)

    const after = await disciplineSeedOrder(seasonId)
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
    const original = await disciplineSeedOrder(seasonId)
    const removed = original[2]
    const target = original[4]
    if (removed === undefined || target === undefined) throw new Error('Faltan asientos de test.')

    await removeSeat(admin.client, removed.id)
    const withHole = await disciplineSeedOrder(seasonId)
    expect(withHole.map((e) => e.seedPosition)).toEqual([0, 1, 3, 4, 5, 6, 7])

    const newId = await addSquadSeat(admin.client, seasonId, 'El Nuevo', target.id)

    const after = await disciplineSeedOrder(seasonId)
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

  //, — `squadSeedOrder` (db/season.ts) es la función
  // que de verdad alimenta el sorteo y el desempate de cada fecha
  // (`matchdayContextFor` -> `snapshotForMatchday`): hasta esta tanda seguía
  // leyendo `entries.seed_position`, que desde PR 7 es dual-write tail-only.
  // El "antes de Juan" de `add_squad_seat` quedaba en no-op para el sorteo
  // aunque `discipline_entries` lo guardara bien.
  it('squadSeedOrder lee discipline_entries: el "antes de" llega al sorteo y al desempate', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason(admin.client, {
      name: 'Los Jueves 2026',
      squadNames: squadNames(8),
      config: defaultConfig(8),
    })
    const disciplineId = await defaultDisciplineId(admin.client, seasonId)
    if (disciplineId === null) throw new Error('La temporada no tiene disciplina.')

    const before = await disciplineSeedOrder(seasonId)
    const target = before[2]
    if (target === undefined) throw new Error('Falta el asiento de test.')

    const newId = await addSquadSeat(admin.client, seasonId, 'El Nuevo', target.id)

    const seedOrder = await squadSeedOrder(admin.client, disciplineId)
    const expectedOrder = (await disciplineSeedOrder(seasonId)).map((seat) => seat.id)
    expect(seedOrder).toEqual(expectedOrder)
    // El nuevo cae en la posición 2 (donde estaba `target`), no al final.
    expect(seedOrder.indexOf(newId)).toBe(2)
  })

  // Complemento del test de arriba, mismo hallazgo (C6, ronda
  // 3), otro lector: `entriesOf` (db/read.ts) es lo que alimenta la pantalla
  // de Plantel (`app/torneo/[id]/ajustes/page.tsx`) y media docena más.
  // Hasta esta tanda seguía devolviendo `entries.seed_position` para SQUAD —
  // dual-write TAIL-ONLY desde PR 7 (0023), que ya no respeta `p_before` — así
  // que el "antes de" quedaba bien guardado en `discipline_entries` y la
  // pantalla lo mostraba igual, siempre al final. Este test reemplaza al que
  // pinneaba esa degradación (`seedPosition === 8`): ahora exige el
  // comportamiento CORRECTO, para que quien vuelva a leer `entries` por
  // accidente lo vea romperse acá.
  it('entriesOf refleja discipline_entries para SQUAD, no el dual-write de entries.seed_position', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason(admin.client, {
      name: 'Los Jueves 2026',
      squadNames: squadNames(8),
      config: defaultConfig(8),
    })
    const before = await squadInSeedOrder(admin, seasonId)
    const target = before[2]
    if (target === undefined) throw new Error('Falta el asiento de test.')

    const newId = await addSquadSeat(admin.client, seasonId, 'El Nuevo', target.id)

    const viaEntriesOf = await squadInSeedOrder(admin, seasonId)
    const viaDisciplineEntries = await disciplineSeedOrder(seasonId)
    // El nuevo cae en la posición 2 (donde estaba `target`), no al final.
    expect(viaEntriesOf.find((e) => e.id === newId)?.seedPosition).toBe(2)
    // El lector de producción coincide EXACTAMENTE con la fuente real —no
    // sólo la posición del nuevo, el orden entero.
    expect(viaEntriesOf.map((e) => ({ id: e.id, seedPosition: e.seedPosition }))).toEqual(
      viaDisciplineEntries.map((e) => ({ id: e.id, seedPosition: e.seedPosition })),
    )
  })

  //,: el fallback `?? row.seed_position` mezclaba dos
  // numeraciones independientes — `entries.seed_position` es de LA TEMPORADA
  // (dual-write tail-only desde PR 7), `discipline_entries.seed_position` es
  // de LA DISCIPLINA — y con solape parcial entre disciplinas producía
  // posiciones colisionadas. Inalcanzable hoy por la UI (una sola disciplina
  // por temporada), pero ya reproducible a mano con `add_squad_seat
  // p_disciplines`, mismo patrón que W6 (attendances-discipline-fk).
  it('entriesOf sin disciplineId explícito no mezcla las dos numeraciones con plantel de solape parcial', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineIds } = await buildSeasonScene({
      admin,
      disciplines: [{ kind: 'PADEL' }, { kind: 'FIFA' }],
    })
    const [padelId, fifaId] = disciplineIds
    if (padelId === undefined || fifaId === undefined) throw new Error('Faltan disciplinas.')

    const seat = async (name: string, disciplineId: string): Promise<string> => {
      const { data, error } = await admin.client.rpc('add_squad_seat', {
        p_season: seasonId,
        p_name: name,
        p_disciplines: [disciplineId],
      })
      if (error !== null || data === null) throw new Error(error?.message)
      return data
    }

    // Dos asientos SÓLO de FIFA primero: se llevan las posiciones 0 y 1 de
    // `entries.seed_position` (temporada) — las mismas que después ocupan los
    // dos primeros de PADEL en `discipline_entries` (disciplina).
    const fifaA = await seat('SoloFIFA-A', fifaId)
    const fifaB = await seat('SoloFIFA-B', fifaId)
    const padel1 = await seat('Padel-1', padelId)
    const padel2 = await seat('Padel-2', padelId)
    const padel3 = await seat('Padel-3', padelId)
    const padel4 = await seat('Padel-4', padelId)

    // PADEL es la default (position 0): `entriesOf(seasonId)` sin id
    // explícito resuelve contra ella.
    const squad = (await entriesOf(admin.client, seasonId)).filter((entry) => entry.kind === 'SQUAD')

    expect(squad.map((entry) => entry.id).sort()).toEqual([padel1, padel2, padel3, padel4].sort())
    expect(squad.find((entry) => entry.id === fifaA)).toBeUndefined()
    expect(squad.find((entry) => entry.id === fifaB)).toBeUndefined()
    const positions = squad.map((entry) => entry.seedPosition)
    expect(new Set(positions).size).toBe(positions.length)
  })

  //,: la pantalla de una fecha necesita el orden de
  // SU disciplina, no el de la default (`entriesOf` la resolvía siempre por
  // dentro, sin forma de que el caller opine). `disciplineId` ahora es un
  // parámetro explícito.
  it('entriesOf con disciplineId explícito devuelve el plantel de ESA disciplina, no el de la default', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineIds } = await buildSeasonScene({
      admin,
      disciplines: [{ kind: 'PADEL' }, { kind: 'FIFA' }],
    })
    const [padelId, fifaId] = disciplineIds
    if (padelId === undefined || fifaId === undefined) throw new Error('Faltan disciplinas.')

    const seat = async (name: string, disciplineId: string): Promise<string> => {
      const { data, error } = await admin.client.rpc('add_squad_seat', {
        p_season: seasonId,
        p_name: name,
        p_disciplines: [disciplineId],
      })
      if (error !== null || data === null) throw new Error(error?.message)
      return data
    }

    const fifaA = await seat('SoloFIFA-A', fifaId)
    const fifaB = await seat('SoloFIFA-B', fifaId)
    await seat('Padel-1', padelId)
    await seat('Padel-2', padelId)

    const fifaSquad = (await entriesOf(admin.client, seasonId, fifaId)).filter((entry) => entry.kind === 'SQUAD')

    expect(fifaSquad.map((entry) => entry.id).sort()).toEqual([fifaA, fifaB].sort())
    expect(fifaSquad.map((entry) => entry.seedPosition).sort((a, b) => a - b)).toEqual([0, 1])
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
  // Migrado a `discipline_entries` en esta misma PR (0023): `shift_seeds_up`
  // ya no toca `entries`, así que forzar el heap adverso tiene que ser sobre
  // la tabla que la función REALMENTE recorre. Reutiliza los 8 asientos que
  // ya creó `createSeason` — sólo se reescriben sus filas de
  // `discipline_entries`, no `entries` — para no inventar entries sueltas que
  // ninguna FK compuesta (entry_id, season_id)/(entry_id, entry_kind) dejaría
  // pasar sin su fila real.
  it('corre la cola desde 0 aunque el motor recorra las filas al revés (Seq Scan, heap descendente)', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason(admin.client, {
      name: 'Los Jueves 2026',
      squadNames: squadNames(8),
      config: defaultConfig(8),
    })
    const db = adminClient()
    const disciplineId = await defaultDisciplineId(db, seasonId)
    if (disciplineId === null) throw new Error('La temporada no tiene disciplina.')

    const original = await disciplineSeedOrder(seasonId)
    expect(original).toHaveLength(8)

    // Se reinserta al revés —el asiento de seed_position 7 primero— para que
    // hasta un Seq Scan recorra el heap de arriba para abajo.
    await db.from('discipline_entries').delete().eq('discipline_id', disciplineId)
    const { error: seedError } = await db.from('discipline_entries').insert(
      [...original].reverse().map((seat) => ({
        discipline_id: disciplineId,
        entry_id: seat.id,
        season_id: seasonId,
        seed_position: seat.seedPosition,
      })),
    )
    if (seedError !== null) throw new Error(seedError.message)

    // Que el heap QUEDÓ al revés no se asume: si el insert múltiple dejara de
    // escribir en el orden del array, este test seguiría en verde sin probar
    // nada. `ctid` es el orden físico, que es el que recorre un Seq Scan.
    const heap = localSql(
      `select seed_position from public.discipline_entries
        where discipline_id = '${disciplineId}' order by ctid;`,
    )
      .trim()
      .split('\n')
      .map(Number)
    expect(heap).toEqual([7, 6, 5, 4, 3, 2, 1, 0])

    // Los GUCs y el corrimiento viajan en la MISMA sesión: sin index scan ni
    // bitmap scan, al motor no le queda otra que el Seq Scan. El `explain` está
    // para que, si algún día el plan dejara de ser Seq Scan, el test lo diga en
    // vez de pasar de arriba.
    //
    // No es literalmente el statement de la pasada 2: con M = 7 la pasada 2
    // resta `v_park - 1` = 8, no 9. Lo que sí es idéntico es el `where`, que es
    // lo único que decide el plan — el `set` de la izquierda del `=` no entra
    // en esa cuenta.
    const output = localSql(`
      set enable_indexscan = off;
      set enable_bitmapscan = off;
      explain (costs off) update public.discipline_entries set seed_position = seed_position - 9
       where discipline_id = '${disciplineId}' and seed_position >= 9;
      select public.shift_seeds_up('${disciplineId}'::uuid, 0);
    `)
    expect(output).toContain('Seq Scan on discipline_entries')

    const after = await disciplineSeedOrder(seasonId)
    expect(after.map((e) => e.seedPosition)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(after.map((e) => e.displayName)).toEqual(original.map((e) => e.displayName))

    // Y el heap TAMBIÉN al final, que es la mitad que faltaba. Lo que hace
    // sensible a este test no es el orden físico de arriba sino el que hay al
    // empezar la PASADA 2: la pasada 1 reescribe las ocho tuplas antes (toca la
    // columna indexada, así que no hay HOT update) y podría dejarlas ascendentes
    // sin que la aserción de arriba se entere. Si eso pasara —un fillfactor
    // distinto, un page split, un cambio de storage de Postgres—, la pasada 2
    // visitaría el 8 antes que el 15, la posición 8 ya estaría libre, el cuerpo
    // con `+1` dejaría de chocar Y ESTE TEST SEGUIRÍA EN VERDE con el CRITICAL
    // de vuelta. Con esta línea, ese día falla acá y se ve.
    const heapAfter = localSql(
      `select seed_position from public.discipline_entries
        where discipline_id = '${disciplineId}' order by ctid;`,
    )
      .trim()
      .split('\n')
      .map(Number)
    expect(heapAfter).toEqual([8, 7, 6, 5, 4, 3, 2, 1])
  })

  it('rechaza un nombre en blanco desde la función, no sólo desde el cliente', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason(admin.client, {
      name: 'Los Jueves 2026',
      squadNames: squadNames(8),
      config: defaultConfig(8),
    })

    // Salteando el guard de `addSquadSeat`: la función está grantada a
    // `authenticated` y sale en `database.types.ts`, así que esto es una
    // llamada perfectamente posible desde afuera del cliente.
    const { error } = await admin.client.rpc('add_squad_seat', {
      p_season: seasonId,
      p_name: '   ',
    })

    expect(error?.message).toBe('El asiento necesita un nombre.')
    expect((await squadInSeedOrder(admin, seasonId))).toHaveLength(8)
  })

  // El `trim` de Postgres saca U+0020 y NADA más, así que con
  // `trim(coalesce(p_name,'')) = ''` la guarda de la base era estrictamente más
  // débil que el `String.trim()` del cliente al que dice respaldar: un tab, un
  // salto de línea o un NBSP pasaban derecho. Y `entries_squad_named` tampoco
  // los frena, así que quedaba un asiento REAL, con posición y todo, que se
  // dibuja en blanco en cada pantalla y da `initials()` vacías
  // (`app/torneo/[id]/ajustes/plantel.tsx:77`). Con `p_before` encima, el
  // asiento fantasma se mete corriendo la cola del plantel.
  it.each([
    ['un tab', '\t'],
    ['un salto de línea', '\n'],
    ['un NBSP', ' '],
    ['una mezcla de todos', ' \t\r\n  '],
  ])('rechaza un nombre hecho sólo de %s, no sólo de espacios', async (_label, name) => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason(admin.client, {
      name: 'Los Jueves 2026',
      squadNames: squadNames(8),
      config: defaultConfig(8),
    })
    const before = await squadInSeedOrder(admin, seasonId)
    const target = before[2]
    if (target === undefined) throw new Error('Falta el asiento de test.')

    const { error } = await admin.client.rpc('add_squad_seat', {
      p_season: seasonId,
      p_name: name,
      p_before: target.id,
    })

    expect(error?.message).toBe('El asiento necesita un nombre.')
    // Y no movió la cola: el rechazo tiene que llegar ANTES del corrimiento.
    const after = await squadInSeedOrder(admin, seasonId)
    expect(after).toHaveLength(8)
    expect(after.map((entry) => entry.seedPosition)).toEqual(before.map((entry) => entry.seedPosition))
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
    const disciplineId = await defaultDisciplineId(adminClient(), seasonId)
    if (disciplineId === null) throw new Error('La temporada no tiene disciplina.')

    // `p_discipline`, no `p_season` (0023): shift_seeds_up corre sobre
    // discipline_entries desde PR 7.
    const { data, error } = await admin.client.rpc('shift_seeds_up', {
      p_discipline: disciplineId,
      p_from: 2,
    })

    expect(data).toBeNull()
    expect(error?.code).toBe('42501')
  })
})
