import { describe, expect, it } from 'vitest'
import { defaultConfig, partnerOf } from '@/core'
import {
  addGuest,
  closeMatchday,
  createMatchday,
  generatePairs,
  lockPair,
  nameGuest,
  openMatchday,
  redraftMatchday,
  reopenMatchday,
  saveResult,
  setAttendance,
  syncGuestSeat,
} from './matchday'
import { promoteGuest } from './entries'
import { disciplineConfig } from './discipline'
import { entriesOf, matchdayDetail, pairLocksOf, seasonSquadMembersOf } from './read'
import { defaultDisciplineId, frozenPointsOf } from './season'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser, type TestUser } from './test/users'

/** El plantel de UNA disciplina, en orden de discipline_entries.seed_position. */
async function disciplineSeedPositions(
  seasonId: string,
): Promise<Array<{ id: string; seed_position: number }>> {
  const db = adminClient()
  const disciplineId = await defaultDisciplineId(db, seasonId)
  if (disciplineId === null) throw new Error('La temporada no tiene disciplina.')
  const { data, error } = await db
    .from('discipline_entries')
    .select('entry_id, seed_position')
    .eq('discipline_id', disciplineId)
    .order('seed_position', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({ id: row.entry_id, seed_position: row.seed_position }))
}

// ── scaffolding local a este archivo ────────────────────────────────────────
// Mismo criterio que cancel.db.test.ts: esta lista de armadores sólo le sirve
// a promote_guest, así que no va a db/test/factories.ts.

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

async function buildSeasonWithSquad(
  squad: string[],
): Promise<{ admin: TestUser; seasonId: string; entryIds: string[] }> {
  const admin = await createTestUser()
  const { seasonId, entryIds } = await createSeason({ admin, config: defaultConfig(8), squad })
  return { admin, seasonId, entryIds }
}

async function markAllPlaying(admin: TestUser, matchdayId: string, entryIds: string[]): Promise<void> {
  for (const entryId of entryIds) {
    await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
  }
}

