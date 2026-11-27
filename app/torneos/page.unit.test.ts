import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig, type Award, type DisciplineId, type EntryId } from '@/core'
import type { AmigoInicio } from '@/db/inicio'
import { amigosDeInicio, pedidosRecibidos } from '@/db/inicio'
import { genteDeTusTorneos, type GenteDeTorneo } from '@/db/friends'
import {
  attendancesOf,
  entriesOf,
  matchdayDetail,
  myEntryId,
  mySeasons,
  seasonAwardsOf,
  seasonMatchdaysOf,
  seasonSquadOf,
  type DisciplineHeader,
  type EntryRow,
  type MatchdaySummary,
  type MatchWithId,
  type SeasonHeader,
} from '@/db/read'

/**
 * Inicio (`/torneos`): las dos partes del S4 -- tus torneos y tus amigos --
 * con la fecha más cercana arriba. Mismo patrón que
 * `app/torneo/[id]/page.unit.test.ts`: server component `async` llamado
 * directo + `renderToStaticMarkup`, lecturas mockeadas.
 *
 * El primer caso viene de antes (docs/tipos-de-torneo.md §2.4): tu puesto en
 * la tarjeta es `row.position` de `computeGlobalRanking`, compartido entre
 * empatados, no un índice de array. Con `index + 1` este test queda en ROJO.
 */

const D_PADEL = 'd-padel' as DisciplineId

function header(over: Partial<SeasonHeader> = {}): SeasonHeader {
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
    playersCanScore: false,
    inviteToken: 'token',
    disciplines: [discipline],
    ...over,
  }
}

function matchday(over: Partial<MatchdaySummary> = {}): MatchdaySummary {
  return {
    id: 'md1',
    number: 1,
    kind: 'REGULAR',
    status: 'CLOSED',
    playedOn: null,
    disciplineId: D_PADEL,
    allowsDraw: false,
    formato: { kind: 'ROUND_ROBIN' },
    matchFormat: null,
    ...over,
  }
}

function award(entryId: string, points: number): Award {
  return { entryId, position: 1, points, lines: [] }
}

function partido(id: string, cargado: boolean): MatchWithId {
  return {
    id,
    fase: 'GRUPO',
    grupo: 0,
    sideA: { kind: 'SINGLE', entry: 'e1' as EntryId },
    sideB: { kind: 'SINGLE', entry: 'e2' as EntryId },
    sets: cargado ? [{ gamesA: 6, gamesB: 4 }] : [],
  } as unknown as MatchWithId
}

function squad(id: string): EntryRow {
  return { id, displayName: id, kind: 'SQUAD', seedPosition: 0, playerId: null, matchdayId: null }
}

const NICO: AmigoInicio = {
  playerId: 'p-nico',
  displayName: 'Nico Arias',
  contra: { won: 7, lost: 5, drew: 0 },
  juntos: { won: 0, lost: 0, drew: 0 },
  ultimo: {
    kind: 'casual',
    matchId: 'c1',
    playedOn: '2026-11-18',
    sport: 'PADEL',
    together: false,
    partners: [],
    rivals: ['Nico Arias'],
    outcome: 'won',
    score: null,
    teams: { mine: null, theirs: null },
    sets: [
      { mine: 6, theirs: 4 },
      { mine: 6, theirs: 3 },
    ],
    createdBy: 'Yo',
    updatedBy: 'Yo',
    createdById: 'p',
    updatedById: 'p',
  },
}

vi.mock('@/db/server', () => ({
  serverClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    rpc: async () => ({ data: 'p-yo' }),
  }),
}))

vi.mock('@/db/inicio', () => ({ amigosDeInicio: vi.fn(async () => []), pedidosRecibidos: vi.fn(async () => []) }))

vi.mock('@/db/friends', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/db/friends')>()
  return { ...real, genteDeTusTorneos: vi.fn(async () => []), friendsOf: vi.fn(async () => []) }
})

