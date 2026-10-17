import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@/core'
import type { Client } from './client'
import { addToDiscipline, hasPlayedDiscipline, removeFromDiscipline } from './discipline-entries'
import { addGuest, createMatchday, generatePairs, lockPair, openMatchday, setAttendance } from './matchday'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser } from './test/users'

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

//── PR 7 — discipline_entries (REQ-D1-3, REQ-D1-4) ──────────────────────────
//`entries` sigue siendo el plantel del TORNEO (REQ-D1-3: una persona, un
// asiento, sin duplicar por disciplina). `discipline_entries` es el
// subconjunto por disciplina, con su propio `seed_position` — este archivo
// prueba que las dos cosas son ciertas contra la base real, no sólo que
// compilan.

interface DisciplineSeat {
  entry_id: string
  seed_position: number
}

async function seatsOf(disciplineId: string): Promise<DisciplineSeat[]> {
  const db = adminClient()
  const { data, error } = await db
    .from('discipline_entries')
    .select('entry_id, seed_position')
    .eq('discipline_id', disciplineId)
    .order('seed_position', { ascending: true })
  if (error) throw new Error(error.message)
  return data ?? []
}

async function attendanceCountOf(matchdayId: string, entryId: string): Promise<number> {
  const db = adminClient()
  const { count, error } = await db
    .from('attendances')
    .select('id', { count: 'exact', head: true })
    .eq('matchday_id', matchdayId)
    .eq('entry_id', entryId)
  if (error) throw new Error(error.message)
  return count ?? 0
}

describe('discipline_entries — backfill de createSeason (REQ-D1-3)', () => {
  it('cada SQUAD de una temporada nueva entra a su disciplina con el mismo seed_position que en entries', async () => {
    const admin = await createTestUser()
    const { seasonId, entryIds, disciplineId } = await createSeason({
      admin,
      squad: await fillerPlayers(4),
    })

    const seats = await seatsOf(disciplineId)
    expect(seats).toHaveLength(4)
    expect(seats.map((seat) => seat.entry_id)).toEqual(entryIds)
    expect(seats.map((seat) => seat.seed_position)).toEqual([0, 1, 2, 3])

    // Una fila en `entries` por asiento — el plantel es del TORNEO, no se
    // duplica por disciplina.
    const db = adminClient()
    const { data: entryRows, error } = await db.from('entries').select('id').eq('season_id', seasonId)
    if (error) throw new Error(error.message)
    expect(entryRows).toHaveLength(4)
  })
})

describe('discipline_entries — un asiento en dos disciplinas, orden independiente (REQ-D1-3)', () => {
  it('la misma persona tiene seed_position distinto en cada disciplina que juega', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineIds } = await createSeason({
      admin,
      disciplines: [{ kind: 'PADEL' }, { kind: 'FIFA' }],
    })
    const [padelId, fifaId] = disciplineIds
    if (padelId === undefined || fifaId === undefined) throw new Error('Faltan disciplinas.')

    // A y C juegan las dos disciplinas; B sólo pádel — mismo entry, misma
    // fila en `entries`, seed_position que DIVERGE por disciplina apenas se
    // intercala un asiento que no juega las dos.
    const seatA = await addSeat(admin.client, seasonId, 'A', [padelId, fifaId])
    const seatB = await addSeat(admin.client, seasonId, 'B', [padelId])
    const seatC = await addSeat(admin.client, seasonId, 'C', [padelId, fifaId])

    const padelSeats = await seatsOf(padelId)
    const fifaSeats = await seatsOf(fifaId)

    expect(padelSeats.map((seat) => [seat.entry_id, seat.seed_position])).toEqual([
      [seatA, 0],
      [seatB, 1],
      [seatC, 2],
    ])
    // B nunca entró a FIFA: C queda en seed_position 1 ahí, no 2 — el orden de
    // una disciplina no arrastra al de la otra.
    expect(fifaSeats.map((seat) => [seat.entry_id, seat.seed_position])).toEqual([
      [seatA, 0],
      [seatC, 1],
    ])

    // Una sola fila en `entries` por persona, aunque juegue las dos.
    const db = adminClient()
    const { data: entryRows, error } = await db.from('entries').select('id').eq('season_id', seasonId)
    if (error) throw new Error(error.message)
    expect(entryRows).toHaveLength(3)
  })
})