async function matchesOf(matchdayId: string): Promise<Array<{ id: string; pair_a: string; pair_b: string }>> {
  const db = adminClient()
  const { data, error } = await db.from('matches').select('id, pair_a, pair_b').eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Carga un 4-1 en cada partido, siempre gana `pair_a`: alcanza para cerrar, nadie necesita saber quién ganó. */
async function playAllMatches(admin: TestUser, matchdayId: string): Promise<void> {
  for (const match of await matchesOf(matchdayId)) {
    await saveResult(admin.client, match.id, [{ gamesA: 4, gamesB: 1 }])
  }
}

interface EntryRow {
  id: string
  kind: 'SQUAD' | 'GUEST'
  matchday_id: string | null
  seed_position: number
  display_name: string
  season_id: string
}

async function entryRow(entryId: string): Promise<EntryRow> {
  const db = adminClient()
  const { data, error } = await db
    .from('entries')
    .select('id, kind, matchday_id, seed_position, display_name, season_id')
    .eq('id', entryId)
    .single()
  if (error || data === null) throw new Error(error?.message)
  return data as EntryRow
}

interface AwardRow {
  entry_id: string
  position: number
  points: number
}

async function awardsOf(matchdayId: string): Promise<AwardRow[]> {
  const db = adminClient()
  const { data, error } = await db
    .from('awards')
    .select('entry_id, position, points')
    .eq('matchday_id', matchdayId)
    .order('entry_id', { ascending: true })
  if (error) throw new Error(error.message)
  return data ?? []
}

async function squadSeedPositions(seasonId: string): Promise<Array<{ id: string; seed_position: number }>> {
  const db = adminClient()
  const { data, error } = await db
    .from('entries')
    .select('id, seed_position')
    .eq('season_id', seasonId)
    .eq('kind', 'SQUAD')
    .order('seed_position', { ascending: true })
  if (error) throw new Error(error.message)
  return data ?? []
}

/**
 * Arma una fecha CLOSED con un invitado SUELTO: plantel de 8, uno ausente
 * (7 presentes), `syncGuestSeat` agrega el invitado que faltaba para volver a
 * 8 y par. Con un solo invitado, `buildPairs` no tiene con quién más
 * emparejarlo que un asiento del plantel — no puede salir una pareja toda
 * invitada de acá, así que esto SIEMPRE da el caso "compañero paga" (spec 3.1).
 */
async function closedMatchdayWithLooseGuest(
  playedOn: string,
): Promise<{ admin: TestUser; seasonId: string; squad: string[]; matchdayId: string; guestId: string; partnerId: string }> {
  const squad = await fillerPlayers(8)
  const { admin, seasonId, entryIds } = await buildSeasonWithSquad(squad)
  const matchdayId = await createMatchday(admin.client, seasonId, playedOn)
  await markAllPlaying(admin, matchdayId, entryIds)
  await setAttendance(admin.client, matchdayId, entryIds[0]!, 'ABSENT')
  await syncGuestSeat(admin.client, matchdayId)

  const [guestId] = (await matchdayDetail(admin.client, matchdayId)).guestIds
  if (guestId === undefined) throw new Error('syncGuestSeat no agregó invitado.')
  await nameGuest(admin.client, guestId, 'Invitado suelto de test')

  await generatePairs(admin.client, matchdayId)
  const side = (await matchdayDetail(admin.client, matchdayId)).sides.find(
    (candidate) => candidate.a === guestId || (candidate.size === 2 && candidate.b === guestId),
  )
  if (side === undefined) throw new Error('El invitado no quedó en ninguna pareja.')
  // Esta factory arma una temporada de PÁDEL, así que el compañero existe;
  // `partnerOf` devolvería `null` en una de a uno y ahí este helper no aplica.
  const partnerId = partnerOf(side, guestId)
  if (partnerId === null) throw new Error('El invitado jugó solo: esta factory arma pádel.')

  await openMatchday(admin.client, matchdayId)
  await playAllMatches(admin, matchdayId)
  await closeMatchday(admin.client, matchdayId)

  return { admin, seasonId, squad: entryIds, matchdayId, guestId, partnerId }
}

describe('promoteGuest — spec 3.1: se copia el award congelado del compañero', () => {
  it('el invitado se lleva EXACTAMENTE el position y los points que ya tenía su compañero, sin tocar ninguna otra fila', async () => {
    const { admin, matchdayId, guestId, partnerId } = await closedMatchdayWithLooseGuest('2026-08-10')

    const before = await awardsOf(matchdayId)
    const partnerAward = before.find((row) => row.entry_id === partnerId)
    if (partnerAward === undefined) throw new Error('El compañero no tiene award — el escenario de test está mal armado.')

    await promoteGuest(admin.client, guestId)

    const after = await awardsOf(matchdayId)
    const guestAward = after.find((row) => row.entry_id === guestId)
    expect(guestAward).toEqual({ entry_id: guestId, position: partnerAward.position, points: partnerAward.points })

    // El compañero, byte a byte igual — nunca se reescribe.
    expect(after.find((row) => row.entry_id === partnerId)).toEqual(partnerAward)

    // Ninguna otra fila de esta fecha cambió: exactamente una fila nueva, el resto intacto.
    expect(after).toHaveLength(before.length + 1)
    for (const row of before) {
      expect(after).toContainEqual(row)
    }

    // El asiento pasó a SQUAD, salió de la fecha (matchday_id null), y cayó al final del plantel.
    const promoted = await entryRow(guestId)
    expect(promoted.kind).toBe('SQUAD')
    expect(promoted.matchday_id).toBeNull()
    expect(promoted.seed_position).toBe(8) // los 8 asientos originales van 0..7
  })

  it('no toca los awards de NINGUNA otra fecha de la temporada', async () => {
    const squad = await fillerPlayers(8)
    const { admin, seasonId, entryIds } = await buildSeasonWithSquad(squad)

    // Fecha 1: cerrada, normal, sin invitados. Sirve de testigo.
    const firstId = await createMatchday(admin.client, seasonId, '2026-08-03')
    await markAllPlaying(admin, firstId, entryIds)
    await generatePairs(admin.client, firstId)
    await openMatchday(admin.client, firstId)
    await playAllMatches(admin, firstId)
    await closeMatchday(admin.client, firstId)
    const firstAwardsBefore = await awardsOf(firstId)
    expect(firstAwardsBefore.length).toBeGreaterThan(0)

    // Fecha 2: la del invitado suelto, armada a mano acá porque
    // closedMatchdayWithLooseGuest crea su PROPIA temporada.
    const secondId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, secondId, entryIds)
    await setAttendance(admin.client, secondId, entryIds[0]!, 'ABSENT')
    await syncGuestSeat(admin.client, secondId)
    const [guestId] = (await matchdayDetail(admin.client, secondId)).guestIds
    if (guestId === undefined) throw new Error('syncGuestSeat no agregó invitado.')
    await nameGuest(admin.client, guestId, 'Invitado suelto')
    await generatePairs(admin.client, secondId)
    await openMatchday(admin.client, secondId)
    await playAllMatches(admin, secondId)
    await closeMatchday(admin.client, secondId)

    await promoteGuest(admin.client, guestId)

    // Que la promoción HAYA PASADO, primero: sin esto el test pasaba igual
    // contra un `promote_guest` completamente no-op, porque lo único que
    // afirmaba era que otra fecha seguía igual.
    expect((await entryRow(guestId)).kind).toBe('SQUAD')
    expect(await awardsOf(firstId)).toEqual(firstAwardsBefore)
  })
})

/**
 * Arma la fecha del incidente C1: 8 del plantel presentes + una PAREJA
 * INVITADA trabada = 5 parejas, y `defaultConfig(8)` sólo tiene 4 valores de
 * puntos. Es legal justamente porque `computeAwards` excluye a la pareja toda
 * invitada de las posiciones que pagan; promover a uno de sus dos integrantes
 * la mete adentro y rompe la cuenta.
 */
async function closedMatchdayWithGuestPair(): Promise<{
  admin: TestUser
  seasonId: string
  matchdayId: string
  guestA: string
  guestB: string
}> {
  const squad = await fillerPlayers(8)
  const { admin, seasonId, entryIds } = await buildSeasonWithSquad(squad)
  const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
  await markAllPlaying(admin, matchdayId, entryIds)

  const guestA = await addGuest(admin.client, matchdayId, { displayName: 'Invitado A' })
  const guestB = await addGuest(admin.client, matchdayId, { displayName: 'Invitado B' })
  await lockPair(admin.client, matchdayId, guestA, guestB)

  await generatePairs(admin.client, matchdayId)
  await openMatchday(admin.client, matchdayId)
  await playAllMatches(admin, matchdayId)
  await closeMatchday(admin.client, matchdayId)

  return { admin, seasonId, matchdayId, guestA, guestB }
}

