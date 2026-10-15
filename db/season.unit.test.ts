import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@/core'
import type { Client } from './client'
import { createSeason, resolveSeedOrders } from './season'

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
function fakeClient(failTeams = false): { client: Client; calls: string[] } {
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
    if (table === 'discipline_teams') {
      return genericBuilder(() => ({ error: failTeams ? { message: 'boom' } : null }))
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

describe('resolveSeedOrders — el orden final de cada disciplina', () => {
  const config = defaultConfig(6)
  /** Un `random` que sale de una semilla: el mismo número de siempre, distinto por semilla. */
  const seeded = (seed: number) => {
    let state = seed + 1
    return () => {
      state = (state * 48271) % 2147483647
      return state / 2147483647
    }
  }

  it('con shuffle y parejas, cada pareja queda contigua y los sueltos van en algún lugar', () => {
    for (let seed = 0; seed < 50; seed++) {
      const [order] = resolveSeedOrders([{ config, shuffle: true, teams: [[0, 3], [1, 2]] }], 5, seeded(seed))

      expect([...order!].sort()).toEqual([0, 1, 2, 3, 4])
      expect(Math.abs(order!.indexOf(0) - order!.indexOf(3))).toBe(1)
      expect(Math.abs(order!.indexOf(1) - order!.indexOf(2))).toBe(1)
    }
  })

  it('sortea unidades: parejas y sueltos, y la pareja conserva el orden en que vino', () => {
    // random = 0 mueve siempre la última unidad al frente: [[0,3],[1,2],[4]] -> [[1,2],[4],[0,3]].
    const [order] = resolveSeedOrders([{ config, shuffle: true, teams: [[0, 3], [1, 2]] }], 5, () => 0)

    expect(order).toEqual([1, 2, 4, 0, 3])
  })

  it('con shuffle y sin parejas, sortea a todos como sueltos', () => {
    const [order] = resolveSeedOrders([{ config, shuffle: true }], 4, () => 0)

    expect([...order!].sort()).toEqual([0, 1, 2, 3])
    expect(order).toEqual([1, 2, 3, 0])
  })

  it('seedOrder pasa tal cual', () => {
    expect(resolveSeedOrders([{ config, seedOrder: [2, 0, 1] }], 3, () => 0)).toEqual([[2, 0, 1]])
  })

  it('sameOrderAs copia el orden ya resuelto de la otra, incluido un sorteo', () => {
    const [shuffledOrder, copy] = resolveSeedOrders(
      [{ config, shuffle: true }, { config, sameOrderAs: 0 }],
      4,
      seeded(7),
    )

    expect(shuffledOrder).toHaveLength(4)
    expect(copy).toEqual(shuffledOrder)
  })

  it('sameOrderAs de una disciplina sin orden propio copia el del plantel', () => {
    expect(resolveSeedOrders([{ config }, { config, sameOrderAs: 0 }], 3, () => 0)).toEqual([undefined, [0, 1, 2]])
  })

  it('sin nada de eso, undefined: el orden global de siempre', () => {
    expect(resolveSeedOrders([{ config }, { config }], 4, () => 0)).toEqual([undefined, undefined])
  })
})

describe('createSeason — las parejas fijas se escriben todas juntas, con rollback', () => {
  const teamsSpec = { kind: 'PADEL' as const, config: defaultConfig(4), fixedTeams: true, teams: [[0, 1], [2, 3]] as Array<[number, number]> }
  const names = ['Ana', 'Beto', 'Caro', 'Dani']

  it('un solo insert en discipline_teams, después de discipline_entries', async () => {
    const { client, calls } = fakeClient()

    await createSeason(client, { name: 'Fijas', squadNames: names, config: defaultConfig(4), disciplines: [teamsSpec] })

    expect(calls.filter((table) => table === 'discipline_teams')).toHaveLength(1)
    expect(calls.indexOf('discipline_teams')).toBeGreaterThan(calls.indexOf('discipline_entries'))
  })

  it('si el insert de las parejas falla, se borra la temporada y gana ese error', async () => {
    const { client, calls } = fakeClient(true)

    await expect(
      createSeason(client, { name: 'Fijas', squadNames: names, config: defaultConfig(4), disciplines: [teamsSpec] }),
    ).rejects.toThrow('No se pudieron armar las parejas fijas: boom')

    // `seasons` se toca dos veces: el insert y el delete del rollback.
    expect(calls.filter((table) => table === 'seasons')).toHaveLength(2)
  })

  it('sin parejas no hay insert en discipline_teams', async () => {
    const { client, calls } = fakeClient()

    await createSeason(client, { name: 'Sin fijas', squadNames: names, config: defaultConfig(4) })

    expect(calls).not.toContain('discipline_teams')
  })
})
