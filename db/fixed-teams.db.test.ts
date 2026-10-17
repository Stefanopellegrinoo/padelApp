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
  // Antes esquivaba el piso plano de 8 —sacar un equipo de un plantel de 8
  // dejaba 6, que ese plano prohibía— con un plantel de 10. Con el piso
  // derivado (`minSquadFor(2) = 4`, docs/tipos-de-torneo.md §3.3) ya no hace
  // falta esquivar nada: 6 sobra de sobra. Se deja en 10 porque no hay ninguna
  // razón para tocar un fixture que ya funciona.
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

//── La fecha siguiente a un campeonato (docs/tipos-de-torneo.md §1.4) ───────
// El apagado de la regla de defensores YA ESTÁ implementado
// (`db/matchday.ts:172-178`, la condición `pairSize === 1 || fixedTeams`
// fuerza `defenders: null`). Sin este test, un refactor futuro de esa
// condición reintroduce un crash real: `resolveSettled` (`core/pairing.ts`)
// toma primero la pareja defensora (`:198-203`) y después las fijas
// (`:204`), y con equipos fijos son las MISMAS dos entries, así que `take`
// (`:187-192`) tira `"${entryId} ya está en la pareja defensora."` al
// segundo `take` -- la fecha siguiente a cualquier campeonato revienta.

/**
 * Fecha 1 ya CERRADA con un campeón: la pareja `(a, b)` en `pairs` y en
 * `awards` con `position: 1`. Escrita directo con `service_role` -- es
 * escenario para el test, no el flujo real de cierre (mismo patrón que
 * `closeMatchday` en `db/pairing-context.db.test.ts`, pero con el
 * `disciplineId` que ya trae `fixedTeamsSeason` en vez de resolverlo aparte).
 *
 * Los dos miembros del equipo con el MISMO puntaje: `core/awards.ts:70` le
 * paga `points` completo a CADA UNO, nunca la mitad (docs/tipos-de-torneo.md
 * §1.1) -- no hay forma de que un equipo fijo termine con puntos distintos
 * entre sus dos mitades.
 */
async function closedChampionMatchday(
  seasonId: string,
  disciplineId: string,
  a: string,
  b: string,
): Promise<void> {
  const db = adminClient()
  const { data: matchday, error } = await db
    .from('matchdays')
    .insert({ season_id: seasonId, discipline_id: disciplineId, number: 1, status: 'CLOSED' })
    .select('id')
    .single()
  if (error || matchday === null) throw new Error(error?.message)

  const { error: pairError } = await db
    .from('pairs')
    .insert({ matchday_id: matchday.id, season_id: seasonId, entry_a: a, entry_b: b })
  if (pairError) throw new Error(pairError.message)

  for (const entryId of [a, b]) {
    const { error: awardError } = await db
      .from('awards')
      .insert({ matchday_id: matchday.id, season_id: seasonId, entry_id: entryId, position: 1, points: 10 })
    if (awardError) throw new Error(awardError.message)
  }
}

describe('la fecha siguiente a un campeonato, con equipos fijos', () => {
  it('arma sin chocar la pareja defensora contra el equipo fijo', async () => {
    const { seasonId, disciplineId, entryIds } = await fixedTeamsSeason(8)
    const [a, b] = [at(entryIds, 0), at(entryIds, 1)]

    // Fecha 1: CERRADA, con el equipo (a, b) como campeón.
    await closedChampionMatchday(seasonId, disciplineId, a, b)

    // Fecha 2: en armado (DRAFT), con el mismo plantel presente.
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

  // CONTROL (auto-chequeo del fixture, no del apagado): el test de arriba
  // sólo prueba algo si `closedChampionMatchday` deja un campeón REAL --
  // reconocido por `previousContext` como pareja defensora. Sin este
  // control, romper `closedChampionMatchday` (por ejemplo, dejar de insertar
  // `awards`) deja el test de arriba en VERDE con el bug de producción
  // TODAVÍA presente, porque sin campeón `defenders` ya sale `null` por las
  // buenas y nunca llega a `resolveSettled` -- nada choca, pero tampoco
  // porque el apagado funcionó.
  //
  // Corre el MISMO fixture (mismo helper, mismos dos inserts) contra una
  // disciplina SIN `fixed_teams`: si `closedChampionMatchday` deja un
  // campeón real, `(a, b)` tiene que salir defendiendo -- junta en la fecha
  // 2 -- no por sorteo sino PORQUE es la pareja defensora.
  it('CONTROL: sin equipos fijos, el mismo fixture dejó a (a,b) defendiendo en la fecha 2', async () => {
    const admin = await createTestUser()
    const players = await fillerPlayers(8)
    const { seasonId, entryIds, disciplineId } = await createSeason({
      admin,
      config: defaultConfig(8),
      squad: players,
    })
    const [a, b] = [at(entryIds, 0), at(entryIds, 1)]

    await closedChampionMatchday(seasonId, disciplineId, a, b)

    const db = adminClient()
    const matchdayId = await openDraft(seasonId, disciplineId, entryIds)
    await generatePairs(db, matchdayId)

    // Sigue junta pese al sorteo de las otras tres parejas: eso sólo pasa
    // si `previousContext` la reconoció como defensora, no por azar.
    expect(await pairKeysOf(matchdayId)).toContain([a, b].sort().join('·'))
  })
})