describe('promoteGuest — spec 3.2: pareja toda invitada, se REFUSA', () => {
  it('no lo promueve y explica por qué: esa pareja no cobró y sumarlo le cambiaría los puntos a los demás', async () => {
    const { admin, matchdayId, guestA, guestB } = await closedMatchdayWithGuestPair()

    const before = await awardsOf(matchdayId)
    expect(before.some((row) => row.entry_id === guestA || row.entry_id === guestB)).toBe(false)

    await expect(promoteGuest(admin.client, guestA)).rejects.toThrow(
      /jugó en una pareja que no cobró puntos.*no se puede desde esta fecha/,
    )

    // Nada se movió: ni el asiento ni una sola fila de awards.
    expect((await entryRow(guestA)).kind).toBe('GUEST')
    expect(await awardsOf(matchdayId)).toEqual(before)
  })

  it('la fecha sigue pudiendo repartir sus puntos: reabrirla y volver a cerrarla no rompe nada', async () => {
    // El daño real del salteo silencioso: `close_matchday` recalculaba con una
    // pareja paga de más y la fecha quedaba OPEN para siempre, con los awards
    // ya borrados por el reopen. Con el refuso, este ida y vuelta tiene que
    // devolver EXACTAMENTE los mismos awards.
    const { admin, matchdayId, guestA } = await closedMatchdayWithGuestPair()
    const before = await awardsOf(matchdayId)

    await expect(promoteGuest(admin.client, guestA)).rejects.toThrow(/no se puede desde esta fecha/)

    await reopenMatchday(admin.client, matchdayId)
    await closeMatchday(admin.client, matchdayId)

    expect(await awardsOf(matchdayId)).toEqual(before)
  })
})

/**
 * El cuantificador del guard, que es lo que hacía falta arreglar: con "ALGUNA
 * pareja suya tiene compañero que cobró" alcanzaba para promoverlo, y la OTRA
 * pareja —la toda invitada— entraba a `paying` igual al voltear `kind`. O sea,
 * el incidente original entero, por la puerta de al lado.
 *
 * Este estado no lo produce la app: `generatePairs` borra las `pairs` de la
 * fecha antes de insertar (db/matchday.ts:458), así que `buildPairs` nunca mete
 * un entry en dos parejas. Se arma a mano —igual que el test del `unique` de
 * más abajo— porque está adentro del contrato que `promote_guest` dice
 * defender, y medido contra la base el guard viejo lo dejaba pasar: promoción
 * exitosa, y después la página tirando "La fecha tiene 6 parejas del torneo
 * pero la lista de puntos sólo tiene 4 valores."
 */
describe('promoteGuest — el invitado en DOS parejas, una de ellas sin cobrar', () => {
  it('se REFUSA aunque una de sus parejas sí tenga compañero con award', async () => {
    const { admin, seasonId, matchdayId, guestA } = await closedMatchdayWithGuestPair()
    const db = adminClient()

    // Una segunda `pairs` para gA, contra un asiento del plantel que SÍ cobró:
    // es exactamente lo que hacía pasar el guard viejo.
    const payingSeat = (await awardsOf(matchdayId))[0]?.entry_id
    if (payingSeat === undefined) throw new Error('La fecha de test no repartió ningún award.')
    const { error } = await db
      .from('pairs')
      .insert({ matchday_id: matchdayId, season_id: seasonId, entry_a: guestA, entry_b: payingSeat })
    if (error !== null) throw new Error(error.message)

    const before = await awardsOf(matchdayId)

    await expect(promoteGuest(admin.client, guestA)).rejects.toThrow(
      /jugó en una pareja que no cobró puntos.*no se puede desde esta fecha/,
    )

    // Sigue de invitado, así que su pareja con gB sigue afuera de `paying` y
    // la cuenta de la pantalla no cambió. Ni un award nuevo.
    expect((await entryRow(guestA)).kind).toBe('GUEST')
    expect(await awardsOf(matchdayId)).toEqual(before)
  })
})

describe('promoteGuest — invitado nunca sorteado en una pareja de esa fecha', () => {
  it('se REFUSA con su propio mensaje: no hay nada suyo que conservar en esta fecha', async () => {
    const { admin, seasonId, matchdayId } = await closedMatchdayWithLooseGuest('2026-08-10')
    const db = adminClient()

    // Se arma a mano, salteando generatePairs a propósito: es el único modo de
    // tener un GUEST en una fecha CLOSED sin una fila en `pairs`.
    const { data: loose, error } = await db
      .from('entries')
      .insert({
        season_id: seasonId,
        matchday_id: matchdayId,
        kind: 'GUEST',
        display_name: 'Nunca sorteado',
        seed_position: 999,
      })
      .select('id')
      .single()
    if (error || loose === null) throw new Error(error?.message)

    const before = await awardsOf(matchdayId)

    await expect(promoteGuest(admin.client, loose.id)).rejects.toThrow(
      /no quedó en ninguna pareja/,
    )

    expect(await awardsOf(matchdayId)).toEqual(before)
    expect((await entryRow(loose.id)).kind).toBe('GUEST')
  })
})

/**
 * El `pair_lock` huérfano. La app deja elegir "Juega con ‹asiento del plantel›"
 * para el invitado suelto (`armado.tsx`, el select de la tarjeta del invitado),
 * y eso escribe un `pair_locks` de GUEST + SQUAD. Esa pareja COBRA, así que el
 * compañero tiene award y `promote_guest` acepta — y si la traba sobrevive al
 * flip, queda con los dos lados en SQUAD, violando "toda pareja trabada incluye
 * a un invitado" (0001_schema.sql:122-125).
 *
 * No es un estado armado a mano: todo el escenario son acciones normales de la
 * pantalla. Y no se puede deshacer desde ninguna pantalla —la traba huérfana no
 * se dibuja en ningún lado, así que no hay botón para destrabarla—, con lo cual
 * la fecha queda sin poder sortear ni abrir, y `matchdays_one_live` traba con
 * ella toda la temporada.
 */
