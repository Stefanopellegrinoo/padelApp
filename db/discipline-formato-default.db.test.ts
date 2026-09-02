import { describe, expect, it } from 'vitest'
import { createMatchday } from './matchday'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser } from './test/users'

/**
 * `disciplines.formato_default` (0074, docs/tipos-de-torneo.md §2.5) — el
 * grant de UPDATE, la herencia hacia `createMatchday` y el CHECK, copiado de
 * `matchdays_formato_kind` (0040).
 *
 * El grant se ejercita con `admin.client` (rol `authenticated`), nunca con
 * `adminClient()` (`service_role`) — mismo criterio que
 * `db/matchday-format.db.test.ts`: con `service_role` PostgREST no aplica
 * RLS ni column grants, y el test pasaría en verde mintiendo.
 */
describe('disciplines.formato_default — column-grant contra authenticated (§2.5)', () => {
  it('authenticated actualiza el formato_default de una disciplina que organiza, sin "permission denied"', async () => {
    const admin = await createTestUser()
    const { disciplineId } = await createSeason({ admin })

    const { error, count } = await admin.client
      .from('disciplines')
      .update(
        { formato_default: { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 } },
        { count: 'exact' },
      )
      .eq('id', disciplineId)

    expect(error).toBeNull()
    expect(count).toBe(1)

    const db = adminClient()
    const { data, error: readError } = await db
      .from('disciplines')
      .select('formato_default')
      .eq('id', disciplineId)
      .single()
    if (readError || data === null) throw new Error(readError?.message)
    expect(data.formato_default).toEqual({ kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 })
  })

  it('una disciplina nueva nace con formato_default ROUND_ROBIN (mismo default que matchdays.formato, sin backfill aparte)', async () => {
    const admin = await createTestUser()
    const { disciplineId } = await createSeason({ admin })

    const db = adminClient()
    const { data, error } = await db.from('disciplines').select('formato_default').eq('id', disciplineId).single()
    if (error || data === null) throw new Error(error?.message)
    expect(data.formato_default).toEqual({ kind: 'ROUND_ROBIN' })
  })
})

/**
 * `disciplines_formato_default_kind` es una copia de `matchdays_formato_kind`
 * (0040_matchday_format.sql:46-60) sólo con la columna cambiada: mismo CASE
 * anidado, mismo guard con regexp. Estos dos casos alcanzan para detectar si
 * la copia perdió la forma completa que exige `GROUPS_KNOCKOUT` (REQ-D5-1).
 */
describe('disciplines_formato_default_kind — copia de matchdays_formato_kind (REQ-D5-1)', () => {
  it('rechaza {"kind":"GROUPS_KNOCKOUT"} sin groups/qualifiersPerGroup', async () => {
    const admin = await createTestUser()
    const { disciplineId } = await createSeason({ admin })
    const db = adminClient()

    const { error } = await db
      .from('disciplines')
      .update({ formato_default: { kind: 'GROUPS_KNOCKOUT' } })
      .eq('id', disciplineId)

    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/disciplines_formato_default_kind/)
  })

  it('acepta la forma completa: groups=2, qualifiersPerGroup=2', async () => {
    const admin = await createTestUser()
    const { disciplineId } = await createSeason({ admin })
    const db = adminClient()

    const { error } = await db
      .from('disciplines')
      .update({ formato_default: { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 } })
      .eq('id', disciplineId)

    expect(error).toBeNull()
  })
})

/**
 * `groups: 1` es la diferencia DELIBERADA entre los dos CHECK, no un typo:
 * `matchdays_formato_kind` (0040) sigue aceptándolo sin cambios —
 * `offerableFormats` lo excluye en TypeScript, no en SQL, y hasta este
 * cambio `matchdays.formato` tenía un único escritor (`setMatchdayFormat`)
 * que ya pasaba por ahí. `disciplines_formato_default_kind` lo rechaza
 * porque `createMatchday` es un segundo escritor de `matchdays.formato` que
 * NO pasa por `formatoOfrecible` (no hay `sides` al crear una disciplina) —
 * ver el comentario de `0074_discipline_formato_default.sql`. Pin de los dos
 * lados para que la próxima persona que lea uno de los dos CHECK no lo lea
 * como un descuido copiando el otro.
 */
describe('groups: 1 — rechazado en formato_default, aceptado en matchdays.formato (diferencia deliberada)', () => {
  it('disciplines_formato_default_kind rechaza groups: 1', async () => {
    const admin = await createTestUser()
    const { disciplineId } = await createSeason({ admin })
    const db = adminClient()

    const { error } = await db
      .from('disciplines')
      .update({ formato_default: { kind: 'GROUPS_KNOCKOUT', groups: 1, qualifiersPerGroup: 2 } })
      .eq('id', disciplineId)

    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/disciplines_formato_default_kind/)
  })

  it('matchdays_formato_kind sigue aceptando groups: 1 (0040, sin cambios)', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineId } = await createSeason({ admin })
    const db = adminClient()

    const { error } = await db.from('matchdays').insert({
      season_id: seasonId,
      discipline_id: disciplineId,
      number: 1,
      played_on: '2026-03-05',
      pair_size: 2,
      allows_draw: false,
      formato: { kind: 'GROUPS_KNOCKOUT', groups: 1, qualifiersPerGroup: 2 },
    })

    expect(error).toBeNull()
  })
})

/**
 * La herencia en sí (§2.5, el arreglo): `createMatchday` (`db/matchday.ts`)
 * lee `formato_default` vía `disciplineConfig` y lo manda como `formato` de
 * la fecha nueva. Se actualiza `formato_default` con `adminClient()`
 * (service_role) porque acá el escenario es la disciplina, no el grant —ya
 * cubierto arriba—, mismo criterio que el resto de esta suite para separar
 * "cómo se arma el escenario" de "qué se está probando".
 */
describe('createMatchday hereda formato_default de la disciplina (§2.5)', () => {
  it('una disciplina con formato_default GROUPS_KNOCKOUT produce una fecha con ese formato', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineId } = await createSeason({ admin })
    const db = adminClient()
    const { error: updateError } = await db
      .from('disciplines')
      .update({ formato_default: { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 } })
      .eq('id', disciplineId)
    if (updateError) throw new Error(updateError.message)

    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05')

    const { data, error } = await db.from('matchdays').select('formato').eq('id', matchdayId).single()
    if (error || data === null) throw new Error(error?.message)
    expect(data.formato).toEqual({ kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 })
  })

  it('una disciplina con formato_default ROUND_ROBIN (el default) produce una fecha ROUND_ROBIN — no-regresión', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason({ admin })

    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05')

    const db = adminClient()
    const { data, error } = await db.from('matchdays').select('formato').eq('id', matchdayId).single()
    if (error || data === null) throw new Error(error?.message)
    expect(data.formato).toEqual({ kind: 'ROUND_ROBIN' })
  })
})
