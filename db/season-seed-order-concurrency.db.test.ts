/**
 * WU1 (tanda 5, round 3 review fix): `add_squad_seat`/`promote_guest`
 * (0081/0082) usaban la fila de `seasons` como mutex (`for update`) para
 * serializar el acceso a `season_seed_order` de la misma temporada — un fix
 * de una ronda anterior (WU5, tanda 3) contra la carrera original
 * (`duplicate key` en `season_seed_order_seed`, 23505). Ese mutex reintrodujo
 * el problema de otra forma:
 *
 * **B1 — auto-deadlock dentro de `add_squad_seat`.** El `insert into
 * public.entries` (0081:64) ya toma `FOR KEY SHARE` sobre la fila de
 * `seasons` — lo hace el trigger de la FK `entries_season_id_fkey`, no una
 * línea visible acá — y el `for update` de la línea de abajo la sube de
 * nivel a exclusiva. Dos altas concurrentes a la MISMA temporada quedan cada
 * una con su propio KEY SHARE y las dos esperando subir a FOR UPDATE:
 * ninguna puede, porque la otra todavía tiene el KEY SHARE — deadlock
 * (40P01), detectado y abortado por Postgres del lado de una de las dos.
 *
 * **B2 — orden opuesto entre `add_squad_seat` y `promote_guest`.**
 * `add_squad_seat` toma `seasons` → `season_seed_order` → `discipline_entries`
 * (en ese orden); `promote_guest` toma `discipline_entries` → `seasons` →
 * `season_seed_order` — orden INVERTIDO, las dos hasta el commit. Un alta y
 * una promoción concurrentes a la misma temporada, ambas con `p_before`
 * (ambas tocan `discipline_entries` de la misma disciplina, no sólo insertan
 * al final), pueden deadlockear cruzado.
 *
 * El fix (ver 0081/0082) cambia el mutex por un advisory lock por temporada
 * (`pg_advisory_xact_lock(hashtextextended(season::text, 0))`), tomado ANTES
 * de cualquier insert o `for update` — nunca toca la fila de `seasons`, así
 * que no compite con el `FOR KEY SHARE` de la FK y no le importa en qué orden
 * cada función toque las demás tablas después.
 *
 * Este archivo no busca reproducir el deadlock de forma determinística en
 * cada corrida — un deadlock depende del entrelazado real de dos
 * transacciones en dos conexiones separadas, algo que ninguna herramienta de
 * este nivel controla statement a statement — sino disparar SUFICIENTE
 * concurrencia real contra la MISMA temporada como para que la versión con
 * el mutex equivocado falle con alta probabilidad, y probar que con el
 * advisory lock el resultado es siempre limpio. La medición a mano (con dos
 * sesiones psql, en el reporte de esta tanda) es la evidencia determinística
 * que este archivo no puede dar por sí solo.
 */
import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@/core'
import { addSquadSeat, promoteGuest } from './entries'
import { addGuest, closeMatchday, createMatchday, generatePairs, openMatchday, saveResult, setAttendance } from './matchday'
import { createSeason } from './season'
import { adminClient } from './test/admin'
import { createTestUser } from './test/users'

async function seedOrderPositions(seasonId: string): Promise<number[]> {
  const db = adminClient()
  const { data, error } = await db.from('season_seed_order').select('seed_position').eq('season_id', seasonId)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => row.seed_position)
}

function expectContiguous(positions: number[], count: number): void {
  expect(positions).toHaveLength(count)
  expect([...positions].sort((a, b) => a - b)).toEqual(Array.from({ length: count }, (_, index) => index))
}

