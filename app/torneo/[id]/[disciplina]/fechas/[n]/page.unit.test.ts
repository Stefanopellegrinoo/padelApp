import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { defaultConfig, type DisciplineId, type MatchdayFormat, type Side } from '@/core'
import type { DisciplineHeader, MatchdaySummary, MatchWithId } from '@/db/read'

/**
 * `FechaDetailPage` entera, RENDERIZADA — no un componente suelto. Es el
 * mismo techo que `cableado-de-formato.unit.test.ts` ya usa para
 * `ReglasPage`/`AjustesPage`: server component `async`, llamado directo,
 * `@/db/read` (y acá también `@/db/season`, `@/db/server`) mockeados con
 * `vi.mock`+`importOriginal`+spread, factoría con `vi.hoisted`.
 *
 * Por qué la página entera y no `Llave`/`SelectorDeFormato` sueltos (#3957,
 * la regla de las seis veces): D2 le da su primer consumidor de producción a
 * tres cosas — `advancePhase`, el grant `update(formato)`, `suggestFormat` —
 * y el cableado de un componente suelto NO ve si `page.tsx` le pasa el
 * argumento equivocado. Acá se pincha ESO: qué llega, no que el componente
 * exista.
 *
 * Lo que NO cubre: la interacción. Esta suite renderiza, no clickea — no hay
 * runner E2E en este repo. Ver el reporte de esta rebanada para el detalle
 * de qué queda sin cubrir por esa razón.
 */

const D1 = 'd1' as DisciplineId

const escena = vi.hoisted(() => ({
  status: 'OPEN' as 'DRAFT' | 'OPEN' | 'CLOSED',
  formato: { kind: 'ROUND_ROBIN' } as MatchdayFormat,
  matches: [] as MatchWithId[],
  sides: [] as Side[],
  isAdmin: true,
}))

vi.mock('@/db/server', () => ({
  serverClient: async () => ({}),
}))

vi.mock('@/db/season', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/db/season')>()
  return {
    ...real,
    awardsBefore: async () => new Map(),
    closedHistory: async () => null,
    frozenPointsOf: async () => new Map(),
  }
})

vi.mock('@/db/read', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/db/read')>()
  const config = { ...defaultConfig(8, 1), matchFormat: { ...defaultConfig(8, 1).matchFormat, openScore: true } }
  const discipline: DisciplineHeader = { id: D1, kind: 'FIFA', config, weight: 1, pairSize: 1 }
  const entries = Array.from({ length: 8 }, (_, index) => ({
    id: `e${index + 1}`,
    displayName: `Jugador ${index + 1}`,
    kind: 'SQUAD' as const,
    seedPosition: index,
    playerId: null,
    matchdayId: null,
  }))

  function matchdaySummary(): MatchdaySummary {
    return {
      id: 'm1',
      number: 1,
      kind: 'REGULAR',
      status: escena.status,
      playedOn: '2026-03-05',
      disciplineId: D1,
      allowsDraw: false,
      formato: escena.formato,
    }
  }

  return {
    ...real,
    seasonHeader: async () => ({
      id: 's1',
      name: 'Torneo de prueba',
      status: 'ACTIVE',
      regularMatchdays: 10,
      isAdmin: escena.isAdmin,
      inviteToken: 'token',
      disciplines: [discipline],
    }),
    seasonMatchdaysOf: async () => [matchdaySummary()],
    entriesOf: async () => entries,
    attendancesOf: async () => new Map(),
    pairLocksOf: async () => [],
    matchdayDetail: async () => ({
      matchday: matchdaySummary(),
      sides: escena.sides,
      matches: escena.matches,
      guestIds: [],
    }),
  }
})

function side(n: number): Side {
  return { size: 1, a: `e${n}` }
}

const ALL_SIDES = [1, 2, 3, 4, 5, 6, 7, 8].map(side)

function playedMatch(fase: MatchWithId['fase'], grupo: number, round: number, a: number, b: number): MatchWithId {
  return { id: `${fase}-${grupo}-${round}-${a}-${b}`, round, fase, grupo, sideA: side(a), sideB: side(b), sets: [{ gamesA: 3, gamesB: 1 }] }
}

function unplayedMatch(fase: MatchWithId['fase'], grupo: number, round: number, a: number, b: number): MatchWithId {
  return { id: `${fase}-${grupo}-${round}-${a}-${b}`, round, fase, grupo, sideA: side(a), sideB: side(b), sets: [] }
}

async function render(): Promise<string> {
  const { default: FechaDetailPage } = await import('./page')
  return renderToStaticMarkup(
    await FechaDetailPage({ params: Promise.resolve({ id: 's1', disciplina: 'fifa', n: '1' }) }),
  )
}

