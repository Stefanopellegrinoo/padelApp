import { describe, expect, it, vi } from 'vitest'
import { defaultConfig, type DisciplineId, type SeasonConfig } from '@/core'
import type { Client } from './client'
import type { Json } from './database.types'
import { addDiscipline, updateDisciplineConfig, updateDisciplineFormatoDefault } from './discipline'
import { teamsOf } from './discipline-teams'
import { EdgeError } from './errors'
import {
  closeMatchday,
  createMatchday,
  generatePairs,
  openMatchday,
  redraftMatchday,
  saveResult,
  setAttendance,
  setMatchdayFormat,
  setMatchFormat,
} from './matchday'
import { seasonHeader } from './read'
import { createSeason as createSeasonOf, squadSeedOrder } from './season'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser } from './test/users'

/**
 * Torneos con los deportes del registro (docs/torneos-deportes.md §7 y §9,
 * docs/plan-torneos-deportes.md). La base deja de conocer deportes: acepta
 * cualquier id de forma válida, el formato `AUTO` (sólo mientras la fecha se
 * arma) y un formato de partido propio por fecha.
 *
 * Una suite por tanda de migraciones; las tareas siguientes agregan los suyos
 * al final. Las escrituras van con `admin.client` (rol `authenticated`, RLS y
 * column grants de verdad); `adminClient()` (`service_role`) sólo mueve el
 * `status`, que ningún rol de la app puede tocar por PostgREST.
 */

const CHECK_VIOLATION = '23514'
const MATCHDAY_PLAYED_ON = '2026-08-10'

/** Una temporada con una fecha en DRAFT, organizada por `admin`. */
async function draftMatchday() {
  const admin = await createTestUser()
  const { seasonId, disciplineId } = await createSeason({ admin })
  const matchdayId = await createMatchday(admin.client, seasonId, MATCHDAY_PLAYED_ON, disciplineId)
  return { admin, seasonId, disciplineId, matchdayId }
}

/** Andamiaje: mueve la fecha de estado con la llave de servicio. Falla fuerte si no puede. */
async function moveTo(matchdayId: string, status: 'OPEN' | 'CLOSED'): Promise<void> {
  const { error } = await adminClient().from('matchdays').update({ status }).eq('id', matchdayId)
  if (error) throw new Error(`No se pudo pasar la fecha a ${status}: ${error.message}`)
}

async function matchFormatOf(matchdayId: string): Promise<Json> {
  const { data, error } = await adminClient()
    .from('matchdays')
    .select('match_format')
    .eq('id', matchdayId)
    .single()
  if (error || data === null) throw new Error(error?.message)
  return data.match_format
}

/** 0094 — `disciplines.kind` deja de ser PADEL|FIFA y pasa a ser "forma de id" (mismo chequeo que 0093). */
describe('disciplines.kind — cualquier id de deporte con forma válida (0094)', () => {
  it('acepta un deporte del registro que no es PADEL ni FIFA', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason({ admin })

    const { error } = await admin.client
      .from('disciplines')
      .insert({ season_id: seasonId, kind: 'PING_PONG', config: defaultConfig(8) as unknown as Json, position: 1 })

    expect(error).toBeNull()
  })

  it.each([
    ['con guion', 'ping-pong'],
    ['vacío', ''],
    ['en minúsculas', 'Padel'],
    ['que empieza con guion bajo', '_PING'],
    ['de 33 caracteres', 'A'.repeat(33)],
  ])('rechaza un id %s con disciplines_kind_id', async (_label, kind) => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason({ admin })

    const { error } = await admin.client
      .from('disciplines')
      .insert({ season_id: seasonId, kind, config: defaultConfig(8) as unknown as Json, position: 1 })

    expect(error?.code).toBe(CHECK_VIOLATION)
    expect(error?.message).toMatch(/disciplines_kind_id/)
  })
})

