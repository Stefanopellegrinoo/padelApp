/**
 * Guardia de escritura de `season_seed_order` (0080_season_seed_order.sql,
 * torneo-multi-disciplina tanda 1) — mirror explícito de
 * `db/entries-seed-writers.db.test.ts`, que hace lo mismo con
 * `entries.seed_position` para el SQUAD.
 *
 * El riesgo real acá no es un crash: es que un escritor de plantel olvide
 * esta tabla EN SILENCIO — el asiento sigue existiendo, pero ordena mal para
 * siempre en Unirse, Ajustes › Plantel y la tabla global, sin que ningún
 * error lo avise. Este archivo prueba, contra los escritores de producción
 * que tocan el plantel SQUAD (`createSeason`, y en las próximas tandas de
 * este mismo cambio `addSquadSeat`/`promoteGuest`), que cada SQUAD de la
 * temporada tiene EXACTAMENTE una fila en `season_seed_order` y que las
 * posiciones son 0..N-1 contiguas sin duplicados.
 *
 * Todas las consultas van ESCOPEADAS por `season_id`. `db/discipline.
 * db.test.ts:234-248` (`countOrphanedSquadEntries`) mide, contra la base
 * completa y sin escopear, que una aserción así es inestable con la suite
 * corriendo en paralelo (`vitest.db.config.ts`: "los tests comparten una
 * base, aíslan por temporada, no por proceso") — huérfanos fantasma en 3 de
 * ~7 corridas, no una regresión real. Este archivo no repite eso: cada
 * `select` de acá lleva su propio `.eq('season_id', ...)`.
 */
import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@/core'
import { addSquadSeat, promoteGuest, removeSeat } from './entries'
import { addGuest, closeMatchday, createMatchday, generatePairs, openMatchday, saveResult, setAttendance } from './matchday'
import { createSeason } from './season'
import { adminClient } from './test/admin'
import { createTestUser, type TestUser } from './test/users'

async function seedOrderPositions(seasonId: string): Promise<number[]> {
  const db = adminClient()
  const { data, error } = await db
    .from('season_seed_order')
    .select('seed_position')
    .eq('season_id', seasonId)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => row.seed_position)
}

async function squadEntryIdsOf(seasonId: string): Promise<string[]> {
  const db = adminClient()
  const { data, error } = await db
    .from('entries')
    .select('id')
    .eq('season_id', seasonId)
    .eq('kind', 'SQUAD')
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => row.id)
}

/** 0..N-1, contiguo, sin duplicados: la única forma legal de que quede una tabla de N SQUAD RECIÉN armada, sin ningún removeSeat todavía. */
function expectContiguous(positions: number[], count: number): void {
  expect(positions).toHaveLength(count)
  expect([...positions].sort((a, b) => a - b)).toEqual(Array.from({ length: count }, (_, index) => index))
}

/**
 * WU2 (tanda 3, round 2 review fix): lo único que `season_seed_order`
 * GARANTIZA de verdad es "una fila por SQUAD, posiciones únicas" — el índice
 * único `season_seed_order_seed` (0080) exige eso y nada más. `expectContiguous`
 * (0..N-1 sin huecos) es más estricto que la garantía real: sólo se cumple
 * mientras nadie sacó a nadie todavía. `removeSeat` deja huecos A PROPÓSITO
 * (0080:48-52, mismo criterio que `discipline_entries` desde 0023) — usar
 * `expectContiguous` después de una baja pediría algo que el sistema nunca
 * prometió.
 */
function expectUniquePositions(positions: number[], count: number): void {
  expect(positions).toHaveLength(count)
  expect(new Set(positions).size).toBe(count)
}