describe('promoteGuest — la traba de armado no puede sobrevivir a la promoción', () => {
  it('borra el pair_lock del invitado en esa fecha, y la fecha vuelve a poder sortearse', async () => {
    const squad = await fillerPlayers(8)
    const { admin, seasonId, entryIds } = await buildSeasonWithSquad(squad)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, entryIds)
    await setAttendance(admin.client, matchdayId, entryIds[0]!, 'ABSENT')
    await syncGuestSeat(admin.client, matchdayId)

    const [guestId] = (await matchdayDetail(admin.client, matchdayId)).guestIds
    if (guestId === undefined) throw new Error('syncGuestSeat no agregó invitado.')
    await nameGuest(admin.client, guestId, 'Invitado con pareja elegida')

    // Esto es exactamente lo que hace `setGuestPartner` cuando el admin elige
    // "Juega con ‹asiento›" en el armado: una traba GUEST + SQUAD.
    const chosenSeat = entryIds[1]!
    await lockPair(admin.client, matchdayId, guestId, chosenSeat)
    expect(await pairLocksOf(adminClient(), matchdayId)).toHaveLength(1)

    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)
    await playAllMatches(admin, matchdayId)
    await closeMatchday(admin.client, matchdayId)

    await promoteGuest(admin.client, guestId)

    // Con `service_role` y no con `admin.client`: leyendo por RLS, un `[]`
    // podría venir de la política y no del borrado, y sería una aserción que no
    // puede fallar. Mismo criterio que `db/cancel.db.test.ts`.
    expect(await pairLocksOf(adminClient(), matchdayId)).toHaveLength(0)
    expect((await entryRow(guestId)).kind).toBe('SQUAD')

    // Y el motivo por el que importa: la fecha vuelve al armado y sortea. Con
    // la traba viva, esto tiraba "Una pareja fijada a mano tiene que incluir a
    // un invitado", igual que `openMatchday` — y la única salida era borrar la
    // fecha jugada.
    await reopenMatchday(admin.client, matchdayId)
    await redraftMatchday(admin.client, matchdayId)
    // El que faltaba vuelve: sin el invitado (que ahora es del plantel y no
    // tiene asistencia en esta fecha) quedaban 7 presentes, y 7 no se juega de
    // a pares. Es una acción normal del armado, no andamiaje.
    await setAttendance(admin.client, matchdayId, entryIds[0]!, 'PLAYING')
    await generatePairs(admin.client, matchdayId)

    expect((await matchdayDetail(admin.client, matchdayId)).sides).toHaveLength(4)
  })
})

describe('promoteGuest — spec 3.6: usa la ubicación de la Capability 2', () => {
  // `entries.seed_position` cambió de significado en torneo-multi-disciplina
  // PR 7 (0023_discipline_entries.sql): `shift_seeds_up` dejó de tocar
  // `entries` — corre `discipline_entries` — y el restatement de
  // `promote_guest` en esa misma migración documenta la misma degradación
  // aceptada que `add_squad_seat`: `p_before` se sigue validando (mismo
  // mensaje si no existe), pero ya no reserva lugar en `entries`, que pasa a
  // recibir el asiento SIEMPRE al final (dual-write, dejará de existir para
  // SQUAD en PR 25). Su propia fila en `discipline_entries` —donde `p_before`
  // SÍ posiciona— es el test de abajo (PR 9, "promote_guest restatement #1/3").
  it('"antes de" sigue validando el asiento, pero entries.seed_position ya no lo posiciona (degradación aceptada)', async () => {
    const { admin, seasonId, matchdayId, guestId } = await closedMatchdayWithLooseGuest('2026-08-10')
    const before = await squadSeedPositions(seasonId)
    const target = before[2]
    if (target === undefined) throw new Error('Falta el asiento de test.')

    await promoteGuest(admin.client, guestId, target.id)

    const after = await squadSeedPositions(seasonId)
    expect(after).toHaveLength(9)
    // Al final (max + 1 = 8), no en la posición 2 que pedía `p_before`.
    expect(after.find((e) => e.id === guestId)?.seed_position).toBe(8)
    // Nadie de los 8 preexistentes se corrió: sin `discipline_entries` propia
    // todavía, no hay nada que parkear en `entries`.
    expect(after.filter((e) => e.id !== guestId).map((e) => e.seed_position)).toEqual(
      before.map((e) => e.seed_position),
    )
    // Sin huecos ni duplicados en 0..8.
    expect(after.map((e) => e.seed_position).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 9 }, (_, i) => i),
    )
  })

  // PR 9 (0025, "promote_guest restatement #1/3"): el invitado promovido SÍ
  // entra a discipline_entries de la disciplina de ESTA fecha, y ahí `p_before`
  // vuelve a reservar el lugar exacto — la degradación del test de arriba es
  // sólo de `entries`, nunca de la fuente real del orden.
  it('entra a discipline_entries de la disciplina de esta fecha, al final si p_before es null', async () => {
    const { admin, seasonId, guestId } = await closedMatchdayWithLooseGuest('2026-08-10')
    const before = await disciplineSeedPositions(seasonId)
    expect(before).toHaveLength(8)

    await promoteGuest(admin.client, guestId)

    const after = await disciplineSeedPositions(seasonId)
    expect(after).toHaveLength(9)
    expect(after.find((seat) => seat.id === guestId)?.seed_position).toBe(8)
    expect(after.filter((seat) => seat.id !== guestId)).toEqual(before)
  })

  it('con p_before puntual, corre la cola de discipline_entries igual que add_squad_seat', async () => {
    const { admin, seasonId, guestId } = await closedMatchdayWithLooseGuest('2026-08-10')
    const before = await disciplineSeedPositions(seasonId)
    const target = before[2]
    if (target === undefined) throw new Error('Falta el asiento de test.')

    await promoteGuest(admin.client, guestId, target.id)

    const after = await disciplineSeedPositions(seasonId)
    expect(after).toHaveLength(9)
    expect(after.find((seat) => seat.id === guestId)?.seed_position).toBe(2)
    expect(after.find((seat) => seat.id === target.id)?.seed_position).toBe(3)
    expect(after.filter((seat) => seat.id !== guestId).map((seat) => seat.id)).toEqual(
      before.map((seat) => seat.id),
    )
    expect(after.map((seat) => seat.seed_position).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 9 }, (_, i) => i),
    )
  })

  it('rechaza un p_before que no es un asiento SQUAD de esta temporada, sin promover nada', async () => {
    const { admin, seasonId, guestId } = await closedMatchdayWithLooseGuest('2026-08-10')
    const before = await squadSeedPositions(seasonId)

    await expect(
      promoteGuest(admin.client, guestId, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow(/no está en el plantel/)

    const after = await squadSeedPositions(seasonId)
    expect(after).toEqual(before)
  })
})

