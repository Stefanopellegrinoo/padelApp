import { describe, expect, it } from 'vitest'
import {
  defaultConfig,
  disciplineProfile,
  members,
  sameSide,
  type DisciplineId,
  type SeasonConfig,
  type Side,
} from '@/core'
import { openScoreSet } from '@/app/torneo/[id]/[disciplina]/fechas/[n]/carga-state'
import { buildDisciplines } from '@/app/torneos/nuevo/wizard-state'
import { addDiscipline } from './discipline'
import {
  closeMatchday,
  createMatchday,
  generatePairs,
  openMatchday,
  saveResult,
  setAttendance,
} from './matchday'
import { matchdayDetail, seasonHeader } from './read'
import { createSeason } from './season'
import { adminClient } from './test/admin'
import { createTestUser, type TestUser } from './test/users'

// ── PR20 rebanada D2 — se puede JUGAR al FIFA, de punta a punta ──────────────
//
// D1 (`db/open-score.db.test.ts`) dejó el modelo sabiendo lo que es un marcador
// abierto y midió que NINGUNA pantalla podía escribir `openScore: true`: los
// dos caminos que crean una disciplina armaban su config con `defaultConfig`,
// que nace en pádel, y la máquina de carga es de dos toques.
//
// Este archivo ejerce el camino REAL de punta a punta: se crea la liga por
// donde la crea una persona, se cargan los goles con la función que usa la
// pantalla de carga, se cierra la fecha, y se mira la tabla. `adminClient()`
// aparece sólo para LEER lo que se escribió, nunca para escribir lo que el test
// viene a probar.

function squadNames(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `Jugador ${index + 1}`)
}

/** Una sola fecha regular: cerrar el año cuesta una fecha, no doce. */
function shortSeason(): SeasonConfig {
  return { ...defaultConfig(8), regularMatchdays: 1, countBestOf: 1 }
}

interface League {
  admin: TestUser
  seasonId: string
  disciplineId: DisciplineId
}

/** El camino del wizard: paso 1 marca los kinds, paso 4 arma la config, `createSeason` escribe. */
async function leagueFromWizard(picked: Array<'PADEL' | 'FIFA'>): Promise<League> {
  const admin = await createTestUser()
  const config = shortSeason()
  const { seasonId } = await createSeason(admin.client, {
    name: `Liga ${picked.join('+')} ${Date.now()}`,
    squadNames: squadNames(8),
    config,
    disciplines: buildDisciplines(picked, config),
  })
  const header = await seasonHeader(admin.client, seasonId)
  const discipline = header.disciplines[0]
  if (discipline === undefined) throw new Error('El torneo nació sin disciplina.')
  return { admin, seasonId, disciplineId: discipline.id }
}

async function shapeOf(disciplineId: string): Promise<{ kind: string; allowsDraw: boolean }> {
  const { data, error } = await adminClient()
    .from('disciplines')
    .select('kind, allows_draw')
    .eq('id', disciplineId)
    .single()
  if (error || data === null) throw new Error(error?.message)
  return { kind: data.kind, allowsDraw: data.allows_draw }
}

describe('crear una liga de FIFA por el camino real (REQ-D2-1, decisión #3933)', () => {
  it('el wizard la crea con marcador abierto Y con empates', async () => {
    const { admin, seasonId, disciplineId } = await leagueFromWizard(['FIFA'])

    const header = await seasonHeader(admin.client, seasonId)
    expect(header.disciplines[0]?.config.matchFormat.openScore).toBe(true)
    // El empate es una regla ORTOGONAL (D1) y vive en una columna, no en el
    // jsonb: sin ella un `0-0` lo rebota `match_sets_no_draw` del lado de la
    // base. Y `allows_draw` NO está en el grant de UPDATE de `disciplines`
    // (0015:70), así que si nace mal no hay pantalla que lo arregle después.
    expect(await shapeOf(disciplineId)).toEqual({ kind: 'FIFA', allowsDraw: true })
  })

  it('y el pádel del wizard sigue naciendo exactamente como hoy', async () => {
    const { admin, seasonId, disciplineId } = await leagueFromWizard(['PADEL'])

    const header = await seasonHeader(admin.client, seasonId)
    expect(header.disciplines[0]?.config.matchFormat.openScore).toBe(false)
    expect(await shapeOf(disciplineId)).toEqual({ kind: 'PADEL', allowsDraw: false })
  })

  // El segundo camino: "+ Agregar disciplina" en Ajustes, sobre un torneo ya en
  //Curso (REQ-D1-2). La expresión es la MISMA que arma `addDisciplineToSeason`
  // — la server action no se puede llamar desde acá (necesita cookies y
  // `revalidatePath`), así que lo que este test fija es todo menos su spread.
  it('"+ Agregar disciplina" de Ajustes la crea igual', async () => {
    const { admin, seasonId } = await leagueFromWizard(['PADEL'])
    const seats = await squadSeatsOf(seasonId)

    const disciplineId = await addDiscipline(
      admin.client,
      seasonId,
      { kind: 'FIFA', ...disciplineProfile('FIFA', defaultConfig(seats.length)) },
      seats,
    )

    expect(await shapeOf(disciplineId)).toEqual({ kind: 'FIFA', allowsDraw: true })
    const header = await seasonHeader(admin.client, seasonId)
    const fifa = header.disciplines.find((candidate) => candidate.id === disciplineId)
    expect(fifa?.config.matchFormat.openScore).toBe(true)
  })
})

