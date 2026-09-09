import { describe, expect, it } from 'vitest'
import { newTournamentPayload, type Squad } from '@/app/torneos/nuevo/wizard-state'
import { defaultConfig, disciplineSlugs } from '@/core'
import { EdgeError } from './errors'
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

  // Sin `position` explícito,
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

  // REQ-D1-3/D1-4, decisión de este slice: el asiento entra a TODAS las
  // disciplinas creadas en el mismo submit — no hay pantalla de "quién juega
  // qué" en este wizard (PR13 la agrega para sumar una disciplina en curso).
  // Sin esto, un asiento SQUAD sin fila en discipline_entries tumba la
  // aserción de no-regresión de `db/discipline.db.test.ts`.
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

  // Equipos fijos (docs/tipos-de-torneo.md §1), por el escritor que el wizard
  // REALMENTE usa: `createSeason` (`db/season.ts`), no `addDiscipline`
  // (`db/discipline.ts`) -- el wizard llama `createTournament` ->
  // `createSeason`, y ningún camino de producción pasa por `addDiscipline`
  // con `fixedTeams`. Con `admin.client` (authenticated): ejercita el grant
  // 0076 Y el valor real que `db/season.ts:366` manda, no sólo que la
  // columna viaje.
  it('fixedTeams se persiste por disciplina a través de createSeason, sin heredar de kind', async () => {
    const admin = await createTestUser()
    const config = defaultConfig(8)
    const { seasonId } = await createSeason(admin.client, {
      name: 'Equipos fijos mixtos',
      squadNames: squadNames(8),
      config,
      disciplines: [
        { kind: 'PADEL', config, fixedTeams: true },
        { kind: 'FIFA', config, fixedTeams: false },
      ],
    })

    const db = adminClient()
    const { data } = await db
      .from('disciplines')
      .select('kind, fixed_teams')
      .eq('season_id', seasonId)
      .order('position', { ascending: true })

    expect(data).toEqual([
      { kind: 'PADEL', fixed_teams: true },
      { kind: 'FIFA', fixed_teams: false },
    ])
  })

  // Decisión #4029, parte 1: mismo automático que `addDiscipline`, ahora
  // desde el wizard -- `has_masters` nace de `pair_size`, sin que nadie lo
  // pase explícito.
  it('has_masters nace de pair_size -- false de a uno, true de a dos (decisión #4029)', async () => {
    const admin = await createTestUser()
    const config = defaultConfig(8)
    const fifaConfig = { ...config, points: [8, 7, 6, 5, 4, 3, 2, 1] }
    const { seasonId } = await createSeason(admin.client, {
      name: 'Formas mixtas Masters',
      squadNames: squadNames(8),
      config,
      disciplines: [
        { kind: 'PADEL', config },
        { kind: 'FIFA', config: fifaConfig, pairSize: 1 },
      ],
    })

    const db = adminClient()
    const { data } = await db
      .from('disciplines')
      .select('kind, has_masters')
      .eq('season_id', seasonId)
      .order('position', { ascending: true })

    expect(data).toEqual([
      { kind: 'PADEL', has_masters: true },
      { kind: 'FIFA', has_masters: false },
    ])
  })

  // Slice 1 del wizard multi-disciplina (docs/tipos-de-torneo.md §0, §2.5,
  // §2.6): hasta acá `has_masters` sólo salía del automático de #4029 y
  // `formato_default` sólo del default de columna (0074) -- ninguno de los
  // dos era elegible por spec. La prueba de que la independencia entre
  // disciplinas (§0: "cada torneo es independiente") es real acá: dos
  // disciplinas de la MISMA temporada, con config, has_masters Y
  // formato_default genuinamente distintos entre sí -- no sólo distintos del
  // default, distintos EL UNO DEL OTRO.
  it('config, has_masters y formato_default nacen genuinamente distintos entre dos disciplinas de la misma temporada', async () => {
    const admin = await createTestUser()
    const config = defaultConfig(8)
    // Misma forma de PAREJAS (pairSize 2 para las dos, sin especificar) para
    // poder atribuir la diferencia de has_masters/formato_default a lo que
    // cada spec pidió, no a un efecto lateral de `pairSize`.
    const fifaConfig = {
      ...config,
      matchFormat: { ...config.matchFormat, openScore: true },
      // 12, no 5: `countBestOf` (8, default de `defaultConfig`) no puede
      // superar `regularMatchdays` (`assertValidConfig`, core/config.ts:246)
      // -- distinto del `regularMatchdays: 10` de `config`, pero legal.
      regularMatchdays: 12,
    }
    const { seasonId } = await createSeason(admin.client, {
      name: 'Disciplinas independientes',
      squadNames: squadNames(8),
      config,
      disciplines: [
        { kind: 'PADEL', config, hasMasters: false },
        {
          kind: 'FIFA',
          config: fifaConfig,
          allowsDraw: true,
          formatoDefault: { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 },
        },
      ],
    })

    const db = adminClient()
    const { data } = await db
      .from('disciplines')
      .select('kind, config, has_masters, formato_default')
      .eq('season_id', seasonId)
      .order('position', { ascending: true })
    const padel = data?.[0]
    const fifa = data?.[1]

    // Cada valor es el que se pidió (o el automático que le tocaba), no
    // cualquier par distinto:
    expect(padel).toMatchObject({ kind: 'PADEL', has_masters: false, formato_default: { kind: 'ROUND_ROBIN' } })
    expect(fifa).toMatchObject({
      kind: 'FIFA',
      has_masters: true, // automático de #4029: sin `hasMasters` explícito y pairSize 2 (default)
      formato_default: { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 },
    })
    // Y por lo tanto genuinamente distintos entre sí, no sólo del default.
    expect(padel?.has_masters).not.toBe(fifa?.has_masters)
    expect(padel?.formato_default).not.toEqual(fifa?.formato_default)
    expect((padel?.config as { regularMatchdays: number }).regularMatchdays).not.toBe(
      (fifa?.config as { regularMatchdays: number }).regularMatchdays,
    )
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
    // Desde la Task 5 (docs/plan-arquitectura-de-paginas.md) `configs` es POR
    // disciplina: la de FIFA ya trae la curva de a uno (#3963) armada, no una
    // compartida que `newTournamentPayload` reinterprete según `pairSizes`.
    const configs = { PADEL: defaultConfig(8), FIFA: defaultConfig(8, 1) }
    const squad: Squad = { names: squadNames(8), mySeat: null }

    const payload = newTournamentPayload(
      'Liga FIFA',
      squad,
      configs,
      ['FIFA'],
      { PADEL: 2, FIFA: 1 },
      { PADEL: true, FIFA: false },
      { PADEL: { kind: 'ROUND_ROBIN' }, FIFA: { kind: 'ROUND_ROBIN' } },
      { PADEL: false, FIFA: false },
      {},
    )
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
    const configs = { PADEL: defaultConfig(8), FIFA: defaultConfig(8, 1) }
    const squad: Squad = { names: squadNames(8), mySeat: null }

    const payload = newTournamentPayload(
      'Mixto',
      squad,
      configs,
      ['PADEL', 'FIFA'],
      { PADEL: 2, FIFA: 1 },
      { PADEL: true, FIFA: false },
      { PADEL: { kind: 'ROUND_ROBIN' }, FIFA: { kind: 'ROUND_ROBIN' } },
      { PADEL: false, FIFA: false },
      {},
    )
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

  // Decisión #4029, parte 1, por el camino REAL del wizard: crear un torneo
  // con "Individual" elegido para FIFA tiene que dejarla sin Masters desde
  // el arranque, sin que el admin tenga que pisar Ajustes después.
  //
  // Desde la Task 5 (docs/plan-arquitectura-de-paginas.md §2.4) el paso 4
  // del wizard ofrece Masters POR disciplina cuando hay 2+ marcadas, y el
  // control de CADA una arranca en el automático de #4029 (`true` con
  // `pairSize` 2, `false` con 1) -- acá el admin no tocó ninguno de los dos
  // checkboxes, así que `hasMasters` llega con esos mismos valores. El de
  // FIFA además pasa por `effectiveHasMasters` adentro de
  // `newTournamentPayload`: aunque llegara en `true`, `pairSize=1` lo fuerza
  // a `false` (`disciplines_has_masters_needs_pair`, 0053).
  it('el wizard con "Individual" crea la disciplina sin Masters (decisión #4029)', async () => {
    const admin = await createTestUser()
    const configs = { PADEL: defaultConfig(8), FIFA: defaultConfig(8, 1) }
    const squad: Squad = { names: squadNames(8), mySeat: null }

    const payload = newTournamentPayload(
      'Mixto Masters',
      squad,
      configs,
      ['PADEL', 'FIFA'],
      { PADEL: 2, FIFA: 1 },
      { PADEL: true, FIFA: false },
      { PADEL: { kind: 'ROUND_ROBIN' }, FIFA: { kind: 'ROUND_ROBIN' } },
      { PADEL: false, FIFA: false },
      {},
    )
    const { seasonId } = await createSeason(admin.client, payload)

    const db = adminClient()
    const { data } = await db
      .from('disciplines')
      .select('kind, has_masters')
      .eq('season_id', seasonId)
      .order('position', { ascending: true })
    expect(data).toEqual([
      { kind: 'PADEL', has_masters: true },
      { kind: 'FIFA', has_masters: false },
    ])
  })
})

