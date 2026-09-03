import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { defaultConfig, type Award, type DisciplineId, type PlayedMatchday, type Side } from '@/core'
import type { DisciplineHeader, EntryRow, SquadMember } from '@/db/read'
import { vi } from 'vitest'

/**
 * Task 2 (`docs/plan-arquitectura-de-paginas.md`): antes esta pantalla vivía
 * en `/torneo/{id}/jugador/{entryId}`, leía `entriesOf`/`closedHistoryAll`/
 * `awardsOf` sin disciplina y sacaba `config` de `primaryDiscipline(header)`
 * — con pádel y FIFA en el mismo torneo, un jugador que jugaba las dos
 * disciplinas veía SIEMPRE las estadísticas de pádel, entrara por donde
 * entrara. Esta suite prueba lo que un test que sólo comprueba que la
 * pantalla renderiza no prueba: que el MISMO `entryId` navegado desde
 * `{disciplina}/jugador/{entryId}` trae las estadísticas de ESA disciplina,
 * no de la `[0]` de la temporada.
 *
 * `e1` es socio de las dos disciplinas del fixture y sale CAMPEÓN en pádel
 * (100% efectividad, 1°, 20 puntos) y SUBCAMPEÓN en fifa (0% efectividad,
 * 2°, 5 puntos) — si la pantalla dejara de pasar `disciplineId` a
 * `entriesOf`/`closedHistoryAll`, las dos URLs mostrarían el mismo pádel y
 * las aserciones de abajo se rompen.
 *
 * CUATRO reversiones puntuales tienen que romper esta suite, no sólo
 * "sacarle `discipline.id` a las tres lecturas" — quedó verificado corriendo
 * cada una (fix round 1, jd-judge):
 *
 * 1. `entriesOf`/`closedHistoryAll` sin `discipline.id` → los nombres
 *    ("Fifa Uno") lo agarran.
 * 2. `awardsOf` sin `discipline.id`, sola — invisible para los nombres y el
 *    `%` (vienen de `closedHistoryAll`, no de acá). Fifa usa `countBestOf: 1`
 *    (pádel usa el default, 8): con los puntajes de PÁDEL pero el
 *    `countBestOf` de FIFA, la posición/puntos de e1 en fifa salen
 *    "1° de 2 · 10 puntos" en vez de "2° de 2 · 5 puntos" — lo agarran las
 *    aserciones de posición/puntos.
 * 3. `config` vuelve a `primaryDiscipline(header).config` entero — con el
 *    `countBestOf` de PÁDEL (8, cuenta las dos fechas) pero los puntajes de
 *    FIFA, e1 sale "2° de 2 · 10 puntos" en vez de "2° de 2 · 5 puntos" —
 *    mismas aserciones, puntos distintos.
 * 4. SÓLO `config.regularMatchdays` vuelve a `header.regularMatchdays` (el
 *    resto de `config` queda bien). Invisible para nombres/%/puntos: sólo
 *    afecta a qué fecha se arma el snapshot de desempate
 *    (`snapshotForMatchday`), y ESE sólo decide algo cuando hay un empate en
 *    puntos (`core/order.ts`, `orderByPoints`: el snapshot es el segundo
 *    criterio, después de los puntos). El test dedicado de más abajo arma
 *    ese empate a propósito — es el único caso de los cuatro que necesita su
 *    propio fixture en vez de reusar `e1`/`e2`.
 *
 * Mismo techo que `[disciplina]/stats/page.unit.test.ts`: server component
 * `async` llamado directo y `renderToStaticMarkup` — sin DOM, sin jsdom
 * (`docs/estado.md`, "jsdom está para UN caso").
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
    // `countBestOf: 1` (pádel se queda con el default, 8) -- observable
    // sólo si la pantalla usa ESTE `config`, no el de pádel: con dos fechas
    // de 5 y 5 puntos, contar sólo la mejor 1 da 5, contar las dos da 10.
    { id: D_FIFA, kind: 'FIFA', config: { ...defaultConfig(2, 1), countBestOf: 1 }, ...shape },
  ]
}

/** El plantel de LA TEMPORADA (`seasonSquadMembersOf`) — no cambia con la disciplina. `e3` es socio del torneo pero de NINGUNA disciplina, para el caso "todavía no jugó". */
function containerSquad(): SquadMember[] {
  return [
    { id: 'e1', displayName: 'Nombre de contenedor, no se muestra', playerId: null },
    { id: 'e2', displayName: 'Nombre de contenedor, no se muestra', playerId: null },
    { id: 'e3', displayName: 'Jugador Fantasma', playerId: null },
  ]
}

/** `e1` y `e2` juegan esta disciplina — nombres distintos por disciplina para poder distinguir en el HTML cuál trajo la pantalla. */
function squadOf(prefix: 'p' | 'f'): EntryRow[] {
  return [
    { id: 'e1', displayName: prefix === 'p' ? 'Padel Uno' : 'Fifa Uno', kind: 'SQUAD', seedPosition: 0, playerId: null, matchdayId: null },
    { id: 'e2', displayName: prefix === 'p' ? 'Padel Dos' : 'Fifa Dos', kind: 'SQUAD', seedPosition: 1, playerId: null, matchdayId: null },
  ]
}