describe('createSeason escribe season_seed_order desde el orden GLOBAL de squadNames', () => {
  it('cada SQUAD tiene exactamente una fila, 0..N-1 contiguo', async () => {
    const admin = await createTestUser()
    const squadNames = Array.from({ length: 6 }, (_, index) => `Jugador ${index + 1}`)
    const { seasonId } = await createSeason(admin.client, {
      name: 'Torneo con season_seed_order',
      squadNames,
      config: defaultConfig(6),
    })

    expectContiguous(await seedOrderPositions(seasonId), 6)
    expect(await squadEntryIdsOf(seasonId)).toHaveLength(6)
  })

  // La trampa que este cambio existe para evitar: `disciplines[0].seedOrder`
  // (PR anterior, `seedNames` renombrado a `seedOrder` en WU1) es un orden
  // POR DISCIPLINA, no el de la temporada. Si `createSeason` copiara ese
  // orden acá, una primaria con `seedOrder` propio volvería a secuestrar en
  // silencio la pantalla de Unirse — la razón entera de esta migración.
  it('usa squadNames, nunca el seedOrder de ninguna disciplina', async () => {
    const admin = await createTestUser()
    const names = Array.from({ length: 4 }, (_, index) => `Jugador ${index + 1}`)
    const config = defaultConfig(4)
    const { seasonId } = await createSeason(admin.client, {
      name: 'Torneo con orden propio por disciplina',
      squadNames: names,
      config,
      disciplines: [{ kind: 'PADEL', config, seedOrder: [3, 2, 1, 0] }],
    })

    const db = adminClient()
    const { data: order, error: orderError } = await db
      .from('season_seed_order')
      .select('entry_id, seed_position')
      .eq('season_id', seasonId)
      .order('seed_position', { ascending: true })
    if (orderError) throw new Error(orderError.message)
    const { data: entryRows, error: entriesError } = await db
      .from('entries')
      .select('id, display_name')
      .eq('season_id', seasonId)
    if (entriesError) throw new Error(entriesError.message)
    const nameOf = new Map((entryRows ?? []).map((row) => [row.id, row.display_name]))

    // El orden de season_seed_order es el de `names` (squadNames), no el
    // invertido que `seedNames` le pidió a PADEL.
    expect((order ?? []).map((row) => nameOf.get(row.entry_id))).toEqual(names)
  })
})

// ── add_squad_seat (0081) — p_before corre la cola A LOS DOS NIVELES ───────
// WU1 (tanda 3, round 2 review fix): la pantalla de Ajustes › Plantel SÍ deja
// elegir "antes de quién" a nivel TEMPORADA (`ajustes/plantel.tsx`), así que
// `p_before` tiene que correr la cola en `season_seed_order` igual que ya
// corría en `discipline_entries` -- `shift_season_seeds_up` (0081) es el
// mirror de `shift_seeds_up` para esa tabla.
describe('add_squad_seat escribe season_seed_order, p_before corre la cola (0081, WU1)', () => {
  it('el asiento nuevo toma el lugar de p_before en season_seed_order, no el final', async () => {
    const admin = await createTestUser()
    const squadNames = Array.from({ length: 4 }, (_, index) => `Jugador ${index + 1}`)
    const { seasonId } = await createSeason(admin.client, {
      name: 'Torneo con alta de plantel',
      squadNames,
      config: defaultConfig(4),
    })
    const db = adminClient()
    const { data: firstEntry, error: firstError } = await db
      .from('entries')
      .select('id')
      .eq('season_id', seasonId)
      .eq('kind', 'SQUAD')
      .order('created_at', { ascending: true })
      .limit(1)
      .single()
    if (firstError || firstEntry === null) throw new Error(firstError?.message)

    // "Antes de Jugador 1": el `p_before` corre la cola en discipline_entries
    // Y en season_seed_order (WU1) -- el nuevo toma la posición 0, el lugar
    // que tenía Jugador 1, no el final.
    const newId = await addSquadSeat(admin.client, seasonId, 'El quinto', firstEntry.id)

    expectContiguous(await seedOrderPositions(seasonId), 5)
    const { data: newRow, error: newRowError } = await db
      .from('season_seed_order')
      .select('seed_position')
      .eq('season_id', seasonId)
      .eq('entry_id', newId)
      .single()
    if (newRowError) throw new Error(newRowError.message)
    expect(newRow.seed_position).toBe(0)
  })
})

