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

/** 0..N-1, contiguo, sin duplicados: la única forma legal de que quede una tabla de N SQUAD. */
function expectContiguous(positions: number[], count: number): void {
  expect(positions).toHaveLength(count)
  expect([...positions].sort((a, b) => a - b)).toEqual(Array.from({ length: count }, (_, index) => index))
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

  // La trampa que este cambio existe para evitar: `disciplines[0].seedNames`
  // (PR anterior) es un orden POR DISCIPLINA, no el de la temporada. Si
  // `createSeason` copiara ese orden acá, una primaria con `seedNames`
  // propio volvería a secuestrar en silencio la pantalla de Unirse — la
  // razón entera de esta migración.
  it('usa squadNames, nunca el seedNames de ninguna disciplina', async () => {
    const admin = await createTestUser()
    const names = Array.from({ length: 4 }, (_, index) => `Jugador ${index + 1}`)
    const config = defaultConfig(4)
    const { seasonId } = await createSeason(admin.client, {
      name: 'Torneo con orden propio por disciplina',
      squadNames: names,
      config,
      disciplines: [{ kind: 'PADEL', config, seedNames: [names[3]!, names[2]!, names[1]!, names[0]!] }],
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

// ── add_squad_seat (0081) — tail-only a nivel temporada ────────────────────
// El corrimiento de `p_before` sigue siendo real DENTRO de la disciplina
// (discipline_entries no cambia); a nivel TEMPORADA el asiento nuevo entra
// siempre al final. Ver el comentario grande de 0081 para el porqué
// completo: no hay pantalla que hoy pida "antes de quién" a nivel temporada.
describe('add_squad_seat escribe season_seed_order, siempre al final (0081)', () => {
  it('el asiento nuevo va al final de season_seed_order aunque p_before lo adelante en su disciplina', async () => {
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

    // "Antes de Jugador 1": el `p_before` que sí corre la cola en
    // discipline_entries. A nivel temporada no importa -- el nuevo tiene que
    // aparecer al FINAL de season_seed_order, no adelante de nadie.
    const newId = await addSquadSeat(admin.client, seasonId, 'El quinto', firstEntry.id)

    expectContiguous(await seedOrderPositions(seasonId), 5)
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

// ── promote_guest (0082) — mismo tail-only ──────────────────────────────────
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
