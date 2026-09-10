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
 *
 * WU3 (tanda 3, round 2 review fix): hasta acá, el SQL del backfill vivía
 * DOS VECES — una en 0080, otra copiada a mano en este archivo — y nada
 * garantizaba que las dos coincidieran para siempre; el CHECK era "hoy son
 * idénticas", no "van a seguir siéndolo". `readBackfillSql` lee el `insert`
 * REAL del archivo de la migración y le inyecta sólo el `where` de scope
 * (dos `.replace` puntuales, con guard si el texto de origen cambia de
 * forma) — la lógica de orden, joins y CTEs viaja siempre desde el archivo,
 * nunca reescrita. Y los tests ya no miden sólo CANTIDAD de filas: miden el
 * ORDEN, que es lo único que un backfill de orden puede romper en silencio.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

/** El `insert` del backfill, tal cual vive en 0080 — desde `with primary_discipline as (` hasta el `;` que lo cierra. */
function readBackfillSql(): string {
  const path = join(process.cwd(), 'supabase/migrations/0080_season_seed_order.sql')
  const content = readFileSync(path, 'utf8')
  const start = content.indexOf('with primary_discipline as (')
  if (start === -1) {
    throw new Error('No se encontró el backfill (`with primary_discipline as (`) en 0080_season_seed_order.sql.')
  }
  const end = content.indexOf(';', start)
  if (end === -1) {
    throw new Error('El backfill de 0080_season_seed_order.sql no cierra con ";" después de donde empieza.')
  }
  return content.slice(start, end + 1)
}

/**
 * El backfill real, ESCOPEADO a una sola temporada. Las dos `.replace` de
 * acá son la ÚNICA diferencia con 0080 — la parte que el backfill real no
 * necesita (corre una vez, contra toda la base) pero este archivo sí, para
 * no tocar ninguna otra temporada que la suite arme en paralelo. Cada
 * `.replace` está guardado: si el texto de origen cambió de forma (otra
 * restatement de 0080), esto tira ruidoso en vez de correr un backfill sin
 * escopear contra toda la base local.
 *
 * `:'season'` (sustitución de literal citado de psql, `-v season=...` más
 * abajo) y no una interpolación de JS en el SQL: mismo criterio que evita
 * `db/discipline.db.test.ts` (que no tiene nada que interpolar) y que
 * `db/squad-position.db.test.ts` (`-f -`, SQL por stdin) — el uuid nunca
 * pasa a formar parte del TEXTO del comando.
 */
function scopedBackfillSql(): string {
  const raw = readBackfillSql()
  const withPrimaryScope = raw.replace(
    'from public.disciplines\n',
    "from public.disciplines\n   where season_id = :'season'\n",
  )
  if (withPrimaryScope === raw) {
    throw new Error('primary_discipline cambió de forma en 0080: no se pudo escopear por season_id.')
  }
  const withSquadScope = withPrimaryScope.replace(
    "where e.kind = 'SQUAD'",
    "where e.kind = 'SQUAD' and e.season_id = :'season'",
  )
  if (withSquadScope === withPrimaryScope) {
    throw new Error('squad cambió de forma en 0080: no se pudo escopear por season_id.')
  }
  return withSquadScope
}