// ── add_squad_seat — dos altas concurrentes no chocan (WU5) ────────────────
// WU5 (tanda 3, round 2 review fix): antes del lock de `seasons` en
// `add_squad_seat`/`promote_guest` (0081/0082), dos transacciones
// concurrentes a la MISMA temporada leían el mismo `max(seed_position)` de
// `season_seed_order` y la segunda en confirmar chocaba contra el índice
// único `season_seed_order_seed` (23505) -- ese mensaje le llegaba CRUDO al
// admin (`db/entries.ts` pasa `error.message` sin traducir, a propósito,
// para los mensajes en castellano de la función; uno que se escapa de ahí es
// justo el que no lo está). El fix serializa con `select ... from seasons
// ... for update`: la segunda espera a la primera y lee el max actualizado,
// no falla.
describe('add_squad_seat — dos altas concurrentes a la misma temporada (WU5)', () => {
  it('las dos entran, sin 23505 y sin pisarse la posición', async () => {
    const admin = await createTestUser()
    const squadNames = Array.from({ length: 4 }, (_, index) => `Jugador ${index + 1}`)
    const { seasonId } = await createSeason(admin.client, {
      name: 'Torneo con alta concurrente',
      squadNames,
      config: defaultConfig(4),
    })

    const [a, b] = await Promise.all([
      addSquadSeat(admin.client, seasonId, 'Concurrente A'),
      addSquadSeat(admin.client, seasonId, 'Concurrente B'),
    ])

    expect(a).not.toBe(b)
    expectContiguous(await seedOrderPositions(seasonId), 6)
  })
})

// ── el max de season_seed_order no se puede confundir con el de discipline_entries (WU2) ──
// WU2 (tanda 3, round 2 review fix): TODA la guardia de arriba usaba
// fixtures de UNA SOLA disciplina, donde `max(season_seed_order.seed_position)`
// y `max(discipline_entries.seed_position)` dan el MISMO entero -- una
// mutación que confundiera las dos tablas pasaba esta guardia entera en
// verde sin que nada lo notara. Este fixture arma DOS disciplinas donde
// NINGUNA tiene el plantel completo (a `Jugador 4` no lo suma ninguna de
// las dos, REQ-D1-4 "no todos juegan todo"), así que el máximo de
// `discipline_entries` -- lea de la disciplina que lea, o de las dos juntas
// sin filtrar por `discipline_id` -- queda en 2, mientras que
// `season_seed_order` (que SIEMPRE tiene una fila por SQUAD, sin excepción)
// sigue en 3. Confirmado a mano: reemplazar el `from public.season_seed_order`
// de `add_squad_seat` por `from public.discipline_entries` (misma
// `where season_id = p_season`, la columna existe en las dos tablas) hace que
// este test choque contra `season_seed_order_seed` (23505) en vez de pasar.
describe('add_squad_seat usa el max de season_seed_order, nunca el de discipline_entries (WU2)', () => {
  it('con dos disciplinas de solape parcial, el alta toma la posición real de la TEMPORADA', async () => {
    const admin = await createTestUser()
    const squadNames = Array.from({ length: 4 }, (_, index) => `Jugador ${index + 1}`)
    const config = defaultConfig(4)
    // FIFA de a uno necesita 4 valores de puntos (uno por lado, squadSize /
    // sideSize = 4/1), no los 2 de `defaultConfig` (pensado para parejas) --
    // mismo ajuste que `closedSoloMatchdayWithGuest`, más abajo en este mismo
    // archivo.
    const fifaConfig = { ...config, points: [4, 3, 2, 1] }
    const { seasonId } = await createSeason(admin.client, {
      name: 'Torneo con solape parcial',
      squadNames,
      config,
      disciplines: [
        { kind: 'PADEL', config },
        { kind: 'FIFA', pairSize: 1, config: fifaConfig },
      ],
    })

    const db = adminClient()
    const { data: disciplines, error: disciplinesError } = await db
      .from('disciplines')
      .select('id')
      .eq('season_id', seasonId)
      .order('position', { ascending: true })
    if (disciplinesError) throw new Error(disciplinesError.message)
    const [padelId, fifaId] = (disciplines ?? []).map((row) => row.id)
    if (padelId === undefined || fifaId === undefined) throw new Error('Faltan las dos disciplinas.')

    const { data: entries, error: entriesError } = await db
      .from('entries')
      .select('id')
      .eq('season_id', seasonId)
      .eq('kind', 'SQUAD')
      .order('created_at', { ascending: true })
    if (entriesError) throw new Error(entriesError.message)
    const fourth = entries?.[3]?.id
    if (fourth === undefined) throw new Error('Falta el cuarto asiento.')

    // `createSeason` sumó a Jugador 4 a las dos disciplinas (posición 3 en
    // cada una, el índice global). Sacarlo de las DOS deja el máximo de
    // discipline_entries en 2 -- Jugador 4 sigue siendo SQUAD de la
    // temporada, sólo que todavía no juega ninguna disciplina.
    //
    // WU5 (tanda 5, round 3 review fix): desde acá hasta la limpieza de abajo
    // la base queda a propósito con Jugador 4 sin NINGUNA fila en
    // discipline_entries -- exactamente el estado que envenena
    // `db/discipline.db.test.ts:250` (`countOrphanedSquadEntries`, sin
    // escopear). Antes, si el `expect` de abajo fallaba, la limpieza nunca
    // corría y el huérfano quedaba para siempre -- pasó de verdad durante esta
    // ronda de review. `try/finally` hace que la limpieza corra pase lo que
    // pase adentro.
    try {
      const { error: padelGapError } = await db
        .from('discipline_entries')
        .delete()
        .eq('discipline_id', padelId)
        .eq('entry_id', fourth)
      if (padelGapError) throw new Error(padelGapError.message)
      const { error: fifaGapError } = await db
        .from('discipline_entries')
        .delete()
        .eq('discipline_id', fifaId)
        .eq('entry_id', fourth)
      if (fifaGapError) throw new Error(fifaGapError.message)

      const newId = await addSquadSeat(admin.client, seasonId, 'El quinto')

      const { data: newRow, error: newRowError } = await db
        .from('season_seed_order')
        .select('seed_position')
        .eq('season_id', seasonId)
        .eq('entry_id', newId)
        .single()
      if (newRowError) throw new Error(newRowError.message)
      // El máximo REAL de season_seed_order es 3 (los 4 SQUAD siguen ahí,
      // incluido Jugador 4): el nuevo va a la posición 4, no a la 3 que daría
      // leer discipline_entries.
      expect(newRow.seed_position).toBe(4)
    } finally {
      // Limpieza: sin esto, Jugador 4 queda SQUAD sin ninguna fila en
      // discipline_entries para siempre, y envenena
      // `db/discipline.db.test.ts:234-248` (`countOrphanedSquadEntries`), que
      // mide contra la base COMPLETA y sin escopear -- medido, rompió esa
      // guardia la primera vez que corrió esta suite entera. El hueco sólo
      // hacía falta DURANTE el alta de arriba, no como estado final. La
      // posición no puede ser la 3 fija: `addSquadSeat` ya usó el hueco de
      // PADEL para "El quinto" -- se recalcula el próximo lugar libre en vez de
      // asumir uno. Sólo restaura PADEL (no FIFA): alcanza para que `fourth`
      // deje de ser huérfano -- el hueco en FIFA es un residuo aceptado de
      // este fixture, no una violación del invariante global.
      const { data: padelSeats, error: padelSeatsError } = await db
        .from('discipline_entries')
        .select('seed_position')
        .eq('discipline_id', padelId)
      if (padelSeatsError) throw new Error(padelSeatsError.message)
      const nextPadelSeat = Math.max(-1, ...(padelSeats ?? []).map((row) => row.seed_position)) + 1
      const { error: cleanupError } = await db
        .from('discipline_entries')
        .insert({ discipline_id: padelId, entry_id: fourth, season_id: seasonId, seed_position: nextPadelSeat })
      if (cleanupError) throw new Error(cleanupError.message)
    }
  })
})

