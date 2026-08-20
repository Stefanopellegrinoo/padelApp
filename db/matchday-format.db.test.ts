import { describe, expect, it } from 'vitest'
import { defaultConfig, type MatchdayFormat } from '@/core'
import { createMatchday, generatePairs, openMatchday, setAttendance, setMatchdayFormat } from './matchday'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser, type TestUser } from './test/users'

// ── scaffolding local: los mismos armadores de `db/generate.db.test.ts`,
// mínimos para llegar a OPEN y probar el guard "editable antes de armar".

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

async function markAllPlaying(admin: TestUser, matchdayId: string, entryIds: string[]): Promise<void> {
  for (const entryId of entryIds) {
    await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
  }
}

/**
 * `matchdays.formato` (0040, REQ-D8-1) es el CUARTO column-grant de la misma
 * trampa que `discipline_id` (0015), `pair_size` (0028) y `allows_draw`
 * (0034): `matchdays` tiene grants a nivel COLUMNA (0002_rls.sql:236-238), y
 * sin el grant un insert/update de `authenticated` que manda `formato` falla
 * con "permission denied for table matchdays" — un mensaje que no nombra la
 * columna.
 *
 * A diferencia de los otros tres, `formato` es el ÚNICO que también necesita
 * `grant update`: el formato se elige DESPUÉS de crear la fecha, ANTES de
 * armar (REQ-D8-1, "editable antes de armar") — los otros tres se fijan al
 * crear y no cambian más. Un test que sólo cubra `insert` no alcanza.
 *
 * Los dos verbos se ejercitan con `admin.client` (rol `authenticated`),
 * NUNCA con `adminClient()` (`service_role`): con `service_role` PostgREST no
 * aplica RLS ni column grants, y el test pasaría en verde mintiendo.
 */
async function scene() {
  const admin = await createTestUser()
  const { seasonId, disciplineId } = await createSeason({ admin })
  return { admin, seasonId, disciplineId }
}

const groupsFormat: MatchdayFormat = { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 }

describe('matchdays.formato — column-grant contra authenticated (REQ-D8-1)', () => {
  it('authenticated crea una fecha mandando formato explícito, sin "permission denied"', async () => {
    const { admin, seasonId, disciplineId } = await scene()

    const { data, error } = await admin.client
      .from('matchdays')
      .insert({
        season_id: seasonId,
        discipline_id: disciplineId,
        number: 1,
        played_on: '2026-03-05',
        pair_size: 2,
        allows_draw: false,
        formato: { kind: 'ROUND_ROBIN' },
      })
      .select('id')
      .single()

    expect(error).toBeNull()
    expect(data).not.toBeNull()
  })

  it('authenticated actualiza el formato de una fecha ya creada (editable antes de armar)', async () => {
    const { admin, seasonId, disciplineId } = await scene()
    const { data: created, error: createError } = await admin.client
      .from('matchdays')
      .insert({
        season_id: seasonId,
        discipline_id: disciplineId,
        number: 1,
        played_on: '2026-03-05',
        pair_size: 2,
        allows_draw: false,
      })
      .select('id')
      .single()
    if (createError || created === null) throw new Error(createError?.message)

    const { error: updateError } = await admin.client
      .from('matchdays')
      .update({ formato: groupsFormat })
      .eq('id', created.id)
    expect(updateError).toBeNull()

    const db = adminClient()
    const { data, error } = await db.from('matchdays').select('formato').eq('id', created.id).single()
    if (error || data === null) throw new Error(error?.message)
    expect(data.formato).toEqual(groupsFormat)
  })

  it('una fecha nueva nace con formato ROUND_ROBIN por default (REQ-D7-1, no-regresión)', async () => {
    const { admin, seasonId, disciplineId } = await scene()
    const { data: created, error } = await admin.client
      .from('matchdays')
      .insert({
        season_id: seasonId,
        discipline_id: disciplineId,
        number: 1,
        played_on: '2026-03-05',
        pair_size: 2,
        allows_draw: false,
      })
      .select('formato')
      .single()
    if (error || created === null) throw new Error(error?.message)

    expect(created.formato).toEqual({ kind: 'ROUND_ROBIN' })
  })
})

/**
 * `setMatchdayFormat` (`db/matchday.ts`) es el PRIMER escritor de producción
 * del `grant update (formato)`: hasta acá el `.update()` de arriba lo ejercía
 * a mano, sin ningún caller real. Se pincha el ARGUMENTO que llega a la fila,
 * no sólo que el update no falle (#3957, la regla de las seis veces) —los dos
 * primeros tests eligen kinds DISTINTOS a propósito, para que copiar el
 * default de columna no alcance para pasar los dos.
 */
