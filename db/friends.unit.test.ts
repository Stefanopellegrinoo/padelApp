import { describe, expect, it } from 'vitest'
import type { Client } from './client'
import { historyWith, porFechaDescendente, type CasualMatch, type SharedMatch, type TournamentMatch } from './friends'

/**
 * PostgREST corta CADA select en `PGRST_DB_MAX_ROWS` (1000,
 * `supabase/config.toml`) y no avisa -- mismo tripwire que `mySeasons`
 * (`db/read.ts:341-374`). No se puede reproducir contra Supabase real sin
 * insertar miles de partidos entre dos jugadores, así que se prueba contra
 * un cliente falso que sí puede devolver la respuesta truncada exacta que
 * dispara el bug -- mismo criterio que `db/discipline.unit.test.ts`.
 *
 * Task 2 (plan-historial-entre-amigos-2a) pasó `historyWith` de UNA consulta
 * a CUATRO (participantes, fechas, temporadas, sets): el fake creció con
 * ella, una tabla configurable por vez, para poder probar el guard de cada
 * una por separado sin tocar las otras tres. Task 2 de 2b sumó dos más
 * (casuales, autores) -- mismo criterio. "deporte-en-la-fila" (cierre de 2b)
 * sumó una séptima (`disciplines`, para el deporte de la fila de torneo).
 */
interface FakeTable<T> {
  rows: T[]
  count: number | null
}

type ParticipantRow = { match_id: string; matchday_id: string; side: string; player_id: string }
type MatchdayRow = {
  id: string
  number: number
  played_on: string | null
  season_id: string
  discipline_id: string
}
type SeasonRow = { id: string; name: string }
type DisciplineRow = { id: string; kind: string }
type MatchSetRow = { match_id: string; games_a: number; games_b: number }
type CasualMatchRow = {
  id: string
  played_on: string
  sport: string
  winner: string | null
  score_a: number | null
  score_b: number | null
  team_a: string | null
  team_b: string | null
  created_by: string
  updated_by: string
}
type PlayerRow = { id: string; display_name: string }

function fakeClient(options: {
  me: string
  participants: FakeTable<ParticipantRow>
  matchdays?: FakeTable<MatchdayRow>
  seasons?: FakeTable<SeasonRow>
  disciplines?: FakeTable<DisciplineRow>
  matchSets?: FakeTable<MatchSetRow>
  casualMatches?: FakeTable<CasualMatchRow>
  players?: FakeTable<PlayerRow>
}): Client {
  // Una tabla no configurada sólo importa si `historyWith` de verdad llega a
  // consultarla -- en los tests de truncamiento de acá abajo, el guard de la
  // consulta ANTERIOR corta antes de eso, así que las tablas siguientes
  // pueden quedar sin definir sin que ningún test las note.
  function builderFor<T>(table: FakeTable<T> | undefined, name: string) {
    return {
      select: () => builderFor(table, name),
      in: () => builderFor(table, name),
      eq: () => builderFor(table, name),
      order: () => builderFor(table, name),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
        const result =
          table === undefined
            ? Promise.reject(new Error(`fakeClient: falta configurar la tabla "${name}" para este test.`))
            : Promise.resolve({ data: table.rows, error: null, count: table.count })
        return result.then(resolve, reject)
      },
    }
  }

  const from = (table: string) => {
    if (table === 'match_participants') return builderFor(options.participants, table)
    if (table === 'matchdays') return builderFor(options.matchdays, table)
    if (table === 'seasons') return builderFor(options.seasons, table)
    if (table === 'disciplines') return builderFor(options.disciplines, table)
    if (table === 'match_sets') return builderFor(options.matchSets, table)
    if (table === 'casual_matches') return builderFor(options.casualMatches, table)
    if (table === 'players') return builderFor(options.players, table)
    throw new Error(`fakeClient: tabla no soportada en este test: ${table}`)
  }
  const rpc = () => Promise.resolve({ data: options.me, error: null })

  return { from, rpc } as unknown as Client
}

const ME = 'jugador-yo'
const AMIGO = 'jugador-amigo'