// ── B1: muchas altas concurrentes a la MISMA temporada ─────────────────────
describe('add_squad_seat bajo carga concurrente, misma temporada (WU1, B1)', () => {
  it('8 altas a la vez terminan todas bien, sin deadlock ni duplicate key', async () => {
    const admin = await createTestUser()
    const squadNames = Array.from({ length: 4 }, (_, index) => `Jugador ${index + 1}`)
    const { seasonId } = await createSeason(admin.client, {
      name: 'Torneo con carga concurrente de altas',
      squadNames,
      config: defaultConfig(4),
    })

    // 8, no más: `authenticated` corre con `statement_timeout = 8s`
    // (`supabase/config.toml`), y estas llamadas se serializan A PROPÓSITO
    // (el advisory lock es un mutex por temporada, no paralelismo) — con
    // demasiada concurrencia el test se queda sin tiempo por la COLA, no por
    // ningún bug, incluso ya arreglado. 8 alcanza para varias veces
    // encimarse (y, sin el fix, para deadlockear) sin acercarse al techo.
    const concurrentCount = 8
    // Todas al final (sin `p_before`): alcanza para disparar B1 — el
    // deadlock sale del insert + el mutex de arriba, no de `p_before`.
    const ids = await Promise.all(
      Array.from({ length: concurrentCount }, (_, index) => addSquadSeat(admin.client, seasonId, `Concurrente ${index + 1}`)),
    )

    expect(new Set(ids).size).toBe(concurrentCount)
    expectContiguous(await seedOrderPositions(seasonId), 4 + concurrentCount)
  })
})

// ── B2: add_squad_seat y promote_guest concurrentes, orden opuesto de locks ─
describe('add_squad_seat y promote_guest concurrentes, misma temporada y disciplina (WU1, B2)', () => {
  it('altas con p_before y promociones con p_before a la vez, sin deadlock cruzado', async () => {
    const admin = await createTestUser()
    const squadNames = Array.from({ length: 4 }, (_, index) => `Jugador ${index + 1}`)
    // `assertSquadCoversLooseGuests` (db/validate.ts) exige tantos jugadores
    // del plantel PLAYING como invitados sueltos, aunque la disciplina sea de
    // a uno -- con 4 SQUAD, 4 es el máximo de invitados sin ese guard de por
    // medio.
    const guestCount = 4
    // FIFA de a uno: mismo criterio que `closedSoloMatchdayWithGuest`
    // (db/season-seed-order-writers.db.test.ts) — evita el guard "¿cobró el
    // compañero?" y deja promover cada invitado con el mínimo de pasos.
    const config = { ...defaultConfig(4), points: [4, 3, 2, 1] }
    const { seasonId } = await createSeason(admin.client, {
      name: 'Torneo con deadlock cruzado (WU1, B2)',
      squadNames,
      config,
      disciplines: [{ kind: 'FIFA', pairSize: 1, config }],
    })

    const db = adminClient()
    const { data: entries, error: entriesError } = await db
      .from('entries')
      .select('id')
      .eq('season_id', seasonId)
      .eq('kind', 'SQUAD')
    if (entriesError) throw new Error(entriesError.message)
    const squadIds = (entries ?? []).map((row) => row.id)
    expect(squadIds).toHaveLength(4)
    const [beforeForAdds, beforeForPromotions] = squadIds
    if (beforeForAdds === undefined || beforeForPromotions === undefined) throw new Error('Faltan asientos de referencia.')

    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    for (const entry of squadIds) {
      await setAttendance(admin.client, matchdayId, entry, 'PLAYING')
    }
    const guestIds: string[] = []
    for (let i = 0; i < guestCount; i++) {
      guestIds.push(await addGuest(admin.client, matchdayId, { displayName: `Invitado ${i + 1}` }))
    }
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)
    const { data: matches, error: matchesError } = await db.from('matches').select('id').eq('matchday_id', matchdayId)
    if (matchesError) throw new Error(matchesError.message)
    for (const match of matches ?? []) {
      await saveResult(admin.client, match.id, [{ gamesA: 4, gamesB: 1 }])
    }
    await closeMatchday(admin.client, matchdayId)

    // Cada `promoteGuest`/`addSquadSeat` de acá lleva `p_before` -- las dos
    // tocan `discipline_entries` de la ÚNICA disciplina de la temporada
    // (`shift_seeds_up`), que es lo que hace falta para que B2 (orden opuesto
    // de locks entre las dos funciones) tenga con qué chocar.
    const promotions = guestIds.map((guestId) => promoteGuest(admin.client, guestId, beforeForPromotions))
    const adds = Array.from({ length: guestCount }, (_, index) =>
      addSquadSeat(admin.client, seasonId, `Concurrente B2 ${index + 1}`, beforeForAdds),
    )

    await Promise.all([...promotions, ...adds])

    expectContiguous(await seedOrderPositions(seasonId), 4 + guestCount * 2)
  })
})
