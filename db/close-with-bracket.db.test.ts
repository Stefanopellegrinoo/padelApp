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
  it('rechaza cerrar si la llave todavía no llegó a la final (decisión #3979: el guard sólo mira FINAL)', async () => {
    const { admin, matchdayId, matches } = await openGroupsKnockout(8, {
      kind: 'GROUPS_KNOCKOUT',
      groups: 2,
      qualifiersPerGroup: 2,
    })
    // Toda la fase GRUPO jugada -- ningún partido sin cargar -- pero nadie
    // llamó `advancePhase`: la llave sigue en GRUPO, nunca llegó a FINAL.
    for (const match of matches) {
      await saveResult(admin.client, match.id, [{ gamesA: 3, gamesB: 0 }])
    }

    await expect(closeMatchday(admin.client, matchdayId)).rejects.toThrow(/final/)
  })

  it(
    'cierra con la llave completa (tercer puesto incluido): usa la llave, no la tabla de grupos plana -- ' +
      'el mejor de la tabla combinada no sale campeón si pierde en semis, y el 5º+ sale de la tabla combinada',
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
      // TODA la fase junta -- la decisión de esta rebanada para el 5º+, ver
      // `standingsFromBracket` en db/matchday.ts):
      //   E(1º) A(2º) F(3º) B(4º) C(5º) G(6º) D(7º) H(8º)

      await advancePhase(admin.client, matchdayId) // GRUPO -> SEMI

      const roles = new Map([...g1, ...g2])
      const semis = (await matchesOf(matchdayId)).filter((match) => match.fase === 'SEMI')
      expect(semis).toHaveLength(2)
      // knockoutMatchups (2 grupos, regla de B2): [A vs F] y [E vs B].
      for (const semi of semis) {
        const roleA = roles.get(semi.pair_a)
        // A le gana a F (esperable: A es el 1º de grupo 1, F el 2º de
        // grupo 2 -- SEMI1 = [A,F] por la regla de cruce de B2). B le gana
        // a E (la ÚNICA sorpresa: SEMI2 = [E,B], y el 2º de grupo 1 elimina
        // al 1º de grupo 2, el lado con la MEJOR tabla combinada de las
        // ocho). "¿Gana pair_a?" se reduce a "¿pair_a es A o B?": en SEMI1
        // pair_a=A (sí, gana), en SEMI2 pair_a=E (no, gana pair_b=B).
        const winnerIsPairA = roleA === 'A' || roleA === 'B'
        await saveResult(
          admin.client,
          semi.id,
          winnerIsPairA ? [{ gamesA: 2, gamesB: 1 }] : [{ gamesA: 1, gamesB: 2 }],
        )
      }

      await advancePhase(admin.client, matchdayId) // SEMI -> FINAL + TERCER_PUESTO

      const afterSemis = await matchesOf(matchdayId)
      const final = afterSemis.find((match) => match.fase === 'FINAL')
      const thirdPlace = afterSemis.find((match) => match.fase === 'TERCER_PUESTO')
      if (final === undefined || thirdPlace === undefined) {
        throw new Error('Faltan la final o el tercer puesto.')
      }

      // FINAL: A vs B. Gana B -- el CAMPEÓN es el 2º de grupo 1, no el 1º de
      // NINGÚN grupo. Un test donde el 1º de una tabla de grupos gana la
      // final no distingue nada (lo pedido explícitamente: sembrar lo
      // contrario). Además: sumando TODOS los partidos jugados (grupo +
      // llave) sin pasar por la llave, A saca más partidos ganados que B
      // (A nunca perdió un partido de grupo; B perdió uno, contra A) -- así
      // que una mutación que ignore `knockoutPositions` y recalcule una
      // tabla plana sobre TODOS los partidos también pondría a A 1º, no a
      // B. Este test agarra las dos formas de "usar la tabla en vez de la
      // llave", no sólo una.
      const finalRoleA = roles.get(final.pair_a)
      const bIsPairA = finalRoleA === 'B'
      await saveResult(admin.client, final.id, bIsPairA ? [{ gamesA: 2, gamesB: 1 }] : [{ gamesA: 1, gamesB: 2 }])

      // TERCER_PUESTO: F vs E (los dos perdedores de semis). Se JUEGA acá --
      // el camino "sin jugar" de la decisión #3979 queda BLOQUEADO por el
      // guard de la propia función SQL `close_matchday` ("Faltan resultados
      // por cargar.", 0030), que exige un resultado para CUALQUIER fila de
      // `matches`, TERCER_PUESTO incluido -- independiente de que el wrapper
      // TS (`closeMatchday`, arriba) ya lo tolera. Habilitarlo pide tocar
      // esa función (mismo patrón de restatement que 0030), fuera de alcance
      // de esta rebanada sin confirmación -- ver `apply-progress-pr21d1`.
      // Gana F (mejor tabla combinada de grupos entre los dos, 3º global):
      // mismo resultado que daría el fallback si pudiera ejercitarse.
      const thirdRoleA = roles.get(thirdPlace.pair_a)
      const fIsPairA = thirdRoleA === 'F'
      await saveResult(admin.client, thirdPlace.id, fIsPairA ? [{ gamesA: 2, gamesB: 0 }] : [{ gamesA: 0, gamesB: 2 }])

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

      // 1º=B (campeón, 2º de grupo 1), 2º=A (perdió la final, era 1º de
      // grupo 1 con el mejor récord de grupo entre los dos finalistas): la
      // llave manda, no la tabla.
      expect(positionOf('B')).toBe(1)
      expect(positionOf('A')).toBe(2)
      // 3º/4º: el resultado REAL del tercer puesto manda (F le gana a E),
      // aunque E tenía MEJOR tabla de grupos que F (E era 1º de grupo 2, F
      // 2º) -- otra vez la llave manda sobre la tabla.
      expect(positionOf('F')).toBe(3)
      expect(positionOf('E')).toBe(4)
      // 5º+ en el orden de la tabla COMBINADA de SOLO grupos
      // (`standingsFromBracket`, db/matchday.ts): C, G, D, H. Si el código
      // sólo concatenara las tablas de grupo en vez de recalcular sobre toda
      // la fase junta (grupo 1 primero: C, D -- luego grupo 2: G, H), G y D
      // saldrían invertidos (D 6º, G 7º) sólo por el número de su propio
      // grupo. Acá G va 6º y D 7º porque G tiene 1 punto del día (ganó a H)
      // y D tiene 0 (perdió los tres) -- el mismo criterio de siempre,
      // aplicado entre los dos grupos. Este test agarra la mutación de
      // "concatenar por grupo".
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

  it('una fecha de pádel ROUND_ROBIN cierra EXACTAMENTE igual que antes (REQ-D7-4, segundo GIVEN)', async () => {
    const admin = await createTestUser()
    const players = await fillerPlayers(8)
    const { seasonId, entryIds } = await createSeason({ admin, squad: players })
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, entryIds)
    await generatePairs(admin.client, matchdayId) // formato por default: ROUND_ROBIN
    await openMatchday(admin.client, matchdayId)
    const matches = await matchesOf(matchdayId)
    for (const match of matches) {
      await saveResult(admin.client, match.id, [{ gamesA: 4, gamesB: 0 }])
    }

    await closeMatchday(admin.client, matchdayId)

    const awards = await awardsOf(matchdayId)
    expect(awards).toHaveLength(8) // 4 parejas de 2 jugadores cada una
    const config = defaultConfig(8)
    const totalPoints = awards.reduce((sum, award) => sum + award.points, 0)
    expect(totalPoints).toBe(2 * config.points.reduce((sum, points) => sum + points, 0))
  })
})