// ── add_squad_seat después de un removeSeat: el hueco no se pisa (WU2) ─────
// WU2 (tanda 3, round 2 review fix): TODOS los fixtures de este archivo
// agregan asientos en orden, sin bajas de por medio, así que
// `season_seed_order` siempre queda 0..N-1 SIN huecos al momento del alta --
// ahí, `count(*)` y `max(seed_position)+1` dan el MISMO número, y una
// mutación que cambiara uno por el otro pasaba la guardia entera en verde.
// Este fixture saca a `Jugador 2` (posición 1, no la más alta) ANTES de dar
// de alta: el hueco queda en el medio, `count(*)` (3) queda POR DEBAJO de
// `max(seed_position)+1` (4) -- confirmado a mano, la misma mutación de
// arriba hace que el alta choque contra la posición 3 (la de Jugador 4, que
// sigue ahí) en vez de tomar la 4 real.
describe('add_squad_seat después de un removeSeat, con un hueco en el medio (WU2)', () => {
  it('el asiento nuevo no pisa ninguna posición existente', async () => {
    const admin = await createTestUser()
    const squadNames = Array.from({ length: 4 }, (_, index) => `Jugador ${index + 1}`)
    const { seasonId } = await createSeason(admin.client, {
      name: 'Torneo con hueco antes del alta',
      squadNames,
      config: defaultConfig(4),
    })
    const db = adminClient()
    const { data: entries, error: entriesError } = await db
      .from('entries')
      .select('id')
      .eq('season_id', seasonId)
      .eq('kind', 'SQUAD')
      .order('created_at', { ascending: true })
    if (entriesError) throw new Error(entriesError.message)
    // Jugador 2 (posición 1): NO es la más alta -- sacarlo deja el hueco en
    // el medio ({0,2,3}) y no toca la posición 3, que es la que importa.
    const target = entries?.[1]?.id
    if (target === undefined) throw new Error('Falta un asiento para sacar.')

    await removeSeat(admin.client, target)
    expect(await seedOrderPositions(seasonId)).toHaveLength(3)

    const newId = await addSquadSeat(admin.client, seasonId, 'El nuevo, después del hueco')

    // No `expectContiguous`: después de una baja, 0..N-1 sin huecos no es lo
    // que el sistema garantiza (ver el comentario grande de
    // `expectUniquePositions`, arriba). Lo real es "posiciones únicas".
    expectUniquePositions(await seedOrderPositions(seasonId), 4)
    const { data: newRow, error: newRowError } = await db
      .from('season_seed_order')
      .select('seed_position')
      .eq('season_id', seasonId)
      .eq('entry_id', newId)
      .single()
    if (newRowError) throw new Error(newRowError.message)
    expect(newRow.seed_position).toBe(4)
  })
})

