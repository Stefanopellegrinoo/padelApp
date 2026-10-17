import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { defaultConfig, type Award, type DisciplineId } from '@/core'
import { disciplineConfig } from '@/db/discipline'
import { teamsOf } from '@/db/discipline-teams'
import {
  seasonHeader,
  type DisciplineHeader,
  type EntryRow,
  type MatchdaySummary,
  type SeasonHeader,
} from '@/db/read'

/**
 * La Tabla de UN deporte, renderizada de verdad (mismo patrón que
 * `[disciplina]/jugador/[entryId]/page.unit.test.ts`): en un deporte de parejas
 * fijas va por pareja ("Ana & Dani · 34"), y el corte "CLASIFICAN AL MASTERS"
 * sigue dependiendo de `has_masters` — tener parejas no lo enciende (una FIFA
 * "Parejas fijas" no tiene Masters). Lo que el test de `pairRows` no agarra: que
 * `page.tsx` pida los equipos de ESTA disciplina y que `TablaView` use el corte
 * por pareja sólo con Masters.
 *
 * Los dos de cada pareja suman lo mismo (cada uno suma lo de su pareja): e1/e4
 * 34 y e2/e3 30, e5 y e6 sueltos.
 */

const D_PADEL = 'd-padel' as DisciplineId
const D_FIFA = 'd-fifa' as DisciplineId

const NAMES: Record<string, string> = {
  e1: 'Ana',
  e2: 'Beto',
  e3: 'Cami',
  e4: 'Dani',
  e5: 'Eli',
  e6: 'Fede',
}

function header(hasMasters: boolean): SeasonHeader {
  const shape = {
    weight: 1,
    pairSize: 2 as const,
    hasMasters,
    allowsDraw: false,
    formatoDefault: { kind: 'ROUND_ROBIN' as const },
  }
  const disciplines: DisciplineHeader[] = [
    { id: D_PADEL, kind: 'PADEL', config: defaultConfig(2, 1), ...shape },
    // Una segunda disciplina, para que el "volver" sea la tabla general y no "Mis torneos".
    { id: D_FIFA, kind: 'FIFA', config: defaultConfig(2, 1), ...shape },
  ]
  return {
    id: 's1',
    name: 'Torneo de prueba',
    status: 'ACTIVE',
    regularMatchdays: 10,
    isAdmin: false,
    playersCanScore: false,
    inviteToken: 'token',
    disciplines,
  } as SeasonHeader
}

function entries(): EntryRow[] {
  return Object.entries(NAMES).map(([id, displayName], index) => ({
    id,
    displayName,
    kind: 'SQUAD',
    seedPosition: index + 1,
    playerId: null,
    matchdayId: null,
  }))
}

function award(entryId: string, position: number, points: number): Award {
  return { entryId, position, points, lines: [] }
}

const CLOSED_MATCHDAY: MatchdaySummary = {
  id: 'm1',
  number: 1,
  kind: 'REGULAR',
  status: 'CLOSED',
  playedOn: '2026-08-10',
  disciplineId: D_PADEL,
  allowsDraw: false,
  formato: { kind: 'ROUND_ROBIN' },
  matchFormat: null,
}

// `Desempate` llama `useRouter` en cada render; `notFound` es lo que importa `page.tsx`.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  notFound: () => {
    throw new Error('notFound')
  },
}))

vi.mock('@/db/server', () => ({ serverClient: async () => ({}) }))

vi.mock('@/db/read', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/db/read')>()
  return {
    ...real,
    seasonHeader: vi.fn(async () => header(false)),
    seasonMatchdaysOf: vi.fn(async () => [CLOSED_MATCHDAY]),
    entriesOf: vi.fn(async () => entries()),
    seasonAwardsOf: vi.fn(
      async () =>
        new Map([
          [
            D_PADEL,
            new Map([
              [
                1,
                [
                  award('e1', 1, 34),
                  award('e4', 1, 34),
                  award('e2', 2, 30),
                  award('e3', 2, 30),
                  award('e5', 3, 10),
                  award('e6', 4, 0),
                ],
              ],
            ]),
          ],
        ]),
    ),
  }
})