/** Dos fechas cerradas — `e1` gana las dos en pádel, las pierde las dos en fifa. */
function historyOf(prefix: 'p' | 'f'): PlayedMatchday[] {
  const winner = prefix === 'p' ? 'e1' : 'e2'
  const loser = prefix === 'p' ? 'e2' : 'e1'
  const matchday = (number: number): PlayedMatchday => ({
    number,
    sides: [side('e1'), side('e2')],
    matches: [{ round: 1, fase: 'GRUPO', grupo: 1, sideA: side(winner), sideB: side(loser), sets: [{ gamesA: 4, gamesB: 0 }] }],
  })
  return [matchday(1), matchday(2)]
}

/** `e1` sale campeón las dos fechas en pádel, subcampeón las dos en fifa — mismo criterio que `historyOf`. */
function awardsOf(prefix: 'p' | 'f'): Map<number, Award[]> {
  const champion = prefix === 'p' ? 'e1' : 'e2'
  const runnerUp = prefix === 'p' ? 'e2' : 'e1'
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

// Las cuatro lecturas van envueltas en `vi.fn` (no funciones async sueltas):
// el test de la fecha activa (más abajo) necesita pisarlas UNA vez con
// `mockResolvedValueOnce` para armar un empate de puntos sin tocar el
// fixture compartido del resto de la suite.
vi.mock('@/db/read', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/db/read')>()
  return {
    ...real,
    seasonHeader: vi.fn(async () => ({
      id: 's1',
      name: 'Torneo de prueba',
      status: 'ACTIVE',
      regularMatchdays: 10,
      isAdmin: false,
      inviteToken: 'token',
      disciplines: header(),
    })),
    seasonSquadMembersOf: vi.fn(async () => containerSquad()),
    // Las tres lecturas devuelven algo DISTINTO según qué `disciplineId`
    // reciban -- si la pantalla dejara de pasarlo, las tres caerían al
    // `else` de pádel sin importar el slug de la URL.
    entriesOf: vi.fn(async (_supabase: unknown, _seasonId: string, disciplineId?: DisciplineId) =>
      disciplineId === D_FIFA ? squadOf('f') : squadOf('p')),
    closedHistoryAll: vi.fn(async (_supabase: unknown, _seasonId: string, disciplineId?: DisciplineId) =>
      disciplineId === D_FIFA ? historyOf('f') : historyOf('p')),
    awardsOf: vi.fn(async (_supabase: unknown, _seasonId: string, disciplineId?: DisciplineId) =>
      disciplineId === D_FIFA ? awardsOf('f') : awardsOf('p')),
  }
})

async function render(disciplina: string, entryId = 'e1'): Promise<string> {
  const { default: JugadorPage } = await import('./page')
  return renderToStaticMarkup(
    await JugadorPage({
      params: Promise.resolve({ id: 's1', disciplina, entryId }),
    }),
  )
}

