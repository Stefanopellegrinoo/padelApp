import { describe, it, expect } from 'vitest'
import { defaultConfig, type MatchdayFormat, type SeasonConfig } from '@/core'
import {
  advancePhase,
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
// No va a db/test/factories.ts: esa lista es la del plan, y estos armadores
// sólo le sirven al avance de fase (Rebanada C2).

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

interface Scene {
  admin: TestUser
  seasonId: string
  entryIds: string[]
}

/**
 * Marcador abierto (FIFA), sin empates: `defaultConfig(squadSize, 1)` ya da
 * exactamente `squadSize` valores de puntos (`DEFAULT_POINTS[squadSize]`,
 * curva de a uno) — no hace falta pisarlos a mano como en otros archivos que
 * arrancan de `defaultConfig(N)` con `sideSize=2` por default.
 */
function fifaConfig(squadSize: number): SeasonConfig {
  return {
    ...defaultConfig(squadSize, 1),
    matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true, openScore: true },
    regularMatchdays: 1,
    countBestOf: 1,
  }
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
 * Planta `formato` con `service_role`, mismo patrón que `db/generate.db.test.ts`:
 * todavía no existe ningún escritor de producción que lo actualice después de
 * crear la fecha (llega en D2.2).
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

/**
 * Inserta un partido "de otra fase" a mano, con `service_role`: escenario
 * para el test del riesgo del design, no un camino de producción — hoy nada
 * escribe `matches` salvo `generatePairs`/`advancePhase`.
 */
async function plantMatch(
  matchdayId: string,
  fase: string,
  grupo: number,
  pairA: string,
  pairB: string,
  gamesA: number,
  gamesB: number,
): Promise<void> {
  const db = adminClient()
  const { data, error } = await db
    .from('matches')
    .insert({ matchday_id: matchdayId, round: 1, pair_a: pairA, pair_b: pairB, allows_draw: false, fase, grupo })
    .select('id')
    .single()
  if (error || data === null) throw new Error(error?.message)
  const { error: setError } = await db
    .from('match_sets')
    .insert({ match_id: data.id, set_number: 1, games_a: gamesA, games_b: gamesB, allows_draw: false })
  if (setError) throw new Error(setError.message)
}

/** Arma la fecha, la abre y devuelve sus partidos de fase GRUPO ya generados. */
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

describe('advancePhase', () => {
  it('con la fase GRUPO recién armada, no hay partidos de una fase siguiente (REQ-D7-2, primer GIVEN)', async () => {
    const { matches } = await openGroupsKnockout(8, {
      kind: 'GROUPS_KNOCKOUT',
      groups: 2,
      qualifiersPerGroup: 2,
    })

    expect(matches.length).toBeGreaterThan(0)
    expect(matches.every((match) => match.fase === 'GRUPO')).toBe(true)
  })

  it('tira si la fase actual todavía tiene partidos sin jugar', async () => {
    const { admin, matchdayId } = await openGroupsKnockout(8, {
      kind: 'GROUPS_KNOCKOUT',
      groups: 2,
      qualifiersPerGroup: 2,
    })

    await expect(advancePhase(admin.client, matchdayId)).rejects.toThrow(/sin jugar/)
  })

  it('tira en una fecha ROUND_ROBIN: no tiene fases que avanzar', async () => {
    const { admin, seasonId, entryIds } = await buildFifaScene(8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, entryIds)
    await generatePairs(admin.client, matchdayId) // formato por default: ROUND_ROBIN
    await openMatchday(admin.client, matchdayId)

    await expect(advancePhase(admin.client, matchdayId)).rejects.toThrow(/no tiene fases/)
  })

  it('con la fase GRUPO completa, arma la fase siguiente (REQ-D7-2, segundo GIVEN)', async () => {
    const { admin, matchdayId, matches } = await openGroupsKnockout(8, {
      kind: 'GROUPS_KNOCKOUT',
      groups: 2,
      qualifiersPerGroup: 2,
    })
    for (const match of matches) {
      await saveResult(admin.client, match.id, [{ gamesA: 2, gamesB: 0 }])
    }

    await advancePhase(admin.client, matchdayId)

    const after = await matchesOf(matchdayId)
    const nextPhase = after.filter((match) => match.fase !== 'GRUPO')
    // 2 grupos con 2 clasificados cada uno: knockoutMatchups da 2 cruces →
    // faseForCount(2) === 'SEMI'. `matches_group_only_in_groups` (0039) exige
    // grupo=1 en toda fase que no sea GRUPO.
    expect(nextPhase).toHaveLength(2)
    expect(nextPhase.every((match) => match.fase === 'SEMI')).toBe(true)
    expect(nextPhase.every((match) => match.grupo === 1)).toBe(true)
  })

  it('no duplica la llave si se llama dos veces seguidas antes de jugar la fase nueva', async () => {
    const { admin, matchdayId, matches } = await openGroupsKnockout(8, {
      kind: 'GROUPS_KNOCKOUT',
      groups: 2,
      qualifiersPerGroup: 2,
    })
    for (const match of matches) {
      await saveResult(admin.client, match.id, [{ gamesA: 2, gamesB: 0 }])
    }
    await advancePhase(admin.client, matchdayId)
    const afterFirst = await matchesOf(matchdayId)

    // La fase nueva (SEMI) todavía no se jugó: currentPhase ya la ve como la
    // actual, y phaseIsComplete la rechaza — no hay una segunda llave que
    // armar en silencio.
    await expect(advancePhase(admin.client, matchdayId)).rejects.toThrow(/sin jugar/)

    const afterSecond = await matchesOf(matchdayId)
    expect(afterSecond).toHaveLength(afterFirst.length)
  })

  it('SEMI genera FINAL y TERCER_PUESTO juntas, no sólo la final (decisión #3979)', async () => {
    // 1 grupo de 4: knockoutMatchups da directo 1 cruce (FINAL), sin SEMI de
    // por medio. Para forzar una SEMI real hacen falta 2 grupos de 4 —
    // knockoutMatchups da 2 cruces → SEMI — y de ahí avanzar una vez más.
    const { admin, matchdayId, matches } = await openGroupsKnockout(8, {
      kind: 'GROUPS_KNOCKOUT',
      groups: 2,
      qualifiersPerGroup: 2,
    })
    for (const match of matches) {
      await saveResult(admin.client, match.id, [{ gamesA: 2, gamesB: 0 }])
    }
    await advancePhase(admin.client, matchdayId) // GRUPO -> SEMI

    const semis = (await matchesOf(matchdayId)).filter((match) => match.fase === 'SEMI')
    expect(semis).toHaveLength(2)
    for (const semi of semis) {
      await saveResult(admin.client, semi.id, [{ gamesA: 3, gamesB: 1 }])
    }

    await advancePhase(admin.client, matchdayId) // SEMI -> FINAL + TERCER_PUESTO

    const after = await matchesOf(matchdayId)
    const finals = after.filter((match) => match.fase === 'FINAL')
    const thirdPlace = after.filter((match) => match.fase === 'TERCER_PUESTO')
    expect(finals).toHaveLength(1)
    expect(thirdPlace).toHaveLength(1)
    expect(finals[0]?.grupo).toBe(1)
    expect(thirdPlace[0]?.grupo).toBe(1)

    // Los cuatro lados de la FINAL+TERCER_PUESTO son los cuatro semifinalistas,
    // sin repetir: ganadores en la final, perdedores en el tercer puesto.
    const semiSides = new Set(semis.flatMap((match) => [match.pair_a, match.pair_b]))
    const final = finals[0]
    const third = thirdPlace[0]
    if (final === undefined || third === undefined) throw new Error('Faltan la final o el tercer puesto.')
    const nextSides = [final.pair_a, final.pair_b, third.pair_a, third.pair_b]
    expect(new Set(nextSides)).toEqual(semiSides)
    expect(nextSides).toHaveLength(4) // sin duplicados entre sí

    await expect(advancePhase(admin.client, matchdayId)).rejects.toThrow(/final/)
  })

  it(
    'filtra por FASE Y GRUPO: un partido de otra fase entre los mismos dos lados del grupo ' +
      'no decide su tabla (el riesgo del design, pinchado con mutación)',
    async () => {
      const { admin, matchdayId } = await openGroupsKnockout(8, {
        kind: 'GROUPS_KNOCKOUT',
        groups: 2,
        qualifiersPerGroup: 2,
      })

      const grupoUnoMatches = (await matchesOf(matchdayId)).filter((match) => match.grupo === 1)
      const grupoDosMatches = (await matchesOf(matchdayId)).filter((match) => match.grupo === 2)
      expect(grupoUnoMatches).toHaveLength(6) // C(4,2), 4 lados en el grupo 1
      expect(grupoDosMatches).toHaveLength(6)

      // Roles A,B,C,D: descubiertos en el orden en que aparecen en las
      // filas reales del grupo 1 — no adivinados por índice de armado, que
      // depende de un `groupSides` zigzag que este test no necesita conocer.
      const roleOf = new Map<string, string>()
      const roleNames = ['A', 'B', 'C', 'D']
      for (const match of grupoUnoMatches) {
        for (const pairId of [match.pair_a, match.pair_b]) {
          if (!roleOf.has(pairId)) roleOf.set(pairId, roleNames[roleOf.size] ?? '?')
        }
      }
      const idOfRole = new Map([...roleOf.entries()].map(([id, role]) => [role, id]))
      const A = idOfRole.get('A')
      const B = idOfRole.get('B')
      if (A === undefined || B === undefined) throw new Error('Faltan roles del grupo 1.')

      // Resultado REAL del grupo 1 (headToHead A > B, y A/B empatados en
      // puntos y diferencia de gol así que el desempate SÍ hace falta):
      //   A-B: A 4-3 · A-C: A 3-0 · A-D: A 0-3 (pierde) · B-C: B 1-0 · B-D: B 1-0 · C-D: C 1-0
      const RESULTS: Record<string, [string, number, number]> = {
        'A-B': ['A', 4, 3],
        'A-C': ['A', 3, 0],
        'A-D': ['D', 3, 0],
        'B-C': ['B', 1, 0],
        'B-D': ['B', 1, 0],
        'C-D': ['C', 1, 0],
      }
      for (const match of grupoUnoMatches) {
        const roleA = roleOf.get(match.pair_a)
        const roleB = roleOf.get(match.pair_b)
        if (roleA === undefined || roleB === undefined) throw new Error('Lado sin rol asignado.')
        const key = [roleA, roleB].sort().join('-')
        const entry = RESULTS[key]
        if (entry === undefined) throw new Error(`Sin resultado planeado para ${key}.`)
        const [winnerRole, winnerScore, loserScore] = entry
        const [sortedFirst] = [roleA, roleB].sort()
        const firstScore = winnerRole === sortedFirst ? winnerScore : loserScore
        const secondScore = winnerRole === sortedFirst ? loserScore : winnerScore
        // firstScore/secondScore están en el orden ALFABÉTICO de los roles;
        // hay que reorientarlos al orden real (pair_a, pair_b) de esta fila.
        const [gamesA, gamesB] = roleA === sortedFirst ? [firstScore, secondScore] : [secondScore, firstScore]
        await saveResult(admin.client, match.id, [{ gamesA, gamesB }])
      }

      // Grupo 2: orden estricto sin empates, no le importa a este test. Roles
      // E-H, distintos de A-D: son lados DISTINTOS (jugadores distintos), y
      // nombrarlos distinto evita confundir "el A del grupo 1" con "el
      // primero que aparece en el grupo 2" al leer este test.
      const roleOf2 = new Map<string, string>()
      const roleNames2 = ['E', 'F', 'G', 'H']
      for (const match of grupoDosMatches) {
        for (const pairId of [match.pair_a, match.pair_b]) {
          if (!roleOf2.has(pairId)) roleOf2.set(pairId, roleNames2[roleOf2.size] ?? '?')
        }
      }
      for (const match of grupoDosMatches) {
        const roleA = roleOf2.get(match.pair_a)
        const roleB = roleOf2.get(match.pair_b)
        if (roleA === undefined || roleB === undefined) throw new Error('Lado sin rol asignado (grupo 2).')
        // El de rol alfabéticamente anterior siempre gana 3-0: orden total,
        // ningún empate que resolver.
        const winnerIsA = roleA < roleB
        await saveResult(admin.client, match.id, winnerIsA ? [{ gamesA: 3, gamesB: 0 }] : [{ gamesA: 0, gamesB: 3 }])
      }

      // El "partido de llave" del riesgo: A y B YA jugaron su mano a mano de
      // grupo (arriba, A gana 4-3). Acá se planta un partido ADICIONAL entre
      // los MISMOS dos lados, en un grupo que no es el 1 (no puede confundirse
      // con el grupo 2 real: usa 99), con el resultado OPUESTO (B gana 0-10).
      // Si `advancePhase` filtra por fase Y grupo, esta fila queda afuera del
      // cómputo del grupo 1 sin importar que comparta `fase='GRUPO'`. Si sólo
      // filtra por fase (o no filtra nada), la tabla del grupo 1 la ve, B
      // saca más puntos del día que A, y el cruce sale con los lados
      // invertidos.
      await plantMatch(matchdayId, 'GRUPO', 99, A, B, 0, 10)

      await advancePhase(admin.client, matchdayId)

      const bracket = (await matchesOf(matchdayId)).filter((match) => match.fase !== 'GRUPO')
      expect(bracket).toHaveLength(2) // SEMI: 2 grupos, 2 clasificados cada uno
      const involvesA = bracket.find((match) => match.pair_a === A || match.pair_b === A)
      if (involvesA === undefined) throw new Error('A no aparece en la llave.')
      // A es 1º del grupo 1 (headToHead real, sin el partido plantado):
      // knockoutMatchups lo pone como pair_a del cruce que lo incluye.
      expect(involvesA.pair_a).toBe(A)
    },
  )

  /**
   * C32 (verify-report-pr21-cierre, #4016): `changeMatchdayFormat` sólo
   * llamaba `setMatchdayFormat` -- sin volver a sortear, `matches` sigue con
   * la forma del formato VIEJO. Acá: sortea con `ROUND_ROBIN` (28 partidos,
   * todos `grupo=1`), después cambia a `GROUPS_KNOCKOUT` de 2 grupos SIN
   * regenerar -- el grupo 2 queda sin un solo partido. `openMatchday` no lo
   * ve (compara sólo quién vino, no la forma del fixture) y la fecha llega a
   * OPEN divergida. Medido en el navegador: "Cerrar fase" tira HTTP 500
   * (`qualifierAt`, `Error` pelado) y la fecha queda imposible de cerrar.
   *
   * El fix convierte ese `Error` pelado en un `EdgeError` ANTES de llegar a
   * `matchupsAfterGroups`: mismo criterio que cualquier otro guard de este
   * archivo, catcheable por `onMatchday` (actions.ts) en vez de tirar un 500.
   */
  it('C32: cambiar el formato DESPUÉS de sortear ya no revienta advancePhase con un Error pelado', async () => {
    const { admin, seasonId, entryIds } = await buildFifaScene(8)
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-08-10')
    await markAllPlaying(admin, matchdayId, entryIds)
    await generatePairs(admin.client, matchdayId) // formato por default: ROUND_ROBIN, 28 partidos, grupo 1
    // Cambia DESPUÉS de sortear, sin volver a generar -- la divergencia real.
    await setFormato(matchdayId, { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 })
    await openMatchday(admin.client, matchdayId) // sameSet sigue dando igual: nadie tocó quién viene

    const matches = await matchesOf(matchdayId)
    expect(matches).toHaveLength(28) // el fixture viejo, intacto
    for (const match of matches) {
      await saveResult(admin.client, match.id, [{ gamesA: 2, gamesB: 0 }])
    }

    await expect(advancePhase(admin.client, matchdayId)).rejects.toThrow(/volver a sortear/)
  })

  /**
   * C33 (verify-report-pr21-cierre, #4016): dos `advancePhase` concurrentes
   * leen la MISMA fase GRUPO completa, deciden LOS DOS que hay que avanzar, e
   * insertan CADA UNO su propia llave -- la protección de hoy
   * (`currentPhase` + `phaseIsComplete`) es lógica y en TypeScript, sin
   * ningún lock. Medido: `fulfilled | fulfilled`, 4 semis en vez de 2, y
   * "Cerrar fase" revienta después con "El tercer puesto necesita
   * exactamente 2 semifinales, hay 4." -- sin FINAL, fecha muerta.
   *
   * `Promise.allSettled` con las DOS llamadas EN VUELO A LA VEZ -- no
   * secuenciales (el test de arriba, "no duplica la llave si se llama dos
   * veces SEGUIDAS", ya cubre eso y no dice nada de la carrera real: la
   * segunda llamada secuencial ve la fase nueva sin jugar y rechaza sola,
   * sin competir con nadie).
   */
  it('C33: dos advancePhase concurrentes no duplican la llave -- exactamente uno gana', async () => {
    const { admin, matchdayId, matches } = await openGroupsKnockout(8, {
      kind: 'GROUPS_KNOCKOUT',
      groups: 2,
      qualifiersPerGroup: 2,
    })
    for (const match of matches) {
      await saveResult(admin.client, match.id, [{ gamesA: 2, gamesB: 0 }])
    }

    const results = await Promise.allSettled([
      advancePhase(admin.client, matchdayId),
      advancePhase(admin.client, matchdayId),
    ])

    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)

    const semis = (await matchesOf(matchdayId)).filter((match) => match.fase === 'SEMI')
    expect(semis).toHaveLength(2)
  })
})