describe('setMatchdayFormat — primer escritor de producción del grant (REQ-D8-1)', () => {
  it('el formato elegido (GROUPS_KNOCKOUT) llega a la fila', async () => {
    const { admin, seasonId, disciplineId } = await scene()
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05', disciplineId)

    await setMatchdayFormat(admin.client, matchdayId, groupsFormat)

    const db = adminClient()
    const { data, error } = await db.from('matchdays').select('formato').eq('id', matchdayId).single()
    if (error || data === null) throw new Error(error?.message)
    expect(data.formato).toEqual(groupsFormat)
  })

  it('elegir ROUND_ROBIN después de GROUPS_KNOCKOUT también llega — no es un default fijo', async () => {
    const { admin, seasonId, disciplineId } = await scene()
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05', disciplineId)
    await setMatchdayFormat(admin.client, matchdayId, groupsFormat)

    await setMatchdayFormat(admin.client, matchdayId, { kind: 'ROUND_ROBIN' })

    const db = adminClient()
    const { data, error } = await db.from('matchdays').select('formato').eq('id', matchdayId).single()
    if (error || data === null) throw new Error(error?.message)
    expect(data.formato).toEqual({ kind: 'ROUND_ROBIN' })
  })

  it('rechaza cambiar el formato con la fecha ya confirmada: "editable antes de armar"', async () => {
    const admin = await createTestUser()
    const players = await fillerPlayers(8)
    const { seasonId, entryIds } = await createSeason({ admin, config: defaultConfig(8), squad: players })
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05')
    await markAllPlaying(admin, matchdayId, entryIds)
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)

    await expect(setMatchdayFormat(admin.client, matchdayId, groupsFormat)).rejects.toThrow(/en armado/)

    const db = adminClient()
    const { data, error } = await db.from('matchdays').select('formato').eq('id', matchdayId).single()
    if (error || data === null) throw new Error(error?.message)
    expect(data.formato).toEqual({ kind: 'ROUND_ROBIN' }) // no cambió
  })
})

/**
 * `matchdays_formato_kind` (0040) validaba SÓLO `kind` — `{"kind":
 * "GROUPS_KNOCKOUT"}` sin `groups`/`qualifiersPerGroup` era una fila LEGAL, y
 * con `grant update (formato)` abierto cualquier `authenticated` podía
 * escribirla. `generatePairs` (`groupedMatches`, `db/matchday.ts`) confía en
 * esa forma sin volver a validarla — con `groups=undefined`,
 * `groupSides(storedSides, undefined)` no dispara su guard (`undefined < 1`
 * es `false`), `Array.from({length: undefined})` da `[]`, y revienta DESPUÉS
 * de haber borrado y reinsertado las parejas (S69: `generatePairs` sin
 * transacción), con un mensaje que culpa al código ("El grupo 0 no existe.
 * Esto es un bug.") cuando el problema es el DATO.
 *
 * La base RECHAZA, no un `if` de aplicación (REQ-D5-1, mismo idioma que
 * `pairs_side_shape`): el check ahora exige la FORMA completa de
 * `GROUPS_KNOCKOUT` — `groups` y `qualifiersPerGroup` presentes, numéricos, y
 * dentro de lo que `knockoutMatchups` (`core/knockout.ts`) sabe armar (G∈
 * {1,2,4}, P=2). `groups: "hola"` tiene que RECHAZAR la fila
 * (`error.code === '23514'`, check_violation), no explotar con un error de
 * casteo (`22P02`) — un CHECK que TIRA no es lo mismo que un CHECK que
 * RECHAZA.
 */
describe('matchdays_formato_kind — GROUPS_KNOCKOUT exige su forma completa (REQ-D5-1)', () => {
  it('rechaza GROUPS_KNOCKOUT sin groups/qualifiersPerGroup', async () => {
    const { admin, seasonId, disciplineId } = await scene()

    const { error } = await admin.client.from('matchdays').insert({
      season_id: seasonId,
      discipline_id: disciplineId,
      number: 1,
      played_on: '2026-03-05',
      pair_size: 2,
      allows_draw: false,
      formato: { kind: 'GROUPS_KNOCKOUT' },
    })

    expect(error).not.toBeNull()
    expect(error?.code).toBe('23514') // check_violation, no un permission denied ni un cast error
  })

  it('rechaza groups=3: knockoutMatchups sólo sabe armar 1, 2 o 4', async () => {
    const { admin, seasonId, disciplineId } = await scene()

    const { error } = await admin.client.from('matchdays').insert({
      season_id: seasonId,
      discipline_id: disciplineId,
      number: 1,
      played_on: '2026-03-05',
      pair_size: 2,
      allows_draw: false,
      formato: { kind: 'GROUPS_KNOCKOUT', groups: 3, qualifiersPerGroup: 2 },
    })

    expect(error).not.toBeNull()
    expect(error?.code).toBe('23514')
  })

  it('rechaza un groups no numérico SIN explotar en un error de casteo', async () => {
    const { admin, seasonId, disciplineId } = await scene()

    const { error } = await admin.client.from('matchdays').insert({
      season_id: seasonId,
      discipline_id: disciplineId,
      number: 1,
      played_on: '2026-03-05',
      pair_size: 2,
      allows_draw: false,
      formato: { kind: 'GROUPS_KNOCKOUT', groups: 'hola', qualifiersPerGroup: 2 },
    })

    expect(error).not.toBeNull()
    // check_violation (23514), NO invalid_text_representation (22P02): el
    // check tiene que RECHAZAR el dato basura, no reventar tratando de
    // castearlo a entero.
    expect(error?.code).toBe('23514')
  })

  it('acepta GROUPS_KNOCKOUT con la forma completa y soportada', async () => {
    const { admin, seasonId, disciplineId } = await scene()

    const { error } = await admin.client.from('matchdays').insert({
      season_id: seasonId,
      discipline_id: disciplineId,
      number: 1,
      played_on: '2026-03-05',
      pair_size: 2,
      allows_draw: false,
      formato: { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 },
    })

    expect(error).toBeNull()
  })

  it('acepta ROUND_ROBIN sin pedirle campos de grupos', async () => {
    const { admin, seasonId, disciplineId } = await scene()

    const { error } = await admin.client.from('matchdays').insert({
      season_id: seasonId,
      discipline_id: disciplineId,
      number: 1,
      played_on: '2026-03-05',
      pair_size: 2,
      allows_draw: false,
      formato: { kind: 'ROUND_ROBIN' },
    })

    expect(error).toBeNull()
  })
})