async function squadSeatsOf(seasonId: string): Promise<string[]> {
  const { data, error } = await adminClient()
    .from('entries')
    .select('id')
    .eq('season_id', seasonId)
    .eq('kind', 'SQUAD')
    .order('seed_position', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => row.id)
}

/**
 * El plan de resultados, por índice de lado y siempre del menor al mayor.
 *
 * Está armado para que la tabla NO se pueda resolver sin mirar la diferencia de
 * gol: los lados 0 y 1 ganan DOS partidos cada uno, y lo único que los separa
 * es que el 1 los ganó por más goles. Y tiene adentro los dos marcadores que
 * el modelo de pádel no podía expresar: un `3-1` y un `0-0`.
 *
 *   0: gana 1-0 y 1-0, empata 0-0   → 2 ganados, dif. +2
 *   1: pierde 0-1, gana 3-1 y 4-0   → 2 ganados, dif. +5
 *   3: empata 0-0, pierde 0-4, gana 1-0 → 1 ganado
 *   2: pierde los tres              → 0 ganados
 */
const PLAN: Record<string, [number, number]> = {
  '0-1': [1, 0],
  '0-2': [1, 0],
  '0-3': [0, 0],
  '1-2': [3, 1],
  '1-3': [4, 0],
  '2-3': [0, 1],
}

describe('jugar la liga de FIFA: un 3-1, un 0-0, y la tabla', () => {
  it('carga los goles por la pantalla, cierra la fecha y reparte por diferencia de gol', async () => {
    const { admin, seasonId, disciplineId } = await leagueFromWizard(['FIFA'])

    const matchdayId = await createMatchday(admin.client, seasonId, '2026-03-05', disciplineId)
    for (const entryId of await squadSeatsOf(seasonId)) {
      await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
    }
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)

    const detail = await matchdayDetail(admin.client, matchdayId)
    const indexOf = (side: Side): number => {
      const at = detail.sides.findIndex((candidate) => sameSide(candidate, side))
      if (at < 0) throw new Error('Un partido nombra un lado que no está en la fecha.')
      return at
    }

    for (const match of detail.matches) {
      const a = indexOf(match.sideA)
      const b = indexOf(match.sideB)
      const planned = PLAN[a < b ? `${a}-${b}` : `${b}-${a}`]
      if (planned === undefined) throw new Error(`El plan no cubre ${a} contra ${b}.`)
      const [low, high] = planned
      // `openScoreSet` es LA función de la pantalla de carga: lo que va a la
      // base es lo que produce el panel, tipeado como lo tipea una persona.
      const set = openScoreSet(String(a < b ? low : high), String(a < b ? high : low))
      expect(set).not.toBeNull()
      await saveResult(admin.client, match.id, [set!])
    }

    const saved = await adminClient()
      .from('match_sets')
      .select('games_a, games_b, match_id')
      .in(
        'match_id',
        detail.matches.map((match) => match.id),
      )
    const scores = (saved.data ?? []).map((row) => [row.games_a, row.games_b].sort().join('-'))
    expect(scores).toContain('0-0')
    expect(scores).toContain('1-3')
    expect(saved.data).toHaveLength(6)

    await closeMatchday(admin.client, matchdayId)

    const { data: awards, error } = await adminClient()
      .from('awards')
      .select('entry_id, points')
      .eq('matchday_id', matchdayId)
    if (error) throw new Error(error.message)
    const pointsByEntry = new Map((awards ?? []).map((row) => [row.entry_id, row.points]))
    const pointsOf = (index: number): Array<number | undefined> => {
      const side = detail.sides[index]
      if (side === undefined) throw new Error('Falta un lado de la fecha.')
      return members(side).map((entryId) => pointsByEntry.get(entryId))
    }

    // Los lados 0 y 1 ganaron LOS DOS dos partidos: si esto sale al revés, la
    // tabla no está mirando la diferencia de gol.
    expect(pointsOf(1)).toEqual([10, 10])
    expect(pointsOf(0)).toEqual([6, 6])
    expect(pointsOf(3)).toEqual([3, 3])
    expect(pointsOf(2)).toEqual([1, 1])
  })
})
