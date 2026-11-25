import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { defaultConfig, type Award, type DisciplineId, type PlayedMatchday, type Side } from '@/core'
import type { DisciplineHeader, EntryRow } from '@/db/read'
import { vi } from 'vitest'

/**
 * Task 1 (`docs/plan-arquitectura-de-paginas.md`): antes esta pantalla vivía
 * en `/torneo/{id}/stats`, leía `entriesOf`/`closedHistoryAll`/`awardsOf` sin
 * disciplina y caía siempre en `defaultDisciplineId` — con 2+ disciplinas
 * mostraba SIEMPRE la `[0]`, sin decirlo. Esta suite prueba lo que un test
 * que sólo comprueba que la pantalla renderiza no prueba: que navegar a
 * `{disciplina}/stats` con la SEGUNDA disciplina de la temporada trae los
 * datos de esa disciplina, no los de la primera.
 *
 * Mismo techo que `[disciplina]/fechas/[n]/page.unit.test.ts`: server
 * component `async` llamado directo y `renderToStaticMarkup` — sin DOM, sin
 * jsdom (`docs/estado.md`, "jsdom está para UN caso").
 */

const D_PADEL = 'd-padel' as DisciplineId
const D_FIFA = 'd-fifa' as DisciplineId

function side(entryId: string): Side {
  return { size: 1, a: entryId }
}

function header(): DisciplineHeader[] {
  const shape = { weight: 1, pairSize: 1 as const, hasMasters: false, allowsDraw: false, formatoDefault: { kind: 'ROUND_ROBIN' as const } }
  return [
    { id: D_PADEL, kind: 'PADEL', config: defaultConfig(2, 1), ...shape },
    { id: D_FIFA, kind: 'FIFA', config: defaultConfig(2, 1), ...shape },
  ]
}

function squadOf(prefix: 'p' | 'f'): EntryRow[] {
  return [
    { id: `${prefix}1`, displayName: `${prefix === 'p' ? 'Padel' : 'Fifa'} Uno`, kind: 'SQUAD', seedPosition: 0, playerId: null, matchdayId: null },
    { id: `${prefix}2`, displayName: `${prefix === 'p' ? 'Padel' : 'Fifa'} Dos`, kind: 'SQUAD', seedPosition: 1, playerId: null, matchdayId: null },
  ]
}

/** Dos fechas cerradas jugadas entre los dos miembros de `prefix`, para pasar `MIN_CLOSED_MATCHDAYS_FOR_STATS`. */
function historyOf(prefix: 'p' | 'f'): PlayedMatchday[] {
  const a = `${prefix}1`
  const b = `${prefix}2`
  const matchday = (number: number): PlayedMatchday => ({
    number,
    sides: [side(a), side(b)],
    matches: [{ round: 1, fase: 'GRUPO', grupo: 1, sideA: side(a), sideB: side(b), sets: [{ gamesA: 4, gamesB: 0 }] }],
  })
  return [matchday(1), matchday(2)]
}

/** El primer miembro de `prefix` sale campeón las dos fechas -- "Racha más larga" lo nombra a él. */
function awardsOf(prefix: 'p' | 'f'): Map<number, Award[]> {
  const champion = `${prefix}1`
  const runnerUp = `${prefix}2`
  const forMatchday: Award[] = [
    { entryId: champion, position: 1, points: 10, lines: [] },
    { entryId: runnerUp, position: 2, points: 5, lines: [] },
  ]
  return new Map([
    [1, forMatchday],
    [2, forMatchday],
  ])
}

vi.mock('next/navigation', async (importOriginal) => {
  const real = await importOriginal<typeof import('next/navigation')>()
  return { ...real, notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }) }
})

vi.mock('@/db/server', () => ({
  serverClient: async () => ({}),
}))

// `fixedTeams` decide si "Mejor dupla" tiene sentido (parejas que rotan); lo lee
// `disciplineConfig`, no el header. Acá: parejas que rotan.
vi.mock('@/db/discipline', () => ({
  disciplineConfig: async () => ({ fixedTeams: false }),
}))

vi.mock('@/db/read', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/db/read')>()
  return {
    ...real,
    seasonHeader: async () => ({
      id: 's1',
      name: 'Torneo de prueba',
      status: 'ACTIVE',
      regularMatchdays: 10,
      isAdmin: false,
      inviteToken: 'token',
      disciplines: header(),
    }),
    // `vi.fn` para que un caso pueda pisar UNA lectura con
    // `mockResolvedValueOnce` (quién mira, cuántas fechas cerraron) sin tocar
    // el fixture del resto de la suite.
    myEntryId: vi.fn(async () => null),
    // Las tres lecturas devuelven algo DISTINTO según qué `disciplineId`
    // reciban -- si la pantalla dejara de pasarlo (o volviera a
    // `defaultDisciplineId`), las tres caerían al `else` de Pádel sin
    // importar el slug de la URL, y las aserciones de más abajo se rompen.
    entriesOf: async (_supabase: unknown, _seasonId: string, disciplineId?: DisciplineId) =>
      disciplineId === D_FIFA ? squadOf('f') : squadOf('p'),
    closedHistoryAll: vi.fn(async (_supabase: unknown, _seasonId: string, disciplineId?: DisciplineId) =>
      disciplineId === D_FIFA ? historyOf('f') : historyOf('p')),
    awardsOf: async (_supabase: unknown, _seasonId: string, disciplineId?: DisciplineId) =>
      disciplineId === D_FIFA ? awardsOf('f') : awardsOf('p'),
  }
})

