import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@/core'
import type { Json } from './database.types'
import { addDiscipline } from './discipline'
import { EdgeError } from './errors'
import { createMatchday } from './matchday'
import { seasonHeader } from './read'
import { createSeason as createSeasonOf } from './season'
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