vi.mock('@/db/discipline', () => ({
  disciplineConfig: vi.fn(async () => ({ fixedTeams: true })),
}))

vi.mock('@/db/discipline-teams', () => ({
  // En orden de uuid, no de tabla: la pareja de abajo viene primero.
  teamsOf: vi.fn(async () => [
    { id: 't2', entryA: 'e2', entryB: 'e3' },
    { id: 't1', entryA: 'e1', entryB: 'e4' },
  ]),
}))

async function render(): Promise<string> {
  const { default: DisciplinaTablaPage } = await import('./page')
  return renderToStaticMarkup(await DisciplinaTablaPage({ params: Promise.resolve({ id: 's1', disciplina: 'padel' }) }))
}

/** Los puestos y los puntos de las filas de la tabla, en el orden en que se dibujan. */
function positions(html: string): string[] {
  return [...html.matchAll(/<span class="w-5 shrink-0[^"]*">(\d+)<\/span>/g)].map((m) => m[1]!)
}

function points(html: string): string[] {
  return [...html.matchAll(/<span class="w-\[34px\] shrink-0[^"]*">(\d+)<\/span>/g)].map((m) => m[1]!)
}

const MASTERS_LINE = 'Clasifican al Masters'

describe('Tabla de un deporte de parejas fijas', () => {
  it('muestra una fila por pareja, con sus puntos, y los sueltos como están', async () => {
    const html = await render()

    expect(html).toContain('Ana &amp; Dani')
    expect(html).toContain('Beto &amp; Cami')
    expect(positions(html)).toEqual(['1', '2', '3', '4'])
    expect(points(html)).toEqual(['34', '30', '10', '0'])
    // Cada persona está en su pareja: ninguna fila suelta con el nombre de uno solo.
    expect(html).not.toContain('>Dani<')
    expect(html).not.toContain('>Cami<')
  })

  it('pide los equipos de la disciplina de la URL, no la primera del torneo', async () => {
    await render()
    expect(teamsOf).toHaveBeenLastCalledWith(expect.anything(), D_PADEL)
    expect(disciplineConfig).toHaveBeenLastCalledWith(expect.anything(), D_PADEL)
  })

  it('sin Masters (FIFA "Parejas fijas") no dibuja el corte, aunque haya parejas', async () => {
    vi.mocked(seasonHeader).mockResolvedValueOnce(header(false))
    const html = await render()

    expect(html).not.toContain(MASTERS_LINE)
  })

  it('con Masters, el corte cae después de la segunda pareja: 2 filas cubren a los 4 primeros', async () => {
    vi.mocked(seasonHeader).mockResolvedValueOnce(header(true))
    const html = await render()

    expect(html.split(MASTERS_LINE)).toHaveLength(2)
    expect(html.indexOf('Beto &amp; Cami')).toBeLessThan(html.indexOf(MASTERS_LINE))
    expect(html.indexOf(MASTERS_LINE)).toBeLessThan(html.indexOf('Eli'))
  })

  it('no anuncia defensores: con parejas fijas el sorteo no los tiene (R17)', async () => {
    const html = await render()
    expect(html).not.toContain('les queda 1 defensa')
  })

  it('control: con parejas que rotan, la campeona de la fecha 1 sí defiende', async () => {
    vi.mocked(disciplineConfig).mockResolvedValueOnce({ fixedTeams: false } as Awaited<ReturnType<typeof disciplineConfig>>)
    const html = await render()
    expect(html).toContain('Ganaron la fecha 1 · les queda 1 defensa')
  })

  it('en un deporte sin parejas fijas la tabla sigue por persona', async () => {
    vi.mocked(disciplineConfig).mockResolvedValueOnce({ fixedTeams: false } as Awaited<ReturnType<typeof disciplineConfig>>)
    vi.mocked(teamsOf).mockClear()
    const html = await render()

    expect(teamsOf).not.toHaveBeenCalled()
    expect(html).not.toContain('&amp;')
    expect(positions(html)).toEqual(['1', '2', '3', '4', '5', '6'])
  })
})
