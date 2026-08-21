import { describe, expect, it } from 'vitest'
import { newTournamentPayload, type Squad } from '@/app/torneos/nuevo/wizard-state'
import { defaultConfig, disciplineSlugs } from '@/core'
import { seasonHeader } from './read'
import { createSeason } from './season'
import { adminClient } from './test/admin'
import { createTestUser } from './test/users'

// ── scaffolding local a este archivo ────────────────────────────────────────

function squadNames(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `Jugador ${index + 1}`)
}

/**
 * PR11b — `createSeason` (producción, `db/season.ts`) gana un `disciplines?`
 * opcional. REQ-D1-1: "existen 2 filas `disciplines` para la misma
 * `season_id`". No hay wizard todavía que arme este input (PR11a, la
 * segunda mitad de esta PR) — estos tests ejercitan la capacidad directo,
 * como lo haría ese wizard cuando exista.
 */
describe('createSeason con múltiples disciplinas (REQ-D1-1, contrato S13)', () => {
  it('crea una fila de disciplines por elemento del array, en ESE orden', async () => {
    const admin = await createTestUser()
    const config = defaultConfig(8)

    const { seasonId } = await createSeason(admin.client, {
      name: 'Multi 2026',
      squadNames: squadNames(8),
      config,
      disciplines: [
        { kind: 'PADEL', config },
        { kind: 'FIFA', config },
      ],
    })

    const header = await seasonHeader(admin.client, seasonId)
    expect(header.disciplines.map((d) => d.kind)).toEqual(['PADEL', 'FIFA'])
  })

  //Sin `position` explícito,
  // N filas insertadas para la misma temporada comparten `position` (default
  // 0) Y `created_at` (misma transacción) — `disciplineSlugs` ordena
  // exactamente por esa clave. Esta prueba fallaría contra cualquier
  // implementación que confíe en el default de la columna.
  it('escribe position explícito 0,1,2... — nunca el default de la columna', async () => {
    const admin = await createTestUser()
    const config = defaultConfig(8)
    const { seasonId } = await createSeason(admin.client, {
      name: 'Tres disciplinas',
      squadNames: squadNames(8),
      config,
      disciplines: [
        { kind: 'PADEL', config },
        { kind: 'FIFA', config },
        { kind: 'PADEL', config },
      ],
    })

    const db = adminClient()
    const { data } = await db
      .from('disciplines')
      .select('position')
      .eq('season_id', seasonId)
      .order('position', { ascending: true })
    expect((data ?? []).map((row) => row.position)).toEqual([0, 1, 2])
  })

  // Contrato de slug de PR10: orden de creación = orden de slug
  // (core/discipline-slug.ts). Dos disciplinas del MISMO kind es el caso que
  // colisiona si el empate de arriba no se rompe de verdad.
  it('el orden de creación es el orden de slug: dos PADEL dan padel/padel-2', async () => {
    const admin = await createTestUser()
    const config = defaultConfig(8)
    const { seasonId } = await createSeason(admin.client, {
      name: 'Dos pádeles',
      squadNames: squadNames(8),
      config,
      disciplines: [
        { kind: 'PADEL', config },
        { kind: 'PADEL', config },
      ],
    })

    const header = await seasonHeader(admin.client, seasonId)
    const slugs = disciplineSlugs(header.disciplines)
    expect(header.disciplines.map((d) => slugs.get(d.id))).toEqual(['padel', 'padel-2'])
  })

  //REQ-D1-3/D1-4, decisión de este slice: el asiento entra a TODAS las
  // disciplinas creadas en el mismo submit — no hay pantalla de "quién juega
  // qué" en este wizard (PR13 la agrega para sumar una disciplina en curso).
  // Sin esto, un asiento SQUAD sin fila en discipline_entries tumba la
  //Aserción de no-regresión de `db/discipline.db.test.ts`.
  it('cada asiento SQUAD entra a discipline_entries de las N disciplinas', async () => {
    const admin = await createTestUser()
    const config = defaultConfig(8)
    const { seasonId } = await createSeason(admin.client, {
      name: 'Plantel compartido',
      squadNames: squadNames(8),
      config,
      disciplines: [
        { kind: 'PADEL', config },
        { kind: 'FIFA', config },
      ],
    })

    const db = adminClient()
    const { data: entries } = await db
      .from('entries')
      .select('id')
      .eq('season_id', seasonId)
      .eq('kind', 'SQUAD')
    const { data: seats } = await db
      .from('discipline_entries')
      .select('entry_id, discipline_id, seed_position')
      .eq('season_id', seasonId)

    expect(entries).toHaveLength(8)
    expect(seats).toHaveLength(16) // 8 asientos × 2 disciplinas
    for (const entry of entries ?? []) {
      const rows = (seats ?? []).filter((seat) => seat.entry_id === entry.id)
      expect(rows).toHaveLength(2)
      expect(new Set(rows.map((row) => row.discipline_id)).size).toBe(2)
    }
  })

  it('rebota si el plantel no calza con el squadSize de alguna disciplina', async () => {
    const admin = await createTestUser()
    const eight = defaultConfig(8)
    const ten = defaultConfig(10)
    await expect(
      createSeason(admin.client, {
        name: 'Desbalanceado',
        squadNames: squadNames(8),
        config: eight,
        disciplines: [
          { kind: 'PADEL', config: eight },
          { kind: 'FIFA', config: ten },
        ],
      }),
    ).rejects.toThrow()
  })

  // PR14 slice A — pair_size/allows_draw se declaran AL CREAR, no se derivan
  // de `kind` (decisión #5: FIFA es 1v1 O 2v2, elegido al configurar la
  // disciplina). Sin especificar, siguen siendo 2/false — el pádel de
  // siempre, y lo que ya asertaba `discipline.db.test.ts` para el caso sin
  // `disciplines` explícito.
  it('pair_size y allows_draw se persisten por disciplina, sin heredar de kind (REQ-D2-1)', async () => {
    const admin = await createTestUser()
    const config = defaultConfig(8)
    //8 valores de puntos, no los 4 de `config`:
    // con `pairSize: 1`, 8 presentes son 8 lados, no 4 parejas.
    const fifaConfig = { ...config, points: [8, 7, 6, 5, 4, 3, 2, 1] }
    const { seasonId } = await createSeason(admin.client, {
      name: 'Formas mixtas',
      squadNames: squadNames(8),
      config,
      disciplines: [
        { kind: 'PADEL', config },
        { kind: 'FIFA', config: fifaConfig, pairSize: 1, allowsDraw: true },
      ],
    })

    const db = adminClient()
    const { data } = await db
      .from('disciplines')
      .select('kind, pair_size, allows_draw')
      .eq('season_id', seasonId)
      .order('position', { ascending: true })

    expect(data).toEqual([
      { kind: 'PADEL', pair_size: 2, allows_draw: false },
      { kind: 'FIFA', pair_size: 1, allows_draw: true },
    ])
  })

  // Compat: el único caller de producción (`app/torneos/nuevo/actions.ts`)
  // todavía no pasa `disciplines` — el wizard multi-disciplina es PR11a,
  // fuera de este slice. Tiene que seguir viendo exactamente el mismo
  // comportamiento de siempre.
  it('sin disciplines: sigue creando exactamente una PADEL en position 0', async () => {
    const admin = await createTestUser()
    const config = defaultConfig(8)
    const { seasonId } = await createSeason(admin.client, {
      name: 'Sólo pádel',
      squadNames: squadNames(8),
      config,
    })

    const header = await seasonHeader(admin.client, seasonId)
    expect(header.disciplines.map((d) => d.kind)).toEqual(['PADEL'])

    const db = adminClient()
    const { data } = await db
      .from('disciplines')
      .select('position')
      .eq('season_id', seasonId)
      .single()
    expect(data?.position).toBe(0)
  })
})