describe('discipline_entries — solape parcial de plantel (REQ-D1-4)', () => {
  it('8 juegan pádel, 6 juegan FIFA, con 4 compartidos: discipline_entries refleja exactamente eso', async () => {
    const admin = await createTestUser()
    const { disciplineIds, seasonId } = await createSeason({
      admin,
      disciplines: [{ kind: 'PADEL' }, { kind: 'FIFA' }],
    })
    const [padelId, fifaId] = disciplineIds
    if (padelId === undefined || fifaId === undefined) throw new Error('Faltan disciplinas.')

    // 4 comparten las dos disciplinas, 4 juegan sólo pádel (8 en total) y 2
    // juegan sólo FIFA (6 en total: los 4 compartidos + estos 2). Secuencial
    // y no `Promise.all`: `add_squad_seat` lee `max(seed_position)` sin
    // trabar la tabla (ponytail documentado en 0013/0023) — dos altas
    // concurrentes del mismo plantel chocan contra `entries_seed`, que es
    // justo el ruido que este test no quiere probar.
    const both = await addSeats(admin.client, seasonId, ['Ambos 1', 'Ambos 2', 'Ambos 3', 'Ambos 4'], [
      padelId,
      fifaId,
    ])
    const padelOnly = await addSeats(admin.client, seasonId, ['Pádel 1', 'Pádel 2', 'Pádel 3', 'Pádel 4'], [
      padelId,
    ])
    const fifaOnly = await addSeats(admin.client, seasonId, ['FIFA 1', 'FIFA 2'], [fifaId])

    const padelSeats = new Set((await seatsOf(padelId)).map((seat) => seat.entry_id))
    const fifaSeats = new Set((await seatsOf(fifaId)).map((seat) => seat.entry_id))

    expect(padelSeats.size).toBe(8)
    expect(fifaSeats.size).toBe(6)
    for (const entryId of both) {
      expect(padelSeats.has(entryId)).toBe(true)
      expect(fifaSeats.has(entryId)).toBe(true)
    }
    for (const entryId of padelOnly) {
      expect(padelSeats.has(entryId)).toBe(true)
      expect(fifaSeats.has(entryId)).toBe(false)
    }
    for (const entryId of fifaOnly) {
      expect(padelSeats.has(entryId)).toBe(false)
      expect(fifaSeats.has(entryId)).toBe(true)
    }
  })
})

/** `add_squad_seat` con `p_disciplines`: la firma que la TS wrapper (db/entries.ts) todavía no expone. RPC directo, mismo patrón que el resto de esta suite. */
async function addSeat(
  client: Client,
  seasonId: string,
  name: string,
  disciplineIds: string[],
): Promise<string> {
  const { data, error } = await client.rpc('add_squad_seat', {
    p_season: seasonId,
    p_name: name,
    p_disciplines: disciplineIds,
  })
  if (error !== null || data === null) throw new Error(error?.message ?? 'add_squad_seat no devolvió id.')
  return data
}

/** Varios `addSeat`, uno detrás del otro — nunca en paralelo, ver el comentario de arriba. */
async function addSeats(
  client: Client,
  seasonId: string,
  names: string[],
  disciplineIds: string[],
): Promise<string[]> {
  const ids: string[] = []
  for (const name of names) {
    ids.push(await addSeat(client, seasonId, name, disciplineIds))
  }
  return ids
}

