import { execFileSync } from 'node:child_process'
import { describe, it, expect } from 'vitest'
import { defaultConfig, PHASE_ORDER } from '@/core'
import { createMatchday, generatePairs, resultsOf, setAttendance } from './matchday'
import { matchdayDetail } from './read'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser, type TestUser } from './test/users'

// REQ-D7-1: una fecha de pádel con config default no cambia con el schema
// nuevo — todos los matches salen fase='GRUPO', grupo=1, idéntico a hoy.
// REQ-D7-3: la fase actual se DEDUCE (matchday_phase), sin columna nueva en
// matchdays.

// ── scaffolding local a este archivo, mismo criterio que generate.db.test.ts ─

/**
 * `matchday_phase` está revocada de public/anon/authenticated Y de
 * service_role (W5, medido: ni siquiera `adminClient()` la puede invocar por
 * PostgREST — "permission denied for function"). Mismo motivo y misma
 * herramienta que `localSql` en squad-position.db.test.ts: para probar la
 * DEDUCCIÓN sin pasar por ningún grant hace falta la sesión de `postgres`
 * dentro del contenedor local, no un cliente PostgREST.
 */
function localSql(sql: string): string {
  return execFileSync(
    'docker',
    [
      'exec', '-i', 'supabase_db_padelApp',
      'psql', '-U', 'postgres', '-d', 'postgres',
      '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-',
    ],
    { input: sql, encoding: 'utf8' },
  )
}

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

async function armedMatchday(): Promise<{ admin: TestUser; matchdayId: string }> {
  const admin = await createTestUser()
  const players = await fillerPlayers(8)
  const { seasonId, entryIds } = await createSeason({
    admin,
    config: defaultConfig(8),
    squad: players,
  })
  const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
  for (const entryId of entryIds) {
    await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
  }
  await generatePairs(admin.client, matchdayId)
  return { admin, matchdayId }
}

async function matchesFaseYGrupo(
  matchdayId: string,
): Promise<Array<{ fase: string; grupo: number }>> {
  const db = adminClient()
  const { data, error } = await db
    .from('matches')
    .select('fase, grupo')
    .eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return data ?? []
}

/**
 * Pisa fase/grupo de DOS partidos ya armados (`fase='GRUPO', grupo=1`, el
 * default de `armedMatchday`) con valores que el default nunca produce — uno
 * por cada eje que `matches_group_only_in_groups` deja variar por separado.
 * `adminClient` (service role) salta RLS para ARMAR la escena, igual que
 * `fillerPlayers` de arriba; la lectura de abajo la hace `resultsOf`/
 * `matchdayDetail` con el cliente real del admin (#3957: un tripwire que sólo
 * confirma 'GRUPO'/1 —el default— pasa igual si el lector lo hardcodea; hace
 * falta un valor que el default JAMÁS produce para que el hardcode se note).
 */
async function sembrarFaseYGrupoNoDefault(matchdayId: string): Promise<void> {
  const db = adminClient()
  const { data, error } = await db
    .from('matches')
    .select('id')
    .eq('matchday_id', matchdayId)
    .order('round', { ascending: true })
  if (error) throw new Error(error.message)
  const [first, second] = data ?? []
  if (first === undefined || second === undefined) throw new Error('bad test fixture')

  // `fase != 'GRUPO'` exige `grupo = 1` (matches_group_only_in_groups) — se
  // deja el default. El segundo partido prueba el otro eje del mismo check:
  // `grupo != 1` con `fase = 'GRUPO'`.
  const { error: e1 } = await db.from('matches').update({ fase: 'SEMI' }).eq('id', first.id)
  if (e1) throw new Error(e1.message)
  const { error: e2 } = await db.from('matches').update({ grupo: 2 }).eq('id', second.id)
  if (e2) throw new Error(e2.message)
}

describe('matches.fase / matches.grupo (REQ-D7-1)', () => {
  it('una fecha de pádel con config default arma todo en GRUPO/1', async () => {
    const { matchdayId } = await armedMatchday()

    const matches = await matchesFaseYGrupo(matchdayId)
    expect(matches.length).toBeGreaterThan(0)
    expect(matches.every((match) => match.fase === 'GRUPO')).toBe(true)
    expect(matches.every((match) => match.grupo === 1)).toBe(true)
  })
})

