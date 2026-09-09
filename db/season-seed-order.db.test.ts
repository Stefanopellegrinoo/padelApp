/**
 * `season_seed_order` (0080_season_seed_order.sql, torneo-multi-disciplina
 * tanda 1): el backfill de esa migración corrió UNA sola vez, contra lo que
 * existía al aplicarla — y localmente eso es CERO temporadas (ninguna
 * migración inserta una `season`; sólo lo hacen `supabase/seed.sql`, que
 * corre DESPUÉS de las migraciones, y la app). El backfill de producción
 * —el que de verdad importa, el que evita que un torneo real pierda su
 * orden— es intestable vía `db:reset` local por esa misma razón.
 *
 * Este archivo prueba la lógica del backfill de otra forma: la re-ejecuta,
 * ESCOPEADA a una sola temporada armada a mano (`squadWithGaps`, que simula
 * la temporada "de antes" — con `discipline_entries` pero sin
 * `season_seed_order`, exactamente lo que el backfill real encontró en cada
 * temporada existente). Escopeada por `season_id` en las dos CTEs base
 * (`squad` y `primary_discipline`), nunca contra la base entera — ver el
 * trap documentado en `db/discipline.db.test.ts:234-248` y evitado del
 * mismo modo en `db/season-seed-order-writers.db.test.ts`.
 */
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser } from './test/users'

/** playerIds sueltos, sin usuario: alcanza para llenar `squad` de la factory. */
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

/**
 * El mismo `insert` que 0080_season_seed_order.sql, con dos `where season_id
 * = ...` de más agregados a `squad` y `primary_discipline` — la parte
 * ESCOPEADA que el backfill real no necesita (corre una vez, contra toda la
 * base) pero este test sí, para no tocar ninguna otra temporada que la
 * suite haya armado en paralelo (`vitest.db.config.ts`: "los tests comparten
 * una base").
 */
function backfillSeason(seasonId: string): void {
  execFileSync(
    'docker',
    [
      'exec', '-i', 'supabase_db_padelApp',
      'psql', '-U', 'postgres', '-d', 'postgres',
      '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c',
      `with primary_discipline as (
         select distinct on (season_id) season_id, id as discipline_id
           from public.disciplines
          where season_id = '${seasonId}'
          order by season_id, position, created_at
       ),
       squad as (
         select e.id as entry_id, e.season_id, e.created_at
           from public.entries e
          where e.kind = 'SQUAD' and e.season_id = '${seasonId}'
       ),
       seeded as (
         select sq.entry_id, sq.season_id, sq.created_at, de.seed_position
           from squad sq
           left join primary_discipline pd on pd.season_id = sq.season_id
           left join public.discipline_entries de
             on de.discipline_id = pd.discipline_id and de.entry_id = sq.entry_id
       ),
       tail_base as (
         select season_id, coalesce(max(seed_position), -1) as max_seed
           from seeded
          group by season_id
       ),
       tail as (
         select s.entry_id, s.season_id,
                tb.max_seed + row_number() over (partition by s.season_id order by s.created_at, s.entry_id) as seed_position
           from seeded s
           join tail_base tb on tb.season_id = s.season_id
          where s.seed_position is null
       )
       insert into public.season_seed_order (season_id, entry_id, seed_position)
       select season_id, entry_id, seed_position from seeded where seed_position is not null
       union all
       select season_id, entry_id, seed_position from tail;`,
    ],
    { encoding: 'utf8' },
  )
}

interface SeedRow {
  entry_id: string
  seed_position: number
}

async function seedOrderOf(seasonId: string): Promise<SeedRow[]> {
  const db = adminClient()
  const { data, error } = await db
    .from('season_seed_order')
    .select('entry_id, seed_position')
    .eq('season_id', seasonId)
    .order('seed_position', { ascending: true })
  if (error) throw new Error(error.message)
  return data ?? []
}

describe('season_seed_order — backfill de 0080 (torneo-multi-disciplina tanda 1)', () => {
  it('copia el seed_position de la primaria, huecos incluidos, y manda al final a quien no la juega', async () => {
    const admin = await createTestUser()
    const squad = await fillerPlayers(4)
    // PADEL (position 0) es la primaria; FIFA (position 1) no importa para
    // el backfill, sólo está para que "no juega la primaria" tenga sentido.
    const { seasonId, entryIds } = await createSeason({
      admin,
      squad,
      disciplines: [{ kind: 'PADEL' }, { kind: 'FIFA' }],
    })
    const [a, b, c, d] = entryIds
    if (a === undefined || b === undefined || c === undefined || d === undefined) {
      throw new Error('Faltan asientos.')
    }

    const db = adminClient()
    const { data: disciplines, error: disciplinesError } = await db
      .from('disciplines')
      .select('id, position')
      .eq('season_id', seasonId)
      .order('position', { ascending: true })
    if (disciplinesError) throw new Error(disciplinesError.message)
    const padelId = disciplines?.[0]?.id
    if (padelId === undefined) throw new Error('Falta la primaria.')

    // Simula la temporada "de antes de esta PR": un hueco en la primaria
    // (mismo efecto que dejaría un `removeSeat` — la fila desaparece, nadie
    // se renumera) y un asiento que no la juega.
    const { error: gapError } = await db.from('discipline_entries').delete().eq('discipline_id', padelId).eq('entry_id', b)
    if (gapError) throw new Error(gapError.message)

    // Y sin `season_seed_order` todavía: lo que el backfill real encontró en
    // cada temporada existente al aplicarse — aunque la factory ya lo
    // escriba para las temporadas NUEVAS (tanda 2 de este mismo cambio), acá
    // se borra a propósito para no depender de eso.
    const { error: clearError } = await db.from('season_seed_order').delete().eq('season_id', seasonId)
    if (clearError) throw new Error(clearError.message)

    backfillSeason(seasonId)

    const rows = await seedOrderOf(seasonId)
    expect(rows).toHaveLength(4)
    // `a`(0) y `c`(2)/`d`(3) se llevan el seed_position CRUDO de la primaria
    // — con el hueco de `b` en el medio, sin renumerar.
    expect(rows.find((row) => row.entry_id === a)?.seed_position).toBe(0)
    expect(rows.find((row) => row.entry_id === c)?.seed_position).toBe(2)
    expect(rows.find((row) => row.entry_id === d)?.seed_position).toBe(3)
    // `b` no juega la primaria: va al final (max=3, +1), no se pierde y no
    // se cuela en el medio del hueco que dejó.
    expect(rows.find((row) => row.entry_id === b)?.seed_position).toBe(4)
  })
})