// ── §2.6 del diseño — "Quién juega" no tenía superficie ─────────────────────
// `discipline_entries` se llenaba al crear el torneo y en "+ Agregar
// disciplina" y de ahí en más no había forma de tocarla. Esta tanda prueba
// las escrituras nuevas (`db/discipline-entries.ts`) contra la base real: el
// alta, y las CUATRO guardas de sacar a alguien — ninguna FK las sostiene
// (`discipline_entries` tiene TRES constraints apuntándole hoy, desde DOS
// tablas: `attendances_entry_discipline` 0024:24, y `discipline_teams`
// 0068:70 (`entry_a`) más 0068:71 (`entry_b`) — ninguna de las tres frena un
// `delete`, las tres CASCADEAN en silencio) — así que si alguna guarda se
// borra, este archivo es lo único que lo nota. La de `discipline_teams` es
// la más nueva de las cuatro: desde que existe la pantalla de Equipos
// (`createTeam`, `db/discipline-teams.ts`) sí hay un escritor de producción
// que llena esa tabla, así que el guard de acá abajo (mismo patrón que el
// de `pair_locks`) deja de ser opcional.

describe('discipline_entries — agregar a una disciplina (§2.6)', () => {
  it('suma la fila con el próximo seed_position libre, sin tocar las demás disciplinas', async () => {
    const admin = await createTestUser()
    const { seasonId, entryIds, disciplineIds } = await createSeason({
      admin,
      squad: await fillerPlayers(4),
      disciplines: [{ kind: 'PADEL' }, { kind: 'FIFA' }],
    })
    const [padelId, fifaId] = disciplineIds
    if (padelId === undefined || fifaId === undefined) throw new Error('Faltan disciplinas.')
    const [target] = entryIds
    if (target === undefined) throw new Error('Falta el plantel.')

    // Sacarlo primero de FIFA (sin haber jugado, esto ya funciona) para
    // poder probar el alta contra un hueco real, no un asiento que nunca
    // se fue.
    await removeFromDiscipline(admin.client, fifaId, seasonId, target)
    expect((await seatsOf(fifaId)).some((seat) => seat.entry_id === target)).toBe(false)

    await addToDiscipline(admin.client, fifaId, seasonId, target)

    const fifaSeats = await seatsOf(fifaId)
    const readded = fifaSeats.find((seat) => seat.entry_id === target)
    expect(readded).toBeDefined()
    // Al FINAL: mayor que cualquier seed_position que ya hubiera en FIFA.
    expect(readded?.seed_position).toBe(Math.max(...fifaSeats.map((seat) => seat.seed_position)))

    // Pádel no se tocó: seguía siendo el plantel entero, en su orden de
    // siempre.
    const padelSeats = await seatsOf(padelId)
    expect(padelSeats.map((seat) => seat.entry_id)).toEqual(entryIds)
  })

  // M-4 (ronda de fix): un 23505 crudo de Postgres ("duplicate key value
  // violates unique constraint...", en inglés) no es un mensaje para la
  // pantalla -- mismo criterio que `removeSeat` traduciendo el 23503
  // (`db/entries.ts:191`). Dos altas AL MISMO asiento y disciplina siempre
  // pegan contra `discipline_entries_pkey`, nunca contra
  // `discipline_entries_seed` (esa es la de dos altas DISTINTAS
  // compitiendo por el mismo lugar, no cubierta acá: reproducirla necesita
  // una carrera real entre dos llamadas).
  //
  // Mutación probada a mano (revertida después, confirmando rojo → verde):
  // sacar el `if (error.code === '23505') {...}` de `addToDiscipline`
  // (`db/discipline-entries.ts`) → este test da ROJO, con el mensaje crudo
  // real de Postgres a la vista ('duplicate key value violates unique
  // constraint "discipline_entries_pkey"').
  it('agregar dos veces al mismo asiento en la misma disciplina da un mensaje en castellano, no el 23505 crudo', async () => {
    const admin = await createTestUser()
    const { seasonId, entryIds, disciplineIds } = await createSeason({
      admin,
      squad: await fillerPlayers(4),
      disciplines: [{ kind: 'PADEL' }, { kind: 'FIFA' }],
    })
    const [padelId] = disciplineIds
    if (padelId === undefined) throw new Error('Falta la disciplina.')
    const [target] = entryIds
    if (target === undefined) throw new Error('Falta el plantel.')

    // Ya juega Pádel (backfill de createSeason) -- un segundo alta pega
    // contra la PK.
    await expect(addToDiscipline(admin.client, padelId, seasonId, target)).rejects.toThrow(
      'Este jugador ya juega esta disciplina.',
    )
  })
})