/**
 * Un partido compartido completo -- 'm1'/'f1'/'s1' --, para los tests que no
 * vienen a probar SU guard. `mySide` parametriza de qué lado juega `ME`: el
 * `4-1` de `matchSets` queda fijo (games_a=4, games_b=1), así que variar el
 * lado es lo que deja probar que `score`/`outcome` de verdad se leen desde
 * `mySide` y no desde `'A'` a fuego -- ver el test de orientación más abajo.
 */
function unPartidoCompleto(mySide: 'A' | 'B' = 'A') {
  const suLado = mySide === 'A' ? 'B' : 'A'
  return {
    participants: {
      rows: [
        { match_id: 'm1', matchday_id: 'f1', side: mySide, player_id: ME },
        { match_id: 'm1', matchday_id: 'f1', side: suLado, player_id: AMIGO },
      ] satisfies ParticipantRow[],
      count: 2,
    },
    matchdays: {
      rows: [
        { id: 'f1', number: 3, played_on: '2026-01-15', season_id: 's1', discipline_id: 'd1' },
      ] satisfies MatchdayRow[],
      count: 1,
    },
    seasons: {
      rows: [{ id: 's1', name: 'Liga de test' }] satisfies SeasonRow[],
      count: 1,
    },
    // `d1` es PADEL por default -- el ejemplo de diseño §4.4 ("Pádel") y el
    // que ya usa `torneoFixture` más abajo.
    disciplines: {
      rows: [{ id: 'd1', kind: 'PADEL' }] satisfies DisciplineRow[],
      count: 1,
    },
    matchSets: {
      rows: [{ match_id: 'm1', games_a: 4, games_b: 1 }] satisfies MatchSetRow[],
      count: 1,
    },
    // Vacía por default: la mayoría de los tests de acá abajo no vienen a
    // probar el lado casual -- `autores` ni se consulta con cero casuales.
    casualMatches: { rows: [], count: 0 } satisfies FakeTable<CasualMatchRow>,
  }
}

