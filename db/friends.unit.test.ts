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
 * una por separado sin tocar las otras tres.
 */
interface FakeTable<T> {
  rows: T[]
  count: number | null
}

type ParticipantRow = { match_id: string; matchday_id: string; side: string; player_id: string }
type MatchdayRow = { id: string; number: number; kind: string; played_on: string | null; season_id: string }
type SeasonRow = { id: string; name: string }
type MatchSetRow = { match_id: string; games_a: number; games_b: number }

function fakeClient(options: {
  me: string
  participants: FakeTable<ParticipantRow>
  matchdays?: FakeTable<MatchdayRow>
  seasons?: FakeTable<SeasonRow>
  matchSets?: FakeTable<MatchSetRow>
}): Client {
  // Una tabla no configurada sólo importa si `historyWith` de verdad llega a
  // consultarla -- en los tests de truncamiento de acá abajo, el guard de la
  // consulta ANTERIOR corta antes de eso, así que las tablas siguientes
  // pueden quedar sin definir sin que ningún test las note.
  function builderFor<T>(table: FakeTable<T> | undefined, name: string) {
    return {
      select: () => builderFor(table, name),
      in: () => builderFor(table, name),
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
    throw new Error(`fakeClient: tabla no soportada en este test: ${table}`)
  }
  const rpc = () => Promise.resolve({ data: options.me, error: null })

  return { from, rpc } as unknown as Client
}

const ME = 'jugador-yo'
const AMIGO = 'jugador-amigo'

/** Un partido compartido completo -- 'm1'/'f1'/'s1' --, para los tests que no vienen a probar SU guard. */
function unPartidoCompleto() {
  return {
    participants: {
      rows: [
        { match_id: 'm1', matchday_id: 'f1', side: 'A', player_id: ME },
        { match_id: 'm1', matchday_id: 'f1', side: 'B', player_id: AMIGO },
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

    await expect(historyWith(client, AMIGO)).rejects.toThrow(/no se pud/i)
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

    await expect(historyWith(client, AMIGO)).rejects.toThrow(/no se pud/i)
  })

  it('temporadas: falla ruidoso si el select de seasons viene truncado', async () => {
    const completo = unPartidoCompleto()
    const client = fakeClient({
      me: ME,
      participants: completo.participants,
      matchdays: completo.matchdays,
      seasons: { rows: [], count: 1 },
    })

    await expect(historyWith(client, AMIGO)).rejects.toThrow(/no se pud/i)
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

    await expect(historyWith(client, AMIGO)).rejects.toThrow(/no se pud/i)
  })

  it('con las cuatro consultas completas, arma el historial normal con su detalle', async () => {
    const client = fakeClient({ me: ME, ...unPartidoCompleto() })

    await expect(historyWith(client, AMIGO)).resolves.toEqual([
      {
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
    })

    await expect(historyWith(client, AMIGO)).resolves.toEqual([
      {
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
})
