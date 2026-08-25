import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@/core'
import { createMatchday, generatePairs, setAttendance } from './matchday'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser } from './test/users'

/** `noUncheckedIndexedAccess`: la factory devuelve tantos ids como se le pidieron. */
function at(ids: string[], index: number): string {
  const id = ids[index]
  if (id === undefined) throw new Error(`La factory no devolvió el id ${index}.`)
  return id
}

/** playerIds sueltos, sin usuario: alcanza para llenar `squad` de la factory. */
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

//── 0068 — discipline_teams (docs/tipos-de-torneo.md §1) ────────────────────
// `pair_locks` es de una FECHA y exige que toda pareja trabada incluya a un
// invitado (`db/validate.ts:205`). Un equipo fijo es de la TEMPORADA y son dos
// del plantel: viola esa guarda por definición, y por eso vive en su propia
// tabla. Este archivo mide contra la base real que las guardas NUEVAS muerden,
// no que el SQL compila.

describe('discipline_teams', () => {
  it('traba a dos del plantel — justo lo que pair_locks prohíbe', async () => {
    const admin = await createTestUser()
    const players = await fillerPlayers(4)
    const { seasonId, entryIds, disciplineId } = await createSeason({ admin, squad: players })
    const [a, b] = [at(entryIds, 0), at(entryIds, 1)]

    const { error } = await adminClient()
      .from('discipline_teams')
      .insert({ discipline_id: disciplineId, entry_a: a, entry_b: b, season_id: seasonId })

    expect(error).toBeNull()
  })

  // Con DOS disciplinas y borrando el asiento de la segunda: el jugador sigue
  // teniendo su fila en la primera, así que el invariante global "ningún SQUAD
  // sin `discipline_entries`" (db/discipline.db.test.ts) se mantiene. Crear un
  // `entries` huérfano sería más corto y dejaría basura permanente en la base.
  it('rechaza a alguien que no juega esa disciplina', async () => {
    const admin = await createTestUser()
    const players = await fillerPlayers(4)
    const { seasonId, entryIds, disciplineIds } = await createSeason({
      admin,
      squad: players,
      disciplines: [{}, { kind: 'FIFA' }],
    })
    const db = adminClient()
    const [primera, segunda] = [at(disciplineIds, 0), at(disciplineIds, 1)]
    const forastero = at(entryIds, 3)

    await db
      .from('discipline_entries')
      .delete()
      .eq('discipline_id', segunda)
      .eq('entry_id', forastero)

    // En la PRIMERA sigue jugando, así que ahí el mismo equipo entra bien.
    const { error: enLaPrimera } = await db.from('discipline_teams').insert({
      discipline_id: primera,
      entry_a: at(entryIds, 0),
      entry_b: forastero,
      season_id: seasonId,
    })
    expect(enLaPrimera).toBeNull()

    const { error } = await db.from('discipline_teams').insert({
      discipline_id: segunda,
      entry_a: at(entryIds, 0),
      entry_b: forastero,
      season_id: seasonId,
    })

    expect(error?.code, error?.message).toBe('23503') // foreign_key_violation
  })

  it('rechaza a la misma persona en dos equipos', async () => {
    const admin = await createTestUser()
    const players = await fillerPlayers(4)
    const { seasonId, entryIds, disciplineId } = await createSeason({ admin, squad: players })
    const [a, b, c] = [at(entryIds, 0), at(entryIds, 1), at(entryIds, 2)]
    const db = adminClient()

    await db
      .from('discipline_teams')
      .insert({ discipline_id: disciplineId, entry_a: a, entry_b: b, season_id: seasonId })

    const { error } = await db
      .from('discipline_teams')
      .insert({ discipline_id: disciplineId, entry_a: a, entry_b: c, season_id: seasonId })

    expect(error?.code, error?.message).toBe('23505') // unique_violation
  })

  it('rechaza un equipo en una disciplina de a uno', async () => {
    const admin = await createTestUser()
    const players = await fillerPlayers(4)
    const { seasonId, entryIds, disciplineIds } = await createSeason({
      admin,
      squad: players,
      disciplines: [{ pairSize: 1 }],
    })

    const { error } = await adminClient().from('discipline_teams').insert({
      discipline_id: at(disciplineIds, 0),
      entry_a: at(entryIds, 0),
      entry_b: at(entryIds, 1),
      season_id: seasonId,
    })

    expect(error?.code, error?.message).toBe('23503') // el ancla (id, pair_size) no encuentra fila
  })

  it('rechaza un equipo de alguien consigo mismo', async () => {
    const admin = await createTestUser()
    const players = await fillerPlayers(4)
    const { seasonId, entryIds, disciplineId } = await createSeason({ admin, squad: players })

    const { error } = await adminClient().from('discipline_teams').insert({
      discipline_id: disciplineId,
      entry_a: at(entryIds, 0),
      entry_b: at(entryIds, 0),
      season_id: seasonId,
    })

    expect(error?.code, error?.message).toBe('23514') // check_violation
  })

  // Dos disciplinas por el mismo motivo que el test de arriba: al sacarle el
  // asiento en la primera, el jugador conserva el de la segunda y no queda
  // huérfano en la base compartida que usan todos los `*.db.test.ts`.
  it('sacar el asiento de la disciplina se lleva el equipo', async () => {
    const admin = await createTestUser()
    const players = await fillerPlayers(4)
    const { seasonId, entryIds, disciplineIds } = await createSeason({
      admin,
      squad: players,
      disciplines: [{}, { kind: 'FIFA' }],
    })
    const primera = at(disciplineIds, 0)
    const [a, b] = [at(entryIds, 0), at(entryIds, 1)]
    const db = adminClient()

    await db
      .from('discipline_teams')
      .insert({ discipline_id: primera, entry_a: a, entry_b: b, season_id: seasonId })

    await db.from('discipline_entries').delete().eq('discipline_id', primera).eq('entry_id', a)

    const { data } = await db.from('discipline_teams').select('id').eq('discipline_id', primera)

    expect(data).toEqual([])
  })
})

