import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@/core'
import type { Client } from './client'
import { createSeason } from './season'

/**
 * WU1 (tanda 7, BLOQUEA): `createSeason` hace 4+N escrituras no
 * transaccionales contra PostgREST. Si el proceso muere entre la ÚLTIMA y la
 * ANTEÚLTIMA, la temporada queda con lo que ya escribió y nada más —no hay
 * rollback posible, porque no hay transacción que deshacer—. Cuál de las dos
 * queda afuera decide si el hueco es RUIDOSO (alguien lo nota) o INVISIBLE
 * (nadie lo nota nunca): sin `discipline_entries`, `setAttendance` rebota
 * 23503 apenas se intenta usar la disciplina, y el tripwire global de
 * `db/discipline.db.test.ts:250` lo cuenta. Sin `season_seed_order`, nada
 * rebota nunca —`seasonSquadMembersOf` (`db/read.ts`) cae a `?? MAX_SAFE_
 * INTEGER` para TODOS, ata el sort estable a un uuid random, y no hay
 * pantalla que reescriba esa tabla para curarlo.
 *
 * No se puede reproducir un crash a mitad de un `await` contra Supabase real
 * (no hay forma de matar el proceso ENTRE dos llamadas HTTP desde este mismo
 * archivo) — mismo criterio que `db/discipline.unit.test.ts` y
 * `db/friends.unit.test.ts` ya usan para lo que no se puede provocar a
 * pedido contra la base real: un cliente falso que sólo anota el ORDEN en
 * que `createSeason` toca cada tabla.
 *
 * El fix no es una validación nueva, es reordenar dos `insert` que ya
 * estaban — por eso el test no mira mensajes de error, sólo el orden.
 */
function fakeClient(): { client: Client; calls: string[] } {
  const calls: string[] = []
  let disciplineSeq = 0
  let entrySeq = 0

  function genericBuilder(resultFor: (payload: unknown) => unknown) {
    let payload: unknown
    const builder: Record<string, unknown> = {
      insert: (data: unknown) => {
        payload = data
        return builder
      },
      select: () => builder,
      single: () => Promise.resolve(resultFor(payload)),
      delete: () => builder,
      eq: () => builder,
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(resultFor(payload)).then(resolve, reject),
    }
    return builder
  }

  const from = (table: string) => {
    calls.push(table)
    if (table === 'seasons') {
      return genericBuilder(() => ({ data: { id: 'season-1', invite_token: 'tok-1' }, error: null }))
    }
    if (table === 'disciplines') {
      return genericBuilder(() => ({ data: { id: `discipline-${disciplineSeq++}` }, error: null }))
    }
    if (table === 'entries') {
      return genericBuilder((payload) => ({
        data: (payload as unknown[]).map(() => ({ id: `entry-${entrySeq++}` })),
        error: null,
      }))
    }
    if (table === 'discipline_entries' || table === 'season_seed_order') {
      return genericBuilder(() => ({ error: null }))
    }
    throw new Error(`fakeClient: tabla no soportada en este test: ${table}`)
  }

  const auth = { getUser: () => Promise.resolve({ data: { user: { id: 'admin-1' } }, error: null }) }

  return { client: { from, auth } as unknown as Client, calls }
}

describe('createSeason — orden de escritura de season_seed_order (WU1, tanda 7)', () => {
  it('escribe season_seed_order ANTES que discipline_entries, no después', async () => {
    const { client, calls } = fakeClient()
    const config = defaultConfig(4)

    await createSeason(client, {
      name: 'Orden de escritura',
      squadNames: ['Ana', 'Beto', 'Caro', 'Dani'],
      config,
    })

    const seedOrderAt = calls.indexOf('season_seed_order')
    const disciplineEntriesAt = calls.indexOf('discipline_entries')
    expect(seedOrderAt).toBeGreaterThanOrEqual(0)
    expect(disciplineEntriesAt).toBeGreaterThanOrEqual(0)
    // La escritura cuya AUSENCIA es invisible (season_seed_order) tiene que
    // quedar ANTES que la que ya tiene tripwire y pantalla que la note
    // (discipline_entries) — así, si el proceso muere entre las dos, lo que
    // falta es lo detectable.
    expect(seedOrderAt).toBeLessThan(disciplineEntriesAt)
  })
})