describe('la fecha GROUPS_KNOCKOUT en juego — fase y llave (REQ-D8-1, decisión #3979)', () => {
  it('con la fase de grupos sin terminar: cuenta la fase y los grupos, sin botón de cerrar fase', async () => {
    escena.status = 'OPEN'
    escena.formato = { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 }
    escena.sides = ALL_SIDES
    escena.matches = [unplayedMatch('GRUPO', 1, 1, 1, 2), unplayedMatch('GRUPO', 2, 1, 5, 6)]

    const html = await render()

    expect(html).toContain('Fase actual: Fase de grupos')
    expect(html).toContain('Grupo 1')
    expect(html).toContain('Grupo 2')
    expect(html).not.toContain('>Cerrar fase<')
  })

  it('con la fase de grupos completa: el botón "Cerrar fase" aparece', async () => {
    escena.status = 'OPEN'
    escena.formato = { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 }
    escena.sides = ALL_SIDES
    escena.matches = [playedMatch('GRUPO', 1, 1, 1, 2), playedMatch('GRUPO', 2, 1, 5, 6)]

    const html = await render()

    expect(html).toContain('>Cerrar fase<')
  })

  /**
   * `advancePhase` tira "La llave ya llegó a la final" (db/matchday.ts) —
   * el botón se apaga ANTES de que el admin pueda pedir eso. Y el guard de
   * las decisiones #3979/#3988 se ve acá: con el tercer puesto SIN jugar,
   * "Cerrar fecha" tiene que estar HABILITADO igual — el fix de
   * `remainingMatches` es lo que hace que esto no quede roto.
   */
  it('con la final jugada: no ofrece "Cerrar fase", y "Cerrar fecha" no queda trabado por el tercer puesto sin jugar', async () => {
    escena.status = 'OPEN'
    escena.formato = { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 }
    escena.sides = ALL_SIDES
    escena.matches = [
      playedMatch('GRUPO', 1, 1, 1, 2),
      playedMatch('FINAL', 1, 1, 1, 5),
      unplayedMatch('TERCER_PUESTO', 1, 1, 2, 6),
    ]

    const html = await render()

    expect(html).not.toContain('>Cerrar fase<')
    expect(html).toContain('>Cerrar fecha<')
    expect(html).not.toContain('faltan 1 partidos')
  })
})

describe('la fecha GROUPS_KNOCKOUT cerrada — la línea de relato (decisión #3990)', () => {
  it('cuenta que el tercer puesto se definió por la tabla cuando no se jugó', async () => {
    escena.status = 'CLOSED'
    escena.isAdmin = true
    escena.formato = { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 }
    escena.sides = ALL_SIDES
    escena.matches = [
      playedMatch('GRUPO', 1, 1, 1, 2),
      playedMatch('GRUPO', 1, 2, 3, 4),
      playedMatch('GRUPO', 2, 1, 5, 6),
      playedMatch('GRUPO', 2, 2, 7, 8),
      playedMatch('SEMI', 1, 1, 1, 6),
      playedMatch('SEMI', 1, 1, 5, 2),
      playedMatch('FINAL', 1, 1, 1, 5),
      unplayedMatch('TERCER_PUESTO', 1, 1, 6, 2),
    ]

    const html = await render()

    expect(html).toContain('El tercer puesto se definió por la tabla de grupos: no se jugó el partido.')
  })

  it('no dice nada cuando el tercer puesto se jugó de verdad', async () => {
    escena.status = 'CLOSED'
    escena.formato = { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 }
    escena.sides = ALL_SIDES
    escena.matches = [
      playedMatch('GRUPO', 1, 1, 1, 2),
      playedMatch('SEMI', 1, 1, 1, 6),
      playedMatch('SEMI', 1, 1, 5, 2),
      playedMatch('FINAL', 1, 1, 1, 5),
      playedMatch('TERCER_PUESTO', 1, 1, 6, 2),
    ]

    const html = await render()

    expect(html).not.toContain('El tercer puesto se definió por la tabla de grupos')
  })
})

describe('no-regresión — una fecha ROUND_ROBIN sigue viendo exactamente lo de siempre (REQ-D7-1)', () => {
  it('sin "Fase actual", con el acordeón de Rondas de siempre', async () => {
    escena.status = 'OPEN'
    escena.formato = { kind: 'ROUND_ROBIN' }
    escena.sides = [1, 2, 3, 4].map(side)
    escena.matches = [
      unplayedMatch('GRUPO', 1, 1, 1, 2),
      unplayedMatch('GRUPO', 1, 1, 3, 4),
      unplayedMatch('GRUPO', 1, 2, 1, 3),
      unplayedMatch('GRUPO', 1, 2, 2, 4),
    ]

    const html = await render()

    expect(html).not.toContain('Fase actual:')
    expect(html).not.toContain('>Cerrar fase<')
    expect(html).toContain('Ronda 1 de')
  })
})

describe('el armado — el selector de formato pasa el `formato` guardado, no un valor fijo', () => {
  it('con GROUPS_KNOCKOUT ya elegido, el botón marcado es el de grupos', async () => {
    escena.status = 'DRAFT'
    escena.isAdmin = true
    escena.formato = { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 }
    escena.sides = []
    escena.matches = []

    const html = await render()

    const btnGrupos = /<button[^>]*>2 grupos \+ llave<\/button>/.exec(html)?.[0] ?? ''
    const btnTodos = /<button[^>]*>Todos contra todos<\/button>/.exec(html)?.[0] ?? ''
    expect(btnGrupos).toContain('bg-accent')
    expect(btnTodos).not.toContain('bg-accent')
  })
})