/** 0095 — `AUTO` como formato por defecto del deporte y de la fecha, ésta sólo mientras se arma. */
describe('formato AUTO (0095)', () => {
  it('disciplines.formato_default acepta { kind: AUTO }', async () => {
    const admin = await createTestUser()
    const { disciplineId } = await createSeason({ admin })

    const { error, count } = await admin.client
      .from('disciplines')
      .update({ formato_default: { kind: 'AUTO' } }, { count: 'exact' })
      .eq('id', disciplineId)

    expect(error).toBeNull()
    expect(count).toBe(1)
  })

  it('disciplines.formato_default sigue rechazando un kind desconocido', async () => {
    const admin = await createTestUser()
    const { disciplineId } = await createSeason({ admin })

    const { error } = await admin.client
      .from('disciplines')
      .update({ formato_default: { kind: 'MAGIC' } })
      .eq('id', disciplineId)

    expect(error?.code).toBe(CHECK_VIOLATION)
    expect(error?.message).toMatch(/disciplines_formato_default_kind/)
  })

  it('matchdays.formato acepta { kind: AUTO } con la fecha en DRAFT', async () => {
    const { admin, matchdayId } = await draftMatchday()

    const { error, count } = await admin.client
      .from('matchdays')
      .update({ formato: { kind: 'AUTO' } }, { count: 'exact' })
      .eq('id', matchdayId)

    expect(error).toBeNull()
    expect(count).toBe(1)
  })

  it('una fecha en AUTO no sale de DRAFT (matchdays_formato_auto_draft)', async () => {
    const { admin, matchdayId } = await draftMatchday()
    const { error: autoError } = await admin.client
      .from('matchdays')
      .update({ formato: { kind: 'AUTO' } })
      .eq('id', matchdayId)
    expect(autoError).toBeNull()

    const { error } = await adminClient().from('matchdays').update({ status: 'OPEN' }).eq('id', matchdayId)

    expect(error?.code).toBe(CHECK_VIOLATION)
    expect(error?.message).toMatch(/matchdays_formato_auto_draft/)
  })

  it('control: la misma fecha con un formato concreto sí pasa a OPEN', async () => {
    const { admin, matchdayId } = await draftMatchday()
    const { error: formatError } = await admin.client
      .from('matchdays')
      .update({ formato: { kind: 'ROUND_ROBIN' } })
      .eq('id', matchdayId)
    expect(formatError).toBeNull()

    const { error } = await adminClient().from('matchdays').update({ status: 'OPEN' }).eq('id', matchdayId)

    expect(error).toBeNull()
  })
})

/** 0096 — `matchdays.match_format`: a cuánto se juega esa fecha. Opcional; null = el del deporte en el torneo. */
describe('matchdays.match_format — forma (0096)', () => {
  it('una fecha nueva nace sin formato de partido propio', async () => {
    const { matchdayId } = await draftMatchday()

    expect(await matchFormatOf(matchdayId)).toBeNull()
  })

  it('acepta { setsToWin, gamesPerSet } en DRAFT y lo guarda', async () => {
    const { admin, matchdayId } = await draftMatchday()

    const { error, count } = await admin.client
      .from('matchdays')
      .update({ match_format: { setsToWin: 2, gamesPerSet: 6 } }, { count: 'exact' })
      .eq('id', matchdayId)

    expect(error).toBeNull()
    expect(count).toBe(1)
    expect(await matchFormatOf(matchdayId)).toEqual({ setsToWin: 2, gamesPerSet: 6 })
  })

  it('acepta volver a null (usar el formato del deporte)', async () => {
    const { admin, matchdayId } = await draftMatchday()
    await admin.client.from('matchdays').update({ match_format: { setsToWin: 1, gamesPerSet: 4 } }).eq('id', matchdayId)

    const { error } = await admin.client.from('matchdays').update({ match_format: null }).eq('id', matchdayId)

    expect(error).toBeNull()
    expect(await matchFormatOf(matchdayId)).toBeNull()
  })

  it.each<[string, Json]>([
    ['setsToWin en 0', { setsToWin: 0, gamesPerSet: 6 }],
    ['sin gamesPerSet', { setsToWin: 2 }],
    ['con una clave de más', { setsToWin: 2, gamesPerSet: 6, tieBreak: false }],
    ['un texto', 'x'],
    ['un arreglo', [1, 2]],
    ['gamesPerSet de tres cifras', { setsToWin: 2, gamesPerSet: 100 }],
    ['los dos como texto', { setsToWin: '2', gamesPerSet: '6' }],
    ['uno como número y otro como texto', { setsToWin: 2, gamesPerSet: '6' }],
  ])('rechaza %s con matchdays_match_format_shape', async (_label, matchFormat) => {
    const { admin, matchdayId } = await draftMatchday()

    const { error } = await admin.client
      .from('matchdays')
      .update({ match_format: matchFormat })
      .eq('id', matchdayId)

    expect(error?.code).toBe(CHECK_VIOLATION)
    expect(error?.message).toMatch(/matchdays_match_format_shape/)
    expect(await matchFormatOf(matchdayId)).toBeNull()
  })

  it('un participante que no organiza no lo cambia (RLS matchdays_write)', async () => {
    const admin = await createTestUser()
    const member = await createTestUser()
    const { seasonId, disciplineId } = await createSeason({ admin, squad: [member.playerId] })
    const matchdayId = await createMatchday(admin.client, seasonId, MATCHDAY_PLAYED_ON, disciplineId)

    const { error, count } = await member.client
      .from('matchdays')
      .update({ match_format: { setsToWin: 2, gamesPerSet: 6 } }, { count: 'exact' })
      .eq('id', matchdayId)

    expect(error).toBeNull()
    expect(count).toBe(0)
    expect(await matchFormatOf(matchdayId)).toBeNull()
  })
})