//── El sorteo con equipos fijos ─────────────────────────────────────────────
// Acá se mide lo que la tabla sola no prueba: que los equipos LLEGAN a
// `fixedPairs` y que el motor los devuelve tal cual. `core/matchings.ts:22`
// dice que un pool 100% trabado sale sin sortear; esto lo corre de punta a
// punta contra la base.

/** Una disciplina de equipos fijos con el plantel ya emparejado de a dos. */
async function fixedTeamsSeason(squadSize: number) {
  const admin = await createTestUser()
  const players = await fillerPlayers(squadSize)
  const { seasonId, entryIds, disciplineId } = await createSeason({
    admin,
    config: defaultConfig(squadSize),
    squad: players,
  })
  const db = adminClient()

  const { error: flagError } = await db
    .from('disciplines')
    .update({ fixed_teams: true })
    .eq('id', disciplineId)
  if (flagError) throw new Error(flagError.message)

  const teams = []
  for (let i = 0; i < entryIds.length; i += 2) {
    teams.push({
      discipline_id: disciplineId,
      entry_a: at(entryIds, i),
      entry_b: at(entryIds, i + 1),
      season_id: seasonId,
    })
  }
  const { error } = await db.from('discipline_teams').insert(teams)
  if (error) throw new Error(error.message)

  return { seasonId, disciplineId, entryIds }
}

/** Las parejas armadas, como claves `a·b` ordenadas: comparables sin depender del sorteo. */
async function pairKeysOf(matchdayId: string): Promise<string[]> {
  const { data, error } = await adminClient()
    .from('pairs')
    .select('entry_a, entry_b')
    .eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => [row.entry_a, row.entry_b ?? ''].sort().join('·')).sort()
}

/**
 * Fecha en armado con TODO el plantel marcado presente.
 *
 * El presentismo se siembra explícito y no por default: `playingEntryIds`
 * cuenta filas PLAYING EXISTENTES (`db/matchday.ts`), así que una fecha sin
 * filas tiene `present` vacío y muere en `assertMatchdaySize` antes de llegar
 * a lo que estos tests miden.
 */
async function openDraft(seasonId: string, disciplineId: string, entryIds: string[]): Promise<string> {
  const db = adminClient()
  const matchdayId = await createMatchday(db, seasonId, '2026-09-01', disciplineId)
  for (const entryId of entryIds) {
    await setAttendance(db, matchdayId, entryId, 'PLAYING')
  }
  return matchdayId
}

describe('el sorteo de una disciplina con equipos fijos', () => {
  it('devuelve exactamente los equipos, sin sortear nada', async () => {
    const { seasonId, disciplineId, entryIds } = await fixedTeamsSeason(8)
    const db = adminClient()
    const matchdayId = await openDraft(seasonId, disciplineId, entryIds)

    await generatePairs(db, matchdayId)

    const want = [
      [0, 1],
      [2, 3],
      [4, 5],
      [6, 7],
    ]
      .map(([i, j]) => [at(entryIds, i ?? 0), at(entryIds, j ?? 0)].sort().join('·'))
      .sort()
    expect(await pairKeysOf(matchdayId)).toEqual(want)
  })

  // El modo de falla que este test compra: sin el guard, el que vino se cae al
  // sorteo suelto y termina de pareja con un rival, EN SILENCIO. Y con un solo
  // ausente el plantel queda impar, así que el mensaje de paridad taparía la
  // causa real — por eso el guard corre antes que `assertMatchdaySize`.
  it('con un equipo a medias falla, y el mensaje nombra la causa', async () => {
    const { seasonId, disciplineId, entryIds } = await fixedTeamsSeason(8)
    const db = adminClient()
    const matchdayId = await openDraft(seasonId, disciplineId, entryIds)

    await setAttendance(db, matchdayId, at(entryIds, 0), 'ABSENT')

    await expect(generatePairs(db, matchdayId)).rejects.toThrow(
      'Hay un equipo con un solo integrante presente: en equipos fijos se viene de a dos.',
    )
  })

  // El equipo entero que no viene no es un problema: simplemente no juega.
  // Con 10 y no con 8: sacar un equipo de 8 deja 6, y `MIN_PLAYERS = 8` lo
  // prohíbe. Ese mínimo es una regla de 2v2 inconsistente consigo misma
  // (prohíbe 6, donde descansa uno, y permite 10, donde también) y queda
  // FUERA de este cambio a propósito — docs/tipos-de-torneo.md §3.3.
  it('un equipo entero ausente sale del sorteo sin romper nada', async () => {
    const { seasonId, disciplineId, entryIds } = await fixedTeamsSeason(10)
    const db = adminClient()
    const matchdayId = await openDraft(seasonId, disciplineId, entryIds)

    await setAttendance(db, matchdayId, at(entryIds, 0), 'ABSENT')
    await setAttendance(db, matchdayId, at(entryIds, 1), 'ABSENT')

    await generatePairs(db, matchdayId)

    const want = [
      [2, 3],
      [4, 5],
      [6, 7],
      [8, 9],
    ]
      .map(([i, j]) => [at(entryIds, i ?? 0), at(entryIds, j ?? 0)].sort().join('·'))
      .sort()
    expect(await pairKeysOf(matchdayId)).toEqual(want)
  })
})
