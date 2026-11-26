import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { fichaSeed, type Award, type DisciplineId, type PlayedMatchday } from '@/core'
import type { DisciplineHeader, EntryRow } from '@/db/read'

/**
 * El perfil en bowling (S4): sin partidos no hay récord de ganados y perdidos,
 * efectividad ni diferencia de games. Se muestra lo que sí hay: los pinos.
 */

const D_BOWLING = 'd-bowling' as DisciplineId
const SEED = fichaSeed('BOWLING', 2, 'INDIVIDUAL')

const HEADER: DisciplineHeader[] = [
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
const SQUAD: EntryRow[] = [
  { id: 'b1', displayName: 'Bolo Uno', kind: 'SQUAD', seedPosition: 0, playerId: null, matchdayId: null },
  { id: 'b2', displayName: 'Bolo Dos', kind: 'SQUAD', seedPosition: 1, playerId: null, matchdayId: null },
]
const HISTORY: PlayedMatchday[] = [
  { number: 1, sides: [], matches: [] },
  { number: 2, sides: [], matches: [] },
]
const AWARDS = new Map<number, Award[]>([
  [1, [{ entryId: 'b1', position: 1, points: 10, lines: [] }, { entryId: 'b2', position: 2, points: 7, lines: [] }]],
  [2, [{ entryId: 'b1', position: 1, points: 10, lines: [] }, { entryId: 'b2', position: 2, points: 7, lines: [] }]],
])
const SCORES = new Map([
  [1, new Map([['b1', 200], ['b2', 150]])],
  [2, new Map([['b1', 181], ['b2', 120]])],
])

vi.mock('@/db/server', () => ({ serverClient: async () => ({}) }))
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
      disciplines: HEADER,
    }),
    seasonSquadMembersOf: async () => SQUAD.map((entry) => ({ id: entry.id, displayName: entry.displayName, playerId: null })),
    entriesOf: async () => SQUAD,
    closedHistoryAll: async () => HISTORY,
    awardsOf: async () => AWARDS,
    myEntryId: async () => null,
    closedScoresOf: async () => SCORES,
  }
})

async function render(entryId: string): Promise<string> {
  const { default: JugadorPage } = await import('./page')
  return renderToStaticMarkup(
    await JugadorPage({
      params: Promise.resolve({ id: 's1', disciplina: 'bowling', entryId }),
      searchParams: Promise.resolve({}),
    }),
  )
}

describe('el perfil de bowling cuenta pinos', () => {
  it('promedio, mejor total y pinos totales; sin partidos, efectividad ni diferencia', async () => {
    const html = await render('b2')
    expect(html).toContain('Promedio')
    expect(html).toContain('>135<')
    expect(html).toContain('Mejor total')
    expect(html).toContain('>150<')
    expect(html).toContain('Pinos totales')
    expect(html).toContain('>270<')
    expect(html).toContain('Fechas jugadas')
    expect(html).not.toContain('Efectividad')
    expect(html).not.toContain('Dif.')
    expect(html).not.toContain('>Partidos<')
  })
})