/**
 * Mutación probada a mano (revertida después, confirmando rojo → verde):
 * - Cambiar `(count ?? 0) <= 1` por `(count ?? 0) < 1` en `assertMultiDiscipline`
 *   (`db/discipline-entries.ts`) → las dos aserciones de "rebotan" de abajo
 *   dan ROJO: `addToDiscipline` tira "Este jugador ya juega esta disciplina"
 *   (no matchea `/una sola disciplina/`) y `removeFromDiscipline` directamente
 *   RESUELVE en vez de rechazar (borra la fila).
 */
describe('discipline_entries — con una sola disciplina no hay nada que tocar (decisión del dueño 2, ronda de fix — BLOQUEA 2)', () => {
  it('addToDiscipline y removeFromDiscipline rebotan, y no tocan nada', async () => {
    const admin = await createTestUser()
    const { seasonId, entryIds, disciplineId } = await createSeason({
      admin,
      squad: await fillerPlayers(4),
    })
    const [target] = entryIds
    if (target === undefined) throw new Error('Falta el plantel.')

    await expect(addToDiscipline(admin.client, disciplineId, seasonId, target)).rejects.toThrow(/una sola disciplina/)
    await expect(removeFromDiscipline(admin.client, disciplineId, seasonId, target)).rejects.toThrow(
      /una sola disciplina/,
    )

    expect((await seatsOf(disciplineId)).some((seat) => seat.entry_id === target)).toBe(true)
  })

  it('con 2+, las dos siguen funcionando (no-regresión)', async () => {
    const admin = await createTestUser()
    const { seasonId, entryIds, disciplineIds } = await createSeason({
      admin,
      squad: await fillerPlayers(4),
      disciplines: [{ kind: 'PADEL' }, { kind: 'FIFA' }],
    })
    const [padelId, fifaId] = disciplineIds
    if (padelId === undefined || fifaId === undefined) throw new Error('Faltan disciplinas.')
    const [target] = entryIds
    if (target === undefined) throw new Error('Falta el plantel.')

    await removeFromDiscipline(admin.client, fifaId, seasonId, target)
    expect((await seatsOf(fifaId)).some((seat) => seat.entry_id === target)).toBe(false)
    await addToDiscipline(admin.client, fifaId, seasonId, target)
    expect((await seatsOf(fifaId)).some((seat) => seat.entry_id === target)).toBe(true)
    expect(padelId).not.toBe(fifaId)
  })
})

/**
 * Mutación probada a mano (revertida después, confirmando rojo → verde):
 * - Sacar el `.eq('season_id', seasonId)` del delete de `removeFromDiscipline`
 *   (`db/discipline-entries.ts`) → este test da ROJO ("promise resolved
 *   undefined instead of rejecting"), y la fila de la temporada B queda
 *   borrada de verdad -- exactamente el daño sin vuelta por la UI que
 *   `assertMultiDiscipline` existe para prevenir. Los demás tests del
 *   archivo (incluido "con 2+, las dos siguen funcionando" acá arriba)
 *   siguen en VERDE: el cruce sólo se nota cuando el `seasonId` que
 *   autoriza es de OTRA temporada, no cuando es el real.
 */
