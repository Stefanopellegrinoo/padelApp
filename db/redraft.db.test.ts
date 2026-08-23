import { describe, expect, it } from 'vitest'
import { defaultConfig, members, type DisciplineId, type SeasonConfig, type Side } from '@/core'
import {
  closeMatchday,
  createMasters,
  createMatchday,
  generateMastersPairs,
  generatePairs,
  nameGuest,
  openMatchday,
  redraftMatchday,
  saveResult,
  setAttendance,
  syncGuestSeat,
} from './matchday'
import { attendancesOf, matchdayDetail } from './read'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser, type TestUser } from './test/users'

// ── scaffolding local a este archivo ────────────────────────────────────────
// Igual que en reopen.db.test.ts: no va a db/test/factories.ts, esta lista de
// armadores sólo le sirve al redraft.

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
  config: SeasonConfig,
  squadSize: number,
): Promise<{ admin: TestUser; seasonId: string; disciplineId: DisciplineId; squad: string[] }> {
  const admin = await createTestUser()
  const players = await fillerPlayers(squadSize)
  const { seasonId, disciplineId, entryIds } = await createSeason({ admin, config, squad: players })
  return { admin, seasonId, disciplineId, squad: entryIds }
}

async function markAllPlaying(admin: TestUser, matchdayId: string, entryIds: string[]): Promise<void> {
  for (const entryId of entryIds) {
    await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
  }
}

interface MatchRow {
  id: string
  pair_a: string
  pair_b: string
}