function backfillSeason(seasonId: string): void {
  execFileSync(
    'docker',
    [
      'exec', '-i', 'supabase_db_padelApp',
      'psql', '-U', 'postgres', '-d', 'postgres',
      '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', `season=${seasonId}`, '-f', '-',
    ],
    { input: scopedBackfillSql(), encoding: 'utf8' },
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

/** Borra lo que la factory ya escribió, para re-ejercitar el backfill real desde cero — mismo criterio que la versión anterior de este archivo. */
async function clearSeedOrder(seasonId: string): Promise<void> {
  const db = adminClient()
  const { error } = await db.from('season_seed_order').delete().eq('season_id', seasonId)
  if (error) throw new Error(error.message)
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

    await clearSeedOrder(seasonId)
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

  // WU3: el named mutation `0080:63` (`order by season_id, position, created_at`
  // → `... position desc, created_at desc`) elige la disciplina de la
  // ÚLTIMA `position` como "primaria" en vez de la primera — con una sola
  // disciplina, o con dos que pidan el MISMO orden, esa mutación es
  // invisible (da lo mismo cuál se elija). Este fixture arma dos
  // disciplinas con órdenes OPUESTOS: si el backfill sigue a PADEL
  // (position 0, la primera — lo correcto), el resultado es el orden
  // NATURAL; si sigue a FIFA (position 1, la mutación), es el INVERTIDO.
  // Confirmado a mano: con la mutación aplicada, este test compara contra
  // el orden natural y falla con el invertido.
  it('la primaria es la disciplina de MENOR position, no la de mayor', async () => {
    const admin = await createTestUser()
    const squad = await fillerPlayers(4)
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
    const fifaId = disciplines?.[1]?.id
    if (fifaId === undefined) throw new Error('Falta la secundaria.')

    // FIFA (secundaria) pide el orden EXACTAMENTE invertido de PADEL
    // (primaria, que la factory ya dejó en orden natural a,b,c,d). Delete +
    // insert y no un `update` fila por fila: la reversión completa (a↔d,
    // b↔c) no tiene ningún punto fijo, así que CUALQUIER orden de updates
    // individuales pisa una posición todavía ocupada a mitad de camino
    // (`discipline_entries_seed`, índice único). Arrancar de cero lo evita.
    const { error: fifaClearError } = await db.from('discipline_entries').delete().eq('discipline_id', fifaId)
    if (fifaClearError) throw new Error(fifaClearError.message)
    const { error: fifaSeedError } = await db.from('discipline_entries').insert(
      [d, c, b, a].map((entryId, index) => ({
        discipline_id: fifaId,
        entry_id: entryId,
        season_id: seasonId,
        seed_position: index,
      })),
    )
    if (fifaSeedError) throw new Error(fifaSeedError.message)

    await clearSeedOrder(seasonId)
    backfillSeason(seasonId)

    const rows = await seedOrderOf(seasonId)
    expect(rows.map((row) => row.entry_id)).toEqual([a, b, c, d])
  })

  // WU3: el named mutation `0080:84` (`order by s.created_at, s.entry_id` →
  // `order by s.entry_id`) sólo se nota con VARIOS asientos "tail" (que no
  // juegan la primaria) a la vez — con uno solo, cualquier `order by` da el
  // mismo resultado. Este fixture deja a los 6 SQUAD sin ninguna fila en la
  // primaria: todos caen al tail, y el orden correcto es el de ALTA
  // (created_at), no el de `entry_id` (uuid al azar, sin relación con el
  // orden de alta). Confirmado a mano: con la mutación, el orden esperado
  // (alta) no coincide con el que produce ordenar por `entry_id`.
  it('el tail (nadie juega la primaria) ordena por fecha de alta, no por entry_id', async () => {
    const admin = await createTestUser()
    const squad = await fillerPlayers(6)
    const { seasonId, entryIds, disciplineId } = await createSeason({
      admin,
      squad,
      disciplines: [{ kind: 'PADEL' }],
    })
    expect(entryIds).toHaveLength(6)

    const db = adminClient()
    // Nadie juega la primaria: todos caen al tail, cuyo orden depende
    // ENTERO de `order by s.created_at, s.entry_id`.
    const { error: clearPrimaryError } = await db.from('discipline_entries').delete().eq('discipline_id', disciplineId)
    if (clearPrimaryError) throw new Error(clearPrimaryError.message)

    await clearSeedOrder(seasonId)
    backfillSeason(seasonId)

    const rows = await seedOrderOf(seasonId)
    // El orden de alta es el de `entryIds` (la factory los crea uno por uno,
    // en ese orden — mismo criterio que documenta `test/factories.ts`).
    expect(rows.map((row) => row.entry_id)).toEqual(entryIds)

    // Limpieza: sin esto, los 6 SQUAD quedan sin NINGUNA fila en
    // discipline_entries para siempre y envenenan
    // `db/discipline.db.test.ts:234-248` (`countOrphanedSquadEntries`), que
    // mide contra la base COMPLETA y sin escopear — mismo trap medido y
    // evitado en `db/season-seed-order-writers.db.test.ts` (WU2). El hueco
    // sólo hacía falta DURANTE el backfill de arriba.
    const { error: restoreError } = await db.from('discipline_entries').insert(
      entryIds.map((entryId, index) => ({
        discipline_id: disciplineId,
        entry_id: entryId,
        season_id: seasonId,
        seed_position: index,
      })),
    )
    if (restoreError) throw new Error(restoreError.message)
  })
})
