import { describe, expect, it } from 'vitest'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser } from './test/users'

// ── REQ-D5-1 (PR14 slice C, design #3801 PUNTO 1) ───────────────────────────
// La BASE, no un `if` de aplicación, tiene que rechazar un `pairs.entry_b`
// que no combina con el `pair_size` real de la disciplina de esa fecha.
//
// Prueba empírica (RED, no comiteada): hoy, contra el schema pre-slice-C, un
// `insert` en `pairs` con `entry_a`/`entry_b` ambos no-nulos para el
// matchday de una disciplina `pair_size=1` SE ACEPTA SIN ERROR — `pairs` no
// tiene columna `pair_size` ni ninguna otra forma de saber la forma del lado
// de esa fecha. Repetido con psql directo contra el docker local (no
// simulado): `NOTICE: INSERT ACEPTADO SIN ERROR: fila pairs con 2 miembros
// en disciplina pair_size=1 quedo guardada.` Los dos tests de abajo son la
// versión permanente de esa misma prueba: fallan (RED) contra el schema sin
// `matchdays.pair_size`/`pairs.pair_size`/`pairs_side_shape` — el insert
// revienta con `PGRST204` (columna inexistente) al pedirle ese campo — y
// pasan (GREEN) una vez que 0028+0029 los agregan y validan.

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

async function insertMatchday(seasonId: string, disciplineId: string, number: number): Promise<string> {
  const db = adminClient()
  const { data: discipline, error: disciplineError } = await db
    .from('disciplines')
    .select('pair_size')
    .eq('id', disciplineId)
    .single()
  if (disciplineError || discipline === null) throw new Error(disciplineError?.message)
  const { data, error } = await db
    .from('matchdays')
    .insert({ season_id: seasonId, discipline_id: disciplineId, number, pair_size: discipline.pair_size })
    .select('id')
    .single()
  if (error || data === null) throw new Error(error?.message)
  return data.id
}

describe('pairs_side_shape (REQ-D5-1)', () => {
  it('rechaza entry_b no nulo cuando la disciplina de la fecha es pair_size=1', async () => {
    const admin = await createTestUser()
    const filler = await fillerPlayers(2)
    const { seasonId, disciplineIds, entryIds } = await createSeason({
      admin,
      squad: filler,
      disciplines: [{ kind: 'FIFA', pairSize: 1 }],
    })
    const [fifaId] = disciplineIds
    const [a, b] = entryIds
    if (fifaId === undefined || a === undefined || b === undefined) throw new Error('Falta escenario de test.')
    const matchdayId = await insertMatchday(seasonId, fifaId, 1)

    const db = adminClient()
    const { error } = await db
      .from('pairs')
      .insert({ matchday_id: matchdayId, season_id: seasonId, entry_a: a, entry_b: b, pair_size: 1 })

    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/pairs_side_shape/)
  })

  it('rechaza entry_b nulo cuando la disciplina de la fecha es pair_size=2', async () => {
    const admin = await createTestUser()
    const filler = await fillerPlayers(1)
    const { seasonId, disciplineIds, entryIds } = await createSeason({
      admin,
      squad: filler,
      disciplines: [{ kind: 'PADEL' }],
    })
    const [padelId] = disciplineIds
    const [a] = entryIds
    if (padelId === undefined || a === undefined) throw new Error('Falta escenario de test.')
    const matchdayId = await insertMatchday(seasonId, padelId, 1)

    const db = adminClient()
    const { error } = await db
      .from('pairs')
      .insert({ matchday_id: matchdayId, season_id: seasonId, entry_a: a, entry_b: null, pair_size: 2 })

    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/pairs_side_shape/)
  })
})