async function matchesOf(matchdayId: string): Promise<MatchRow[]> {
  const db = adminClient()
  const { data, error } = await db
    .from('matches')
    .select('id, pair_a, pair_b')
    .eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Carga un 4-1 en cada partido de la fecha, con `winnerOf` decidiendo quién gana. */
async function playAllMatches(
  admin: TestUser,
  matchdayId: string,
  winnerOf: (pairA: string, pairB: string) => string,
): Promise<void> {
  const matches = await matchesOf(matchdayId)
  for (const match of matches) {
    const winner = winnerOf(match.pair_a, match.pair_b)
    const sets = winner === match.pair_a ? [{ gamesA: 4, gamesB: 1 }] : [{ gamesA: 1, gamesB: 4 }]
    await saveResult(admin.client, match.id, sets)
  }
}

async function matchdayStatus(matchdayId: string): Promise<string> {
  const db = adminClient()
  const { data, error } = await db
    .from('matchdays')
    .select('status')
    .eq('id', matchdayId)
    .single()
  if (error || data === null) throw new Error(error?.message)
  return data.status
}

// `seasons.status` ya no tiene escritor de producción (bloqueante #2 del
// contract, db/season-status-writers.db.test.ts): el trinquete real vive en
// `disciplines.status`.
async function disciplineStatus(disciplineId: DisciplineId): Promise<string> {
  const db = adminClient()
  const { data, error } = await db
    .from('disciplines')
    .select('status')
    .eq('id', disciplineId)
    .single()
  if (error || data === null) throw new Error(error?.message)
  return data.status
}

async function nonClosedMatchdaysOf(seasonId: string): Promise<number> {
  const db = adminClient()
  const { data, error } = await db
    .from('matchdays')
    .select('id')
    .eq('season_id', seasonId)
    .neq('status', 'CLOSED')
  if (error) throw new Error(error.message)
  return (data ?? []).length
}

async function awardsOf(
  matchdayId: string,
): Promise<Array<{ entry_id: string; position: number; points: number }>> {
  const db = adminClient()
  const { data, error } = await db
    .from('awards')
    .select('entry_id, position, points')
    .eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Arma y confirma una fecha regular: todo el plantel presente, parejas sorteadas, OPEN. */
async function buildOpenMatchday(
  config: SeasonConfig,
  squadSize: number,
): Promise<{
  admin: TestUser
  seasonId: string
  disciplineId: DisciplineId
  squad: string[]
  matchdayId: string
}> {
  const { admin, seasonId, disciplineId, squad } = await buildSeasonWithSquad(config, squadSize)
  const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
  await markAllPlaying(admin, matchdayId, squad)
  await generatePairs(admin.client, matchdayId)
  await openMatchday(admin.client, matchdayId)
  return { admin, seasonId, disciplineId, squad, matchdayId }
}

const sortSides = (sides: Side[]): Side[] => [...sides].sort((left, right) => left.a.localeCompare(right.a))

/** Los premios de una fecha, indexados por la posición del jugador en el plantel en vez de por su entry_id: dos temporadas nunca comparten entries, pero comparten seed_position. */
function awardsBySeed(
  rows: Array<{ entry_id: string; position: number; points: number }>,
  squad: string[],
): Array<{ seed: number; position: number; points: number }> {
  return rows
    .map((row) => ({ seed: squad.indexOf(row.entry_id), position: row.position, points: row.points }))
    .sort((left, right) => left.seed - right.seed)
}

describe('redraftMatchday', () => {
  it('vuelve una fecha OPEN a DRAFT', async () => {
    const { admin, matchdayId } = await buildOpenMatchday(defaultConfig(8), 8)
    expect(await matchdayStatus(matchdayId)).toBe('OPEN')

    await redraftMatchday(admin.client, matchdayId)

    expect(await matchdayStatus(matchdayId)).toBe('DRAFT')
  })

  it('un jugador del plantel, sin ser el admin, recibe "sólo quien organiza"', async () => {
    const admin = await createTestUser()
    const member = await createTestUser()
    const filler = await fillerPlayers(7)
    const { seasonId, entryIds } = await createSeason({
      admin,
      config: defaultConfig(8),
      squad: [member.playerId, ...filler],
    })
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, entryIds)
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)

    await expect(redraftMatchday(member.client, matchdayId)).rejects.toThrow(/Sólo quien organiza/)

    expect(await matchdayStatus(matchdayId)).toBe('OPEN')
  })

  it('un desconocido recibe "sólo quien organiza" y no mueve nada', async () => {
    const { matchdayId } = await buildOpenMatchday(defaultConfig(8), 8)
    const stranger = await createTestUser()

    const { error } = await stranger.client.rpc('redraft_matchday', { p_matchday: matchdayId })

    expect(error?.message).toMatch(/Sólo quien organiza/)
    expect(await matchdayStatus(matchdayId)).toBe('OPEN')
  })

  it('rechaza una fecha en armado (DRAFT)', async () => {
    const { admin, seasonId } = await buildSeasonWithSquad(defaultConfig(8), 8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')

    await expect(redraftMatchday(admin.client, matchdayId)).rejects.toThrow(/fecha en juego/)

    expect(await matchdayStatus(matchdayId)).toBe('DRAFT')
  })

  it('rechaza una fecha cerrada (CLOSED)', async () => {
    const { admin, matchdayId } = await buildOpenMatchday(defaultConfig(8), 8)
    await playAllMatches(admin, matchdayId, (pairA) => pairA)
    await closeMatchday(admin.client, matchdayId)

    await expect(redraftMatchday(admin.client, matchdayId)).rejects.toThrow(/fecha en juego/)

    expect(await matchdayStatus(matchdayId)).toBe('CLOSED')
  })

  it('no borra parejas, partidos, resultados ni presentismo', async () => {
    const { admin, matchdayId } = await buildOpenMatchday(defaultConfig(8), 8)
    const [firstMatch] = await matchesOf(matchdayId)
    if (firstMatch === undefined) throw new Error('Falta un partido de test.')
    await saveResult(admin.client, firstMatch.id, [{ gamesA: 4, gamesB: 1 }])

    const pairsBefore = sortSides((await matchdayDetail(admin.client, matchdayId)).sides)
    const matchesBefore = (await matchdayDetail(admin.client, matchdayId)).matches
    const attendancesBefore = await attendancesOf(admin.client, matchdayId)

    await redraftMatchday(admin.client, matchdayId)

    const detailAfter = await matchdayDetail(admin.client, matchdayId)
    expect(sortSides(detailAfter.sides)).toEqual(pairsBefore)
    expect(detailAfter.matches).toEqual(matchesBefore)
    expect(await attendancesOf(admin.client, matchdayId)).toEqual(attendancesBefore)
  })

  it('un PATCH directo sobre matchdays.status sigue sin poder nada: sólo la función abre la puerta', async () => {
    const { admin, matchdayId } = await buildOpenMatchday(defaultConfig(8), 8)

    const { data, error } = await admin.client
      .from('matchdays')
      .update({ status: 'DRAFT' })
      .eq('id', matchdayId)
      .select()

    expect(data).toBeNull()
    expect(error?.code).toBe('42501')
    expect(await matchdayStatus(matchdayId)).toBe('OPEN')
  })

  it('no toca el estado de la disciplina ni el invariante de una sola fecha sin cerrar', async () => {
    const { admin, seasonId, disciplineId, matchdayId } = await buildOpenMatchday(defaultConfig(8), 8)

    await redraftMatchday(admin.client, matchdayId)

    expect(await disciplineStatus(disciplineId)).toBe('ACTIVE')
    expect(await nonClosedMatchdaysOf(seasonId)).toBe(1)
  })

  it('permite corregir quién juega y volver a confirmar', async () => {
    const { admin, matchdayId, squad } = await buildOpenMatchday(defaultConfig(10), 10)
    const dropped = [squad[0]!, squad[1]!]

    await redraftMatchday(admin.client, matchdayId)
    for (const entryId of dropped) {
      await setAttendance(admin.client, matchdayId, entryId, 'ABSENT')
    }
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)

    expect(await matchdayStatus(matchdayId)).toBe('OPEN')
    const playing = new Set((await matchdayDetail(admin.client, matchdayId)).sides.flatMap((side) => [...members(side)]))
    for (const entryId of dropped) expect(playing.has(entryId)).toBe(false)
  })

  it('volver al armado y confirmar sin tocar nada es un no-op: misma fecha, mismos resultados', async () => {
    const { admin, matchdayId } = await buildOpenMatchday(defaultConfig(8), 8)
    const [firstMatch] = await matchesOf(matchdayId)
    if (firstMatch === undefined) throw new Error('Falta un partido de test.')
    await saveResult(admin.client, firstMatch.id, [{ gamesA: 4, gamesB: 1 }])
    const detailBefore = await matchdayDetail(admin.client, matchdayId)

    await redraftMatchday(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)

    expect(await matchdayStatus(matchdayId)).toBe('OPEN')
    const detailAfter = await matchdayDetail(admin.client, matchdayId)
    expect(sortSides(detailAfter.sides)).toEqual(sortSides(detailBefore.sides))
    expect(detailAfter.matches).toEqual(detailBefore.matches)
  })

  // El equivalente sin redraft juega y cierra una temporada gemela — mismo
  // config, mismo tamaño de plantel, sin historia previa — así que el sorteo
  // determinista arma la misma estructura de parejas por seed_position en las
  // dos. Comparando los premios por esa posición (no por entry_id, que nunca
  // se repite entre temporadas) se prueba que ir y volver de DRAFT no cambia
  // un solo punto.
  it('anti-regresión: cierra con los mismos puntos que una fecha nunca revertida', async () => {
    const config = defaultConfig(8)

    const control = await buildOpenMatchday(config, 8)
    await playAllMatches(control.admin, control.matchdayId, (pairA) => pairA)
    await closeMatchday(control.admin.client, control.matchdayId)
    const controlAwards = awardsBySeed(await awardsOf(control.matchdayId), control.squad)

    const redrafted = await buildOpenMatchday(config, 8)
    await redraftMatchday(redrafted.admin.client, redrafted.matchdayId)
    await openMatchday(redrafted.admin.client, redrafted.matchdayId)
    await playAllMatches(redrafted.admin, redrafted.matchdayId, (pairA) => pairA)
    await closeMatchday(redrafted.admin.client, redrafted.matchdayId)
    const redraftedAwards = awardsBySeed(await awardsOf(redrafted.matchdayId), redrafted.squad)

    // Sin esto, el `toEqual` de abajo pasa igual de bien comparando `[]` con
    // `[]`: un plantel de 8 SIEMPRE reparte 4 posiciones (8 filas de award), así
    // que si algún día viene vacío la comparación dejó de probar nada.
    expect(controlAwards).toHaveLength(8)
    expect(redraftedAwards).toEqual(controlAwards)
  })

  // El camino completo, de punta a punta: es el escenario para el que existe
  // todo este cambio y ningún otro test lo recorre entero. El #9 llega a OPEN
  // sin puntuar, el "no-op" de arriba tiene resultados pero nunca regenera, y
  // el anti-regresión puntúa desde una fecha OPEN virgen. Acá hay resultados
  // ANTES de volver al armado, se cambia el plantel de verdad (uno se cae), se
  // regenera y se vuelve a confirmar, y recién ahí se juega y se cierra.
  it('resultados cargados, vuelve al armado, cambia quién juega, confirma de nuevo y cierra pagando bien', async () => {
    const config = defaultConfig(10)
    const { admin, matchdayId, squad } = await buildOpenMatchday(config, 10)

    const [firstMatch] = await matchesOf(matchdayId)
    if (firstMatch === undefined) throw new Error('Falta un partido de test.')
    await saveResult(admin.client, firstMatch.id, [{ gamesA: 4, gamesB: 1 }])

    await redraftMatchday(admin.client, matchdayId)
    expect(await matchdayStatus(matchdayId)).toBe('DRAFT')

    // Un jugador se cae. El plantel presente queda impar (9), así que
    // `syncGuestSeat` —lo mismo que hace `toggleAttendance` en la acción— suma
    // un invitado suelto para volver a par, igual que en la app real.
    const dropped = squad[0]!
    await setAttendance(admin.client, matchdayId, dropped, 'ABSENT')
    await syncGuestSeat(admin.client, matchdayId)

    const [guestId] = (await matchdayDetail(admin.client, matchdayId)).guestIds
    if (guestId === undefined) throw new Error('syncGuestSeat no agregó invitado.')
    await nameGuest(admin.client, guestId, 'Invitado de test')

    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)
    expect(await matchdayStatus(matchdayId)).toBe('OPEN')

    const playing = new Set(
      (await matchdayDetail(admin.client, matchdayId)).sides.flatMap((side) => [...members(side)]),
    )
    expect(playing.has(dropped)).toBe(false)
    expect(playing.has(guestId)).toBe(true)

    await playAllMatches(admin, matchdayId, (pairA) => pairA)
    await closeMatchday(admin.client, matchdayId)

    expect(await matchdayStatus(matchdayId)).toBe('CLOSED')
    const awards = await awardsOf(matchdayId)
    // 9 jugadores del plantel presentes (10 - el que se cayó); el invitado no
    // cobra (spec: "guests get nothing"), así que 9 filas de award es la única
    // cuenta consistente con quién jugó de verdad.
    expect(awards).toHaveLength(9)
    expect(awards.some((award) => award.entry_id === dropped)).toBe(false)
    expect(awards.some((award) => award.entry_id === guestId)).toBe(false)
    for (const award of awards) expect(config.points).toContain(award.points)
  })

  it('el Masters también vuelve al armado, y el sorteo del Masters vuelve a estar disponible', async () => {
    const config: SeasonConfig = { ...defaultConfig(8), regularMatchdays: 1, countBestOf: 1 }
    const { admin, seasonId, disciplineId, squad } = await buildSeasonWithSquad(config, 8)
    const md1 = await createMatchday(admin.client, seasonId, '2026-03-05')
    await markAllPlaying(admin, md1, squad)
    await generatePairs(admin.client, md1)
    await openMatchday(admin.client, md1)
    await playAllMatches(admin, md1, (pairA) => pairA)
    await closeMatchday(admin.client, md1)

    const mastersId = await createMasters(admin.client, disciplineId, '2026-12-20')
    await generateMastersPairs(admin.client, mastersId)
    await openMatchday(admin.client, mastersId)
    expect(await matchdayStatus(mastersId)).toBe('OPEN')

    await redraftMatchday(admin.client, mastersId)

    expect(await matchdayStatus(mastersId)).toBe('DRAFT')
    await generateMastersPairs(admin.client, mastersId)
    expect((await matchdayDetail(admin.client, mastersId)).sides).toHaveLength(6)
  })
})