// ── promote_guest (0082) — sin `p_before`, sigue yendo al final ────────────
// Scaffolding local a este archivo (mismo criterio que `promote.db.test.ts`):
// una disciplina de a uno evita el guard "¿cobró el compañero?" y llega al
// promote_guest real con el mínimo de pasos.
async function closedSoloMatchdayWithGuest(): Promise<{
  admin: TestUser
  seasonId: string
  matchdayId: string
  guestId: string
}> {
  const admin = await createTestUser()
  const squadNames = Array.from({ length: 4 }, (_, index) => `Jugador ${index + 1}`)
  const config = { ...defaultConfig(4), points: [4, 3, 2, 1] }
  const { seasonId } = await createSeason(admin.client, {
    name: 'Torneo con promoción de invitado',
    squadNames,
    config,
    disciplines: [{ kind: 'FIFA', pairSize: 1, config }],
  })
  const db = adminClient()
  const { data: entries, error: entriesError } = await db
    .from('entries')
    .select('id')
    .eq('season_id', seasonId)
    .eq('kind', 'SQUAD')
  if (entriesError) throw new Error(entriesError.message)
  const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
  for (const entry of entries ?? []) {
    await setAttendance(admin.client, matchdayId, entry.id, 'PLAYING')
  }
  const guestId = await addGuest(admin.client, matchdayId, { displayName: 'Invitado solo' })

  await generatePairs(admin.client, matchdayId)
  await openMatchday(admin.client, matchdayId)
  const { data: matches, error: matchesError } = await db.from('matches').select('id').eq('matchday_id', matchdayId)
  if (matchesError) throw new Error(matchesError.message)
  for (const match of matches ?? []) {
    await saveResult(admin.client, match.id, [{ gamesA: 4, gamesB: 1 }])
  }
  await closeMatchday(admin.client, matchdayId)

  return { admin, seasonId, matchdayId, guestId }
}

describe('promote_guest escribe season_seed_order, siempre al final (0082)', () => {
  it('el invitado promovido entra al final de season_seed_order de la temporada', async () => {
    const { admin, seasonId, guestId } = await closedSoloMatchdayWithGuest()

    await promoteGuest(admin.client, guestId)

    expectContiguous(await seedOrderPositions(seasonId), 5)
    const db = adminClient()
    const { data: row, error } = await db
      .from('season_seed_order')
      .select('seed_position')
      .eq('season_id', seasonId)
      .eq('entry_id', guestId)
      .single()
    if (error) throw new Error(error.message)
    expect(row.seed_position).toBe(4)
  })
})