describe('promoteGuest — spec 3.3 y la instrucción vigente (refuso CUALQUIER fecha no CLOSED)', () => {
  it('DRAFT: refusa con el mensaje que manda a sacarlo y sumarlo como plantel', async () => {
    const squad = await fillerPlayers(8)
    const { admin, seasonId } = await buildSeasonWithSquad(squad)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    const guestId = await addGuest(admin.client, matchdayId, { displayName: 'Invitado en armado' })

    await expect(promoteGuest(admin.client, guestId)).rejects.toThrow(
      /se está armando.*Sacalo de invitado/,
    )

    expect((await entryRow(guestId)).kind).toBe('GUEST')
  })

  it('OPEN: refusa con el mensaje que manda a cerrar la fecha primero', async () => {
    const squad = await fillerPlayers(8)
    const { admin, seasonId, entryIds } = await buildSeasonWithSquad(squad)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, entryIds)
    await setAttendance(admin.client, matchdayId, entryIds[0]!, 'ABSENT')
    await syncGuestSeat(admin.client, matchdayId)
    const [guestId] = (await matchdayDetail(admin.client, matchdayId)).guestIds
    if (guestId === undefined) throw new Error('syncGuestSeat no agregó invitado.')
    await nameGuest(admin.client, guestId, 'Invitado en juego')
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)

    await expect(promoteGuest(admin.client, guestId)).rejects.toThrow(
      /está en juego.*Cerrala primero/,
    )

    expect((await entryRow(guestId)).kind).toBe('GUEST')
  })
})

describe('promoteGuest — spec 3.5: un invitado sin nombre no se puede promover', () => {
  it('refusa pidiendo el nombre, no con el constraint crudo de la base', async () => {
    const squad = await fillerPlayers(8)
    const { admin, seasonId } = await buildSeasonWithSquad(squad)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    const guestId = await addGuest(admin.client, matchdayId, { displayName: '' })

    await expect(promoteGuest(admin.client, guestId)).rejects.toThrow(/nombre/)

    expect((await entryRow(guestId)).kind).toBe('GUEST')
  })
})

describe('promoteGuest — spec 3.9: sólo el admin', () => {
  it('un jugador del plantel que no organiza recibe "sólo quien organiza" y no cambia nada', async () => {
    const member = await createTestUser()
    const filler = await fillerPlayers(7)
    const admin = await createTestUser()
    const { seasonId, entryIds } = await createSeason({
      admin,
      config: defaultConfig(8),
      squad: [member.playerId, ...filler],
    })
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, entryIds)
    await setAttendance(admin.client, matchdayId, entryIds[0]!, 'ABSENT')
    await syncGuestSeat(admin.client, matchdayId)
    const [guestId] = (await matchdayDetail(admin.client, matchdayId)).guestIds
    if (guestId === undefined) throw new Error('syncGuestSeat no agregó invitado.')
    await nameGuest(admin.client, guestId, 'Invitado')
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)
    await playAllMatches(admin, matchdayId)
    await closeMatchday(admin.client, matchdayId)

    await expect(promoteGuest(member.client, guestId)).rejects.toThrow(/Sólo quien organiza/)

    expect((await entryRow(guestId)).kind).toBe('GUEST')
  })
})

describe('promoteGuest — una segunda promoción no duplica el award', () => {
  it('la segunda llamada se rechaza limpio ("ya es del plantel"), y el award sigue siendo uno solo', async () => {
    const { admin, matchdayId, guestId } = await closedMatchdayWithLooseGuest('2026-08-10')

    await promoteGuest(admin.client, guestId)
    const afterFirst = (await awardsOf(matchdayId)).filter((row) => row.entry_id === guestId)
    expect(afterFirst).toHaveLength(1)

    await expect(promoteGuest(admin.client, guestId)).rejects.toThrow(/ya es del plantel/)

    const afterSecond = (await awardsOf(matchdayId)).filter((row) => row.entry_id === guestId)
    expect(afterSecond).toHaveLength(1)
    expect(afterSecond).toEqual(afterFirst)
  })
})