vi.mock('@/app/amigos/actions', () => ({
  agregarAmigo: vi.fn(),
  aceptarPedidoDe: vi.fn(),
  rechazarPedidoDe: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

vi.mock('@/db/read', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/db/read')>()
  return {
    ...real,
    mySeasons: vi.fn(async () => [header()]),
    seasonSquadOf: vi.fn(async () => ['e1', 'e2']),
    seasonMatchdaysOf: vi.fn(async () => [matchday()]),
    seasonAwardsOf: vi.fn(async () => new Map([[D_PADEL, new Map([[1, [award('e1', 5), award('e2', 5)]]])]])),
    myEntryId: vi.fn(async () => 'e1'),
    playerNames: vi.fn(async () => new Map([['p-yo', 'Martín Paz']])),
    matchdayDetail: vi.fn(),
    entriesOf: vi.fn(async () => []),
    attendancesOf: vi.fn(async () => new Map()),
  }
})

beforeEach(() => {
  vi.mocked(mySeasons).mockResolvedValue([header()])
  vi.mocked(seasonMatchdaysOf).mockResolvedValue([matchday()])
  vi.mocked(amigosDeInicio).mockResolvedValue([])
  vi.mocked(genteDeTusTorneos).mockClear().mockResolvedValue([])
  vi.mocked(pedidosRecibidos).mockClear().mockResolvedValue([])
})

async function render(): Promise<string> {
  const { default: InicioPage } = await import('./page')
  return renderToStaticMarkup(await InicioPage())
}

/** El `<a>` (con todo lo de adentro) que va a `href`. */
function linkA(html: string, href: string): string | null {
  const start = html.indexOf(`href="${href}"`)
  if (start === -1) return null
  const open = html.lastIndexOf('<a', start)
  return html.slice(open, html.indexOf('</a>', start) + 4)
}

describe('Inicio, tus torneos', () => {
  // El viewer es e2 A PROPÓSITO, no e1: e1 queda primero en el orden interno
  // de `computeGlobalRanking` (arrival order), así que con e1 como viewer
  // `index + 1` (1) y `position` (1) coinciden por casualidad y el test no
  // discrimina nada. Con e2 (segundo del empate), el bug viejo mostraría "2°"
  // (`index + 1`) y el correcto muestra "1°" (`position`, compartido con e1).
  it('con e1 y e2 en 5 puntos, el viewer (e2) ve el puesto 1, no 2', async () => {
    vi.mocked(myEntryId).mockResolvedValueOnce('e2' as EntryId)
    vi.mocked(seasonSquadOf).mockResolvedValueOnce(['e1', 'e2'] as EntryId[])
    vi.mocked(seasonAwardsOf).mockResolvedValueOnce(
      new Map([[D_PADEL, new Map([[1, [award('e1', 5), award('e2', 5)]]])]]),
    )

    const html = await render()
    expect(linkA(html, '/torneo/s1')).toMatch(/aria-label="Torneo de prueba, Pádel, vas 1° de 2, Fecha 2 de 10"/)
    // El bloque toma el color de su deporte.
    expect(html).toMatch(/<li data-deporte="PADEL"[^>]*><a[^>]*href="\/torneo\/s1"/)
  })

  it('un torneo terminado queda a mano, en "Terminados"', async () => {
    vi.mocked(mySeasons).mockResolvedValueOnce([header(), header({ id: 's9', name: 'El del verano', status: 'FINISHED' })])
    const html = await render()
    expect(html).toMatch(/<h2[^>]*>Terminados<\/h2>/)
    expect(linkA(html, '/torneo/s9')).toContain('El del verano')
  })

  it('crear torneo y torneo rápido, siempre', async () => {
    const html = await render()
    expect(linkA(html, '/torneos/nuevo')).toContain('Crear torneo')
    expect(linkA(html, '/rapido')).toContain('Torneo rápido')
  })
})

describe('Inicio, la fecha de arriba', () => {
  it('una fecha en juego: el torneo, "Fecha N", el día, cuántos partidos faltan y el link', async () => {
    vi.mocked(seasonMatchdaysOf).mockResolvedValueOnce([
      matchday(),
      matchday({ id: 'md2', number: 2, status: 'OPEN', playedOn: '2026-11-18' }),
    ])
    vi.mocked(matchdayDetail).mockResolvedValueOnce({
      matchday: matchday({ id: 'md2', number: 2, status: 'OPEN' }),
      sides: [],
      matches: [partido('a', true), partido('b', false), partido('c', false)],
      guestIds: [],
    })
    const html = await render()
    const hero = html.slice(html.indexOf('<header'), html.indexOf('</header>'))
    expect(hero).toContain('Torneo de prueba')
    expect(hero).toMatch(/<h1[^>]*>Fecha 2<\/h1>/)
    expect(hero).toContain('Miércoles 18 nov')
    expect(hero).toContain('En juego')
    expect(hero).toContain('Faltan 2 partidos')
    expect(linkA(hero, '/torneo/s1/padel/fechas/2')).toContain('Ver la fecha')
  })

  it('una fecha armándose: los confirmados de la lista, sin inventar parejas', async () => {
    vi.mocked(seasonMatchdaysOf).mockResolvedValueOnce([matchday({ id: 'md2', number: 2, status: 'DRAFT' })])
    vi.mocked(entriesOf).mockResolvedValueOnce([squad('e1'), squad('e2'), squad('e3')])
    vi.mocked(attendancesOf).mockResolvedValueOnce(new Map([['e3' as EntryId, 'ABSENT' as const]]))
    const html = await render()
    const hero = html.slice(html.indexOf('<header'), html.indexOf('</header>'))
    expect(hero).toContain('2 de 3')
    expect(hero).toContain('confirmados')
    expect(hero).toContain('Parejas sin sortear')
    expect(hero).not.toContain('Faltan')
  })

  it('sin ninguna fecha viva, el bloque no inventa una', async () => {
    const html = await render()
    expect(html).not.toContain('Ver la fecha')
  })
})

describe('Inicio, cargar partido', () => {
  const abierta = () => [matchday({ id: 'md2', number: 2, status: 'OPEN', playedOn: '2026-11-18' })]
  const detalle = () => ({ matchday: abierta()[0]!, sides: [], matches: [], guestIds: [] })

  it('ofrece la fecha en juego si podés cargar, y cada amigo con su hoja ya abierta', async () => {
    vi.mocked(mySeasons).mockResolvedValueOnce([header({ playersCanScore: true })])
    vi.mocked(seasonMatchdaysOf).mockResolvedValueOnce(abierta())
    vi.mocked(matchdayDetail).mockResolvedValueOnce(detalle())
    vi.mocked(amigosDeInicio).mockResolvedValueOnce([NICO])
    const html = await render()
    const hoja = html.slice(html.indexOf('<dialog'), html.indexOf('</dialog>'))
    expect(html).toMatch(/<button[^>]*>.*Cargar partido<\/button>/)
    expect(linkA(hoja, '/torneo/s1/padel/fechas/2')).toContain('Torneo de prueba')
    expect(linkA(hoja, '/amigos/p-nico?cargar=1')).toContain('Nico Arias')
    expect(linkA(hoja, '/amigos')).toContain('Ver todos')
  })

  it('en la hoja van hasta seis amigos, en el orden de Inicio (el más reciente primero)', async () => {
    const amigos = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => ({ ...NICO, playerId: `p-${id}`, displayName: id.toUpperCase() }))
    vi.mocked(amigosDeInicio).mockResolvedValueOnce(amigos)
    const html = await render()
    const hoja = html.slice(html.indexOf('<dialog'), html.indexOf('</dialog>'))
    const hrefs = [...hoja.matchAll(/href="\/amigos\/(p-[a-z])\?cargar=1"/g)].map((m) => m[1])
    expect(hrefs).toEqual(['p-a', 'p-b', 'p-c', 'p-d', 'p-e', 'p-f'])
  })

  it('sin permiso para cargar, esa fecha no está en la hoja', async () => {
    vi.mocked(seasonMatchdaysOf).mockResolvedValueOnce(abierta())
    vi.mocked(matchdayDetail).mockResolvedValueOnce(detalle())
    const html = await render()
    const hoja = html.slice(html.indexOf('<dialog'), html.indexOf('</dialog>'))
    expect(hoja).not.toContain('/torneo/s1/padel/fechas/2')
  })
})

describe('Inicio, amigos', () => {
  it('cada amigo con su último resultado y el cara a cara, y la fila va a su historial', async () => {
    vi.mocked(amigosDeInicio).mockResolvedValueOnce([NICO])
    const fila = linkA(await render(), '/amigos/p-nico')
    expect(fila).toContain('Nico Arias')
    expect(fila).toContain('Ganaste 6-4 6-3')
    expect(fila).toContain('mié 18 nov')
    expect(fila).toMatch(/aria-label="Historial: ganaste 7, perdiste 5"/)
  })

  it('sin amigos ni nadie para sugerir, la sección invita a sumar uno', async () => {
    const html = await render()
    expect(html).toMatch(/<h2[^>]*>Amigos<\/h2>/)
    expect(linkA(html, '/amigos')).toContain('Sumá un amigo')
  })

  const gente = (n: number): GenteDeTorneo[] =>
    Array.from({ length: n }, (_, i) => ({
      playerId: `p-${i}`,
      displayName: `Persona ${i}`,
      seasonIds: ['s-martes'],
      torneos: ['Los Pibes del Martes'],
      fechasJuntos: 7 - i,
    }))

  it('sin amigos, empieza por la gente de tus torneos: las dos primeras con "Agregar" y "Ver más gente" a /amigos/gente', async () => {
    vi.mocked(genteDeTusTorneos).mockResolvedValueOnce(gente(3))
    const html = await render()
    const amigos = html.slice(html.search(/<h2[^>]*>Amigos<\/h2>/))
    expect(amigos).toContain('Empezá por la gente de tus torneos')
    expect(amigos).toContain('Persona 0')
    // S11: sin fechas (antes "Los Pibes del Martes · 7 fechas").
    expect(amigos).toContain('Los Pibes del Martes</span>')
    expect(amigos).not.toContain('fechas')
    expect(amigos).toContain('Persona 1')
    expect(amigos).not.toContain('Persona 2')
    expect(amigos).toContain('aria-label="Agregar a Persona 0"')
    expect(linkA(amigos, '/amigos/gente')).toContain('Ver más gente')
    expect(linkA(amigos, '/amigos')).toBeNull()
    expect(html).not.toContain('Sumá un amigo')
  })

  it('con amigos, Inicio no sugiere a nadie ni lee la gente de tus torneos', async () => {
    vi.mocked(amigosDeInicio).mockResolvedValueOnce([NICO])
    const html = await render()
    expect(genteDeTusTorneos).not.toHaveBeenCalled()
    expect(html).not.toContain('Empezá por la gente de tus torneos')
    // Sin pedidos, la sección queda como antes: ningún pedido resaltado.
    expect(html).not.toContain('Te pidió ser amigos')
    expect(html).not.toContain('bg-sport-tint px-4')
    expect(linkA(html, '/amigos')).toContain('Ver todos')
    expect(linkA(html, '/amigos/p-nico')).toContain('Nico Arias')
  })
})

// odd/tasks/amigos-faciles.md, T3, S4: los pedidos que te hicieron, arriba de tus amigos.
describe('Inicio, pedidos de amistad', () => {
  const JUAMPI = { playerId: 'p-juampi', displayName: 'Juampi Ledesma', torneos: ['Los Pibes del Martes'] }
  const amigosDe = (html: string) => html.slice(html.search(/<h2[^>]*>Amigos<\/h2>/))

  it('con amigos: el pedido va primero, resaltado, con de dónde, Aceptar y ✕', async () => {
    vi.mocked(amigosDeInicio).mockResolvedValueOnce([NICO])
    vi.mocked(pedidosRecibidos).mockResolvedValueOnce([JUAMPI])
    const amigos = amigosDe(await render())
    expect(amigos.indexOf('Juampi Ledesma')).toBeGreaterThan(-1)
    expect(amigos.indexOf('Juampi Ledesma')).toBeLessThan(amigos.indexOf('Nico Arias'))
    expect(amigos).toContain('Te pidió ser amigos · Los Pibes del Martes')
    expect(amigos).toMatch(/<li[^>]*bg-sport-tint[^>]*>/)
    expect(amigos).toMatch(/<button[^>]*>Aceptar<\/button>/)
    expect(amigos).toContain('aria-label="Rechazar el pedido de Juampi"')
  })

  it('sin amigos: el pedido igual se ve, antes de la gente de tus torneos', async () => {
    vi.mocked(pedidosRecibidos).mockResolvedValueOnce([{ ...JUAMPI, torneos: [] }])
    vi.mocked(genteDeTusTorneos).mockResolvedValueOnce([
      { playerId: 'p-seba', displayName: 'Seba Molina', seasonIds: ['s-a'], torneos: ['A'], fechasJuntos: 2 },
    ])
    const amigos = amigosDe(await render())
    expect(amigos).toContain('Te pidió ser amigos')
    expect(amigos).not.toContain('Te pidió ser amigos ·')
    expect(amigos.indexOf('Juampi Ledesma')).toBeLessThan(amigos.indexOf('Empezá por la gente de tus torneos'))
    expect(amigos).toContain('Seba Molina')
  })

  // S11: los torneos compartidos con el formato de toda la app.
  it('con dos torneos compartidos: "Te pidió ser amigos · Los Pibes del Martes y Copa del Jueves"', async () => {
    vi.mocked(amigosDeInicio).mockResolvedValueOnce([NICO])
    vi.mocked(pedidosRecibidos).mockResolvedValueOnce([{ ...JUAMPI, torneos: ['Los Pibes del Martes', 'Copa del Jueves'] }])
    const amigos = amigosDe(await render())
    expect(amigos).toContain('Te pidió ser amigos · Los Pibes del Martes y Copa del Jueves')
    expect(amigos).not.toContain('y 1 más')
  })

  it('las amistades se leen una vez y se comparten entre amigos y pedidos', async () => {
    const { friendsOf } = await import('@/db/friends')
    vi.mocked(friendsOf).mockClear()
    await render()
    expect(friendsOf).toHaveBeenCalledTimes(1)
    const leidas = await vi.mocked(friendsOf).mock.results[0]?.value
    expect(vi.mocked(amigosDeInicio).mock.lastCall?.[1]).toBe(leidas)
    expect(vi.mocked(pedidosRecibidos).mock.lastCall?.[1]).toBe(leidas)
  })
})

describe('Inicio vacío', () => {
  it('sin torneos: el bloque invita a crear uno y no hay "Terminados"', async () => {
    vi.mocked(mySeasons).mockResolvedValueOnce([])
    const html = await render()
    const hero = html.slice(html.indexOf('<header'), html.indexOf('</header>'))
    expect(linkA(hero, '/torneos/nuevo')).toContain('Crear torneo')
    expect(html).not.toContain('Terminados')
  })

  it('sin fechas para cargar ni amigos, no hay "Cargar partido": no tendría a dónde llevar', async () => {
    vi.mocked(mySeasons).mockResolvedValueOnce([])
    expect(await render()).not.toContain('Cargar partido')
  })

  it('el menú de cuenta está arriba, con tu nombre', async () => {
    const html = await render()
    expect(html).toMatch(/aria-label="Tu cuenta, Martín Paz"/)
  })
})