// ── removeSeat no necesita ningún cambio ────────────────────────────────────
// La FK `(entry_id, season_id) references entries (id, season_id) on delete
// cascade` (0080) hace todo el trabajo: borrar el asiento de `entries` se
// lleva su fila de `season_seed_order` sola, mismo mecanismo que ya usa
// `discipline_entries` desde 0023. Probado, no asumido.
describe('removeSeat — el cascade de la FK alcanza, sin tocar código (0080)', () => {
  it('sacar un asiento borra su fila de season_seed_order y no rompe las de los demás', async () => {
    const admin = await createTestUser()
    const squadNames = Array.from({ length: 4 }, (_, index) => `Jugador ${index + 1}`)
    const { seasonId } = await createSeason(admin.client, {
      name: 'Torneo con baja de plantel',
      squadNames,
      config: defaultConfig(4),
    })
    const db = adminClient()
    const { data: entries, error: entriesError } = await db
      .from('entries')
      .select('id')
      .eq('season_id', seasonId)
      .eq('kind', 'SQUAD')
    if (entriesError || entries === null) throw new Error(entriesError?.message)
    const target = entries[1]?.id
    if (target === undefined) throw new Error('Falta un asiento para sacar.')

    await removeSeat(admin.client, target)

    const { data: row, error: rowError } = await db
      .from('season_seed_order')
      .select('entry_id')
      .eq('season_id', seasonId)
      .eq('entry_id', target)
      .maybeSingle()
    if (rowError) throw new Error(rowError.message)
    expect(row).toBeNull()
    // Los otros tres siguen ahí, sin renumerar -- mismo criterio de huecos
    // que `discipline_entries` (0023): sacar a uno no reescribe el orden de
    // desempate inicial de los demás.
    expect(await seedOrderPositions(seasonId)).toHaveLength(3)
  })
})

// ── La guardia completa: los tres escritores, una sola temporada ───────────
// Esto es lo que este archivo existe para cubrir de verdad (el mirror
// explícito de `db/entries-seed-writers.db.test.ts` que el docblock de
// arriba promete): encadena `createSeason` -> `promote_guest` ->
// `add_squad_seat` sobre la MISMA temporada y verifica el invariante
// completo después de CADA paso. El riesgo no es un crash -- es que un
// futuro escritor de plantel se olvide de esta tabla en silencio, y este
// test es la única cosa que lo agarraría antes que un admin en producción.
describe('la guardia completa: createSeason -> promote_guest -> add_squad_seat, invariante después de cada paso', () => {
  it('cada paso deja exactamente una fila por SQUAD, 0..N-1 contiguo', async () => {
    const squadNames = Array.from({ length: 4 }, (_, index) => `Jugador ${index + 1}`)
    const config = { ...defaultConfig(4), points: [4, 3, 2, 1] }
    const admin = await createTestUser()
    const { seasonId } = await createSeason(admin.client, {
      name: 'Torneo con la guardia completa',
      squadNames,
      config,
      disciplines: [{ kind: 'FIFA', pairSize: 1, config }],
    })

    expectContiguous(await seedOrderPositions(seasonId), 4)

    // promote_guest: cierra una fecha de a uno con un invitado solo (evita
    // el guard "¿cobró el compañero?") y lo promueve.
    const db = adminClient()
    const { data: entries, error: entriesError } = await db
      .from('entries')
      .select('id')
      .eq('season_id', seasonId)
      .eq('kind', 'SQUAD')
    if (entriesError) throw new Error(entriesError.message)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    for (const entry of entries ?? []) {
      await setAttendance(admin.client, matchdayId, entry.id, 'PLAYING')
    }
    const guestId = await addGuest(admin.client, matchdayId, { displayName: 'Invitado de la guardia' })
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)
    const { data: matches, error: matchesError } = await db.from('matches').select('id').eq('matchday_id', matchdayId)
    if (matchesError) throw new Error(matchesError.message)
    for (const match of matches ?? []) {
      await saveResult(admin.client, match.id, [{ gamesA: 4, gamesB: 1 }])
    }
    await closeMatchday(admin.client, matchdayId)
    await promoteGuest(admin.client, guestId)

    expectContiguous(await seedOrderPositions(seasonId), 5)

    // add_squad_seat: un alta más, encima de todo lo anterior.
    const newId = await addSquadSeat(admin.client, seasonId, 'El sexto')

    expectContiguous(await seedOrderPositions(seasonId), 6)
    const squadIds = await squadEntryIdsOf(seasonId)
    expect(squadIds).toHaveLength(6)
    expect(squadIds).toContain(newId)
  })
})
