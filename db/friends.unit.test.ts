import { describe, expect, it } from 'vitest'
import type { Client } from './client'
import { EdgeError } from './errors'
import {
  historyWith,
  parseCasualResult,
  porFechaDescendente,
  type CasualMatch,
  type CasualResultInput,
  type SharedMatch,
  type TournamentMatch,
} from './friends'

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
 * una por separado sin tocar las otras tres. "deporte-en-la-fila" (cierre de
 * 2b) sumó `disciplines`. La parte casual son cinco más desde
 * plan-amigos-deporte-y-2v2 (Tarea 2): partidos del amigo, casuales,
 * jugadores, nombres y sets -- mismo criterio, una tabla configurable por vez.
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
  winner_side: string | null
  score_a: number | null
  score_b: number | null
  team_a: string | null
  team_b: string | null
  created_by: string
  updated_by: string
}
type PlayerRow = { id: string; display_name: string }
type CasualOfFriendRow = { match_id: string }
type CasualPlayerRow = { match_id: string; side: string; player_id: string | null; guest_name: string | null }
type CasualSetRow = { match_id: string; games_a: number; games_b: number }

function fakeClient(options: {
  me: string
  participants: FakeTable<ParticipantRow>
  matchdays?: FakeTable<MatchdayRow>
  seasons?: FakeTable<SeasonRow>
  disciplines?: FakeTable<DisciplineRow>
  matchSets?: FakeTable<MatchSetRow>
  /** Consulta 6: `casual_match_players` filtrada con `.eq('player_id', amigo)`. */
  casualOfFriend?: FakeTable<CasualOfFriendRow>
  casualMatches?: FakeTable<CasualMatchRow>
  /** Consulta 8: `casual_match_players` filtrada con `.in('match_id', ids)`. */
  casualPlayers?: FakeTable<CasualPlayerRow>
  players?: FakeTable<PlayerRow>
  casualSets?: FakeTable<CasualSetRow>
}): Client {
  // Una tabla no configurada sólo importa si `historyWith` de verdad llega a
  // consultarla -- en los tests de truncamiento de acá abajo, el guard de la
  // consulta ANTERIOR corta antes de eso, así que las tablas siguientes
  // pueden quedar sin definir sin que ningún test las note.
  //
  // `casual_match_players` se consulta DOS veces (6 y 8) con filtros
  // distintos: `onEq` es la tabla que responde si la consulta usa `.eq()`.
  function builderFor<T>(
    table: FakeTable<T> | undefined,
    name: string,
    onEq?: { table: FakeTable<unknown> | undefined; name: string },
  ): object {
    return {
      select: () => builderFor(table, name, onEq),
      in: () => builderFor(table, name, onEq),
      eq: () => (onEq === undefined ? builderFor(table, name) : builderFor(onEq.table, onEq.name)),
      order: () => builderFor(table, name, onEq),
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
    if (table === 'casual_match_players') {
      return builderFor(options.casualPlayers, 'casual_match_players (todos)', {
        table: options.casualOfFriend,
        name: 'casual_match_players (del amigo)',
      })
    }
    if (table === 'casual_match_sets') return builderFor(options.casualSets, table)
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
    // probar el lado casual -- sin partidos del amigo, las otras cuatro
    // consultas casuales ni corren.
    casualOfFriend: { rows: [], count: 0 } satisfies FakeTable<CasualOfFriendRow>,
  }
}

/**
 * El torneo de `unPartidoCompleto` más dos casuales con todo cargado, para
 * los tests de la parte casual. 'c1' (1/2) cae DESPUÉS del torneo (15/1) y
 * 'c2' (1/1) ANTES -- sólo con los dos, en ese orden, la mezcla por fecha es
 * distinguible de una concatenación.
 *
 * - c1: FIFA 1v1, `AMIGO` lado A y `ME` lado B; ganó A 5-2 (números
 *   distintos, para que un swap mine/theirs se note).
 * - c2: PADEL 2v2, `ME` + `AMIGO` lado A contra los invitados Pepe y Tano
 *   (lado B); ganó A, 6-3 4-6 6-4.
 */
function casualCompleto() {
  return {
    me: ME,
    ...unPartidoCompleto(),
    casualOfFriend: {
      rows: [{ match_id: 'c1' }, { match_id: 'c2' }] satisfies CasualOfFriendRow[],
      count: 2,
    },
    casualMatches: {
      rows: [
        {
          id: 'c1',
          played_on: '2026-02-01',
          sport: 'FIFA',
          winner_side: 'A',
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
          winner_side: 'A',
          score_a: null,
          score_b: null,
          team_a: null,
          team_b: null,
          created_by: ME,
          updated_by: ME,
        },
      ] satisfies CasualMatchRow[],
      count: 2,
    },
    casualPlayers: {
      rows: [
        { match_id: 'c1', side: 'A', player_id: AMIGO, guest_name: null },
        { match_id: 'c1', side: 'B', player_id: ME, guest_name: null },
        { match_id: 'c2', side: 'A', player_id: AMIGO, guest_name: null },
        { match_id: 'c2', side: 'A', player_id: ME, guest_name: null },
        { match_id: 'c2', side: 'B', player_id: null, guest_name: 'Pepe' },
        { match_id: 'c2', side: 'B', player_id: null, guest_name: 'Tano' },
      ] satisfies CasualPlayerRow[],
      count: 6,
    },
    players: {
      rows: [
        { id: ME, display_name: 'Yo' },
        { id: AMIGO, display_name: 'El amigo' },
      ] satisfies PlayerRow[],
      count: 2,
    },
    casualSets: {
      rows: [
        { match_id: 'c2', games_a: 6, games_b: 3 },
        { match_id: 'c2', games_a: 4, games_b: 6 },
        { match_id: 'c2', games_a: 6, games_b: 4 },
      ] satisfies CasualSetRow[],
      count: 3,
    },
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

  it('con todas las consultas completas, arma el historial normal con su detalle', async () => {
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
      casualOfFriend: completo.casualOfFriend,
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

  // Los cinco guards de la parte casual (`casualesEntre`, db/friends.ts): cada
  // test deja completas las consultas ANTERIORES y trunca sólo la suya.
  it('partidos casuales del amigo: falla ruidoso si el select viene truncado', async () => {
    const client = fakeClient({ me: ME, ...unPartidoCompleto(), casualOfFriend: { rows: [], count: 1 } })
    await expect(historyWith(client, AMIGO)).rejects.toThrow(/completo de partidos casuales del amigo/)
  })

  it('casuales: falla ruidoso si el select de casual_matches viene truncado', async () => {
    const client = fakeClient({ ...casualCompleto(), casualMatches: { rows: [], count: 2 } })
    await expect(historyWith(client, AMIGO)).rejects.toThrow(/completo de casuales/)
  })

  it('jugadores casuales: falla ruidoso si el select viene truncado', async () => {
    const completo = casualCompleto()
    const client = fakeClient({
      ...completo,
      // Falta una fila: sin el guard, un compañero o un rival desaparecería
      // de la fila sin ningún error.
      casualPlayers: { rows: completo.casualPlayers.rows.slice(1), count: completo.casualPlayers.rows.length },
    })
    await expect(historyWith(client, AMIGO)).rejects.toThrow(/completo de jugadores casuales/)
  })

  it('nombres: falla ruidoso si el select de players viene truncado', async () => {
    const client = fakeClient({ ...casualCompleto(), players: { rows: [], count: 2 } })
    await expect(historyWith(client, AMIGO)).rejects.toThrow(/completo de nombres/)
  })

  it('sets casuales: falla ruidoso si el select de casual_match_sets viene truncado', async () => {
    const client = fakeClient({ ...casualCompleto(), casualSets: { rows: [], count: 3 } })
    await expect(historyWith(client, AMIGO)).rejects.toThrow(/completo de sets casuales/)
  })

  it('arma cada casual desde el lado del caller y lo mezcla con el de torneo por fecha', async () => {
    const historia = await historyWith(fakeClient(casualCompleto()), AMIGO)

    expect(historia).toHaveLength(3)
    // Orden esperado por fecha descendente ENTRE las dos fuentes:
    // c1 (1/2) > torneo m1 (15/1) > c2 (1/1). Una concatenación simple
    // (`[...casuales, ...torneo]` o al revés) nunca produce este orden,
    // porque intercala una fuente en el medio de la otra.
    expect(historia.map((m) => m.matchId)).toEqual(['c1', 'm1', 'c2'])

    // c1: FIFA 1v1, `ME` del lado B -- mío es `score_b`/`team_b`.
    expect(historia[0]).toEqual({
      kind: 'casual',
      matchId: 'c1',
      playedOn: '2026-02-01',
      sport: 'FIFA',
      together: false,
      partners: [],
      rivals: ['El amigo'],
      outcome: 'lost',
      score: { mine: 2, theirs: 5 },
      teams: { mine: 'Boca', theirs: 'River' },
      sets: null,
      createdBy: 'El amigo',
      updatedBy: 'Yo',
      // Por id, no por nombre: `autoriaDe` (`app/amigos/historial.tsx`) compara
      // estos dos (review final de 2b, Important 2).
      createdById: AMIGO,
      updatedById: ME,
    })

    // c2: PADEL 2v2, `ME` y `AMIGO` juntos del lado A contra dos invitados --
    // los sets salen en orden y desde el lado A, sin goles.
    expect(historia[2]).toMatchObject({
      matchId: 'c2',
      sport: 'PADEL',
      together: true,
      partners: ['El amigo'],
      rivals: ['Pepe', 'Tano'],
      outcome: 'won',
      score: null,
      sets: [
        { mine: 6, theirs: 3 },
        { mine: 4, theirs: 6 },
        { mine: 6, theirs: 4 },
      ],
    })
  })

  it('con el caller del lado B, los sets de pádel se leen al revés', async () => {
    const completo = casualCompleto()
    const client = fakeClient({
      ...completo,
      casualPlayers: {
        rows: completo.casualPlayers.rows.map((fila) =>
          fila.match_id === 'c2' ? { ...fila, side: fila.side === 'A' ? 'B' : 'A' } : fila,
        ),
        count: completo.casualPlayers.count,
      },
    })
    const c2 = (await historyWith(client, AMIGO)).find((m) => m.matchId === 'c2')
    expect(c2).toMatchObject({
      outcome: 'lost',
      sets: [
        { mine: 3, theirs: 6 },
        { mine: 6, theirs: 4 },
        { mine: 4, theirs: 6 },
      ],
    })
  })

  it('un torneo sin jugar (playedOn null) queda al final, mezclado con un casual que sí tiene fecha', async () => {
    // El caso que la unión introduce de nuevo: el lado casual NUNCA llega
    // con `playedOn: null` (`0072`, columna `not null`), sólo el de torneo
    // puede -- una fecha abierta todavía sin `played_on` cargado.
    const completo = casualCompleto()
    const client = fakeClient({
      ...completo,
      matchdays: {
        rows: [{ id: 'f1', number: 3, played_on: null, season_id: 's1', discipline_id: 'd1' }],
        count: 1,
      },
    })

    const historia = await historyWith(client, AMIGO)

    // Los casuales (con fecha) primero; el torneo sin jugar, al final --
    // nunca al revés, sin importar que su `matchId` ('m1') ordene antes en texto.
    expect(historia.map((m) => m.matchId)).toEqual(['c1', 'c2', 'm1'])
    expect(historia[2]?.playedOn).toBeNull()
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
      casualOfFriend: { rows: [], count: 0 },
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
    together: false,
    partners: [],
    rivals: [],
    sets: null,
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

describe('parseCasualResult', () => {
  const base: CasualResultInput = {
    sport: 'PADEL',
    playedOn: '2026-05-01',
    outcome: '',
    scoreMine: '',
    scoreTheirs: '',
    teamMine: '',
    teamTheirs: '',
    setsToWin: '1',
    gamesPerSet: '4',
    sets: '[]',
  }
  const padel = (over: Partial<CasualResultInput>) => ({ ...base, ...over })
  const fifa = (over: Partial<CasualResultInput>) => ({ ...base, sport: 'FIFA', ...over })

  it('padel a 1 set a 4: deriva won del set', () => {
    const r = parseCasualResult(padel({ sets: '[{"mine":4,"theirs":2}]', outcome: 'lost' }))
    expect(r.outcome).toBe('won')
    expect(r.sets).toEqual([{ mine: 4, theirs: 2 }])
    expect(r.scoreMine).toBeNull()
  })

  it('padel a 2 sets de 6: gana quien lleva más sets', () => {
    const sets = '[{"mine":6,"theirs":3},{"mine":4,"theirs":6},{"mine":6,"theirs":5}]'
    expect(parseCasualResult(padel({ setsToWin: '2', gamesPerSet: '6', sets })).outcome).toBe('won')
  })

  it('padel: deriva lost cuando el rival gana el set', () => {
    expect(parseCasualResult(padel({ sets: '[{"mine":1,"theirs":4}]' })).outcome).toBe('lost')
  })

  it('padel: falta un set', () => {
    expect(() =>
      parseCasualResult(padel({ setsToWin: '2', gamesPerSet: '6', sets: '[{"mine":6,"theirs":3}]' })),
    ).toThrow(EdgeError)
  })

  it('padel: set imposible 4-4', () => {
    expect(() => parseCasualResult(padel({ sets: '[{"mine":4,"theirs":4}]' }))).toThrow(EdgeError)
  })

  it('padel: gamesPerSet fuera de rango', () => {
    expect(() =>
      parseCasualResult(padel({ gamesPerSet: '12', sets: '[{"mine":12,"theirs":3}]' })),
    ).toThrow(EdgeError)
  })

  it('padel: sets que no es JSON de pares enteros', () => {
    expect(() => parseCasualResult(padel({ sets: 'nope' }))).toThrow(EdgeError)
    expect(() => parseCasualResult(padel({ sets: '[{"mine":4.5,"theirs":2}]' }))).toThrow(EdgeError)
  })

  it('padel: rechaza equipos', () => {
    expect(() =>
      parseCasualResult(padel({ sets: '[{"mine":4,"theirs":2}]', teamMine: 'Boca' })),
    ).toThrow('Los equipos son sólo para FIFA.')
  })

  it('fifa 2-2 con won (penales) es válido', () => {
    const r = parseCasualResult(fifa({ scoreMine: '2', scoreTheirs: '2', outcome: 'won', teamMine: ' Boca ' }))
    expect(r).toMatchObject({ sport: 'FIFA', outcome: 'won', scoreMine: 2, scoreTheirs: 2, teamMine: 'Boca', teamTheirs: null, format: null, sets: null })
  })

  it('fifa 3-1 con lost contradice el marcador', () => {
    expect(() => parseCasualResult(fifa({ scoreMine: '3', scoreTheirs: '1', outcome: 'lost' }))).toThrow(
      'El marcador dice otra cosa sobre quién ganó.',
    )
  })

  it('fifa sin marcador + drew es válido', () => {
    const r = parseCasualResult(fifa({ outcome: 'drew' }))
    expect(r.scoreMine).toBeNull()
    expect(r.outcome).toBe('drew')
  })

  it('fifa: outcome obligatorio y marcador a medias o negativo', () => {
    expect(() => parseCasualResult(fifa({}))).toThrow(EdgeError)
    expect(() => parseCasualResult(fifa({ scoreMine: '2', outcome: 'won' }))).toThrow(EdgeError)
    expect(() => parseCasualResult(fifa({ scoreMine: '-1', scoreTheirs: '0', outcome: 'lost' }))).toThrow(EdgeError)
  })

  it('deporte fuera de PADEL/FIFA', () => {
    expect(() => parseCasualResult(fifa({ sport: 'Fifa', outcome: 'won' }))).toThrow('Elegí Pádel o FIFA.')
  })

  it('fecha inexistente', () => {
    expect(() => parseCasualResult(fifa({ playedOn: '2026-02-31', outcome: 'won' }))).toThrow(EdgeError)
  })
})