/** 0097 — mismo molde que `matchdays_formato_immutable_after_draft` (0045): un PATCH directo no lo saltea. */
describe('matchdays.match_format — inmutable fuera de DRAFT (0097)', () => {
  const LOCKED_MESSAGE = 'A cuánto se juega la fecha sólo se cambia con la fecha en armado.'

  it.each<['OPEN' | 'CLOSED']>([['OPEN'], ['CLOSED']])(
    'con la fecha en %s, cambiar match_format falla y no escribe nada',
    async (status) => {
      const { admin, matchdayId } = await draftMatchday()
      await moveTo(matchdayId, status)

      const { error } = await admin.client
        .from('matchdays')
        .update({ match_format: { setsToWin: 2, gamesPerSet: 6 } })
        .eq('id', matchdayId)

      expect(error?.message).toContain(LOCKED_MESSAGE)
      expect(await matchFormatOf(matchdayId)).toBeNull()
    },
  )

  it('con la fecha en OPEN, mandar el mismo valor que ya tiene no falla (is distinct from)', async () => {
    const { admin, matchdayId } = await draftMatchday()
    await admin.client.from('matchdays').update({ match_format: { setsToWin: 2, gamesPerSet: 6 } }).eq('id', matchdayId)
    await moveTo(matchdayId, 'OPEN')

    const { error } = await admin.client
      .from('matchdays')
      .update({ match_format: { setsToWin: 2, gamesPerSet: 6 } })
      .eq('id', matchdayId)

    expect(error).toBeNull()
  })
})

/**
 * Task 3 — la app lee cualquier deporte del registro, y una escritura con un id
 * que NO es de un torneo se rechaza ANTES de tocar la base (el CHECK 0094 sólo
 * mira la forma del id: `TEJO` o `FUTBOL` la cumplen).
 */