/**
 * C29 (verify-report-pr21, #4004): el radio "Individual" del wizard NO podía
 * crear un torneo — `createSeason` lo rechazaba SIEMPRE. `newTournamentPayload`
 * mandaba el MISMO objeto `config` como `seasons.config` (legado, validado con
 * `sideSize` FIJO en 2, `db/season.ts:273`) y como `disciplines[0].config`
 * (validado con `pairSize=1`). Con 8 lados de a uno esa config trae 8 valores
 * de puntos: pasa la validación de la disciplina y rompe la del legado, que
 * exige 4. No hay config que pase las dos — por eso el test entra por el
 * camino REAL: `newTournamentPayload` + `createSeason` como `authenticated`,
 * no un insert armado a mano como el resto de este archivo.
 */
describe('createSeason vía el wizard real, disciplina de a uno (C29)', () => {
  it('el wizard con "Individual" crea el torneo: FIFA pair_size=1 con la curva de #3963', async () => {
    const admin = await createTestUser()
    // El `config` de entrada es siempre la curva de a dos (C29, W76/#4017):
    // la curva de a uno la arma `newTournamentPayload` sola, a partir de
    // `pairSizes.FIFA`, no de lo que traiga este argumento.
    const config = defaultConfig(8)
    const squad: Squad = { names: squadNames(8), mySeat: null }

    const payload = newTournamentPayload('Liga FIFA', squad, config, ['FIFA'], { PADEL: 2, FIFA: 1 })
    const { seasonId } = await createSeason(admin.client, payload)

    const db = adminClient()
    const { data } = await db
      .from('disciplines')
      .select('kind, pair_size, config')
      .eq('season_id', seasonId)
      .single()
    expect(data?.pair_size).toBe(1)
    expect((data?.config as { points: number[] } | null)?.points).toEqual([10, 7, 5, 3, 2, 1, 0, 0])
  })

  /**
   * W69 (tanda de cierre, #4006): "Lados" era UN solo control para todo el
   * paso 4 — con Pádel + FIFA juntos, aplicar `pairSize=1` a las DOS sería
   * herencia cruzada (REQ-D2-1: "sin herencia cruzada") — el pádel nacería
   * 1v1 sin que nadie lo haya pedido para pádel. El arreglo de entonces
   * evitaba la herencia IGNORANDO "Individual" con dos o más marcadas —
   * las dos nacían en 2, sin excepción.
   *
   * W76 (verify-report-pr21-cierre, #4016) + decisión #4017: ESE arreglo
   * cambió un bug por otro de la misma familia — la pantalla mostraba la
   * curva de a uno para FIFA y el torneo se creaba igual, con las dos en 2,
   * sin decir una palabra. El wizard ahora lleva un selector "Parejas /
   * Individual" POR disciplina, así que "no cruza a Pádel" ya no significa
   * "Individual se ignora": significa que CADA disciplina nace con SU
   * `pairSize`, elegido en SU propio radio — pádel en 2, FIFA en 1, las dos
   * a la vez, sin que ninguna le pise el dato a la otra.
   */
  it('con Pádel + FIFA marcados, cada uno nace con SU pairSize -- sin herencia cruzada en ningún sentido (W69/W76, REQ-D2-1)', async () => {
    const admin = await createTestUser()
    const config = defaultConfig(8)
    const squad: Squad = { names: squadNames(8), mySeat: null }

    const payload = newTournamentPayload('Mixto', squad, config, ['PADEL', 'FIFA'], { PADEL: 2, FIFA: 1 })
    const { seasonId } = await createSeason(admin.client, payload)

    const db = adminClient()
    const { data } = await db
      .from('disciplines')
      .select('kind, pair_size, config')
      .eq('season_id', seasonId)
      .order('position', { ascending: true })
    expect(data?.map((row) => ({ kind: row.kind, pair_size: row.pair_size }))).toEqual([
      { kind: 'PADEL', pair_size: 2 },
      { kind: 'FIFA', pair_size: 1 },
    ])
    // Cada fila con SU curva (#3963: 8 jugadores en parejas son 4 lados,
    // la curva de 4; 8 lados de a uno puntúan los primeros seis).
    const padel = data?.find((row) => row.kind === 'PADEL')
    const fifa = data?.find((row) => row.kind === 'FIFA')
    expect((padel?.config as { points: number[] } | null)?.points).toEqual([10, 6, 3, 1])
    expect((fifa?.config as { points: number[] } | null)?.points).toEqual([10, 7, 5, 3, 2, 1, 0, 0])
  })
})