// La segunda línea de defensa contra un duplicado: si por cualquier motivo
// `pairs` tuviera DOS filas para el mismo invitado en la misma fecha —un
// estado que la app nunca debería producir, y que este test fuerza a mano—
// el `insert ... select` del reparto trae dos filas con la MISMA clave
// (matchday_id, entry_id) y el `unique` de `awards` (0001_schema.sql:220)
// tiene que cortar la función entera, no dejar pasar una y perder la otra.
describe('promoteGuest — el unique de awards protege contra una pareja duplicada', () => {
  it('con dos parejas para el mismo invitado, la función se cae entera: cero awards, el asiento sigue GUEST', async () => {
    const { admin, seasonId, matchdayId, guestId, partnerId } = await closedMatchdayWithLooseGuest(
      '2026-08-10',
    )

    // Un segundo "compañero" cualquiera con award en esta fecha, distinto del
    // real: se elige DIRECTO de la lista de awards ya escrita, no del plantel
    // completo — el asiento que faltó (`entryIds[0]`, ausente para que el
    // conteo diera impar y apareciera el invitado) no tiene award y arruinaba
    // el escenario si tocaba por orden.
    const fakePartner = (await awardsOf(matchdayId)).find(
      (row) => row.entry_id !== partnerId && row.entry_id !== guestId,
    )?.entry_id
    if (fakePartner === undefined) throw new Error('Falta un segundo candidato de test.')

    const db = adminClient()
    const { error: insertError } = await db.from('pairs').insert({
      matchday_id: matchdayId,
      season_id: seasonId,
      entry_a: guestId,
      entry_b: fakePartner,
    })
    if (insertError !== null) throw new Error(insertError.message)

    const { data, error } = await admin.client.rpc('promote_guest', { p_entry: guestId })

    expect(data).toBeNull()
    expect(error?.code).toBe('23505')

    // Nada quedó a mitad de camino: ni el flip a SQUAD ni ningún award nuevo.
    expect((await entryRow(guestId)).kind).toBe('GUEST')
    expect((await awardsOf(matchdayId)).filter((row) => row.entry_id === guestId)).toHaveLength(0)
  })
})

// ── S23 (verify-report ronda 7) — discipline_entries de LA FECHA, no la default
// `promote_guest` (0025_promote_guest_discipline_entries.sql) ya siembra la
// disciplina de la fecha en la que jugó el invitado, no la default — la
// siembra estaba bien desde el restatement de esa migración, pero C12
// bloqueaba llegar a este escenario (no se podía abrir una fecha fuera de la
// default). Con C12 cerrado, esto ya es alcanzable: se prueba de punta a
// punta, con `entriesOf` (la misma función que lee "Plantel" en Ajustes) del
// lado de la disciplina correcta y del lado de la default.
describe('promoteGuest — discipline_entries de la disciplina de la fecha, no la default (S23)', () => {
  it('un invitado promovido desde una fecha FIFA entra a discipline_entries de FIFA, no de la default PADEL', async () => {
    const squad = await fillerPlayers(8)
    const admin = await createTestUser()
    const { seasonId, disciplineIds, entryIds } = await createSeason({
      admin,
      config: defaultConfig(8),
      squad,
      disciplines: [{ kind: 'PADEL' }, { kind: 'FIFA' }],
    })
    const [padelId, fifaId] = disciplineIds
    if (padelId === undefined || fifaId === undefined) throw new Error('Faltan disciplinas.')

    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10', fifaId)
    await markAllPlaying(admin, matchdayId, entryIds)
    await setAttendance(admin.client, matchdayId, entryIds[0]!, 'ABSENT')
    await syncGuestSeat(admin.client, matchdayId)

    const [guestId] = (await matchdayDetail(admin.client, matchdayId)).guestIds
    if (guestId === undefined) throw new Error('syncGuestSeat no agregó invitado.')
    await nameGuest(admin.client, guestId, 'Invitade de FIFA')

    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)
    await playAllMatches(admin, matchdayId)
    await closeMatchday(admin.client, matchdayId)

    await promoteGuest(admin.client, guestId)

    const db = adminClient()
    const { data: fifaSeat, error: fifaSeatError } = await db
      .from('discipline_entries')
      .select('entry_id')
      .eq('discipline_id', fifaId)
      .eq('entry_id', guestId)
      .maybeSingle()
    if (fifaSeatError) throw new Error(fifaSeatError.message)
    expect(fifaSeat).not.toBeNull()

    const { data: padelSeat, error: padelSeatError } = await db
      .from('discipline_entries')
      .select('entry_id')
      .eq('discipline_id', padelId)
      .eq('entry_id', guestId)
      .maybeSingle()
    if (padelSeatError) throw new Error(padelSeatError.message)
    expect(padelSeat).toBeNull()

    // Misma función que arma "Plantel" en Ajustes: aparece del lado de FIFA,
    // no del lado de la default (padel) — ahí es donde S23 mordía.
    expect((await entriesOf(admin.client, seasonId, fifaId)).some((entry) => entry.id === guestId)).toBe(true)
    expect((await entriesOf(admin.client, seasonId, padelId)).some((entry) => entry.id === guestId)).toBe(false)

    // C14 (verify-report ronda 8): lo de arriba es exactamente lo que hace que
    // Ajustes → Plantel pierda a esta persona — `ajustes/page.tsx:50` llama
    // `entriesOf(seasonId)` SIN disciplineId, que cae en la disciplina por
    // defecto (padel acá), igual que la aserción de arriba. Lo que Plantel
    // necesita es `seasonSquadMembersOf` (temporada entera, sin pasar por
    // discipline_entries), y para no perder a quién ya reclamó su asiento
    // ("Este soy yo"/"Desvincular") esa función tiene que traer `playerId`.
    const roster = await seasonSquadMembersOf(admin.client, seasonId)
    const promoted = roster.find((member) => member.id === guestId)
    expect(promoted).toBeDefined()
    expect(promoted?.playerId).toBeNull()
  })
})