describe('un deporte fuera de los de torneo se rechaza antes de escribir', () => {
  const NOT_IN_LIST = 'Elegí un deporte de la lista.'

  async function seasonsOf(userId: string): Promise<number> {
    const { count, error } = await adminClient()
      .from('seasons')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', userId)
    if (error) throw new Error(error.message)
    return count ?? 0
  }

  async function disciplinesOf(seasonId: string): Promise<number> {
    const { count, error } = await adminClient()
      .from('disciplines')
      .select('id', { count: 'exact', head: true })
      .eq('season_id', seasonId)
    if (error) throw new Error(error.message)
    return count ?? 0
  }

  it.each([['TEJO'], ['FUTBOL']])('createSeason con %s tira EdgeError y no crea ninguna temporada', async (kind) => {
    const admin = await createTestUser()
    const config = defaultConfig(8)

    const attempt = createSeasonOf(admin.client, {
      name: `Deporte ajeno ${kind}`,
      squadNames: Array.from({ length: 8 }, (_, i) => `Jugador ${i + 1}`),
      config,
      disciplines: [{ kind: kind as never, config }],
    })

    await expect(attempt).rejects.toBeInstanceOf(EdgeError)
    await expect(attempt).rejects.toThrow(NOT_IN_LIST)
    expect(await seasonsOf(admin.userId)).toBe(0)
  })

  it('addDiscipline con TEJO tira EdgeError y la temporada no gana ninguna disciplina', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason({ admin })

    const attempt = addDiscipline(admin.client, seasonId, { kind: 'TEJO' as never, config: defaultConfig(8) })

    await expect(attempt).rejects.toBeInstanceOf(EdgeError)
    await expect(attempt).rejects.toThrow(NOT_IN_LIST)
    expect(await disciplinesOf(seasonId)).toBe(1)
  })

  it('un formato de partido fuera de la ficha tampoco se escribe', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason({ admin })
    const config = defaultConfig(8)
    const outOfRange = { ...config, matchFormat: { ...config.matchFormat, setsToWin: 4 } }

    await expect(addDiscipline(admin.client, seasonId, { kind: 'PADEL', config: outOfRange })).rejects.toThrow(
      'Los sets para ganar tienen que estar entre 1 y 3.',
    )
    expect(await disciplinesOf(seasonId)).toBe(1)
  })

  it('seasonHeader lee una disciplina de un deporte que la app no arma y trae su kind tal cual', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason({ admin, disciplines: [{ kind: 'TEJO' }] })

    const header = await seasonHeader(admin.client, seasonId)

    expect(header.disciplines.map((d) => d.kind)).toEqual(['TEJO'])
  })
})

// ── Tarea 4: AUTO y "a cuánto se juega esta fecha" del lado del servidor (§7).
// Mismo andamiaje que `db/matchday-format.db.test.ts`: plantel, fecha y asistencia.

async function fillerPlayers(count: number): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    const { data, error } = await adminClient()
      .from('players')
      .insert({ display_name: `Relleno de test ${Date.now()}-${i}-${Math.random()}` })
      .select('id')
      .single()
    if (error || data === null) throw new Error(error?.message)
    ids.push(data.id)
  }
  return ids
}

function fifaConfig(squadSize: number): SeasonConfig {
  return { ...defaultConfig(squadSize, 1), matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true, openScore: true } }
}

/** Un torneo con `count` en el plantel: Pádel en pareja (1 set a 4), o FIFA de a uno. */
async function squadSeason(count: number, sport: 'PADEL' | 'FIFA') {
  const admin = await createTestUser()
  const { seasonId, disciplineId, entryIds } = await createSeason({
    admin,
    config: defaultConfig(count),
    squad: await fillerPlayers(count),
    disciplines: [sport === 'FIFA' ? { kind: 'FIFA', pairSize: 1, allowsDraw: true, config: fifaConfig(count) } : {}],
  })
  return { admin, seasonId, disciplineId, entryIds }
}

/** La fecha siguiente de ese torneo, en DRAFT, con todo el plantel confirmado. */
async function draftWithPresent(scene: Awaited<ReturnType<typeof squadSeason>>): Promise<string> {
  const matchdayId = await createMatchday(scene.admin.client, scene.seasonId, MATCHDAY_PLAYED_ON, scene.disciplineId)
  for (const entryId of scene.entryIds) await setAttendance(scene.admin.client, matchdayId, entryId, 'PLAYING')
  return matchdayId
}

async function matchdayRow(matchdayId: string) {
  const { data, error } = await adminClient()
    .from('matchdays')
    .select('status, formato')
    .eq('id', matchdayId)
    .single()
  if (error || data === null) throw new Error(error?.message)
  return data
}

async function matchesOf(matchdayId: string): Promise<{ id: string; grupo: number }[]> {
  const { data, error } = await adminClient().from('matches').select('id, grupo').eq('matchday_id', matchdayId)
  if (error || data === null) throw new Error(error?.message)
  return data
}

async function loadAll(client: Client, matchdayId: string, gamesA: number, gamesB: number): Promise<void> {
  for (const match of await matchesOf(matchdayId)) await saveResult(client, match.id, [{ gamesA, gamesB }])
}

