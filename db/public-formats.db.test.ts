import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { defaultConfig, disciplineProfile, type SeasonConfig } from '@/core'
import { buildDisciplines } from '@/app/torneos/nuevo/wizard-state'
import type { Database } from './database.types'
import { publicFormats, publicRules } from './read'
import { addDiscipline } from './discipline'
import { createSeason } from './season'
import { adminClient } from './test/admin'
import { createTestUser, type TestUser } from './test/users'

/**
 * S76 — la mitad ANÓNIMA de W64.
 *
 * Reglas es la ÚNICA pantalla pública del torneo, y narraba un solo formato
 * aunque el torneo tuviera dos: `season_public_rules` (0022) devuelve la
 * config de la disciplina POR DEFECTO y ni siquiera su `kind`. Medido en
 * Chromium en las rondas 22 y 23: un torneo de pádel + FIFA le decía a un
 * extraño `1 set a 4 games` sobre una mitad que se juega a goles.
 *
 * `season_public_formats` (0038) es la salida, y va **ADITIVA**: la firma de
 * `season_public_rules` NO se toca. Cambiarle el `returns table` pedía
 * `drop function` —medido: `ERROR: cannot change return type of existing
 * function`— y un drop+create se lleva los grants y abre una ventana de
 * despliegue en la que la única superficie pública del sistema no existe.
 *
 * Todo lo que sigue corre con la llave `anon`, que es el punto: con
 * `service_role` los grants no se ejercen y estos tests pasarían igual
 * estando mal.
 */

/** Sin sesión y con la llave `anon`: el cliente de quien abre el link del grupo. */
function anonReadClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (url === undefined || anonKey === undefined) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY.')
  }
  return createClient<Database>(url, anonKey)
}

let admin: TestUser
let seasonId: string
let padelConfig: SeasonConfig

function nombres(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `Jugador ${i + 1}`)
}

/** Un torneo por el camino REAL —el del wizard—, no por el atajo de la factory. */
async function torneo(picked: Array<'PADEL' | 'FIFA'>): Promise<{ user: TestUser; id: string }> {
  const user = await createTestUser()
  const config = defaultConfig(8)
  const { seasonId: id } = await createSeason(user.client, {
    name: `Publico ${picked.join('+')} ${Date.now()}`,
    squadNames: nombres(8),
    config,
    disciplines: buildDisciplines(picked, config),
  })
  return { user, id }
}

beforeAll(async () => {
  padelConfig = defaultConfig(8)
  const creado = await torneo(['PADEL'])
  admin = creado.user
  seasonId = creado.id
  // La segunda disciplina por el camino REAL, el mismo que usa
  // "+ Agregar disciplina" de Ajustes.
  const seats = await seatIdsOf(seasonId)
  await addDiscipline(
    admin.client,
    seasonId,
    { kind: 'FIFA', ...disciplineProfile('FIFA', defaultConfig(8)) },
    seats,
  )
}, 60_000)

async function seatIdsOf(id: string): Promise<string[]> {
  const { data, error } = await adminClient()
    .from('entries')
    .select('id')
    .eq('season_id', id)
    .eq('kind', 'SQUAD')
    .order('seed_position', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => row.id)
}

describe('season_public_formats — lo que ve un extraño con el link', () => {
  it('devuelve UNA fila por disciplina, con su kind y su config', async () => {
    const formats = await publicFormats(anonReadClient(), seasonId)
    expect(formats.map((row) => row.kind)).toEqual(['PADEL', 'FIFA'])
    expect(formats[0]?.config.matchFormat.openScore).toBe(false)
    expect(formats[1]?.config.matchFormat.openScore).toBe(true)
  })

  it('un torneo de una sola disciplina devuelve una sola fila', async () => {
    const { id: solo } = await torneo(['PADEL'])
    const formats = await publicFormats(anonReadClient(), solo)
    expect(formats).toHaveLength(1)
    expect(formats[0]?.kind).toBe('PADEL')
  })

  it('un link muerto devuelve vacío, no un error', async () => {
    const formats = await publicFormats(anonReadClient(), '00000000-0000-0000-0000-000000000000')
    expect(formats).toEqual([])
  })
})

describe('lo que la función NO expone', () => {
  /**
   * El techo declarado de la rebanada. Un `returns setof public.disciplines` o
   * un `d.id` de más le regalaría a `anon` claves primarias y las columnas
   * `pair_size`, `allows_draw`, `has_masters`, `weight`, `status` y
   * `season_id`, que hoy están detrás de `revoke all on all tables` (0009).
   * Esto no es un comentario: es el assert.
   */
  it('devuelve DOS columnas y nada más', async () => {
    const { data, error } = await anonReadClient().rpc('season_public_formats', {
      p_season: seasonId,
    })
    expect(error).toBeNull()
    const fila = (data ?? [])[0]
    expect(fila).toBeDefined()
    expect(Object.keys(fila as object).sort()).toEqual(['config', 'kind'])
  })

  it('y `anon` sigue sin poder leer la tabla disciplines de frente', async () => {
    const { data, error } = await anonReadClient().from('disciplines').select('*').limit(1)
    // Sin el privilegio de base: no es RLS filtrando, es el grant que no está.
    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })
})

describe('la función vieja no se tocó (es ADITIVA)', () => {
  it('season_public_rules sigue devolviendo sus cinco campos', async () => {
    const rules = await publicRules(anonReadClient(), seasonId)
    expect(rules?.name).toBeTruthy()
    expect(rules?.adminName).not.toBe('')
    expect(rules?.config.squadSize).toBe(padelConfig.squadSize)
  })

  it('y sigue devolviendo la config de la disciplina POR DEFECTO, la de pádel', async () => {
    const rules = await publicRules(anonReadClient(), seasonId)
    expect(rules?.config.matchFormat.openScore).toBe(false)
  })
})