// ── PR18c — slice D re-especificada (W35, verify-report ronda 10) ────────────
//
// El design (#3801) traía un "HALLAZGO NUEVO" que decía que `promote_guest`
// con `pair_size=1` sobre una fecha CERRADA copiaba 0 puntos EN SILENCIO, y
// proponía agregar un `raise` para que fallara ruidoso. W35 midió eso contra
// la función real y encontró que la premisa era FALSA en las dos puntas: ya
// falla ruidoso, y falla por el guard EQUIVOCADO.
//
// La causa no es la copia final (que es inalcanzable): 60 líneas antes, el
// guard de "¿el compañero cobró?" arma `case when pr.entry_a = p_entry then
// pr.entry_b else pr.entry_a end`, y con un lado de uno eso da NULL, así que
// `a.entry_id = NULL` no matchea nunca y "el compañero no cobró" sale TRUE.
// Misma lógica de tres valores que C17, en la dirección conservadora.
//
// Por eso la re-especificación NO es agregar un raise: es SALTEAR el guard del
// compañero y la copia cuando `pair_size = 1`, y dejar que la promoción
// proceda. En una disciplina de a uno el invitado ES su propio lado y no cobró
// nada al cerrar — no hay puntos que conservar ni que copiar, y sumarlo al
// plantel no le mueve la posición a nadie.

async function closedSoloMatchdayWithGuest(): Promise<{
  admin: TestUser
  seasonId: string
  matchdayId: string
  guestId: string
  squadEntryIds: string[]
}> {
  const admin = await createTestUser()
  const squad = await fillerPlayers(8)
  // 8 asientos de a uno son 8 lados del torneo, así que la lista de puntos
  // tiene 8 valores y no 4 — `validateConfig` lo exige por `sideSize`.
  const config = { ...defaultConfig(8), points: [8, 7, 6, 5, 4, 3, 2, 1] }
  const { seasonId, entryIds } = await createSeason({
    admin,
    squad,
    disciplines: [{ kind: 'FIFA', pairSize: 1, config }],
  })
  const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
  await markAllPlaying(admin, matchdayId, entryIds)

  // UN invitado, sin lock: de a uno no hay a quién trabarlo. Son 9 lados, 8
  // del torneo (el invitado no cobra) y 36 partidos.
  const guestId = await addGuest(admin.client, matchdayId, { displayName: 'Invitado solo' })

  await generatePairs(admin.client, matchdayId)
  await openMatchday(admin.client, matchdayId)
  await playAllMatches(admin, matchdayId)
  await closeMatchday(admin.client, matchdayId)

  return { admin, seasonId, matchdayId, guestId, squadEntryIds: entryIds }
}