describe('a cuánto se juega esta fecha: setMatchFormat (§7)', () => {
  it('una fecha de Pádel a 6 games valida y cierra a 6, aunque el torneo juegue a 4', async () => {
    const scene = await squadSeason(8, 'PADEL')
    const matchdayId = await draftWithPresent(scene)
    await setMatchFormat(scene.admin.client, matchdayId, { setsToWin: 1, gamesPerSet: 6 })
    await generatePairs(scene.admin.client, matchdayId)
    await openMatchday(scene.admin.client, matchdayId)
    const [first, second] = await matchesOf(matchdayId)

    await saveResult(scene.admin.client, first!.id, [{ gamesA: 6, gamesB: 4 }])
    await expect(saveResult(scene.admin.client, second!.id, [{ gamesA: 4, gamesB: 2 }])).rejects.toThrow(
      'En un set a 6 games con tie-break, 4-2 no es un resultado posible.',
    )
    await loadAll(scene.admin.client, matchdayId, 6, 4)
    await closeMatchday(scene.admin.client, matchdayId)

    expect((await matchdayRow(matchdayId)).status).toBe('CLOSED')
  })

  it('null la vuelve a jugar al formato del torneo', async () => {
    const { admin, matchdayId } = await draftMatchday()
    await setMatchFormat(admin.client, matchdayId, { setsToWin: 1, gamesPerSet: 6 })

    await setMatchFormat(admin.client, matchdayId, null)

    expect(await matchFormatOf(matchdayId)).toBeNull()
  })

  it('rechaza games fuera de la ficha del deporte y no escribe', async () => {
    const { admin, matchdayId } = await draftMatchday()

    await expect(setMatchFormat(admin.client, matchdayId, { setsToWin: 1, gamesPerSet: 10 })).rejects.toThrow(
      'Los games por set tienen que estar entre 3 y 9.',
    )
    expect(await matchFormatOf(matchdayId)).toBeNull()
  })

  it('rechaza un deporte sin sets (FIFA)', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineId } = await createSeason({
      admin,
      disciplines: [{ kind: 'FIFA', pairSize: 1, allowsDraw: true, config: fifaConfig(8) }],
    })
    const matchdayId = await createMatchday(admin.client, seasonId, MATCHDAY_PLAYED_ON, disciplineId)

    await expect(setMatchFormat(admin.client, matchdayId, { setsToWin: 1, gamesPerSet: 4 })).rejects.toThrow(
      'Este deporte no tiene sets que cambiar.',
    )
  })

  it('rechaza con la fecha en juego', async () => {
    const { admin, matchdayId } = await draftMatchday()
    await moveTo(matchdayId, 'OPEN')

    await expect(setMatchFormat(admin.client, matchdayId, { setsToWin: 1, gamesPerSet: 6 })).rejects.toThrow(
      'A cuánto se juega la fecha sólo se cambia con la fecha en armado.',
    )
  })

  it('rechaza con resultados cargados después de volver a armado', async () => {
    const scene = await squadSeason(8, 'PADEL')
    const matchdayId = await draftWithPresent(scene)
    await generatePairs(scene.admin.client, matchdayId)
    await openMatchday(scene.admin.client, matchdayId)
    const [first] = await matchesOf(matchdayId)
    await saveResult(scene.admin.client, first!.id, [{ gamesA: 4, gamesB: 2 }])
    await redraftMatchday(scene.admin.client, matchdayId)

    await expect(setMatchFormat(scene.admin.client, matchdayId, { setsToWin: 1, gamesPerSet: 6 })).rejects.toThrow(
      'Hay resultados cargados: volvé a sortear la fecha antes de cambiar a cuánto se juega.',
    )
  })

  it('cambiar el formato del torneo con la fecha en juego no la toca: vale desde la próxima', async () => {
    const scene = await squadSeason(8, 'PADEL')
    const matchdayId = await draftWithPresent(scene)
    await generatePairs(scene.admin.client, matchdayId)
    await openMatchday(scene.admin.client, matchdayId)
    expect(await matchFormatOf(matchdayId)).toEqual({ setsToWin: 1, gamesPerSet: 4 })
    const config = defaultConfig(8)

    await updateDisciplineConfig(scene.admin.client, scene.disciplineId, {
      ...config,
      matchFormat: { ...config.matchFormat, gamesPerSet: 6 },
    })
    await loadAll(scene.admin.client, matchdayId, 4, 2)
    await closeMatchday(scene.admin.client, matchdayId)

    expect((await matchdayRow(matchdayId)).status).toBe('CLOSED')
  })
})