/**
 * plan-piso-y-techo-del-plantel, Task 2: `createSeason` corría
 * `assertValidConfig(config, 2)` sobre `config` -- el legado que
 * `newTournamentPayload` arma con el `squadSize` REAL del plantel cargado,
 * `db/season.ts` alrededor de la línea 266 (antes de esta tarea) -- con el
 * `sideSize` de PAREJAS hardcodeado en 2, sin importar qué disciplina eligió
 * el admin. Con dos amigos de FIFA (`pairSize=1`, piso real 2) el plantel
 * real de 2 pasa la validación de LA DISCIPLINA (`minSquadFor(1) = 2`) pero
 * rebotaba contra el piso de parejas (`minSquadFor(2) = 4`) de esa llamada
 * legado -- rechazando un torneo que en todo lo demás era válido.
 */
describe('createSeason con el plantel al piso real de una disciplina de a uno', () => {
  it('dos amigos arman un torneo de FIFA con un plantel de 2, no de 4', async () => {
    const admin = await createTestUser()
    // El `PADEL` de este `Record` nunca se lee -- `picked` es sólo `['FIFA']`
    // -- pero `configs` sigue siendo obligatorio para las dos claves, mismo
    // criterio que ya usa `pairSizes` en el wizard real.
    const configs = { PADEL: defaultConfig(2, 1), FIFA: defaultConfig(2, 1) }
    const squad: Squad = { names: squadNames(2), mySeat: null }

    const payload = newTournamentPayload(
      'Dos amigos',
      squad,
      configs,
      ['FIFA'],
      { PADEL: 2, FIFA: 1 },
      { PADEL: true, FIFA: false },
      { PADEL: { kind: 'ROUND_ROBIN' }, FIFA: { kind: 'ROUND_ROBIN' } },
      { PADEL: false, FIFA: false },
      {},
    )
    const { seasonId } = await createSeason(admin.client, payload)

    const db = adminClient()
    const { data } = await db
      .from('disciplines')
      .select('kind, pair_size')
      .eq('season_id', seasonId)
      .single()
    expect(data).toEqual({ kind: 'FIFA', pair_size: 1 })

    // Lo que este test dice pinear -- que el plantel de 2 fue ACEPTADO, no
    // rebotado por el piso de parejas hardcodeado que borró Task 2 -- antes
    // sólo lo sostenía que `createSeason` no hubiera tirado. `expect(data)`
    // de arriba prueba que la disciplina se creó bien, no el tamaño real del
    // plantel: acá se cuenta de verdad.
    const { data: entries } = await db.from('entries').select('id').eq('season_id', seasonId).eq('kind', 'SQUAD')
    expect(entries).toHaveLength(2)
  })
})