describe('Jugador trae las estadísticas de la disciplina de la URL, no la [0] de la temporada', () => {
  it('con el slug de PADEL, el mismo entryId (e1) sale campeón: 1° con 20 puntos, 100% de efectividad, no los datos de fifa', async () => {
    const html = await render('padel')

    expect(html).toContain('Padel Uno')
    expect(html).not.toContain('Fifa Uno')
    expect(html).toContain('100%')
    expect(html).toContain('1° de 2 · 20 puntos')
  })

  it('con el slug de FIFA, el MISMO entryId (e1) sale subcampeón: 2° con 5 puntos (countBestOf de FIFA, no el de pádel), 0% de efectividad', async () => {
    const html = await render('fifa')

    expect(html).toContain('Fifa Uno')
    expect(html).not.toContain('Padel Uno')
    expect(html).toContain('0%')
    expect(html).not.toContain('100%')
    expect(html).toContain('2° de 2 · 5 puntos')
  })

  it('con 2+ disciplinas, el nombre dice cuál está mostrando', async () => {
    const htmlFifa = await render('fifa')
    const htmlPadel = await render('padel')

    expect(htmlFifa).toContain('Fifa Uno · FIFA')
    expect(htmlPadel).toContain('Padel Uno · Pádel')
  })

  it('un socio del torneo que no juega ESTA disciplina dice cuál le falta, no un genérico "esta disciplina"', async () => {
    const html = await render('padel', 'e3')

    expect(html).toContain('Jugador Fantasma')
    expect(html).toContain('Todavía no jugó Pádel')
  })

  it('un slug de disciplina desconocido da notFound(), no la [0] por defecto', async () => {
    const { notFound } = await import('next/navigation')

    await expect(render('handball')).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
  })

  it('la fecha activa del snapshot de desempate sale de `discipline.config.regularMatchdays`, no de `header.regularMatchdays`', async () => {
    // Fixture APARTE (no `e1`/`e2` de arriba): necesita un empate de puntos
    // real para que el snapshot de desempate decida algo (`core/order.ts`,
    // `orderByPoints` sólo lo consulta si los puntos ya están empatados), y
    // necesita una disciplina NO PRIMARIA cuyo `regularMatchdays` sea
    // MENOR al de la primaria para que la fecha activa
    // (`min(history.length + 1, regularMatchdays)`) cambie según cuál de
    // los dos números use la pantalla.
    //
    // `tPadel` (primaria) se queda con el default (`regularMatchdays: 10`,
    // `tiebreakSnapshotEvery: 3`) -- es el valor que `header.regularMatchdays`
    // usaría si la pantalla volviera a leerlo de ahí. `tFifa` (la URL bajo
    // prueba) tiene `regularMatchdays: 1` y `tiebreakSnapshotEvery: 1`.
    //
    // `e1` y `e2` empatan 10-10 en fifa (`countBestOf: 1` de esa disciplina,
    // mejor puntaje de cada uno): fecha 1 `e2=10, e1=3`; fecha 2 `e1=10,
    // e2=3`.
    //
    // Con el `regularMatchdays` CORRECTO de fifa (1): fecha activa =
    // `min(3, 1) = 1`. `(1-1)/1 = 0` refrescos -- el snapshot de desempate
    // se queda en el orden de siembra `[e1, e2]` sin tocar, y el empate lo
    // gana `e1` (seedPosition 0): **1° de 2**.
    //
    // Si la pantalla usara `header.regularMatchdays` (10, el de la
    // primaria): fecha activa = `min(3, 10) = 3`. `(3-1)/1 = 2` refrescos, y
    // el primero recorta a sólo la fecha 1 (`e2=10` vs `e1=3`, SIN empate
    // ahí) -- el snapshot pasa a `[e2, e1]` antes de llegar al empate final,
    // y ESE es el que lo desempata: **2° de 2**, `e1` invertido con `e2`.
    //
    // Verificado a mano contra `core/snapshots.ts` (`snapshotForMatchday`)
    // y `core/order.ts` (`orderByPoints`) -- no es una posición adivinada.
    const { seasonHeader, seasonSquadMembersOf, entriesOf, closedHistoryAll, awardsOf: awardsOfRead } = await import('@/db/read')

    const shape = { weight: 1, pairSize: 1 as const, hasMasters: false, allowsDraw: false, formatoDefault: { kind: 'ROUND_ROBIN' as const } }
    const tPadel: DisciplineHeader = { id: D_PADEL, kind: 'PADEL', config: defaultConfig(2, 1), ...shape }
    const tFifa: DisciplineHeader = {
      id: D_FIFA,
      kind: 'FIFA',
      config: { ...defaultConfig(2, 1), regularMatchdays: 1, tiebreakSnapshotEvery: 1, countBestOf: 1 },
      ...shape,
    }

    vi.mocked(seasonHeader).mockResolvedValueOnce({
      id: 's1',
      name: 'Torneo de prueba',
      status: 'ACTIVE',
      regularMatchdays: tPadel.config.regularMatchdays,
      isAdmin: false,
      inviteToken: 'token',
      disciplines: [tPadel, tFifa],
    })
    vi.mocked(seasonSquadMembersOf).mockResolvedValueOnce([
      { id: 'e1', displayName: 'Empatado Uno', playerId: null },
      { id: 'e2', displayName: 'Empatado Dos', playerId: null },
    ])
    vi.mocked(entriesOf).mockResolvedValueOnce([
      { id: 'e1', displayName: 'Empatado Uno', kind: 'SQUAD', seedPosition: 0, playerId: null, matchdayId: null },
      { id: 'e2', displayName: 'Empatado Dos', kind: 'SQUAD', seedPosition: 1, playerId: null, matchdayId: null },
    ])
    vi.mocked(closedHistoryAll).mockResolvedValueOnce([
      { number: 1, sides: [side('e1'), side('e2')], matches: [{ round: 1, fase: 'GRUPO', grupo: 1, sideA: side('e2'), sideB: side('e1'), sets: [{ gamesA: 4, gamesB: 0 }] }] },
      { number: 2, sides: [side('e1'), side('e2')], matches: [{ round: 1, fase: 'GRUPO', grupo: 1, sideA: side('e1'), sideB: side('e2'), sets: [{ gamesA: 4, gamesB: 0 }] }] },
    ])
    vi.mocked(awardsOfRead).mockResolvedValueOnce(
      new Map([
        [1, [{ entryId: 'e2', position: 1, points: 10, lines: [] }, { entryId: 'e1', position: 2, points: 3, lines: [] }]],
        [2, [{ entryId: 'e1', position: 1, points: 10, lines: [] }, { entryId: 'e2', position: 2, points: 3, lines: [] }]],
      ]),
    )

    const html = await render('fifa', 'e1')

    expect(html).toContain('1° de 2 · 10 puntos')
  })
})
