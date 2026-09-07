import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { defaultConfig, type Award, type DisciplineId } from '@/core'
import {
  myEntryId,
  seasonAwardsOf,
  seasonMatchdaysOf,
  seasonSquadOf,
  type DisciplineHeader,
  type MatchdaySummary,
  type SeasonHeader,
} from '@/db/read'

/**
 * docs/tipos-de-torneo.md §2.4: "mi posición" (`cardFor`) tiene que leer
 * `row.position` de `computeGlobalRanking` — que comparte puesto entre
 * empatados — y no un índice de array. Mismo patrón que
 * `app/torneo/[id]/page.unit.test.ts`: server component `async` llamado
 * directo + `renderToStaticMarkup`, reads mockeadas.
 *
 * Regresión puntual: `cardFor` volviendo a `index + 1` tiene que poner este
 * test en ROJO — verificado corriendo la mutación (ver reporte de la tarea).
 */

const D_PADEL = 'd-padel' as DisciplineId

function header(): SeasonHeader {
  const discipline: DisciplineHeader = {
    id: D_PADEL,
    kind: 'PADEL',
    config: defaultConfig(2, 1),
    weight: 1,
    pairSize: 1,
    hasMasters: false,
    allowsDraw: false,
    formatoDefault: { kind: 'ROUND_ROBIN' },
  }
  return {
    id: 's1',
    name: 'Torneo de prueba',
    status: 'ACTIVE',
    regularMatchdays: 10,
    isAdmin: false,
    inviteToken: 'token',
    disciplines: [discipline],
  }
}

function closedMatchday(): MatchdaySummary {
  return {
    id: 'md1',
    number: 1,
    kind: 'REGULAR',
    status: 'CLOSED',
    playedOn: null,
    disciplineId: D_PADEL,
    allowsDraw: false,
    formato: { kind: 'ROUND_ROBIN' },
  }
}

function award(entryId: string, points: number): Award {
  return { entryId, position: 1, points, lines: [] }
}

vi.mock('@/db/server', () => ({
  serverClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    rpc: async () => ({ data: null }),
  }),
}))

vi.mock('@/db/read', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/db/read')>()
  return {
    ...real,
    mySeasons: vi.fn(async () => [header()]),
    seasonSquadOf: vi.fn(async () => ['e1', 'e2']),
    seasonMatchdaysOf: vi.fn(async () => [closedMatchday()]),
    seasonAwardsOf: vi.fn(async () => new Map([[D_PADEL, new Map([[1, [award('e1', 5), award('e2', 5)]]])]])),
    myEntryId: vi.fn(async () => 'e1'),
    playerNames: vi.fn(async () => new Map()),
  }
})

async function render(): Promise<string> {
  const { default: MisTorneosPage } = await import('./page')
  return renderToStaticMarkup(await MisTorneosPage())
}

describe('Mis torneos — "mi posición" comparte puesto entre empatados', () => {
  // El viewer es e2 A PROPÓSITO, no e1: e1 queda primero en el orden interno
  // de `computeGlobalRanking` (arrival order), así que con e1 como viewer
  // `index + 1` (1) y `position` (1) coinciden por casualidad y el test no
  // discrimina nada. Con e2 (segundo del empate), el bug viejo mostraría "2°"
  // (`index + 1`) y el correcto muestra "1°" (`position`, compartido con e1).
  it('con e1 y e2 en 5 puntos, el viewer (e2) ve el puesto 1, no 2', async () => {
    vi.mocked(myEntryId).mockResolvedValueOnce('e2')
    vi.mocked(seasonSquadOf).mockResolvedValueOnce(['e1', 'e2'])
    vi.mocked(seasonMatchdaysOf).mockResolvedValueOnce([closedMatchday()])
    vi.mocked(seasonAwardsOf).mockResolvedValueOnce(
      new Map([[D_PADEL, new Map([[1, [award('e1', 5), award('e2', 5)]]])]]),
    )

    const html = await render()

    expect(html).toContain('Mi posición')
    const posicion = /Mi posición[\s\S]*?<p class="text-\[15px\] font-extrabold">([^<]+)<\/p>/.exec(html)?.[1]
    expect(posicion).toBe('1°')
  })
})
