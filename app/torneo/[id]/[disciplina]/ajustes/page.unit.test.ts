import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig, type DisciplineId, type MatchdayFormat, type SeasonConfig } from '@/core'
import type { DisciplineHeader, SquadMember } from '@/db/read'

/**
 * Task 4 (docs/plan-arquitectura-de-paginas.md; docs/arquitectura-de-paginas.md
 * §2.5/§3.2): con 2+ disciplinas, los paneles de Formato/FormatoDefault/
 * Reglas que el contenedor mostraba por disciplina (`../../ajustes/page.tsx`,
 * ver `app/cableado-de-formato.unit.test.ts`) se mudan acá, una URL por
 * disciplina -- mismo patrón que Stats (Task 1) y el perfil (Task 2):
 * resolver por slug, `notFound()` si no existe, y acá además la guarda de
 * `isAdmin` que el contenedor ya tenía.
 *
 * Mismo techo que esas dos suites: server component `async`, llamado directo
 * y `renderToStaticMarkup`, sin DOM (`docs/estado.md`, "jsdom es la
 * excepción"). El wiring de "Quién juega" (onClick -> acción correcta) NO se
 * prueba acá -- `renderToStaticMarkup` descarta los props de evento -- sino
 * en `quien-juega.unit.test.ts` (jsdom, click de verdad). Lo que ACÁ se pinea
 * es que la página le pasa el `disciplineId` CORRECTO a `QuienJuega`, con el
 * mismo truco que ya usan `Formato`/`FormatoDefault` (`data-formato`,
 * `data-formato-default`): un atributo `data-quien-juega` con el id real.
 */

const D_PADEL = 'd-padel' as DisciplineId
const D_FIFA = 'd-fifa' as DisciplineId

const PADEL_CONFIG = defaultConfig(8)
const FIFA_CONFIG: SeasonConfig = { ...PADEL_CONFIG, matchFormat: { ...PADEL_CONFIG.matchFormat, openScore: true } }

function disciplina(
  id: DisciplineId,
  kind: 'PADEL' | 'FIFA',
  config: SeasonConfig,
  formatoDefault: MatchdayFormat = { kind: 'ROUND_ROBIN' },
): DisciplineHeader {
  const pairSize = kind === 'PADEL' ? 2 : 1
  return {
    id,
    kind,
    config,
    weight: 1,
    pairSize,
    hasMasters: pairSize === 2,
    allowsDraw: kind === 'FIFA',
    formatoDefault,
  }
}

const PADEL_Y_FIFA = [disciplina(D_PADEL, 'PADEL', PADEL_CONFIG), disciplina(D_FIFA, 'FIFA', FIFA_CONFIG)]
const SOLO_PADEL = [disciplina(D_PADEL, 'PADEL', PADEL_CONFIG)]

const escena = vi.hoisted(() => ({
  disciplines: [] as DisciplineHeader[],
  isAdmin: true,
  rulesByDiscipline: new Map<string, string>(),
  // El tamaño del plantel de la TEMPORADA -- lo que `seasonSquadMembersOf`
  // trae de verdad. 8 calza con `PADEL_CONFIG.squadSize` (`defaultConfig(8)`),
  // así que por default no hay mismatch que mostrar.
  squadSize: 8,
  // Equipos (§1 tipos-de-torneo): por disciplina, no un booleano suelto --
  // así el describe de "no copia el gate de multiDiscipline" puede prender
  // `fixed_teams` en UNA sola de las dos disciplinas del fixture y probar que
  // la OTRA no dibuja la sección.
  fixedTeamsByDiscipline: new Map<string, boolean>(),
  teamsByDiscipline: new Map<string, { id: string; entry_a: string; entry_b: string }[]>(),
}))