describe('discipline_entries — el seasonId que autoriza tiene que ser el DUEÑO de disciplineId (ronda de fix 2 — BLOQUEA 1)', () => {
  it('el seasonId de una temporada con 2+ disciplinas no autoriza a borrar en una temporada de 1 (mismo admin, dos torneos)', async () => {
    const admin = await createTestUser()
    // B: el 100% de producción, una sola disciplina -- es la que se ataca.
    const seasonB = await createSeason({ admin, squad: await fillerPlayers(4) })
    // A: 2+ disciplinas, del MISMO admin -- su seasonId es el que se cuela
    // como argumento "autorizador" sin ser el dueño de `seasonB.disciplineId`.
    const seasonA = await createSeason({
      admin,
      squad: await fillerPlayers(4),
      disciplines: [{ kind: 'PADEL' }, { kind: 'FIFA' }],
    })
    const [target] = seasonB.entryIds
    if (target === undefined) throw new Error('Falta el plantel de B.')

    // Con el seasonId REAL de B, la guarda de 1 disciplina rebota (ya
    // probado arriba) -- acá se repite sólo para dejar claro que el caso de
    // abajo NO es ese.
    await expect(
      removeFromDiscipline(admin.client, seasonB.disciplineId, seasonB.seasonId, target),
    ).rejects.toThrow(/una sola disciplina/)

    // El seasonId de A SÍ tiene 2+ disciplinas: `assertMultiDiscipline` lo
    // deja pasar. Pero `seasonB.disciplineId` no es una disciplina de A --
    // el delete tiene que rechazarlo igual, no borrar la fila de B.
    await expect(
      removeFromDiscipline(admin.client, seasonB.disciplineId, seasonA.seasonId, target),
    ).rejects.toThrow()

    expect((await seatsOf(seasonB.disciplineId)).some((seat) => seat.entry_id === target)).toBe(true)
  })
})

describe('discipline_entries — sacar de una disciplina sin haber jugado (§2.6)', () => {
  it('borra la fila de ESA disciplina, sin sacar del plantel ni de las demás', async () => {
    const admin = await createTestUser()
    const { seasonId, entryIds, disciplineIds } = await createSeason({
      admin,
      squad: await fillerPlayers(8),
      disciplines: [{ kind: 'PADEL' }, { kind: 'FIFA' }],
    })
    const [padelId, fifaId] = disciplineIds
    if (padelId === undefined || fifaId === undefined) throw new Error('Faltan disciplinas.')
    const [target] = entryIds
    if (target === undefined) throw new Error('Falta el plantel.')

    expect(await hasPlayedDiscipline(admin.client, padelId, target)).toBe(false)
    await removeFromDiscipline(admin.client, padelId, seasonId, target)

    expect((await seatsOf(padelId)).some((seat) => seat.entry_id === target)).toBe(false)
    // Sigue jugando FIFA: sacar de UNA disciplina no saca de las demás.
    expect((await seatsOf(fifaId)).some((seat) => seat.entry_id === target)).toBe(true)
    // Sigue en el plantel del TORNEO: esto no es `removeSeat` (`db/entries.ts`).
    const db = adminClient()
    const { data: entryRow } = await db.from('entries').select('id').eq('id', target).maybeSingle()
    expect(entryRow).not.toBeNull()
  })
})

/**
 * Mutaciones probadas a mano contra esta tanda (revertidas después de cada
 * corrida, confirmando rojo → verde):
 * - Borrar el `if (await hasPlayedDiscipline(...)) { throw ... }` de
 *   `removeFromDiscipline` (`db/discipline-entries.ts`) → el describe "ya
 *   jugada" de abajo da ROJO ("promise resolved undefined instead of
 *   rejecting"); los demás de este archivo siguen en VERDE.
 * - En `hasPlayedDiscipline`, sacar el `.eq('discipline_id', disciplineId)`
 *   del select de `matchdays` (deja la pregunta "¿jugó ALGUNA disciplina de
 *   la temporada?" en vez de "¿jugó ÉSTA?") → el describe "ya jugada" da
 *   ROJO en la aserción de FIFA (`hasPlayedDiscipline(..., fifaId, target)`
 *   pasa a dar `true` aunque FIFA no tiene ni una fecha creada).
 * - Borrar el bloque entero de `pair_locks` en `removeFromDiscipline` →
 *   el describe "pareja fija" da ROJO (resuelve en vez de rechazar, y borra
 *   la fila).
 * - Borrar el bloque entero de `attendances` en `removeFromDiscipline` →
 *   el describe "presentismo" da ROJO en la primera `it` (resuelve en vez de
 *   rechazar, y la asistencia queda en 0 — cascadeó).
 * - Sacar el `.eq('status', 'PLAYING')` del select de `attendances` (deja
 *   que un ABSENT también bloquee) → la segunda `it` del describe
 *   "presentismo" (ABSENT no bloquea) da ROJO: `removeFromDiscipline`
 *   rechaza en vez de resolver.
 *
 * `awards` NO tiene un chequeo ni un test acá (a diferencia de una versión
 * anterior de este archivo): verificado que es redundante con `pairs` —
 * `close_matchday` (`0067:56-64`) rechaza el cierre si algún premio nombra a
 * alguien sin fila en `pairs` de esa misma fecha, así que no hay forma de
 * que `awards` tenga una fila sin que `pairs` ya la tenga. El detalle completo
 * está en el docstring de `hasPlayedDiscipline`.
 */