async function render(disciplina: string, tab?: string): Promise<string> {
  const { default: StatsPage } = await import('./page')
  return renderToStaticMarkup(
    await StatsPage({
      params: Promise.resolve({ id: 's1', disciplina }),
      searchParams: Promise.resolve(tab === undefined ? {} : { tab }),
    }),
  )
}

/** El `<a>` entero (apertura, contenido, cierre) cuyo texto visible es `text`. */
function linkWith(html: string, text: string): string | undefined {
  return html.match(new RegExp(`<a [^>]*>(?:(?!</a>).)*?${text}(?:(?!</a>).)*?</a>`))?.[0]
}

describe('Stats trae los datos de la disciplina de la URL, no la [0] de la temporada', () => {
  it('con el slug de la SEGUNDA disciplina (fifa), muestra sus jugadores y su campeón de racha', async () => {
    const html = await render('fifa')

    expect(html).toContain('Fifa Uno')
    expect(html).toContain('Fifa Dos')
    expect(html).not.toContain('Padel Uno')
    expect(html).not.toContain('Padel Dos')
  })

  it('con el slug de la PRIMERA disciplina (padel), muestra sus jugadores, no los de fifa', async () => {
    const html = await render('padel')

    expect(html).toContain('Padel Uno')
    expect(html).toContain('Padel Dos')
    expect(html).not.toContain('Fifa Uno')
    expect(html).not.toContain('Fifa Dos')
  })

  it('con 2+ disciplinas, el título dice cuál está mostrando', async () => {
    const htmlFifa = await render('fifa')
    const htmlPadel = await render('padel')

    expect(htmlFifa).toContain('Estadísticas · FIFA')
    expect(htmlPadel).toContain('Estadísticas · Pádel')
  })

  it('un slug de disciplina desconocido da notFound(), no la [0] por defecto', async () => {
    const { notFound } = await import('next/navigation')

    await expect(render('handball')).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
  })
})

describe('Stats habla con la unidad y las palabras del deporte', () => {
  it('FIFA de a uno: cuenta goles y no tiene "Mejor dupla del torneo"', async () => {
    const html = await render('fifa')

    expect(html).toContain('Goles totales')
    expect(html).not.toContain('Games totales')
    expect(html).not.toContain('Mejor dupla del torneo')
  })

  it('pádel: sigue contando games', async () => {
    const html = await render('padel')

    expect(html).toContain('Games totales')
    expect(html).not.toContain('Goles totales')
  })
})

describe('Stats: el encabezado y el control General/Mías', () => {
  it('Volver nombra su destino: con 2+ deportes, la Tabla general', async () => {
    const html = await render('padel')

    const volver = linkWith(html, 'Tabla general')
    expect(volver).toContain('href="/torneo/s1"')
  })

  it('General y Mías son links a la misma pantalla; el encendido lleva aria-current="page"', async () => {
    const general = await render('padel')
    expect(linkWith(general, 'General')).toContain('href="/torneo/s1/padel/stats"')
    expect(linkWith(general, 'General')).toContain('aria-current="page"')
    expect(linkWith(general, 'Mías')).toContain('href="/torneo/s1/padel/stats?tab=mias"')
    expect(linkWith(general, 'Mías')).not.toContain('aria-current')

    const mias = await render('padel', 'mias')
    expect(linkWith(mias, 'Mías')).toContain('aria-current="page"')
    expect(linkWith(mias, 'General')).not.toContain('aria-current')
  })
})

describe('Stats: lo tuyo y los links al perfil', () => {
  it('tu fila en los rankings dice "vos"; la de otro, no', async () => {
    const { myEntryId } = await import('@/db/read')
    vi.mocked(myEntryId).mockResolvedValueOnce('p1')

    const html = await render('padel')

    const rows = html.match(/<li[^>]*>(?:(?!<\/li>).)*<\/li>/g) ?? []
    const mine = rows.filter((row) => row.includes('Padel Uno'))
    const theirs = rows.filter((row) => row.includes('Padel Dos'))
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.every((row) => />vos</.test(row))).toBe(true)
    expect(theirs.some((row) => />vos</.test(row))).toBe(false)
  })

  it('los perfiles se abren sabiendo de dónde vinieron (?desde=stats), para que su Volver diga Estadísticas', async () => {
    const html = await render('padel')

    expect(html).toContain('href="/torneo/s1/padel/jugador/p1?desde=stats"')
    expect(html).toContain('href="/torneo/s1/padel/jugador/p2?desde=stats"')
    expect(html).not.toMatch(/jugador\/p[12]"/)
  })

  it('Mías muestra tus puntos por fecha', async () => {
    const { myEntryId } = await import('@/db/read')
    vi.mocked(myEntryId).mockResolvedValueOnce('p1')

    const html = await render('padel', 'mias')

    expect(html).toContain('Tus puntos por fecha')
    expect(html).toContain('Puntos por fecha: fecha 1, 10; fecha 2, 10')
  })

  it('Mías sin partidos jugados invita a ir a las fechas', async () => {
    const html = await render('padel', 'mias')

    expect(html).toContain('Todavía no jugaste')
    expect(linkWith(html, 'Ir a las fechas')).toContain('href="/torneo/s1/padel/fechas"')
  })
})

describe('Stats sin fechas suficientes', () => {
  it('con 1 fecha cerrada dice cuánto falta y lleva a las fechas', async () => {
    const { closedHistoryAll } = await import('@/db/read')
    vi.mocked(closedHistoryAll).mockResolvedValueOnce(historyOf('p').slice(0, 1))

    const html = await render('padel')

    expect(html).toContain('Estadísticas · Pádel')
    expect(html).toContain('Falta 1 fecha')
    expect(linkWith(html, 'Ir a las fechas')).toContain('href="/torneo/s1/padel/fechas"')
  })
})