describe('promoteGuest — disciplina de a uno: se promueve, sin copiar nada (PR18c, W35)', () => {
  it('el invitado que jugó solo entra al plantel en vez de rebotar contra el guard del compañero', async () => {
    const { admin, seasonId, matchdayId, guestId, squadEntryIds } =
      await closedSoloMatchdayWithGuest()

    // Punto de partida: los 8 del plantel cobraron, el invitado no. Eso es
    // `computeAwards`, que saltea los lados hechos sólo de invitados.
    const before = await awardsOf(matchdayId)
    expect(before).toHaveLength(8)
    expect(before.some((row) => row.entry_id === guestId)).toBe(false)

    await promoteGuest(admin.client, guestId)

    // El asiento pasó a ser del plantel y dejó de pertenecer a esa fecha.
    const promoted = await entryRow(guestId)
    expect(promoted.kind).toBe('SQUAD')
    expect(promoted.matchday_id).toBeNull()

    // Y entró a la disciplina de ESTA fecha, al final del orden.
    const seeds = await disciplineSeedPositions(seasonId)
    expect(seeds.map((row) => row.id)).toContain(guestId)
    expect(seeds[seeds.length - 1]?.id).toBe(guestId)
  })

  it('no se lleva puntos de esa fecha, y no le mueve la posición a nadie', async () => {
    const { admin, matchdayId, guestId } = await closedSoloMatchdayWithGuest()
    const before = await awardsOf(matchdayId)

    await promoteGuest(admin.client, guestId)

    // Jugó solo: no hubo compañero que cobrara, así que no hay nada que
    // copiar. Y las 8 filas de los demás quedan EXACTAMENTE como estaban —
    // que es la razón por la que la promoción se permite: no reescribe la
    // tabla de una fecha ya cerrada.
    const after = await awardsOf(matchdayId)
    expect(after.some((row) => row.entry_id === guestId)).toBe(false)
    expect(after).toEqual(before)
  })

  /*
   * C21 (verify-report ronda 14). Promover funcionaba y la PANTALLA de esa
   * fecha moría en el render siguiente: `page.tsx` recalculaba los puntos del
   * día con `computeAwards` sobre los `guestIds` de HOY, y al salir el
   * promovido de esa lista quedaban 9 lados pagos contra 8 valores de puntos.
   *
   * Este test recorre la secuencia y afirma sobre la fuente que la pantalla
   * lee AHORA: los `awards` congelados. Si alguien vuelve a recalcular, los
   * números de acá siguen bien pero la pantalla se cae — por eso el test
   * afirma además que el conjunto de asientos que cobran NO cambió con la
   * promoción, que es exactamente la premisa que el recálculo rompía.
   */
  it('después de promover, los puntos congelados de la fecha no se mueven (C21)', async () => {
    const { admin, matchdayId, guestId, squadEntryIds } = await closedSoloMatchdayWithGuest()
    const antes = await frozenPointsOf(admin.client, matchdayId)
    expect([...antes.keys()].sort()).toEqual([...squadEntryIds].sort())

    await promoteGuest(admin.client, guestId)

    const despues = await frozenPointsOf(admin.client, matchdayId)
    // Mismos asientos y mismos puntos: el promovido no aparece y a los 8 que
    // cobraron no se les movió un punto. Un recálculo con los `guestIds` de
    // hoy daría 9 lados pagos y no podría siquiera producirse.
    expect([...despues.keys()].sort()).toEqual([...antes.keys()].sort())
    for (const [entryId, award] of antes) {
      // `toStrictEqual` y no `toBe`: desde W55 (verify-report ronda 16) el
      // premio congelado es `{ position, points }` y no un número — el puesto
      // viaja con los puntos justamente para que el orden de la tabla no
      // pueda contradecirlos.
      expect(despues.get(entryId)).toStrictEqual(award)
    }

    // Y la fecha se sigue pudiendo LEER entera, que es lo que la pantalla hace
    // antes de dibujar: con 9 lados y 8 valores de puntos, cualquier camino
    // que recalcule el reparto acá revienta.
    const detail = await matchdayDetail(admin.client, matchdayId)
    expect(detail.sides).toHaveLength(9)
    expect(detail.guestIds).toEqual([])
  })

  /*
   * Decisión de producto de Stefano (esta sesión). La lista de puntos tiene
   * que tener un casillero por lado, aunque valga 0 — el 0 ya significa "de
   * acá para abajo no se suma" (`core/config.ts: pointsErrors`). Lo que trababa
   * la temporada no era una regla de reparto: era el LARGO de la lista.
   *
   * Al promover un invitado de a uno el plantel pasa de 8 a 9 y la lista se
   * queda corta, así que la fecha siguiente no se puede sortear y —peor— si se
   * REABRE ésta, los premios se borran y no se puede volver a cerrar (C22,
   * verify-report ronda 15).
   *
   * La decisión: que la app agregue el casillero SOLA, con 0. El admin después
   * lo deja en 0 o le pone valor. Cambia a propósito la convención de que
   * "agregar un asiento no toca squadSize ni points" — acá la app no está
   * eligiendo un reparto, está manteniendo el invariante de largo que ella
   * misma exige.
   */
  it('promover de a uno agrega el casillero de puntos y sube el plantel', async () => {
    const { admin, seasonId, guestId } = await closedSoloMatchdayWithGuest()
    const disciplineId = await defaultDisciplineId(adminClient(), seasonId)
    if (disciplineId === null) throw new Error('La temporada no tiene disciplina.')

    const antes = await disciplineConfig(admin.client, disciplineId)
    expect(antes.config.squadSize).toBe(8)
    expect(antes.config.points).toEqual([8, 7, 6, 5, 4, 3, 2, 1])

    await promoteGuest(admin.client, guestId)

    const despues = await disciplineConfig(admin.client, disciplineId)
    expect(despues.config.squadSize).toBe(9)
    // El casillero nuevo va al final y en 0: el promovido no cobra por haberse
    // sumado, y el orden de la lista sigue siendo de mayor a menor.
    expect(despues.config.points).toEqual([8, 7, 6, 5, 4, 3, 2, 1, 0])
    // Y el resto de la config no se toca.
    expect({ ...despues.config, squadSize: 8, points: antes.config.points }).toEqual(antes.config)
  })

  it('la fecha se puede reabrir y volver a cerrar después de promover (C22)', async () => {
    // C22 (verify-report ronda 15): esto borraba los 8 premios y después no
    // dejaba cerrar — la fecha quedaba OPEN con cero puntos repartidos y sin
    // salida por ninguna pantalla. Con el casillero agregado, el re-cierre
    // reparte 9 premios y el noveno es 0.
    const { admin, matchdayId, guestId } = await closedSoloMatchdayWithGuest()
    await promoteGuest(admin.client, guestId)

    await reopenMatchday(admin.client, matchdayId)
    await closeMatchday(admin.client, matchdayId)

    const awards = await awardsOf(matchdayId)
    expect(awards).toHaveLength(9)
    expect([...awards.map((row) => row.points)].sort((a, b) => b - a)).toEqual([8, 7, 6, 5, 4, 3, 2, 1, 0])
    expect(awards.some((row) => row.entry_id === guestId)).toBe(true)
  })

  it('de a DOS sigue refusando la pareja toda invitada (no-regresión de spec 3.2)', async () => {
    // El mismo guard que se saltea de a uno tiene que seguir disparando donde
    // el lado es de dos: ahí sumarlo SÍ le cambiaría los puntos a los demás.
    const { admin, guestA } = await closedMatchdayWithGuestPair()
    await expect(promoteGuest(admin.client, guestA)).rejects.toThrow(
      /jugó en una pareja que no cobró puntos/,
    )
    expect((await entryRow(guestA)).kind).toBe('GUEST')
  })
})