describe('historyWith — tripwire de truncamiento de PostgREST', () => {
  it('participantes: falla ruidoso si el select viene truncado, en vez de perder un partido en silencio', async () => {
    // Dos partidos completos serían 4 filas (2 por partido); acá sólo llegan
    // 3 -- falta la fila del amigo en el segundo partido. Sin el guard, ese
    // partido desaparece del historial sin ningún error: un conteo más chico
    // y confiadamente equivocado.
    const client = fakeClient({
      me: ME,
      participants: {
        rows: [
          { match_id: 'm1', matchday_id: 'f1', side: 'A', player_id: ME },
          { match_id: 'm1', matchday_id: 'f1', side: 'B', player_id: AMIGO },
          { match_id: 'm2', matchday_id: 'f1', side: 'A', player_id: ME },
        ],
        count: 4,
      },
    })

    // El mensaje nombra la consulta (`assertComplete`, db/friends.ts): sin
    // eso, `/no se pud/i` matchea igual las cuatro consultas Y los dos throw
    // de "vista/tablas en desacuerdo" del final -- este test podría estar
    // rompiendo cualquiera de los seis y seguir en verde.
    await expect(historyWith(client, AMIGO)).rejects.toThrow(/completo de participantes/)
  })

  it('fechas: falla ruidoso si el select de matchdays viene truncado', async () => {
    const completo = unPartidoCompleto()
    const client = fakeClient({
      me: ME,
      participants: completo.participants,
      // Debería traer la fecha 'f1'; llega vacío -- mismo bug que arriba,
      // ahora en la segunda consulta.
      matchdays: { rows: [], count: 1 },
    })

    await expect(historyWith(client, AMIGO)).rejects.toThrow(/completo de fechas/)
  })

  it('temporadas: falla ruidoso si el select de seasons viene truncado', async () => {
    const completo = unPartidoCompleto()
    const client = fakeClient({
      me: ME,
      participants: completo.participants,
      matchdays: completo.matchdays,
      seasons: { rows: [], count: 1 },
    })

    await expect(historyWith(client, AMIGO)).rejects.toThrow(/completo de temporadas/)
  })

  it('disciplinas: falla ruidoso si el select de disciplines viene truncado', async () => {
    const completo = unPartidoCompleto()
    const client = fakeClient({
      me: ME,
      participants: completo.participants,
      matchdays: completo.matchdays,
      seasons: completo.seasons,
      // Debería traer 'd1' (la disciplina de la fecha 'f1'); llega vacío --
      // mismo bug que arriba, ahora en la cuarta consulta.
      disciplines: { rows: [], count: 1 },
    })

    await expect(historyWith(client, AMIGO)).rejects.toThrow(/completo de disciplinas/)
  })

  it('sets: falla ruidoso si el select de match_sets viene truncado', async () => {
    const completo = unPartidoCompleto()
    const client = fakeClient({
      me: ME,
      participants: completo.participants,
      matchdays: completo.matchdays,
      seasons: completo.seasons,
      disciplines: completo.disciplines,
      matchSets: { rows: [], count: 1 },
    })

    await expect(historyWith(client, AMIGO)).rejects.toThrow(/completo de sets/)
  })

  it('con las siete consultas completas, arma el historial normal con su detalle', async () => {
    const client = fakeClient({ me: ME, ...unPartidoCompleto() })

    await expect(historyWith(client, AMIGO)).resolves.toEqual([
      {
        kind: 'tournament',
        matchId: 'm1',
        matchdayId: 'f1',
        together: false,
        playedOn: '2026-01-15',
        matchdayNumber: 3,
        // 'd1' es PADEL en el fixture (`unPartidoCompleto`) -- el deporte
        // sale de la disciplina de la fecha, no de `matchdays.kind` (eso es
        // REGULAR/MASTERS, un campo distinto que ya no lee la pantalla).
        sport: 'PADEL',
        seasonName: 'Liga de test',
        // 4-1 con mi lado 'A': gano el único set, y el marcador se lee con
        // mis games primero.
        outcome: 'won',
        score: { mine: 4, theirs: 1 },
      },
    ])
  })

  it.each([
    ['A', { mine: 4, theirs: 1 }, 'won'],
    ['B', { mine: 1, theirs: 4 }, 'lost'],
  ] as const)(
    'con mi lado %s, score/outcome se leen de ESE lado -- el fake no puede quedar hardcodeado en A',
    async (mySide, score, outcome) => {
      // El caso 'A' repite lo que ya prueba el test de arriba; el de 'B' es
      // el que de verdad pone a prueba `mySide === 'A' ? … : …`
      // (db/friends.ts) -- si esas dos ramas se invirtieran, SÓLO este caso
      // lo notaría.
      const client = fakeClient({ me: ME, ...unPartidoCompleto(mySide) })

      const historia = await historyWith(client, AMIGO)

      expect(historia[0]?.score).toEqual(score)
      expect(historia[0]?.outcome).toBe(outcome)
    },
  )

  it('un partido sin sets sale con outcome y score en null, sin que el guard lo note', async () => {
    const completo = unPartidoCompleto()
    const client = fakeClient({
      me: ME,
      participants: completo.participants,
      matchdays: completo.matchdays,
      seasons: completo.seasons,
      disciplines: completo.disciplines,
      // Cero sets es una respuesta COMPLETA -- una fecha abierta no tiene
      // ninguno todavía --, no un corte: `count` coincide con `rows.length`.
      matchSets: { rows: [], count: 0 },
      casualMatches: completo.casualMatches,
    })

    await expect(historyWith(client, AMIGO)).resolves.toEqual([
      {
        kind: 'tournament',
        matchId: 'm1',
        matchdayId: 'f1',
        together: false,
        playedOn: '2026-01-15',
        matchdayNumber: 3,
        sport: 'PADEL',
        seasonName: 'Liga de test',
        outcome: null,
        score: null,
      },
    ])
  })

  it('casuales: falla ruidoso si el select de casual_matches viene truncado', async () => {
    const completo = unPartidoCompleto()
    const client = fakeClient({
      me: ME,
      participants: completo.participants,
      matchdays: completo.matchdays,
      seasons: completo.seasons,
      disciplines: completo.disciplines,
      matchSets: completo.matchSets,
      // Debería traer un casual; llega vacío -- mismo bug que las cinco de
      // torneo, ahora en la sexta consulta.
      casualMatches: { rows: [], count: 1 },
    })

    await expect(historyWith(client, AMIGO)).rejects.toThrow(/completo de casuales/)
  })

  it('autores: falla ruidoso si el select de nombres viene truncado', async () => {
    const completo = unPartidoCompleto()
    const client = fakeClient({
      me: ME,
      participants: completo.participants,
      matchdays: completo.matchdays,
      seasons: completo.seasons,
      disciplines: completo.disciplines,
      matchSets: completo.matchSets,
      casualMatches: {
        rows: [
          {
            id: 'c1',
            played_on: '2026-01-20',
            sport: 'FIFA',
            winner: null,
            score_a: null,
            score_b: null,
            team_a: null,
            team_b: null,
            created_by: ME,
            updated_by: ME,
          },
        ],
        count: 1,
      },
      // Debería traer al menos el nombre de `ME`; llega vacío -- mismo bug,
      // ahora en la séptima consulta. Sólo corre porque el casual de arriba
      // tiene autores que nombrar.
      players: { rows: [], count: 1 },
    })

    await expect(historyWith(client, AMIGO)).rejects.toThrow(/completo de autores/)
  })

  it('arma el casual con su outcome/orientación propios y lo mezcla con el de torneo por fecha', async () => {
    // `historyWith` calcula el par canónico comparando texto (`me < friendId`,
    // mismo criterio que `requestFriendship`): 'jugador-amigo' < 'jugador-yo'
    // (la 'a' de "amigo" ordena antes que la 'y' de "yo"), así que `AMIGO` es
    // `ladoA` y `ME` es `ladoB` acá -- fijado con una aserción, no a ojo, para
    // que si algún día se cambian las constantes ME/AMIGO el test explote acá
    // y no en un `toEqual` silenciosamente mal derivado.
    expect(AMIGO < ME).toBe(true)

    const completo = unPartidoCompleto()
    const client = fakeClient({
      me: ME,
      participants: completo.participants,
      matchdays: completo.matchdays,
      seasons: completo.seasons,
      disciplines: completo.disciplines,
      matchSets: completo.matchSets,
      // Dos casuales a propósito, uno de cada lado del torneo (15/1): 'c1'
      // DESPUÉS (1/2) y 'c2' ANTES (1/1). Sólo con los dos, en ese orden, la
      // mezcla es distinguible de una concatenación -- `[...casuales,
      // ...torneo]` (sin `porFechaDescendente`) pondría a 'c2' ANTES del
      // torneo igual, por casualidad de qué lado se concatena primero, y
      // este mismo test seguiría en verde. Con 'c2' fechado ANTES del
      // torneo pero esperado DESPUÉS en la lista, sólo un sort real por
      // fecha entre las dos fuentes lo deja en el lugar que se assertea
      // abajo -- ver fix round 1, Important 2.
      casualMatches: {
        rows: [
          {
            id: 'c1',
            played_on: '2026-02-01',
            sport: 'FIFA',
            // `winner` compara contra `ME` directamente, no contra un lado
            // A/B como el torneo -- ver el comentario de `db/friends.ts`.
            winner: AMIGO,
            // `score_a` es de `ladoA` (`AMIGO`), `score_b` de `ladoB` (`ME`):
            // números distintos entre sí para que un swap mine/theirs se note.
            score_a: 5,
            score_b: 2,
            team_a: 'River',
            team_b: 'Boca',
            created_by: AMIGO,
            updated_by: ME,
          },
          {
            id: 'c2',
            played_on: '2026-01-01',
            sport: 'PADEL',
            winner: ME,
            score_a: 1,
            score_b: 3,
            team_a: null,
            team_b: null,
            created_by: ME,
            updated_by: ME,
          },
        ],
        count: 2,
      },
      players: {
        rows: [
          { id: ME, display_name: 'Yo' },
          { id: AMIGO, display_name: 'El amigo' },
        ],
        count: 2,
      },
    })

    const historia = await historyWith(client, AMIGO)

    expect(historia).toHaveLength(3)
    // Orden esperado por fecha descendente ENTRE las dos fuentes:
    // c1 (1/2) > torneo m1 (15/1) > c2 (1/1). Una concatenación simple
    // (`[...casuales, ...torneo]` o al revés) nunca produce este orden,
    // porque intercala una fuente en el medio de la otra.
    expect(historia.map((m) => m.matchId)).toEqual(['c1', 'm1', 'c2'])
    expect(historia[0]?.kind).toBe('casual')
    expect(historia[1]?.kind).toBe('tournament')
    expect(historia[2]?.kind).toBe('casual')

    const casual = historia[0]
    if (casual?.kind !== 'casual') throw new Error('El primer partido no salió casual.')
    expect(casual.outcome).toBe('lost')
    // `ME` es `ladoB`: mío es `score_b`/`team_b`, suyo es `score_a`/`team_a`.
    expect(casual.score).toEqual({ mine: 2, theirs: 5 })
    expect(casual.teams).toEqual({ mine: 'Boca', theirs: 'River' })
    expect(casual.createdBy).toBe('El amigo')
    expect(casual.updatedBy).toBe('Yo')
    // Review final de 2b, Important 2: `historyWith` ya tenía los dos ids en
    // mano acá (`row.created_by`/`row.updated_by`) para armar `nombrePorId`
    // -- sólo hacía falta llevarlos también al `CasualMatch` de salida, para
    // que `autoriaDe` (`app/amigos/historial.tsx`) compare por id y no por
    // nombre.
    expect(casual.createdById).toBe(AMIGO)
    expect(casual.updatedById).toBe(ME)
  })

  it('un torneo sin jugar (playedOn null) queda al final, mezclado con un casual que sí tiene fecha', async () => {
    // El caso que la unión introduce de nuevo: el lado casual NUNCA llega
    // con `playedOn: null` (`0072`, columna `not null`), sólo el de torneo
    // puede -- una fecha abierta todavía sin `played_on` cargado.
    const completo = unPartidoCompleto()
    const client = fakeClient({
      me: ME,
      participants: completo.participants,
      matchdays: {
        rows: [{ id: 'f1', number: 3, played_on: null, season_id: 's1', discipline_id: 'd1' }],
        count: 1,
      },
      seasons: completo.seasons,
      disciplines: completo.disciplines,
      matchSets: completo.matchSets,
      casualMatches: {
        rows: [
          {
            id: 'c1',
            played_on: '2026-01-01',
            sport: 'FIFA',
            winner: null,
            score_a: null,
            score_b: null,
            team_a: null,
            team_b: null,
            created_by: ME,
            updated_by: ME,
          },
        ],
        count: 1,
      },
      players: { rows: [{ id: ME, display_name: 'Yo' }], count: 1 },
    })

    const historia = await historyWith(client, AMIGO)

    // El casual (con fecha) primero; el torneo sin jugar, al final -- nunca
    // al revés, sin importar que su `matchId` ('m1') ordene antes en texto.
    expect(historia.map((m) => m.matchId)).toEqual(['c1', 'm1'])
    expect(historia[1]?.playedOn).toBeNull()
  })

  it('dos fechas de torneo compartidas, las dos sin jugar, desempatan por matchdayNumber descendente', async () => {
    // Fix round 1 de Task 3 (plan-historial-entre-amigos-2b): la pantalla
    // (`app/amigos/historial.tsx`) tenía este desempate en su propio sort, y
    // se borró ahí sin reponerlo acá -- dos fechas de torneo compartidas y
    // sin jugar quedaban en el orden arbitrario de `match_id` de la consulta
    // de participantes en vez de por número de fecha. El desempate sólo
    // puede vivir en `porFechaDescendente`: es el único lugar que define el
    // orden ahora.
    const client = fakeClient({
      me: ME,
      participants: {
        rows: [
          { match_id: 'm1', matchday_id: 'f1', side: 'A', player_id: ME },
          { match_id: 'm1', matchday_id: 'f1', side: 'B', player_id: AMIGO },
          { match_id: 'm2', matchday_id: 'f2', side: 'A', player_id: ME },
          { match_id: 'm2', matchday_id: 'f2', side: 'B', player_id: AMIGO },
        ],
        count: 4,
      },
      matchdays: {
        rows: [
          { id: 'f1', number: 1, played_on: null, season_id: 's1', discipline_id: 'd1' },
          { id: 'f2', number: 5, played_on: null, season_id: 's1', discipline_id: 'd1' },
        ],
        count: 2,
      },
      seasons: { rows: [{ id: 's1', name: 'Liga de test' }], count: 1 },
      disciplines: { rows: [{ id: 'd1', kind: 'PADEL' }], count: 1 },
      matchSets: { rows: [], count: 0 },
      casualMatches: { rows: [], count: 0 },
    })

    const historia = await historyWith(client, AMIGO)

    // 'm1' es fecha número 1, 'm2' es fecha número 5 -- las dos sin
    // `played_on`. Sin el desempate, `porFechaDescendente` da `0` para las
    // dos comparaciones y el sort estable las deja en el orden de llegada
    // (`m1`, `m2`, el de la consulta de participantes) -- lo opuesto de lo
    // que se assertea abajo.
    expect(historia.map((m) => m.matchId)).toEqual(['m2', 'm1'])
  })
})