describe('matchday_phase (REQ-D7-3)', () => {
  it('un matchday recién armado devuelve GRUPO', async () => {
    const { matchdayId } = await armedMatchday()

    // Lo que REQ-D7-3 pide probar es la DEDUCCIÓN, no un grant — y nadie
    // tiene el grant (W5): ni `authenticated` ni `service_role` (medido).
    // `localSql` corre como `postgres`, afuera del ACL que PostgREST exige.
    const output = localSql(`select public.matchday_phase('${matchdayId}'::uuid);`)
    expect(output.trim()).toBe('GRUPO')
  })

  // Mismo patrón que discipline.db.test.ts: "matchday_discipline no es
  // alcanzable por RPC: nadie tiene el grant". Fija la decisión de W5 acá
  // también — si mañana alguien le devuelve el grant sin traer un
  // consumidor real, este test se entera en rojo.
  it('no es alcanzable por RPC desde authenticated: nadie tiene el grant', async () => {
    const { admin, matchdayId } = await armedMatchday()

    const { data, error } = await admin.client.rpc('matchday_phase', { p_matchday: matchdayId })

    expect(data).toBeNull()
    expect(error?.code).toBe('42501')
  })
})

/**
 * #3957 (la regla de las seis veces): `fase`/`grupo` nacen con un solo camino
 * que los puebla — el `select` de `resultsOf`/`pairsAndMatchesOf` — y hasta
 * D1 ningún consumidor de producción los USA todavía, así que ningún test que
 * pase por `closeMatchday`/`matchdayDetail` de punta a punta puede notar si
 * alguno de los dos lectores los hardcodea a `'GRUPO'`/`1`. Estos dos tests
 * pinchan el ARGUMENTO, no el nombre: siembran un valor que el default nunca
 * produce y comprueban que el lector lo trae de vuelta.
 */
describe('resultsOf y pairsAndMatchesOf leen fase/grupo de la fila, no los hardcodean', () => {
  it('resultsOf (db/matchday.ts) devuelve el fase/grupo real de cada partido', async () => {
    const { admin, matchdayId } = await armedMatchday()
    await sembrarFaseYGrupoNoDefault(matchdayId)

    const { matches } = await resultsOf(admin.client, matchdayId)

    expect(matches.some((match) => match.fase === 'SEMI')).toBe(true)
    expect(matches.some((match) => match.grupo === 2)).toBe(true)
  })

  it('matchdayDetail (db/read.ts, vía pairsAndMatchesOf) devuelve el mismo fase/grupo real', async () => {
    const { admin, matchdayId } = await armedMatchday()
    await sembrarFaseYGrupoNoDefault(matchdayId)

    const detail = await matchdayDetail(admin.client, matchdayId)

    expect(detail.matches.some((match) => match.fase === 'SEMI')).toBe(true)
    expect(detail.matches.some((match) => match.grupo === 2)).toBe(true)
  })
})

/**
 * Las seis fases están escritas TRES veces: `PHASE_ORDER` (TypeScript), el
 * `check` de `matches.fase` y el `array[...]` de `array_position` dentro de
 * `matchday_phase` (las dos últimas en `0039_match_phase.sql`). Lo único que
 * las ata hoy es un comentario. Estructural, no hardcodea la lista: lee el
 * catálogo real de Postgres (`pg_constraint`, `pg_get_functiondef`) con
 * `localSql`, igual que `db/migrations.unit.test.ts` lee los archivos en vez
 * de una lista de nombres copiada a mano.
 */
describe('PHASE_ORDER no driftea contra la base (matches_fase_check / matchday_phase)', () => {
  it('el check de matches.fase y el array de matchday_phase coinciden con PHASE_ORDER', () => {
    const checkDef = localSql(`
      select pg_get_constraintdef(oid) from pg_constraint
       where conrelid = 'public.matches'::regclass and conname = 'matches_fase_check';
    `)
    const checkValues = [...checkDef.matchAll(/'(\w+)'::text/g)].map((match) => match[1])
    expect(new Set(checkValues)).toEqual(new Set(PHASE_ORDER))

    const funcDef = localSql(`select pg_get_functiondef('public.matchday_phase(uuid)'::regprocedure);`)
    const arrayLiteral = funcDef.match(/array\[([^\]]+)\]/i)
    if (arrayLiteral === null) {
      throw new Error('matchday_phase ya no arma su fase con un array literal — revisar este test.')
    }
    const arrayValues = arrayLiteral[1]?.split(',').map((value) => value.trim().replace(/^'|'$/g, ''))
    expect(arrayValues).toEqual([...PHASE_ORDER])
  })
})