describe('AUTO se resuelve al confirmar la fecha (§7)', () => {
  it('se arma con lo sugerido y al confirmar quedan el formato concreto y el partido del torneo congelados', async () => {
    const scene = await squadSeason(8, 'FIFA')
    await updateDisciplineFormatoDefault(scene.admin.client, scene.disciplineId, { kind: 'AUTO' })
    const matchdayId = await draftWithPresent(scene)
    expect((await matchdayRow(matchdayId)).formato).toEqual({ kind: 'AUTO' })

    await generatePairs(scene.admin.client, matchdayId)
    expect([...new Set((await matchesOf(matchdayId)).map((match) => match.grupo))].sort()).toEqual([1, 2])
    // Sortear resuelve en memoria: la fecha sigue en Automático hasta confirmarla.
    expect((await matchdayRow(matchdayId)).formato).toEqual({ kind: 'AUTO' })

    await openMatchday(scene.admin.client, matchdayId)

    expect(await matchdayRow(matchdayId)).toEqual({
      status: 'OPEN',
      formato: { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 },
    })
    expect(await matchFormatOf(matchdayId)).toEqual({ setsToWin: 1, gamesPerSet: 4 })
  })

  it('setMatchdayFormat acepta AUTO en armado aunque todos contra todos no entre (12 de a uno)', async () => {
    const scene = await squadSeason(12, 'FIFA')
    const matchdayId = await draftWithPresent(scene)
    await expect(setMatchdayFormat(scene.admin.client, matchdayId, { kind: 'ROUND_ROBIN' })).rejects.toThrow(/12 lados/)

    await setMatchdayFormat(scene.admin.client, matchdayId, { kind: 'AUTO' })

    expect((await matchdayRow(matchdayId)).formato).toEqual({ kind: 'AUTO' })
  })
})

// ── Tarea 11: createSeason guarda el sorteo como orden, arma las parejas fijas
// y copia el orden de otro deporte (§4 "Por dentro").

const playerNames = (count: number) => Array.from({ length: count }, (_, i) => `Jugador ${i + 1}`)

/** Los `entries.id` del plantel, en el orden de `names` (el índice de asiento). */
async function seatIds(seasonId: string, names: string[]): Promise<string[]> {
  const { data, error } = await adminClient()
    .from('entries')
    .select('id, display_name')
    .eq('season_id', seasonId)
    .eq('kind', 'SQUAD')
  if (error || data === null) throw new Error(error?.message)
  return names.map((name) => data.find((row) => row.display_name === name)!.id)
}

async function disciplineIdOf(seasonId: string, kind: string): Promise<DisciplineId> {
  const { data, error } = await adminClient().from('disciplines').select('id').eq('season_id', seasonId).eq('kind', kind).single()
  if (error || data === null) throw new Error(error?.message)
  return data.id as DisciplineId
}

async function seasonRowsOf(userId: string): Promise<number> {
  const { count, error } = await adminClient().from('seasons').select('id', { count: 'exact', head: true }).eq('created_by', userId)
  if (error) throw new Error(error.message)
  return count ?? 0
}

