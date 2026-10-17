import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@/core'
import type { Json } from './database.types'
import { updateDisciplineFormatoDefault } from './discipline'
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
 * `0075_disciplines_formato_default_insert_grant.sql` — slice 1 del wizard
 * multi-disciplina (docs/tipos-de-torneo.md §2.5, §2.6): `createSeason`/
 * `addDiscipline` (`db/season.ts`/`db/discipline.ts`) ganan un
 * `formatoDefault` opcional por spec, así que ahora sí puede llegar un INSERT
 * de `authenticated` que nombre `formato_default`. Mismo criterio que el
 * resto de esta suite y que `db/matchday-format.db.test.ts`: se ejercita con
 * `admin.client` (rol `authenticated`), nunca con `adminClient()`
 * (`service_role`).
 */
describe('disciplines.formato_default — grant de INSERT contra authenticated (§2.5)', () => {
  it('authenticated inserta una disciplina mandando formato_default explícito, sin "permission denied"', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason({ admin })

    const { data, error } = await admin.client
      .from('disciplines')
      .insert({
        season_id: seasonId,
        kind: 'FIFA',
        config: defaultConfig(8) as unknown as Json,
        position: 1,
        formato_default: { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 },
      })
      .select('id')
      .single()

    expect(error).toBeNull()
    expect(data).not.toBeNull()
  })
})

/**
 * `updateDisciplineFormatoDefault` -- la pantalla de Ajustes que edita este
 * default (§2.5). El camino feliz con `admin.client` sigue el mismo
 * `count: 'exact'` que `updateDisciplineHasMasters`/`updateDisciplineRules`
 * (`db/discipline.db.test.ts`). El caso de un participante que NO organiza
 * copia el de `updateDisciplineRules` (894-901) -- `updateDisciplineHasMasters`
 * (761-816) no tiene ese caso: sus tres tests corren los tres con
 * `admin.client`. Nunca `service_role` para esto.
 */
describe('updateDisciplineFormatoDefault (§2.5)', () => {
  it('un admin guarda el formato por default de su disciplina', async () => {
    const admin = await createTestUser()
    const { disciplineId } = await createSeason({ admin })

    await updateDisciplineFormatoDefault(admin.client, disciplineId, {
      kind: 'GROUPS_KNOCKOUT',
      groups: 4,
      qualifiersPerGroup: 2,
    })

    const { data, error } = await adminClient()
      .from('disciplines')
      .select('formato_default')
      .eq('id', disciplineId)
      .single()
    if (error || data === null) throw new Error(error?.message)
    expect(data.formato_default).toEqual({ kind: 'GROUPS_KNOCKOUT', groups: 4, qualifiersPerGroup: 2 })
  })

  it('a un participante que no organiza le avisa que no guardó, y no escribe nada (RLS disciplines_write)', async () => {
    const admin = await createTestUser()
    const member = await createTestUser()
    const { disciplineId } = await createSeason({ admin, squad: [member.playerId] })

    await expect(
      updateDisciplineFormatoDefault(member.client, disciplineId, {
        kind: 'GROUPS_KNOCKOUT',
        groups: 2,
        qualifiersPerGroup: 2,
      }),
    ).rejects.toThrow(/sólo puede hacerlo quien organiza/)

    const { data, error } = await adminClient()
      .from('disciplines')
      .select('formato_default')
      .eq('id', disciplineId)
      .single()
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