describe('discipline_entries — sacar de una disciplina ya jugada rebota (decisión del dueño 1, §2.6)', () => {
  it('con pairs generados para esa disciplina, el delete no corre y la fila sigue ahí', async () => {
    const admin = await createTestUser()
    const config = defaultConfig(8)
    const { seasonId, entryIds, disciplineIds } = await createSeason({
      admin,
      config,
      squad: await fillerPlayers(8),
      disciplines: [{ kind: 'PADEL', config }, { kind: 'FIFA', config }],
    })
    const [padelId, fifaId] = disciplineIds
    if (padelId === undefined || fifaId === undefined) throw new Error('Faltan disciplinas.')

    // Arma una fecha de PÁDEL y le genera las parejas -- ni siquiera hace
    // falta abrirla ni cerrarla: `generatePairs` ya escribe en `pairs` con
    // la fecha en DRAFT (`db/matchday.ts:757`), que es lo que
    // `hasPlayedDiscipline` mira.
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05', padelId)
    for (const entryId of entryIds) {
      await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
    }
    await generatePairs(admin.client, matchdayId)

    const [target] = entryIds
    if (target === undefined) throw new Error('Falta el plantel.')

    expect(await hasPlayedDiscipline(admin.client, padelId, target)).toBe(true)
    await expect(removeFromDiscipline(admin.client, padelId, seasonId, target)).rejects.toThrow(/ya jugó/)

    // No borró nada: la fila de Pádel sigue.
    expect((await seatsOf(padelId)).some((seat) => seat.entry_id === target)).toBe(true)

    // FIFA no tiene ni una fecha creada: el mismo entry, en OTRA disciplina,
    // no está bloqueado -- la guarda es POR DISCIPLINA, no de la temporada
    // entera.
    expect(await hasPlayedDiscipline(admin.client, fifaId, target)).toBe(false)
    await removeFromDiscipline(admin.client, fifaId, seasonId, target)
    expect((await seatsOf(fifaId)).some((seat) => seat.entry_id === target)).toBe(false)
  })

  /**
   * M-1 (ronda de fix 2): el chequeo de `attendances` está acotado a fechas
   * en DRAFT (a propósito, ver el docstring de `removeFromDiscipline`) — así
   * que el test de arriba, con la fecha TODAVÍA en DRAFT, no aísla
   * `hasPlayedDiscipline`: si se le borra el chequeo, el de `attendances`
   * tapa el agujero y el test de arriba sigue rechazando igual (con OTRO
   * mensaje). La única situación donde `hasPlayedDiscipline` está SOLO es
   * una fecha que ya no es DRAFT (OPEN o CLOSED) -- que es justo el caso
   * real que le importa (partidos y premios reales, no un armado en curso).
   *
   * Mutación probada a mano (revertida después, confirmando rojo → verde):
   * borrar el `if (await hasPlayedDiscipline(...))` de `removeFromDiscipline`
   * → este test da ROJO ("promise resolved undefined instead of
   * rejecting" -- ni `pair_locks` ni `attendances` lo tapan acá, porque no
   * hay lock y la fecha ya no es DRAFT).
   */
  it('con la fecha ya OPEN (no DRAFT), sacar sigue rebotando por "ya jugó" -- nada más lo cubre ahí', async () => {
    const admin = await createTestUser()
    const config = defaultConfig(8)
    const { seasonId, entryIds, disciplineIds } = await createSeason({
      admin,
      config,
      squad: await fillerPlayers(8),
      disciplines: [{ kind: 'PADEL', config }, { kind: 'FIFA', config }],
    })
    const [padelId] = disciplineIds
    if (padelId === undefined) throw new Error('Falta la disciplina.')

    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05', padelId)
    for (const entryId of entryIds) {
      await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
    }
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)

    const [target] = entryIds
    if (target === undefined) throw new Error('Falta el plantel.')

    await expect(removeFromDiscipline(admin.client, padelId, seasonId, target)).rejects.toThrow(/ya jugó/)
    expect((await seatsOf(padelId)).some((seat) => seat.entry_id === target)).toBe(true)
  })
})