describe('createSeason: parejas fijas, sorteo guardado como orden, "igual que" (§4)', () => {
  it('FIJAS + "Al azar": nacen las parejas, el sorteo queda como orden de parejas y season_seed_order sigue al plantel', async () => {
    const admin = await createTestUser()
    const names = playerNames(6)
    // `random` en 0 mueve siempre la última unidad al frente: [01][23][4][5] -> [23][4][5][01].
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    let seasonId: string
    try {
      ;({ seasonId } = await createSeasonOf(admin.client, {
        name: 'Fijas al azar',
        squadNames: names,
        config: defaultConfig(6),
        disciplines: [
          { kind: 'FIFA', pairSize: 1, config: fifaConfig(6) },
          { kind: 'PADEL', config: defaultConfig(6), fixedTeams: true, shuffle: true, teams: [[0, 1], [2, 3]] },
        ],
      }))
    } finally {
      random.mockRestore()
    }
    const ids = await seatIds(seasonId, names)
    const padelId = await disciplineIdOf(seasonId, 'PADEL')

    const pairs = (await teamsOf(admin.client, padelId))
      .map((team) => [ids.indexOf(team.entryA), ids.indexOf(team.entryB)])
      .sort((left, right) => left[0]! - right[0]!)
    expect(pairs).toEqual([[0, 1], [2, 3]])
    expect(await squadSeedOrder(admin.client, padelId)).toEqual([2, 3, 4, 5, 0, 1].map((at) => ids[at]))
    // El otro deporte sigue el plantel y no se llevó las parejas del vecino.
    expect(await teamsOf(admin.client, await disciplineIdOf(seasonId, 'FIFA'))).toEqual([])
    expect(await squadSeedOrder(admin.client, await disciplineIdOf(seasonId, 'FIFA'))).toEqual(ids)
    const { data: seasonOrder } = await adminClient()
      .from('season_seed_order')
      .select('entry_id')
      .eq('season_id', seasonId)
      .order('seed_position', { ascending: true })
    expect(seasonOrder?.map((row) => row.entry_id)).toEqual(ids)
  })

  it('"Por nivel" (seedOrder) en pádel e "Igual que" en FIFA individual: los dos órdenes iguales', async () => {
    const admin = await createTestUser()
    const names = playerNames(4)

    const { seasonId } = await createSeasonOf(admin.client, {
      name: 'Igual que',
      squadNames: names,
      config: defaultConfig(4),
      disciplines: [
        { kind: 'PADEL', config: defaultConfig(4), seedOrder: [3, 2, 1, 0] },
        { kind: 'FIFA', pairSize: 1, config: fifaConfig(4), sameOrderAs: 0 },
      ],
    })

    const ids = await seatIds(seasonId, names)
    const padel = await squadSeedOrder(admin.client, await disciplineIdOf(seasonId, 'PADEL'))
    const fifa = await squadSeedOrder(admin.client, await disciplineIdOf(seasonId, 'FIFA'))
    expect(padel).toEqual([3, 2, 1, 0].map((at) => ids[at]))
    expect(fifa).toEqual(padel)
  })

  it('el formato por default AUTO (el de la ficha) se guarda tal cual', async () => {
    const admin = await createTestUser()

    const { seasonId } = await createSeasonOf(admin.client, {
      name: 'Default AUTO',
      squadNames: playerNames(4),
      config: defaultConfig(4),
      disciplines: [{ kind: 'PADEL', config: defaultConfig(4), formatoDefault: { kind: 'AUTO' } }],
    })

    const { data } = await adminClient().from('disciplines').select('formato_default').eq('season_id', seasonId).single()
    expect(data?.formato_default).toEqual({ kind: 'AUTO' })
  })
})

/**
 * Review Focus 1: el payload de `createTournament` es JSON de cliente sin schema
 * en runtime. Cada forma falsificada se rechaza con SU mensaje y antes de
 * escribir: el usuario no gana ninguna fila en `seasons`.
 */
