import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { defaultConfig, type DisciplineId, type EntryId, type MatchdayFormat, type SeasonConfig } from '@/core'
import type { DisciplineHeader } from '@/db/read'

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
 * y `renderToStaticMarkup`, sin DOM (`docs/estado.md`, "jsdom está para UN
 * caso").
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
  // El tamaño del plantel de la TEMPORADA -- lo que `seasonSquadOf` trae de
  // verdad. 8 calza con `PADEL_CONFIG.squadSize` (`defaultConfig(8)`), así
  // que por default no hay mismatch que mostrar.
  squadSize: 8,
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
    seasonSquadOf: async (): Promise<EntryId[]> =>
      Array.from({ length: escena.squadSize }, (_, index) => `e${index}`),
  }
})

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