describe('discipline_entries — pareja fija sin resolver bloquea sacar (ronda de fix — BLOQUEA 3)', () => {
  it('con un pair_lock armado para una fecha DRAFT de esta disciplina, sacar rebota y no borra nada', async () => {
    const admin = await createTestUser()
    const { seasonId, entryIds, disciplineIds } = await createSeason({
      admin,
      squad: await fillerPlayers(8),
      disciplines: [{ kind: 'PADEL' }, { kind: 'FIFA' }],
    })
    const [padelId, fifaId] = disciplineIds
    if (padelId === undefined || fifaId === undefined) throw new Error('Faltan disciplinas.')
    const [target] = entryIds
    if (target === undefined) throw new Error('Falta el plantel.')

    // `lockPair` sólo exige que UNO de los dos lados sea invitado
    // (`assertLocksAndGuests`, `db/validate.ts:216-236`) -- no hace falta
    // presentismo para armar el lock, así que esta fixture no toca
    // `attendances` y prueba el chequeo de `pair_locks` aislado del de
    // presentismo (que es el describe de abajo).
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05', padelId)
    const guestId = await addGuest(admin.client, matchdayId, { displayName: 'Invitado de test' })
    await lockPair(admin.client, matchdayId, target, guestId)

    expect(await hasPlayedDiscipline(admin.client, padelId, target)).toBe(false)
    await expect(removeFromDiscipline(admin.client, padelId, seasonId, target)).rejects.toThrow(/pareja fija/)

    expect((await seatsOf(padelId)).some((seat) => seat.entry_id === target)).toBe(true)
  })
})