vi.mock('next/navigation', async (importOriginal) => {
  const real = await importOriginal<typeof import('next/navigation')>()
  return {
    ...real,
    notFound: vi.fn(() => {
      throw new Error('NEXT_NOT_FOUND')
    }),
    redirect: vi.fn((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`)
    }),
  }
})

vi.mock('@/db/server', () => ({
  serverClient: async () => ({}),
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
      isAdmin: escena.isAdmin,
      inviteToken: 'token',
      disciplines: escena.disciplines,
    }),
    disciplineRulesOf: async () => escena.rulesByDiscipline as Map<DisciplineId, string>,
    seasonSquadMembersOf: async (): Promise<SquadMember[]> =>
      Array.from({ length: escena.squadSize }, (_, index) => ({
        id: `e${index}`,
        displayName: `Jugador ${index}`,
        playerId: null,
      })),
  }
})

// `squadSeedOrder` es "Quién juega" DE ESTA disciplina (`discipline_entries`,
// db/season.ts:23) -- la página sólo la pide con 2+ disciplinas. Por default
// todo el plantel juega TODAS (mismo resultado que antes de sumar la
// sección, para no romper los tests de Formato/FormatoDefault/Reglas de acá
// abajo, que no le interesa la membresía); el describe de "Quién juega" pisa
// esto con `mockResolvedValueOnce` para el caso de solape parcial.
vi.mock('@/db/season', () => ({
  squadSeedOrder: vi.fn(async () => Array.from({ length: escena.squadSize }, (_, index) => `e${index}`)),
}))

// `disciplineConfig` es de dónde sale `fixedTeams` -- el resto de la fila
// (`config`/`pairSize`/`allowsDraw`/`formatoDefault`) no lo usa esta pantalla
// por este camino, así que el mock sólo devuelve lo que se lee.
vi.mock('@/db/discipline', () => ({
  disciplineConfig: vi.fn(async (_supabase: unknown, disciplineId: string) => ({
    fixedTeams: escena.fixedTeamsByDiscipline.get(disciplineId) ?? false,
  })),
}))

vi.mock('@/db/discipline-teams', () => ({
  teamsOf: vi.fn(async (_supabase: unknown, disciplineId: string) =>
    (escena.teamsByDiscipline.get(disciplineId) ?? []).map((row) => ({
      id: row.id,
      entryA: row.entry_a,
      entryB: row.entry_b,
    })),
  ),
}))

async function render(disciplina: string): Promise<string> {
  const { default: DisciplinaAjustesPage } = await import('./page')
  return renderToStaticMarkup(
    await DisciplinaAjustesPage({ params: Promise.resolve({ id: 's1', disciplina }) }),
  )
}

describe('Ajustes de una disciplina trae los datos de la disciplina de la URL, no la [0]', () => {
  it('con el slug de la SEGUNDA disciplina (fifa), edita FIFA: nombra el Masters apagado y no dibuja los steppers de sets', async () => {
    escena.disciplines = PADEL_Y_FIFA
    const html = await render('fifa')

    expect(html).toContain('>Ajustes · FIFA</h1>')
    expect(html).not.toContain('Sets por partido')
    expect(html).toContain('Una disciplina de a uno no juega Masters')

    // El SAVE TARGET, no sólo lo que se lee: `data-formato`/`data-formato-default`
    // (`ajustes/formato.tsx:95`, `ajustes/formato-default.tsx:104`) llevan el
    // `disciplineId` real que reciben `Formato`/`FormatoDefault` -- si esta
    // página mutara los tres props a `disciplines[0]`, seguiría leyéndose y
    // viéndose bien (FIFA es a uno, sin steppers de sets, igual que arriba)
    // pero cada `save*` (`ajustes/actions.ts`) guardaría en Pádel. Mismo
    // defecto que C36 (`app/cableado-de-formato.unit.test.ts`), en el
    // write path de esta ruta.
    expect(html).toContain('data-formato="d-fifa"')
    expect(html).not.toContain('data-formato="d-padel"')
    expect(html).toContain('data-formato-default="d-fifa"')
    expect(html).not.toContain('data-formato-default="d-padel"')

    // Mismo pin, para `QuienJuega` (ronda de fix, BLOQUEA 1 parte 2): sin
    // esto, `page.tsx` pasando `header.disciplines[last].id` en vez de
    // `discipline.id` se seguiría viendo y renderizando IGUAL (misma cantidad
    // de filas, mismos nombres) pero "Agregar"/"Sacar" escribirían sobre
    // Pádel estando en la URL de FIFA.
    expect(html).toContain('data-quien-juega="d-fifa"')
    expect(html).not.toContain('data-quien-juega="d-padel"')

    // Mismo pin, para `disciplineLabel` (ronda de fix 2, BLOQUEA 3): sin
    // esto, `page.tsx` pasando `DISCIPLINE_LABELS[header.disciplines[0]!.kind]`
    // en vez de `DISCIPLINE_LABELS[discipline.kind]` seguiría viéndose y
    // renderizando IGUAL, pero cada rebote de "Sacar" en la URL de FIFA
    // diría "Pádel: ..." en vez de "FIFA: ...".
    expect(html).toContain('data-quien-juega-label="FIFA"')
    expect(html).not.toContain('data-quien-juega-label="Pádel"')
  })

  it('con el slug de la PRIMERA disciplina (padel), edita Pádel: dibuja sus cinco steppers', async () => {
    escena.disciplines = PADEL_Y_FIFA
    const html = await render('padel')

    expect(html).toContain('>Ajustes · Pádel</h1>')
    expect(html).toContain('Sets por partido')
    expect(html).not.toContain('Una disciplina de a uno no juega Masters')

    // Mismo pin que arriba, del otro lado: si la mutación fuera al revés
    // (`disciplines[1]` fijo), esta URL guardaría en FIFA.
    expect(html).toContain('data-formato="d-padel"')
    expect(html).not.toContain('data-formato="d-fifa"')
    expect(html).toContain('data-formato-default="d-padel"')
    expect(html).not.toContain('data-formato-default="d-fifa"')

    // Mismo pin que arriba, del otro lado, para `QuienJuega`.
    expect(html).toContain('data-quien-juega="d-padel"')
    expect(html).not.toContain('data-quien-juega="d-fifa"')

    // Mismo pin que arriba, del otro lado, para `disciplineLabel`.
    expect(html).toContain('data-quien-juega-label="Pádel"')
    expect(html).not.toContain('data-quien-juega-label="FIFA"')
  })

  it('un slug de disciplina desconocido da notFound(), no la [0] por defecto', async () => {
    escena.disciplines = PADEL_Y_FIFA
    const { notFound } = await import('next/navigation')

    await expect(render('handball')).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
  })

  /**
   * PIN de no-regresión (§5 del diseño): con una sola disciplina —el 100% de
   * los torneos que existen hoy— esta ruta sigue funcionando por URL directa,
   * pero el título no gana un sufijo: no hay de qué desambiguar.
   */
  it('con una sola disciplina el título no lleva sufijo', async () => {
    escena.disciplines = SOLO_PADEL
    const html = await render('padel')
    expect(html).toContain('>Ajustes</h1>')
    expect(html).not.toContain('>Ajustes · Pádel</h1>')
  })
})

describe('Ajustes de una disciplina — cada panel guarda SU PROPIO formatoDefault (mismo defecto que C36)', () => {
  it('con formatoDefault DISTINTO por disciplina, cada URL marca el radio de la SUYA, no el de la otra', async () => {
    escena.disciplines = [
      disciplina(D_PADEL, 'PADEL', PADEL_CONFIG),
      disciplina(D_FIFA, 'FIFA', FIFA_CONFIG, { kind: 'GROUPS_KNOCKOUT', groups: 4, qualifiersPerGroup: 2 }),
    ]

    const padel = await render('padel')
    const fifa = await render('fifa')

    // Pádel quedó en el default (ROUND_ROBIN).
    const radiosPadel = [...padel.matchAll(/<input[^>]*type="radio"[^>]*\/>/g)].map((match) => match[0])
    expect(radiosPadel[0]).toContain('checked')
    expect(radiosPadel[1]).not.toContain('checked')
    expect(radiosPadel[2]).not.toContain('checked')

    // FIFA se armó con "4 grupos + llave": si esta página le pasara el
    // formatoDefault de Pádel a las dos URLs, acá marcaría el primero.
    const radiosFifa = [...fifa.matchAll(/<input[^>]*type="radio"[^>]*\/>/g)].map((match) => match[0])
    expect(radiosFifa[0]).not.toContain('checked')
    expect(radiosFifa[1]).not.toContain('checked')
    expect(radiosFifa[2]).toContain('checked')
  })
})

describe('Ajustes de una disciplina — el aviso de plantel es de ESTA disciplina, no de la [0]', () => {
  /**
   * El contenedor (`../../ajustes/page.tsx`) también avisa esto, sobre TODAS
   * las disciplinas (fix round 1 de Task 4: antes sólo miraba la primaria).
   * Este test cubre la MISMA propiedad acá, con `discipline.config` de la
   * disciplina de la URL -- para quien entra directo a esta pantalla sin
   * pasar por el contenedor. Con un plantel de 6 y Pádel esperando 8, el
   * aviso aparece en `/padel/ajustes` aunque FIFA (que sí espera 6) no tenga
   * nada que avisar.
   */
  it('el plantel no calza con Pádel (8) pero sí con FIFA (6): sólo la URL de Pádel muestra el aviso', async () => {
    escena.disciplines = [
      disciplina(D_PADEL, 'PADEL', PADEL_CONFIG),
      disciplina(D_FIFA, 'FIFA', { ...FIFA_CONFIG, squadSize: 6 }),
    ]
    escena.squadSize = 6

    const padel = await render('padel')
    const fifa = await render('fifa')

    expect(padel).toContain('bg-live-bg')
    expect(fifa).not.toContain('bg-live-bg')

    escena.squadSize = 8
  })
})

describe('Ajustes de una disciplina — la guarda de admin', () => {
  it('un no-admin es redirigido a la tabla de ESA disciplina, no ve los paneles de escritura', async () => {
    escena.disciplines = PADEL_Y_FIFA
    escena.isAdmin = false
    const { redirect } = await import('next/navigation')

    await expect(render('fifa')).rejects.toThrow('NEXT_REDIRECT:/torneo/s1/fifa')
    expect(redirect).toHaveBeenCalledWith('/torneo/s1/fifa')

    escena.isAdmin = true
  })
})

/**
 * "Quién juega" (§2.6 del diseño, decisión del dueño 2): la sección se
 * agrega SÓLO con 2+ disciplinas -- con una sola, el plantel del contenedor
 * y "quién juega" son la misma lista y la sección no diría nada nuevo.
 *
 * Mutaciones probadas a mano contra esta suite (revertidas después):
 * - Sacar el `multiDiscipline &&` que envuelve a `<QuienJuega>` en
 *   `page.tsx` → el primer test (una sola disciplina) da ROJO.
 * - Invertir `member.playsDiscipline` en el `.map` de `page.tsx` (juega
 *   pasa a "no juega" y viceversa) → el segundo test (Agregar/Sacar por
 *   fila) da ROJO: cuenta 1 "Sacar" y 2 "Agregar" en vez de al revés.
 */
describe('Ajustes de una disciplina — "Quién juega" (§2.6 del diseño)', () => {
  it('con una sola disciplina, la sección no se dibuja', async () => {
    escena.disciplines = SOLO_PADEL
    const html = await render('padel')
    expect(html).not.toContain('Quién juega')
  })

  it('con 2+, marca por fila quién juega esta disciplina (Sacar) y quién no (Agregar)', async () => {
    escena.disciplines = PADEL_Y_FIFA
    escena.squadSize = 3
    const { squadSeedOrder } = await import('@/db/season')
    // Del plantel de 3 (e0, e1, e2), sólo e0 y e1 juegan Pádel: e2 quedó
    // afuera a propósito (REQ-D1-4, solape parcial) para probar las dos
    // ramas en el mismo render.
    vi.mocked(squadSeedOrder).mockResolvedValueOnce(['e0', 'e1'])

    const html = await render('padel')

    expect(html).toContain('Quién juega')
    expect([...html.matchAll(/>Sacar</g)]).toHaveLength(2)
    expect([...html.matchAll(/>Agregar</g)]).toHaveLength(1)

    escena.squadSize = 8
  })
})

/**
 * Equipos (docs/tipos-de-torneo.md §1). A diferencia de "Quién juega", el
 * gate NO es `multiDiscipline` -- es `discipline.fixed_teams`, así que un
 * torneo de UNA sola disciplina tiene que dibujarla igual que uno de 2+.
 *
 * Mutaciones probadas a mano contra esta suite (revertidas después,
 * confirmando rojo → verde -- ver el reporte de la tanda para la lista
 * completa corrida contra `db/discipline-teams.ts` y `db/discipline-entries.ts`):
 * - Copiar el gate de "Quién juega" (`multiDiscipline &&`) para `<Equipos>`
 *   en `page.tsx` → el segundo test de acá abajo (una sola disciplina, con
 *   `fixed_teams`) da ROJO.
 */
describe('Ajustes de una disciplina — "Equipos" (§1 tipos-de-torneo)', () => {
  afterEach(() => {
    escena.fixedTeamsByDiscipline = new Map()
    escena.teamsByDiscipline = new Map()
  })

  it('con fixed_teams apagado, la sección no se dibuja', async () => {
    escena.disciplines = SOLO_PADEL
    const html = await render('padel')
    expect(html).not.toContain('>Equipos</h2>')
  })

  it('con fixed_teams prendido y UNA sola disciplina, la sección SÍ se dibuja', async () => {
    escena.disciplines = SOLO_PADEL
    escena.fixedTeamsByDiscipline = new Map([['d-padel', true]])
    const html = await render('padel')
    expect(html).toContain('>Equipos</h2>')
  })

  // `fixedTeamsByDiscipline` con las DOS en `true`: si `page.tsx` le pasara
  // `header.disciplines[0].id` a `<Equipos disciplineId=...>` en vez de
  // `discipline.id`, el `data-equipos` sería igual en las dos URLs y esto no
  // lo notaría -- por eso el segundo test de este describe usa valores
  // DISTINTOS por disciplina, que es lo que de verdad pinea `disciplineConfig`.
  it('data-equipos lleva el id de la disciplina de la URL, no la [0]', async () => {
    escena.disciplines = PADEL_Y_FIFA
    escena.fixedTeamsByDiscipline = new Map([
      ['d-padel', true],
      ['d-fifa', true],
    ])

    const fifa = await render('fifa')
    expect(fifa).toContain('data-equipos="d-fifa"')
    expect(fifa).not.toContain('data-equipos="d-padel"')

    const padel = await render('padel')
    expect(padel).toContain('data-equipos="d-padel"')
    expect(padel).not.toContain('data-equipos="d-fifa"')
  })

  // Ronda de fix — M-1: `seasonId` es el OTRO id que viaja a `<Equipos>`, y
  // no tenía pin -- mutación probada a mano (revertida después, confirmando
  // rojo → verde): cambiar `seasonId={seasonId}` por `seasonId={discipline.id}`
  // en `page.tsx` deja pasar TODOS los tests de arriba en VERDE (ninguno
  // mira `data-equipos-season`) pero da ROJO acá.
  it('data-equipos-season lleva el seasonId real, no el id de la disciplina', async () => {
    escena.disciplines = SOLO_PADEL
    escena.fixedTeamsByDiscipline = new Map([['d-padel', true]])

    const html = await render('padel')

    expect(html).toContain('data-equipos-season="s1"')
    expect(html).not.toContain('data-equipos-season="d-padel"')
  })

  // Complementa el test de arriba: acá `fixedTeams` DIFIERE entre las dos
  // disciplinas, así que si `page.tsx` le pidiera `disciplineConfig` a
  // `header.disciplines[0].id` en vez de `discipline.id`, esta sección
  // saldría PRENDIDA o APAGADA al revés en una de las dos URLs -- mutación
  // probada a mano (revertida después, confirmando rojo → verde): cambiar
  // `disciplineConfig(supabase, discipline.id)` por
  // `disciplineConfig(supabase, header.disciplines[0]!.id)` en `page.tsx`
  // deja el test de arriba en VERDE (las dos disciplinas comparten el mismo
  // `fixedTeams: true`) pero ÉSTE da ROJO.
  it('cada URL lee el fixed_teams de SU PROPIA disciplina, no el de la [0]', async () => {
    escena.disciplines = PADEL_Y_FIFA
    escena.fixedTeamsByDiscipline = new Map([
      ['d-padel', false],
      ['d-fifa', true],
    ])

    const fifa = await render('fifa')
    expect(fifa).toContain('>Equipos</h2>')

    const padel = await render('padel')
    expect(padel).not.toContain('>Equipos</h2>')
  })

  // Mismo motivo que el test de arriba, para `teamsOf`: mutación probada a
  // mano (revertida después, confirmando rojo → verde): cambiar
  // `teamsOf(supabase, discipline.id)` por
  // `teamsOf(supabase, header.disciplines[0]!.id)` en `page.tsx` deja pasar
  // esto en VERDE con equipos IGUALES en las dos disciplinas (el test de
  // "muestra los equipos ya armados", con SOLO_PADEL, no tiene una segunda
  // disciplina contra la que comparar) pero da ROJO acá, con equipos
  // DISTINTOS por disciplina.
  it('cada URL lee los equipos de SU PROPIA disciplina, no los de la [0]', async () => {
    escena.disciplines = PADEL_Y_FIFA
    escena.squadSize = 4
    escena.fixedTeamsByDiscipline = new Map([
      ['d-padel', true],
      ['d-fifa', true],
    ])
    escena.teamsByDiscipline = new Map([
      ['d-padel', [{ id: 'tp', entry_a: 'e0', entry_b: 'e1' }]],
      ['d-fifa', [{ id: 'tf', entry_a: 'e2', entry_b: 'e3' }]],
    ])

    const fifa = await render('fifa')
    expect(fifa).toContain('Jugador 2 y Jugador 3')
    expect(fifa).not.toContain('Jugador 0 y Jugador 1')

    const padel = await render('padel')
    expect(padel).toContain('Jugador 0 y Jugador 1')
    expect(padel).not.toContain('Jugador 2 y Jugador 3')

    escena.squadSize = 8
  })

  it('muestra los equipos ya armados por nombre, y no ofrece a quien ya tiene equipo para armar uno nuevo', async () => {
    escena.disciplines = SOLO_PADEL
    escena.squadSize = 4
    escena.fixedTeamsByDiscipline = new Map([['d-padel', true]])
    escena.teamsByDiscipline = new Map([['d-padel', [{ id: 't1', entry_a: 'e0', entry_b: 'e1' }]]])

    const html = await render('padel')

    expect(html).toContain('Jugador 0 y Jugador 1')
    expect(html).toContain('Deshacer')
    // e0/e1 ya tienen equipo: no aparecen como `<option>` de ninguno de los
    // dos `<select>` de armar uno nuevo.
    expect(html).not.toContain('value="e0"')
    expect(html).not.toContain('value="e1"')
    // e2/e3 siguen libres: aparecen en LOS DOS `<select>`.
    expect([...html.matchAll(/value="e2"/g)]).toHaveLength(2)
    expect([...html.matchAll(/value="e3"/g)]).toHaveLength(2)

    escena.squadSize = 8
  })

  // Ronda de fix — M-2: en TODOS los tests de arriba, el mock de
  // `squadSeedOrder` devuelve EXACTAMENTE los mismos ids que
  // `seasonSquadMembersOf` -- "quién juega esta disciplina" y "el plantel
  // del contenedor" son el mismo valor siempre, así que `disciplineMemberIds`
  // (`page.tsx`) mutado a `squad.map(...)` siempre (ignorando la membresía
  // real) queda indistinguible. Acá se pisa `squadSeedOrder` con un
  // SUBCONJUNTO (mismo mecanismo que el describe de "Quién juega" ya usa)
  // para que la disciplina de la URL tenga MENOS gente que el plantel
  // entero.
  //
  // Mutación probada a mano (revertida después, confirmando rojo → verde):
  // en `page.tsx`, cambiar `const disciplineMemberIds = multiDiscipline ?
  // disciplinePlayers : squad.map((member) => member.id)` por
  // `squad.map((member) => member.id)` siempre → todos los tests de arriba
  // siguen en VERDE (fixture homogénea) pero éste da ROJO: ofrece a
  // "Jugador 2" para armar equipo en FIFA aunque no la juegue.
  it('con 2+ disciplinas, el form de armar equipo sólo ofrece a quien juega ESTA disciplina, no todo el plantel del contenedor', async () => {
    escena.disciplines = PADEL_Y_FIFA
    escena.squadSize = 3
    escena.fixedTeamsByDiscipline = new Map([['d-fifa', true]])
    const { squadSeedOrder } = await import('@/db/season')
    // Del plantel de 3 (e0, e1, e2), sólo e0 y e1 juegan FIFA -- e2 quedó
    // afuera a propósito (mismo patrón que el describe de "Quién juega").
    vi.mocked(squadSeedOrder).mockResolvedValueOnce(['e0', 'e1'])

    const html = await render('fifa')

    expect(html).toContain('>Equipos</h2>')
    expect(html).toContain('value="e0"')
    expect(html).toContain('value="e1"')
    expect(html).not.toContain('value="e2"')

    escena.squadSize = 8
  })
})