// Fixtures mínimas de `SharedMatch` para probar el comparador DIRECTO, sin
// pasar por `historyWith` -- a propósito: `historyWith` concatena
// `[...torneo, ...casuales]` antes de ordenar, así que un casual nunca puede
// terminar posicionado ENTRE dos partidos de torneo en el array de entrada.
// El repro de acá abajo necesita exactamente esa posición (torneo, casual,
// torneo) para mostrar la intransitividad -- inalcanzable por el camino
// público, así que el comparador se prueba solo.
function torneoFixture(overrides: Partial<TournamentMatch>): SharedMatch {
  return {
    kind: 'tournament',
    matchId: 'default',
    matchdayId: 'f1',
    together: false,
    playedOn: '2026-01-01',
    matchdayNumber: 1,
    sport: 'PADEL',
    seasonName: 'Liga de test',
    outcome: null,
    score: null,
    ...overrides,
  }
}

function casualFixture(overrides: Partial<CasualMatch>): SharedMatch {
  return {
    kind: 'casual',
    matchId: 'default',
    playedOn: '2026-01-01',
    sport: 'FIFA',
    outcome: 'drew',
    score: null,
    teams: { mine: null, theirs: null },
    createdBy: 'Yo',
    updatedBy: 'Yo',
    createdById: ME,
    updatedById: ME,
    ...overrides,
  }
}