/**
 * PR11c — orden inicial POR disciplina (docs/tipos-de-torneo.md §3, plan
 * arquitectura de páginas). KEY FACT ya verificado antes de esta tarea:
 * `discipline_entries.seed_position` (arriba, `squadSeedOrder`) YA es una
 * columna por disciplina — hasta acá `createSeason` simplemente escribía el
 * mismo índice de `squadNames` en la fila de TODAS las disciplinas (el orden
 * global). `NewSeasonDiscipline.seedNames` es el primer caller que aprovecha
 * que la columna ya soporta esto: nada de esquema cambia, sólo lo que
 * `createSeason` calcula antes de insertar.
 *
 * `seedNames` es un array de NOMBRES, no de índices ni de ids: es el mismo
 * vocabulario que `squadNames`, porque a esta altura del wizard (paso "Orden
 * inicial", todavía sin crear el torneo) no existe otro identificador con el
 * que un caller pueda referirse a un asiento.
 */
describe('createSeason con orden propio por disciplina (seedNames)', () => {
  it('dos disciplinas con seedNames en órdenes distintos escriben seed_position distinto cada una', async () => {
    const admin = await createTestUser()
    const config = defaultConfig(4)
    const names = squadNames(4)
    const { seasonId } = await createSeason(admin.client, {
      name: 'Orden propio',
      squadNames: names,
      config,
      disciplines: [
        // Pádel: orden invertido respecto del plantel.
        { kind: 'PADEL', config, seedNames: [names[3]!, names[2]!, names[1]!, names[0]!] },
        // FIFA: mismo conjunto, otro orden -- ninguno de los dos es el global.
        { kind: 'FIFA', config, seedNames: [names[1]!, names[3]!, names[0]!, names[2]!] },
      ],
    })

    const db = adminClient()
    const { data: entries } = await db.from('entries').select('id, display_name').eq('season_id', seasonId)
    const idFor = (name: string) => entries!.find((row) => row.display_name === name)!.id

    const { data: disciplines } = await db
      .from('disciplines')
      .select('id, kind')
      .eq('season_id', seasonId)
      .order('position', { ascending: true })
    const padelId = disciplines!.find((row) => row.kind === 'PADEL')!.id
    const fifaId = disciplines!.find((row) => row.kind === 'FIFA')!.id

    const { data: padelSeats } = await db
      .from('discipline_entries')
      .select('entry_id, seed_position')
      .eq('discipline_id', padelId)
      .order('seed_position', { ascending: true })
    expect(padelSeats?.map((row) => row.entry_id)).toEqual(
      [names[3]!, names[2]!, names[1]!, names[0]!].map(idFor),
    )

    const { data: fifaSeats } = await db
      .from('discipline_entries')
      .select('entry_id, seed_position')
      .eq('discipline_id', fifaId)
      .order('seed_position', { ascending: true })
    expect(fifaSeats?.map((row) => row.entry_id)).toEqual(
      [names[1]!, names[3]!, names[0]!, names[2]!].map(idFor),
    )
  })

  it('la disciplina sin seedNames sigue el orden global, aunque la vecina tenga el suyo propio', async () => {
    const admin = await createTestUser()
    const config = defaultConfig(4)
    const names = squadNames(4)
    const { seasonId } = await createSeason(admin.client, {
      name: 'Mixto orden',
      squadNames: names,
      config,
      disciplines: [
        { kind: 'PADEL', config, seedNames: [names[1]!, names[0]!, names[3]!, names[2]!] },
        { kind: 'FIFA', config }, // sin seedNames: comportamiento de siempre, el índice global.
      ],
    })

    const db = adminClient()
    const { data: entries } = await db.from('entries').select('id, display_name').eq('season_id', seasonId)
    const idFor = (name: string) => entries!.find((row) => row.display_name === name)!.id
    const { data: disciplines } = await db.from('disciplines').select('id, kind').eq('season_id', seasonId)
    const fifaId = disciplines!.find((row) => row.kind === 'FIFA')!.id

    const { data: fifaSeats } = await db
      .from('discipline_entries')
      .select('entry_id, seed_position')
      .eq('discipline_id', fifaId)
      .order('seed_position', { ascending: true })
    expect(fifaSeats?.map((row) => row.entry_id)).toEqual(names.map(idFor))
  })

  // El guard de permutación: `seedNames` tiene que ser el MISMO conjunto que
  // `squadNames`, sólo reordenado -- ni de menos (falta un nombre) ni de más
  // (repite uno que no compensa una ausencia). Sin este guard, un `seedNames`
  // roto se comería en silencio a un jugador (nunca entra a
  // `discipline_entries` de esa disciplina) o lo dejaría con dos asientos.
  //
  // F5 (revisión ciega dual, 37b225b..d33377a): un `.rejects.toThrow()` a
  // secas queda verde aunque el rechazo real sea un `TypeError` sin
  // mensaje en español (medido: debilitar `isPermutationOf` a
  // `a.every(v => b.includes(v))` deja pasar un plantel corto y el
  // `TypeError: Cannot read properties of undefined (reading 'id')` que
  // sigue explota más abajo, no el `EdgeError` que el usuario tiene que
  // leer) -- y también queda verde si el guard se corre de lugar y deja
  // temporadas huérfanas atrás (medido: moverlo a justo antes del insert de
  // `discipline_entries` no lo hace fallar, sólo cambia CUÁNDO). Estos dos
  // tests ahora piden las tres cosas: el TIPO del error, el MENSAJE exacto,
  // y que no quede ninguna fila de `seasons` con ese nombre.
  it('rebota si seedNames no calza en cantidad con el plantel', async () => {
    const admin = await createTestUser()
    const config = defaultConfig(4)
    const names = squadNames(4)
    const seasonName = 'Orden corto'
    let caught: unknown
    try {
      await createSeason(admin.client, {
        name: seasonName,
        squadNames: names,
        config,
        disciplines: [{ kind: 'PADEL', config, seedNames: [names[0]!, names[1]!, names[2]!] }],
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(EdgeError)
    expect((caught as EdgeError).message).toBe(
      'El orden propio de PADEL no coincide con el plantel: tiene que ser el mismo plantel, sólo reordenado.',
    )

    const db = adminClient()
    const { data } = await db.from('seasons').select('id').eq('name', seasonName)
    expect(data).toEqual([])
  })

  it('rebota si seedNames repite un nombre en vez de traer al que falta', async () => {
    const admin = await createTestUser()
    const config = defaultConfig(4)
    const names = squadNames(4)
    const seasonName = 'Orden repetido'
    let caught: unknown
    try {
      await createSeason(admin.client, {
        name: seasonName,
        squadNames: names,
        config,
        // Repite names[0] en vez de traer names[1]: misma longitud, multiset distinto.
        disciplines: [{ kind: 'PADEL', config, seedNames: [names[0]!, names[0]!, names[2]!, names[3]!] }],
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(EdgeError)
    expect((caught as EdgeError).message).toBe(
      'El orden propio de PADEL no coincide con el plantel: tiene que ser el mismo plantel, sólo reordenado.',
    )

    const db = adminClient()
    const { data } = await db.from('seasons').select('id').eq('name', seasonName)
    expect(data).toEqual([])
  })

  // F4 (revisión ciega dual, 37b225b..d33377a): la máscara `used` de
  // `seedOrderIndices` (`db/season.ts`) no tenía NINGÚN test que la
  // ejercitara con nombres repetidos -- medido, reemplazar su cuerpo entero
  // por `seedNames.map((name) => squadNames.indexOf(name))` pasa la suite
  // COMPLETA de la base. Esa mutación es genuinamente incorrecta: sin la
  // máscara, dos "Juan" en `seedNames` resuelven SIEMPRE al mismo índice
  // (el primero), y el segundo `discipline_entries` con el mismo
  // `entry_id` para la misma disciplina viola la PK `(discipline_id,
  // entry_id)` -- el torneo entero muere. Este test ejercita esa máscara
  // de verdad: plantel con dos "Juan" y `seedNames` que los intercala.
  it('con nombres duplicados en el plantel, seedNames interleaved arma un entry_id DISTINTO para cada seed (F4)', async () => {
    const admin = await createTestUser()
    const config = defaultConfig(4)
    const names = ['Juan', 'Juan', 'Ana', 'Luis']
    const { seasonId } = await createSeason(admin.client, {
      name: 'Duplicados F4',
      squadNames: names,
      config,
      disciplines: [
        // Sin seedNames: cae al índice global de siempre -- sirve acá como
        // referencia para saber CUÁL entry_id es cuál "Juan", algo que el
        // nombre solo no puede distinguir (son duplicados).
        { kind: 'PADEL', config },
        // Interleaved: Juan(0), Ana(2), Luis(3), Juan(1) -- el segundo
        // "Juan" tiene que resolver al OTRO asiento, no repetir el primero.
        { kind: 'FIFA', config, seedNames: ['Juan', 'Ana', 'Luis', 'Juan'] },
      ],
    })

    const db = adminClient()
    const { data: disciplines } = await db
      .from('disciplines')
      .select('id, kind')
      .eq('season_id', seasonId)
      .order('position', { ascending: true })
    const padelId = disciplines!.find((row) => row.kind === 'PADEL')!.id
    const fifaId = disciplines!.find((row) => row.kind === 'FIFA')!.id

    // PADEL, sin seedNames, da la referencia: seed_position i == squadNames[i].
    const { data: padelSeats } = await db
      .from('discipline_entries')
      .select('entry_id, seed_position')
      .eq('discipline_id', padelId)
      .order('seed_position', { ascending: true })
    const entryIdByIndex = padelSeats!.map((row) => row.entry_id)

    const { data: fifaSeats } = await db
      .from('discipline_entries')
      .select('entry_id, seed_position')
      .eq('discipline_id', fifaId)
      .order('seed_position', { ascending: true })
    const fifaEntryIds = fifaSeats!.map((row) => row.entry_id)

    // seedOrderIndices(['Juan','Juan','Ana','Luis'], ['Juan','Ana','Luis','Juan']) === [0, 2, 3, 1].
    expect(fifaEntryIds).toEqual([
      entryIdByIndex[0],
      entryIdByIndex[2],
      entryIdByIndex[3],
      entryIdByIndex[1],
    ])
    // Los cuatro entry_id de FIFA son DISTINTOS entre sí -- ninguna PK
    // (discipline_id, entry_id) duplicada.
    expect(new Set(fifaEntryIds).size).toBe(4)
  })
})
