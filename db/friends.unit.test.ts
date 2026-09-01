import { describe, expect, it } from 'vitest'
import type { Client } from './client'
import { historyWith } from './friends'

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
 * (casuales, autores) -- mismo criterio.
 */
interface FakeTable<T> {
  rows: T[]
  count: number | null
}

type ParticipantRow = { match_id: string; matchday_id: string; side: string; player_id: string }
type MatchdayRow = { id: string; number: number; kind: string; played_on: string | null; season_id: string }
type SeasonRow = { id: string; name: string }
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
      rows: [{ id: 'f1', number: 3, kind: 'REGULAR', played_on: '2026-01-15', season_id: 's1' }] satisfies MatchdayRow[],
      count: 1,
    },
    seasons: {
      rows: [{ id: 's1', name: 'Liga de test' }] satisfies SeasonRow[],
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

  it('sets: falla ruidoso si el select de match_sets viene truncado', async () => {
    const completo = unPartidoCompleto()
    const client = fakeClient({
      me: ME,
      participants: completo.participants,
      matchdays: completo.matchdays,
      seasons: completo.seasons,
      matchSets: { rows: [], count: 1 },
    })

    await expect(historyWith(client, AMIGO)).rejects.toThrow(/completo de sets/)
  })

  it('con las seis consultas completas, arma el historial normal con su detalle', async () => {
    const client = fakeClient({ me: ME, ...unPartidoCompleto() })

    await expect(historyWith(client, AMIGO)).resolves.toEqual([
      {
        kind: 'tournament',
        matchId: 'm1',
        matchdayId: 'f1',
        together: false,
        playedOn: '2026-01-15',
        matchdayNumber: 3,
        matchdayKind: 'REGULAR',
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
        matchdayKind: 'REGULAR',
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
      matchSets: completo.matchSets,
      // Debería traer un casual; llega vacío -- mismo bug que las cuatro de
      // torneo, ahora en la quinta consulta.
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
      // ahora en la sexta consulta. Sólo corre porque el casual de arriba
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
      matchSets: completo.matchSets,
      // Jugado DESPUÉS del de torneo ('2026-01-15') -- tiene que salir
      // primero en la lista final, mezclado entre las dos fuentes.
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
        ],
        count: 1,
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

    expect(historia).toHaveLength(2)
    // El casual (1/2) más nuevo que el de torneo (15/1): va primero.
    expect(historia[0]?.matchId).toBe('c1')
    expect(historia[0]?.kind).toBe('casual')
    expect(historia[1]?.kind).toBe('tournament')

    const casual = historia[0]
    if (casual?.kind !== 'casual') throw new Error('El primer partido no salió casual.')
    expect(casual.outcome).toBe('lost')
    // `ME` es `ladoB`: mío es `score_b`/`team_b`, suyo es `score_a`/`team_a`.
    expect(casual.score).toEqual({ mine: 2, theirs: 5 })
    expect(casual.teams).toEqual({ mine: 'Boca', theirs: 'River' })
    expect(casual.createdBy).toBe('El amigo')
    expect(casual.updatedBy).toBe('Yo')
  })
})