describe('porFechaDescendente', () => {
  // Review final de 2b, Minor 3: con la misma fecha para los tres, el
  // desempate SÓLO corría entre dos de torneo -- cualquier par cruzado
  // (torneo vs casual) volvía `0`. Eso es una relación intransitiva
  // (T1==C, C==T2, pero T1 != T2 comparados directo), y con eso el resultado
  // de `Array.prototype.sort` depende de qué pares llega a comparar el
  // algoritmo -- que depende del ORDEN DE ENTRADA, no de los datos. Repro
  // exacto de la review: mismo trío, dos órdenes de entrada.
  it('el mismo trío en dos órdenes de entrada da el mismo resultado -- antes dependía del orden', () => {
    const t1 = torneoFixture({ matchId: 't1', matchdayNumber: 1 })
    const t2 = torneoFixture({ matchId: 't2', matchdayNumber: 5 })
    const c = casualFixture({ matchId: 'c1' })

    const ordenA = [t1, c, t2].sort(porFechaDescendente).map((m) => m.matchId)
    const ordenB = [t1, t2, c].sort(porFechaDescendente).map((m) => m.matchId)

    // La propiedad que de verdad importa: el resultado no puede depender de
    // en qué orden llegaron los mismos tres elementos.
    expect(ordenA).toEqual(ordenB)
    // Y el orden en sí: torneo antes que casual en un empate de fecha: entre
    // los dos de torneo, el `matchdayNumber` más alto primero (t2, n=5).
    expect(ordenA).toEqual(['t2', 't1', 'c1'])
  })
})
