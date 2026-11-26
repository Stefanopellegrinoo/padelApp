import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { fichaSeed, type Award, type DisciplineId, type PlayedMatchday } from '@/core'
import type { DisciplineHeader, EntryRow } from '@/db/read'

/**
 * Stats de bowling (S4): sus fechas no tienen partidos, así que "partidos
 * jugados", "% de partidos ganados", efectividad y diferencia de games no
 * dicen nada. Lo que se cuenta son los pinos (`closedScoresOf`) y quién vino
 * (los awards: en una fecha por ranking cobra cada presente).
 */

const D_BOWLING = 'd-bowling' as DisciplineId
const SEED = fichaSeed('BOWLING', 2, 'INDIVIDUAL')

const viewer = vi.hoisted(() => ({ entryId: null as string | null }))

function header(): DisciplineHeader[] {
  return [
    {
      id: D_BOWLING,
      kind: 'BOWLING',
      config: SEED.config,
      weight: 1,
      pairSize: 1,
      hasMasters: false,
      allowsDraw: false,
      formatoDefault: { kind: 'RANKING' },
    },
  ]
}

const SQUAD: EntryRow[] = [
  { id: 'b1', displayName: 'Bolo Uno', kind: 'SQUAD', seedPosition: 0, playerId: null, matchdayId: null },
  { id: 'b2', displayName: 'Bolo Dos', kind: 'SQUAD', seedPosition: 1, playerId: null, matchdayId: null },
]

// Dos fechas cerradas, sin partidos: lo que `closedHistoryAll` devuelve para una fecha por ranking.
const HISTORY: PlayedMatchday[] = [
  { number: 1, sides: [], matches: [] },
  { number: 2, sides: [], matches: [] },
]

// `b2` faltó a la 2.
const AWARDS = new Map<number, Award[]>([
  [
    1,
    [
      { entryId: 'b1', position: 1, points: 10, lines: [] },
      { entryId: 'b2', position: 2, points: 7, lines: [] },
    ],
  ],
  [2, [{ entryId: 'b1', position: 1, points: 10, lines: [] }]],
])

const SCORES = new Map([
  [1, new Map([['b1', 200], ['b2', 150]])],
  [2, new Map([['b1', 181]])],
])

vi.mock('@/db/server', () => ({ serverClient: async () => ({}) }))
vi.mock('@/db/discipline', () => ({ disciplineConfig: async () => ({ fixedTeams: false }) }))
vi.mock('@/db/read', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/db/read')>()
  return {
    ...real,
    seasonHeader: async () => ({
      id: 's1',
      name: 'Bolos del jueves',
      status: 'ACTIVE',
      regularMatchdays: 10,
      isAdmin: false,
      playersCanScore: false,
      inviteToken: null,
      disciplines: header(),
    }),
    myEntryId: async () => viewer.entryId,
    entriesOf: async () => SQUAD,
    closedHistoryAll: async () => HISTORY,
    awardsOf: async () => AWARDS,
    closedScoresOf: async () => SCORES,
  }
})

async function render(tab?: string): Promise<string> {
  const { default: StatsPage } = await import('./page')
  return renderToStaticMarkup(
    await StatsPage({
      params: Promise.resolve({ id: 's1', disciplina: 'bowling' }),
      searchParams: Promise.resolve(tab === undefined ? {} : { tab }),
    }),
  )
}

describe('Stats de bowling cuenta pinos, no partidos', () => {
  it('General: pinos totales, mejor total y promedio; sin partidos ni % de partidos ganados', async () => {
    viewer.entryId = null
    const html = await render()
    expect(html).toContain('Pinos totales')
    expect(html).toContain('>531<')
    expect(html).toContain('Mejor total')
    expect(html).toContain('>200<')
    expect(html).not.toContain('Partidos jugados')
    expect(html).not.toContain('% de partidos ganados')
    expect(html).not.toContain('Fecha más pareja')
    // Presentismo sale de quién vino: b1 las dos, b2 una.
    expect(html).toContain('Presentismo')
    expect(html).toContain('100%')
    expect(html).toContain('50%')
  })

  it('Mías: tus fechas, tu promedio y tu mejor total, sin efectividad ni diferencia', async () => {
    viewer.entryId = 'b1'
    const html = await render('mias')
    expect(html).toContain('Fechas jugadas')
    expect(html).toContain('Promedio')
    expect(html).toContain('>191<')
    expect(html).toContain('Mejor total')
    expect(html).not.toContain('Efectividad')
    expect(html).not.toContain('Dif.')
    expect(html).not.toContain('Todavía no jugaste')
  })
})
