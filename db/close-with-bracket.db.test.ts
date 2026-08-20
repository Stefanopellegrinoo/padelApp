import { describe, it, expect } from 'vitest'
import { defaultConfig, type MatchdayFormat, type SeasonConfig } from '@/core'
import {
  advancePhase,
  closeMatchday,
  createMatchday,
  generatePairs,
  openMatchday,
  saveResult,
  setAttendance,
} from './matchday'
import { adminClient } from './test/admin'
import type { Json } from './database.types'
import { createSeason } from './test/factories'
import { createTestUser, type TestUser } from './test/users'

// ── scaffolding local a este archivo ────────────────────────────────────────
// Mismo patrón que db/matchday-phase-advance.db.test.ts (Rebanada C2): estos
// armadores sólo le sirven al cierre con llave (Rebanada D1), no van a
// db/test/factories.ts.

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

function fifaConfig(squadSize: number): SeasonConfig {
  return {
    ...defaultConfig(squadSize, 1),
    matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true, openScore: true },
    regularMatchdays: 1,
    countBestOf: 1,
    points: [8, 7, 6, 5, 4, 3, 2, 1],
  }
}

interface Scene {
  admin: TestUser
  seasonId: string
  entryIds: string[]
}

async function buildFifaScene(squadSize: number): Promise<Scene> {
  const admin = await createTestUser()
  const players = await fillerPlayers(squadSize)
  const { seasonId, entryIds } = await createSeason({
    admin,
    squad: players,
    disciplines: [{ kind: 'FIFA', pairSize: 1, config: fifaConfig(squadSize) }],
  })
  return { admin, seasonId, entryIds }
}

async function markAllPlaying(admin: TestUser, matchdayId: string, entryIds: string[]): Promise<void> {
  for (const entryId of entryIds) {
    await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
  }
}

/**
 * Planta `formato` con `service_role`, mismo patrón que
 * `db/matchday-phase-advance.db.test.ts`: todavía no existe ningún escritor
 * de producción que lo actualice después de crear la fecha (llega en D2.2).
 */
async function setFormato(matchdayId: string, formato: MatchdayFormat): Promise<void> {
  const db = adminClient()
  const { error } = await db
    .from('matchdays')
    .update({ formato: formato as unknown as Json })
    .eq('id', matchdayId)
  if (error) throw new Error(error.message)
}

interface MatchRow {
  id: string
  fase: string
  grupo: number
  round: number
  pair_a: string
  pair_b: string
}

async function matchesOf(matchdayId: string): Promise<MatchRow[]> {
  const db = adminClient()
  const { data, error } = await db
    .from('matches')
    .select('id, fase, grupo, round, pair_a, pair_b')
    .eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return data ?? []
}

async function awardsOf(
  matchdayId: string,
): Promise<Array<{ entry_id: string; position: number; points: number }>> {
  const db = adminClient()
  const { data, error } = await db
    .from('awards')
    .select('entry_id, position, points')
    .eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return data ?? []
}