// Precedente más cercano: la guarda de `pair_locks` de acá arriba, pero de
// la DISCIPLINA entera en vez de una fecha puntual -- el escritor de filas
// que faltaba (`createTeam`, `db/discipline-teams.ts`) es lo que esta misma
// tanda agrega, y es lo que vuelve a este cuarto guard NECESARIO (ver el
// comentario actualizado arriba del describe de "§2.6").
describe('discipline_entries — equipo fijo armado bloquea sacar (equipos fijos, docs/tipos-de-torneo.md §1)', () => {
  // Mutación probada a mano (revertida después, confirmando rojo → verde):
  // sacar el bloque entero de `discipline_teams` en `removeFromDiscipline`
  // (`db/discipline-entries.ts`) → este test da ROJO (resuelve en vez de
  // rechazar, y `partner` queda en un equipo roto: su fila de
  // `discipline_teams` cascadeó con la de `target`, pero `partner` sigue
  // jugando la disciplina sin compañero y sin que nadie se entere).
  it('con un equipo armado en esta disciplina, sacar a CUALQUIERA de los dos rebota y no borra nada', async () => {
    const admin = await createTestUser()
    const players = await fillerPlayers(8)
    const { seasonId, entryIds, disciplineIds } = await createSeason({
      admin,
      squad: players,
      disciplines: [{ kind: 'PADEL' }, { kind: 'FIFA' }],
    })
    const [padelId, fifaId] = disciplineIds
    if (padelId === undefined || fifaId === undefined) throw new Error('Faltan disciplinas.')
    const [target, partner] = entryIds
    if (target === undefined || partner === undefined) throw new Error('Falta el plantel.')

    const db = adminClient()
    const { error: flagError } = await db.from('disciplines').update({ fixed_teams: true }).eq('id', padelId)
    if (flagError) throw new Error(flagError.message)
    const { error: teamError } = await db
      .from('discipline_teams')
      .insert({ discipline_id: padelId, entry_a: target, entry_b: partner, season_id: seasonId })
    if (teamError) throw new Error(teamError.message)

    expect(await hasPlayedDiscipline(admin.client, padelId, target)).toBe(false)
    await expect(removeFromDiscipline(admin.client, padelId, seasonId, target)).rejects.toThrow(/equipo armado/)
    await expect(removeFromDiscipline(admin.client, padelId, seasonId, partner)).rejects.toThrow(/equipo armado/)

    expect((await seatsOf(padelId)).some((seat) => seat.entry_id === target)).toBe(true)
    expect((await seatsOf(padelId)).some((seat) => seat.entry_id === partner)).toBe(true)

    // FIFA no tiene ningún equipo: sacar a `target` de ahí sigue andando --
    // la guarda es POR DISCIPLINA, mismo criterio que las otras tres.
    await removeFromDiscipline(admin.client, fifaId, seasonId, target)
    expect((await seatsOf(fifaId)).some((seat) => seat.entry_id === target)).toBe(false)
  })
})

describe('discipline_entries — presentismo en una fecha sin armar bloquea sacar (ronda de fix — BLOQUEA 3)', () => {
  it('marcado PLAYING en una fecha DRAFT sin sortear, sacar rebota y no borra la asistencia', async () => {
    const admin = await createTestUser()
    const { seasonId, entryIds, disciplineIds } = await createSeason({
      admin,
      squad: await fillerPlayers(8),
      disciplines: [{ kind: 'PADEL' }, { kind: 'FIFA' }],
    })
    const [padelId, fifaId] = disciplineIds
    if (padelId === undefined || fifaId === undefined) throw new Error('Faltan disciplinas.')
    const [target] = entryIds
    if (target === undefined) throw new Error('Falta el plantel.')

    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05', padelId)
    await setAttendance(admin.client, matchdayId, target, 'PLAYING')

    expect(await hasPlayedDiscipline(admin.client, padelId, target)).toBe(false)
    await expect(removeFromDiscipline(admin.client, padelId, seasonId, target)).rejects.toThrow(/presente/)

    expect((await seatsOf(padelId)).some((seat) => seat.entry_id === target)).toBe(true)
    // La asistencia SIGUE ahí: si `attendances_entry_discipline` (0024)
    // hubiera cascadeado, esto daría 0.
    expect(await attendanceCountOf(matchdayId, target)).toBe(1)
  })

  it('marcado ABSENT no bloquea: no hay nada real que perder en una fecha que ni jugó', async () => {
    const admin = await createTestUser()
    const { seasonId, entryIds, disciplineIds } = await createSeason({
      admin,
      squad: await fillerPlayers(8),
      disciplines: [{ kind: 'PADEL' }, { kind: 'FIFA' }],
    })
    const [padelId, fifaId] = disciplineIds
    if (padelId === undefined || fifaId === undefined) throw new Error('Faltan disciplinas.')
    const [target] = entryIds
    if (target === undefined) throw new Error('Falta el plantel.')

    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05', padelId)
    await setAttendance(admin.client, matchdayId, target, 'ABSENT')

    await removeFromDiscipline(admin.client, padelId, seasonId, target)
    expect((await seatsOf(padelId)).some((seat) => seat.entry_id === target)).toBe(false)
  })
})