describe('createSeason: sorteo, "igual que" y parejas se validan antes de escribir', () => {
  const ONE_FORM = 'Cada deporte arma su primera fecha de una sola forma.'
  const SAME_AS = '"Igual que" tiene que apuntar a otro deporte del torneo.'
  const FIXED_ONLY = 'Las parejas fijas sólo van en un deporte de parejas fijas.'
  const BAD_TEAMS = 'Las parejas tienen que ser de dos personas distintas del plantel, cada una en una sola pareja.'

  type Forged = Record<string, unknown>
  const padel = (extra: Forged = {}): Forged => ({ kind: 'PADEL', config: defaultConfig(4), ...extra })
  const fixed = (extra: Forged = {}): Forged => padel({ fixedTeams: true, ...extra })
  const fifa = (extra: Forged = {}): Forged => ({ kind: 'FIFA', pairSize: 1, config: fifaConfig(4), ...extra })

  const cases: Array<[string, string, Forged[]]> = [
    ['seedOrder y shuffle', ONE_FORM, [padel({ seedOrder: [0, 1, 2, 3], shuffle: true })]],
    ['seedOrder y sameOrderAs', ONE_FORM, [padel(), fifa({ seedOrder: [0, 1, 2, 3], sameOrderAs: 0 })]],
    ['shuffle y sameOrderAs', ONE_FORM, [padel(), fifa({ shuffle: true, sameOrderAs: 0 })]],
    ['las tres formas juntas', ONE_FORM, [padel(), fifa({ seedOrder: [0, 1, 2, 3], shuffle: true, sameOrderAs: 0 })]],

    ['sameOrderAs no entero (0.5)', SAME_AS, [padel(), fifa({ sameOrderAs: 0.5 })]],
    ['sameOrderAs de texto ("0")', SAME_AS, [padel(), fifa({ sameOrderAs: '0' })]],
    ['sameOrderAs null (lo que cruza el JSON de un NaN)', SAME_AS, [padel(), fifa({ sameOrderAs: null })]],
    ['sameOrderAs fuera de rango (2 con dos deportes)', SAME_AS, [padel(), fifa({ sameOrderAs: 2 })]],
    ['sameOrderAs negativo', SAME_AS, [padel(), fifa({ sameOrderAs: -1 })]],
    ['sameOrderAs igual a su propio índice', SAME_AS, [padel(), fifa({ sameOrderAs: 1 })]],
    ['sameOrderAs a un único deporte', SAME_AS, [padel({ sameOrderAs: 0 })]],
    ['sameOrderAs a otra que a su vez copia', SAME_AS, [padel(), fifa({ sameOrderAs: 0 }), fifa({ sameOrderAs: 1 })]],
    ['dos que se copian entre sí', SAME_AS, [padel({ sameOrderAs: 1 }), fifa({ sameOrderAs: 0 })]],

    ['teams sin fixedTeams', FIXED_ONLY, [padel({ teams: [[0, 1]] })]],
    ['teams con fixedTeams en false', FIXED_ONLY, [padel({ fixedTeams: false, teams: [[0, 1]] })]],
    ['teams en un deporte de a uno', FIXED_ONLY, [fifa({ fixedTeams: true, teams: [[0, 1]] })]],

    ['índice de pareja no entero', BAD_TEAMS, [fixed({ teams: [[0.5, 1]] })]],
    ['índice de pareja de texto', BAD_TEAMS, [fixed({ teams: [['0', 1]] })]],
    ['índice de pareja null', BAD_TEAMS, [fixed({ teams: [[null, 1]] })]],
    ['índice de pareja fuera del plantel (4 de 4)', BAD_TEAMS, [fixed({ teams: [[0, 4]] })]],
    ['índice de pareja negativo', BAD_TEAMS, [fixed({ teams: [[-1, 1]] })]],
    ['pareja de la misma persona', BAD_TEAMS, [fixed({ teams: [[1, 1]] })]],
    ['alguien en dos parejas', BAD_TEAMS, [fixed({ teams: [[0, 1], [1, 2]] })]],
    ['la misma pareja dada vuelta', BAD_TEAMS, [fixed({ teams: [[0, 1], [1, 0]] })]],
    ['pareja de tres', BAD_TEAMS, [fixed({ teams: [[0, 1, 2]] })]],
    ['pareja que no es una lista', BAD_TEAMS, [fixed({ teams: [5] })]],
    ['teams que no es una lista', BAD_TEAMS, [fixed({ teams: 'abc' })]],
    ['teams null', BAD_TEAMS, [fixed({ teams: null })]],
  ]

  it.each(cases)('%s: rebota con su mensaje y no deja ninguna temporada', async (_label, message, disciplines) => {
    const admin = await createTestUser()

    const caught = await createSeasonOf(admin.client, {
      name: 'Payload falsificado',
      squadNames: playerNames(4),
      config: defaultConfig(4),
      disciplines: disciplines as never,
    }).then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(caught).toBeInstanceOf(EdgeError)
    expect((caught as EdgeError).message).toBe(message)
    expect(await seasonRowsOf(admin.userId)).toBe(0)
  })
})