async function pairsOf(matchdayId: string): Promise<Array<{ id: string; entry_a: string }>> {
  const db = adminClient()
  const { data, error } = await db.from('pairs').select('id, entry_a').eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Arma la fecha GROUPS_KNOCKOUT, la abre y devuelve sus partidos de grupo. */
async function openGroupsKnockout(
  squadSize: number,
  formato: MatchdayFormat,
): Promise<{ admin: TestUser; matchdayId: string; matches: MatchRow[] }> {
  const { admin, seasonId, entryIds } = await buildFifaScene(squadSize)
  const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
  await markAllPlaying(admin, matchdayId, entryIds)
  await setFormato(matchdayId, formato)
  await generatePairs(admin.client, matchdayId)
  await openMatchday(admin.client, matchdayId)
  return { admin, matchdayId, matches: await matchesOf(matchdayId) }
}

/** Roles (A-D / E-H) en el orden en que aparecen en las filas reales del grupo. */
function roleMap(matches: MatchRow[], grupo: number, names: string[]): Map<string, string> {
  const roles = new Map<string, string>()
  for (const match of matches.filter((match) => match.grupo === grupo)) {
    for (const pairId of [match.pair_a, match.pair_b]) {
      if (!roles.has(pairId)) roles.set(pairId, names[roles.size] ?? '?')
    }
  }
  return roles
}

/** Carga los resultados de `matches` según un diccionario "ROL-ROL" -> [ganador, marcadorGanador, marcadorPerdedor]. */
async function playByRole(
  admin: TestUser,
  matches: MatchRow[],
  roleOf: Map<string, string>,
  results: Record<string, [string, number, number]>,
): Promise<void> {
  for (const match of matches) {
    const roleA = roleOf.get(match.pair_a)
    const roleB = roleOf.get(match.pair_b)
    if (roleA === undefined || roleB === undefined) throw new Error('Lado sin rol asignado.')
    const key = [roleA, roleB].sort().join('-')
    const entry = results[key]
    if (entry === undefined) throw new Error(`Sin resultado planeado para ${key}.`)
    const [winnerRole, winnerScore, loserScore] = entry
    const [sortedFirst] = [roleA, roleB].sort()
    const firstScore = winnerRole === sortedFirst ? winnerScore : loserScore
    const secondScore = winnerRole === sortedFirst ? loserScore : winnerScore
    const [gamesA, gamesB] = roleA === sortedFirst ? [firstScore, secondScore] : [secondScore, firstScore]
    await saveResult(admin.client, match.id, [{ gamesA, gamesB }])
  }
}

describe('closeMatchday con llave (GROUPS_KNOCKOUT, Rebanada D1)', () => {
  it('un partido de GRUPO sin jugar sigue rechazando (la rendija de #3979 no se come este guard)', async () => {
    const { admin, matchdayId, matches } = await openGroupsKnockout(8, {
      kind: 'GROUPS_KNOCKOUT',
      groups: 2,
      qualifiersPerGroup: 2,
    })
    // Todos los partidos de grupo menos uno -- deja UNO sin cargar a
    // propósito. La rendija de la migración 0041 es sólo TERCER_PUESTO
    // (`m.fase <> 'TERCER_PUESTO'`); un GRUPO sin jugar sigue exigiendo
    // resultado como siempre.
    const [, ...rest] = matches
    for (const match of rest) {
      await saveResult(admin.client, match.id, [{ gamesA: 3, gamesB: 0 }])
    }

    await expect(closeMatchday(admin.client, matchdayId)).rejects.toThrow(/resultado/)
  })

  it('la fase SEMI sin jugar sigue rechazando (decisión #3979: la rendija es sólo TERCER_PUESTO)', async () => {
    const { admin, matchdayId, matches } = await openGroupsKnockout(8, {
      kind: 'GROUPS_KNOCKOUT',
      groups: 2,
      qualifiersPerGroup: 2,
    })
    for (const match of matches) {
      await saveResult(admin.client, match.id, [{ gamesA: 3, gamesB: 0 }])
    }
    await advancePhase(admin.client, matchdayId) // GRUPO -> SEMI, sin jugarla

    // El loop de validación de resultados (`closeMatchday`, db/matchday.ts)
    // encuentra la SEMI sin jugar antes de llegar al guard de
    // `standingsFromBracket` -- rechaza por "falta resultado", no por "la
    // final". Sigue siendo un rechazo, que es lo que pide #3979: la rendija
    // es sólo TERCER_PUESTO.
    await expect(closeMatchday(admin.client, matchdayId)).rejects.toThrow(/resultado/)
  })

  it(
    'la RPC en sí (sin pasar por el wrapper TS) rechaza una SEMI sin jugar -- la rendija de la ' +
      'migración es SÓLO TERCER_PUESTO, no cualquier fase de la llave',
    async () => {
      // El test de arriba pasa por `closeMatchday` (TS), y ahí el loop de
      // `matchError` ya rechaza ANTES de llegar a la RPC -- no prueba el
      // guard de la función SQL en sí. Éste llama `close_matchday` directo,
      // mismo patrón que el resto de `close.db.test.ts` para probar guards
      // de la RPC de forma aislada.
      const { admin, matchdayId, matches } = await openGroupsKnockout(8, {
        kind: 'GROUPS_KNOCKOUT',
        groups: 2,
        qualifiersPerGroup: 2,
      })
      for (const match of matches) {
        await saveResult(admin.client, match.id, [{ gamesA: 3, gamesB: 0 }])
      }
      await advancePhase(admin.client, matchdayId) // GRUPO -> SEMI, sin jugarla

      const { error } = await admin.client.rpc('close_matchday', { p_matchday: matchdayId, p_awards: [] })

      expect(error?.message).toBe('Faltan resultados por cargar.')
    },
  )

  it('toda la fase actual jugada pero la llave sin avanzar sigue rechazando (el guard de "la final" en sí)', async () => {
    const { admin, matchdayId, matches } = await openGroupsKnockout(8, {
      kind: 'GROUPS_KNOCKOUT',
      groups: 2,
      qualifiersPerGroup: 2,
    })
    // Los 12 partidos de GRUPO, todos cargados -- nadie sin resultado. Pero
    // nadie llamó `advancePhase`: la llave sigue en GRUPO, nunca llegó a
    // FINAL. Es el ÚNICO escenario donde el guard de `standingsFromBracket`
    // ("la final", no el loop de resultados) es el que de verdad rechaza.
    for (const match of matches) {
      await saveResult(admin.client, match.id, [{ gamesA: 3, gamesB: 0 }])
    }

    await expect(closeMatchday(admin.client, matchdayId)).rejects.toThrow(/final/)
  })

  it(
    'cierra con TERCER_PUESTO sin jugar (decisión #3979, de punta a punta): el 3º/4º sale del ' +
      'desempate cruzado entre grupos, no de la llave -- y el campeón no es el 1º de ningún grupo',
    async () => {
      const { admin, matchdayId, matches } = await openGroupsKnockout(8, {
        kind: 'GROUPS_KNOCKOUT',
        groups: 2,
        qualifiersPerGroup: 2,
      })

      const g1 = roleMap(matches, 1, ['A', 'B', 'C', 'D'])
      const g2 = roleMap(matches, 2, ['E', 'F', 'G', 'H'])

      await playByRole(
        admin,
        matches.filter((match) => match.grupo === 1),
        g1,
        {
          'A-B': ['A', 5, 0],
          'A-C': ['A', 5, 0],
          'A-D': ['A', 5, 0],
          'B-C': ['B', 3, 0],
          'B-D': ['B', 3, 0],
          'C-D': ['C', 1, 0],
        },
      )
      await playByRole(
        admin,
        matches.filter((match) => match.grupo === 2),
        g2,
        {
          'E-F': ['E', 9, 0],
          'E-G': ['E', 9, 0],
          'E-H': ['E', 9, 0],
          'F-G': ['F', 8, 0],
          'F-H': ['F', 8, 0],
          'G-H': ['G', 1, 0],
        },
      )
      // Grupo 1 (puntos del día, luego diferencia de goles):
      //   A (3, +15) > B (2, +1) > C (1, -7) > D (0, -9)
      // Grupo 2:
      //   E (3, +27) > F (2, +7) > G (1, -16) > H (0, -18)
      // Tabla combinada de SOLO la fase de grupos (misma `computeStandings`,
      // TODA la fase junta -- la decisión de esta rebanada para el 5º+ y
      // para el desempate de 3º/4º sin tercer puesto jugado, ver
      // `standingsFromBracket` en db/matchday.ts. Es una CONVENCIÓN elegida,
      // no un requisito del spec: REQ-D7-4 sólo dice "5º+ por tabla de
      // grupos", sin decir cómo comparar entre grupos distintos):
      //   E(1º) A(2º) F(3º) B(4º) C(5º) G(6º) D(7º) H(8º)

      await advancePhase(admin.client, matchdayId) // GRUPO -> SEMI

      const roles = new Map([...g1, ...g2])
      const semis = (await matchesOf(matchdayId)).filter((match) => match.fase === 'SEMI')
      expect(semis).toHaveLength(2)
      // knockoutMatchups (2 grupos, regla de B2): [A vs F] y [E vs B].
      // Doble sorpresa, a propósito: gana pair_b en las dos -- F elimina a
      // A (el 1º de grupo 1), B elimina a E (el 1º de grupo 2 y el mejor de
      // la tabla combinada de las ocho). Con las DOS sorpresas, los
      // finalistas son F y B -- los DOS son 2º de su grupo, ninguno es 1º
      // de nada -- y los perdedores de semis son A y E, uno de CADA grupo:
      // recién ahí el desempate de 3º/4º sin tercer puesto necesita de
      // verdad comparar ENTRE grupos (los dos tienen posición local 1,
      // "empatados" si el código sólo mirara la posición dentro de su
      // propio grupo).
      for (const semi of semis) {
        await saveResult(admin.client, semi.id, [{ gamesA: 1, gamesB: 2 }])
      }

      await advancePhase(admin.client, matchdayId) // SEMI -> FINAL + TERCER_PUESTO

      const afterSemis = await matchesOf(matchdayId)
      const final = afterSemis.find((match) => match.fase === 'FINAL')
      const thirdPlace = afterSemis.find((match) => match.fase === 'TERCER_PUESTO')
      if (final === undefined || thirdPlace === undefined) {
        throw new Error('Faltan la final o el tercer puesto.')
      }

      // FINAL: F vs B. Gana B -- el CAMPEÓN es el 2º de grupo 1, no el 1º
      // de NINGÚN grupo (la trampa pedida: un test donde el 1º de una tabla
      // de grupos gana la final no distingue nada).
      const finalRoleA = roles.get(final.pair_a)
      const bIsPairA = finalRoleA === 'B'
      await saveResult(admin.client, final.id, bIsPairA ? [{ gamesA: 2, gamesB: 1 }] : [{ gamesA: 1, gamesB: 2 }])

      // TERCER_PUESTO queda SIN JUGAR -- el corazón de la decisión #3979,
      // habilitado por la migración 0041. `thirdPlace` existe como fila de
      // `matches` (registro visible de que no se jugó) pero nunca recibe
      // un `saveResult`.

      await closeMatchday(admin.client, matchdayId)

      const pairs = await pairsOf(matchdayId)
      const entryOfRole = new Map<string, string>()
      for (const pair of pairs) {
        const role = roles.get(pair.id)
        if (role !== undefined) entryOfRole.set(role, pair.entry_a)
      }
      const awards = await awardsOf(matchdayId)
      const positionByEntry = new Map(awards.map((award) => [award.entry_id, award.position]))
      const positionOf = (role: string): number | undefined => {
        const entryId = entryOfRole.get(role)
        return entryId === undefined ? undefined : positionByEntry.get(entryId)
      }

      // 1º=B (campeón, 2º de grupo 1), 2º=F (perdió la final, 2º de grupo 2).
      expect(positionOf('B')).toBe(1)
      expect(positionOf('F')).toBe(2)
      // 3º/4º: SIN tercer puesto jugado, decide el desempate cruzado entre
      // grupos -- E (1º de la tabla combinada) queda 3º, A (2º de la tabla
      // combinada) queda 4º. Los dos tienen posición LOCAL 1 en su propio
      // grupo (cada uno ganó su grupo) -- si el código comparara sólo esa
      // posición local, quedarían empatados y el orden dependería de un
      // detalle arbitrario (el orden en que la base devuelve las semis).
      // Acá el orden sale de la diferencia de gol combinada real (E +27 >
      // A +15), determinístico.
      expect(positionOf('E')).toBe(3)
      expect(positionOf('A')).toBe(4)
      // 5º+ en el orden de la tabla combinada de sólo grupos: C, G, D, H.
      expect(positionOf('C')).toBe(5)
      expect(positionOf('G')).toBe(6)
      expect(positionOf('D')).toBe(7)
      expect(positionOf('H')).toBe(8)

      expect(awards).toHaveLength(8)
      expect([...awards.map((award) => award.points)].sort((left, right) => right - left)).toEqual([
        8, 7, 6, 5, 4, 3, 2, 1,
      ])
    },
  )

  it('una fecha de pádel ROUND_ROBIN con un partido sin cargar sigue rechazando (la rendija no toca pádel)', async () => {
    const admin = await createTestUser()
    const players = await fillerPlayers(8)
    const { seasonId, entryIds } = await createSeason({ admin, squad: players })
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, entryIds)
    await generatePairs(admin.client, matchdayId) // formato por default: ROUND_ROBIN
    await openMatchday(admin.client, matchdayId)
    const matches = await matchesOf(matchdayId)
    // Deja uno sin cargar. Toda fecha de pádel cae en `fase='GRUPO'`
    // (default de 0039, `roundRobinMatches` nunca manda `fase`) -- la
    // rendija de 0041 (`m.fase <> 'TERCER_PUESTO'`) no la alcanza nunca.
    const [, ...rest] = matches
    for (const match of rest) {
      await saveResult(admin.client, match.id, [{ gamesA: 4, gamesB: 0 }])
    }

    await expect(closeMatchday(admin.client, matchdayId)).rejects.toThrow(/resultado/)
  })
})
