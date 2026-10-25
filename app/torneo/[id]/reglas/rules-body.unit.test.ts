// @vitest-environment jsdom
//
// `renderToStaticMarkup` descarta el estado de React: con él se mira todo lo
// que sale al HTML (títulos, orden, `<details>` cerrado), pero no se puede
// ABRIR una fila del acordeón. Un solo test monta de verdad (`createRoot`)
// para eso, y por eso el archivo corre en jsdom.
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultConfig,
  reglamento,
  unitOf,
  SPORTS,
  type DisciplineShape,
  type MatchdayFormatSetting,
  type SeasonConfig,
} from '@/core'
import { RulesBody, type RulesBlock } from './rules-body'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// El mock envuelve la `narrateRules` real (no la reemplaza): todos los tests
// de este archivo, salvo el que arma a propósito una sección faltante,
// corren contra el comportamiento de verdad.
vi.mock('@/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/core')>()
  return { ...real, narrateRules: vi.fn(real.narrateRules) }
})

const { narrateRules } = await import('@/core')
const mockedNarrateRules = vi.mocked(narrateRules)

/**
 * La página Reglas (docs/torneos-deportes.md §6): un bloque por deporte con el
 * reglamento en criollo ARRIBA y, cerrado bajo "Más detalle", el acordeón de
 * siempre. `RulesBody` no calcula nada: recibe las líneas del reglamento y la
 * unidad ya resueltas por la página, así que acá se arman igual que ella.
 */
const PADEL_CONFIG: SeasonConfig = { ...defaultConfig(8), firstFecha: 'NIVEL' }
const FIFA_CONFIG: SeasonConfig = {
  ...defaultConfig(8),
  matchFormat: { ...defaultConfig(8).matchFormat, openScore: true },
  firstFecha: 'SORTEO',
}
const PADEL_SHAPE: DisciplineShape = { hasMasters: true, pairSize: 2, fixedTeams: false, allowsDraw: false }
const FIJAS_SHAPE: DisciplineShape = { ...PADEL_SHAPE, fixedTeams: true }
const FIFA_SHAPE: DisciplineShape = { hasMasters: false, pairSize: 1, fixedTeams: false, allowsDraw: true }
const ROUND_ROBIN: MatchdayFormatSetting = { kind: 'ROUND_ROBIN' }

function bloque(
  kind: string,
  label: string,
  config: SeasonConfig,
  shape: DisciplineShape,
  text = '',
  formatoDefault: MatchdayFormatSetting = ROUND_ROBIN,
): RulesBlock {
  return {
    label,
    lines: reglamento({ kind, ...shape, formatoDefault, config }),
    config,
    shape,
    unit: unitOf(kind, config.matchFormat),
    text,
  }
}

const PADEL = (text = '') => bloque('PADEL', 'Pádel', PADEL_CONFIG, PADEL_SHAPE, text)
const FIFA = (text = '') => bloque('FIFA', 'FIFA', FIFA_CONFIG, FIFA_SHAPE, text)

function html(disciplines: RulesBlock[], adminName = 'Marce', isAdmin = false): string {
  return renderToStaticMarkup(
    createElement(RulesBody, { seasonId: 'season-1', disciplines, adminName, isAdmin }),
  )
}

/** Un bloque recortado del HTML: desde su título `<h2>` hasta el próximo `<h2>` o el final. */
function bloqueDe(out: string, label: string): string {
  return new RegExp(`<h2[^>]*>${label}</h2>([\\s\\S]*?)(?=<h2[^>]*>|$)`).exec(out)?.[1] ?? ''
}

const LINEA_FIJA = 'Alguna fecha puede jugarse a otra cosa: se avisa en esa fecha.'

describe('Reglas — un bloque por deporte, con el reglamento arriba', () => {
  it('Pádel + FIFA: un título por deporte', () => {
    const out = html([PADEL(), FIFA()])
    expect(out).toMatch(/<h2 class="text-\[17px\] font-extrabold[^"]*">Pádel<\/h2>/)
    expect(out).toMatch(/<h2 class="text-\[17px\] font-extrabold[^"]*">FIFA<\/h2>/)
  })

  it('con un solo deporte el título igual aparece', () => {
    expect(html([PADEL()])).toContain('>Pádel</h2>')
  })

  it('el reglamento sale como UN párrafo con las líneas unidas, antes de "Más detalle"', () => {
    const out = html([PADEL()])
    const parrafo = reglamento({ kind: 'PADEL', ...PADEL_SHAPE, formatoDefault: ROUND_ROBIN, config: PADEL_CONFIG })
      .map((line) => line.text)
      .join(' ')
    expect(out).toContain(`>${parrafo}</p>`)
    expect(parrafo).toContain('se arma por nivel')
    expect(out.indexOf('se arma por nivel')).toBeLessThan(out.indexOf('<details'))
  })

  it('en Pádel + FIFA cada bloque dice SU reglamento, antes de SU "Más detalle"', () => {
    const out = html([PADEL(), FIFA()])
    const padel = bloqueDe(out, 'Pádel')
    const fifa = bloqueDe(out, 'FIFA')
    expect(padel).toContain('Parejas que rotan.')
    expect(padel).toContain('Masters al final')
    expect(fifa).toContain('Individual.')
    expect(fifa).toContain('Partidos a goles; se puede empatar.')
    expect(fifa).not.toContain('Masters al final')
    for (const bloqueHtml of [padel, fifa]) {
      expect(bloqueHtml.indexOf('Gana 10')).toBeLessThan(bloqueHtml.indexOf('<details'))
    }
  })

  it('un torneo anterior a la ficha (sin `firstFecha`) no inventa cómo se armó la primera fecha', () => {
    const existente = bloque('PADEL', 'Pádel', defaultConfig(8), PADEL_SHAPE)
    const out = html([existente])
    expect(out).toContain('Parejas que rotan. Partidos a 1 set de 4 games.')
    expect(out).toContain('Cada fecha, todos contra todos.')
    expect(out).not.toContain('primera fecha')
  })

  it('la línea fija sale una sola vez, con uno o con dos deportes', () => {
    expect(html([PADEL()]).split(LINEA_FIJA)).toHaveLength(2)
    expect(html([PADEL(), FIFA()]).split(LINEA_FIJA)).toHaveLength(2)
  })

  it('dos deportes iguales son dos bloques: cada uno repite lo suyo', () => {
    const out = html([PADEL(), PADEL()])
    expect(out.match(/>Pádel<\/h2>/g)).toHaveLength(2)
    expect(out.match(/<details/g)).toHaveLength(2)
  })

  it('la intro nombra a quien organiza, y "Editar reglas" sólo aparece para el admin', () => {
    expect(html([PADEL()], 'Marce')).toContain('Las reglas de este torneo, como quedaron cuando Marce lo creó.')
    expect(html([PADEL()])).not.toContain('Editar reglas')
    expect(html([PADEL()], 'Marce', true)).toContain('href="/torneo/season-1/ajustes"')
  })

  it('con 2+ deportes, cada bloque lleva su "Editar reglas" al Ajustes de ese deporte', () => {
    const out = html([{ ...PADEL(), slug: 'padel' }, { ...FIFA(), slug: 'fifa' }], 'Marce', true)
    expect(bloqueDe(out, 'Pádel')).toContain('href="/torneo/season-1/padel/ajustes"')
    expect(bloqueDe(out, 'FIFA')).toContain('href="/torneo/season-1/fifa/ajustes"')
    expect(out).not.toContain('href="/torneo/season-1/ajustes"')
  })
})

describe('Reglas — "Más detalle", cerrado, con el acordeón de siempre', () => {
  it('es un <details> sin `open` con el <summary> "Más detalle"', () => {
    const out = html([PADEL(), FIFA()])
    const abiertos = out.match(/<details[^>]*>/g) ?? []
    expect(abiertos).toHaveLength(2)
    for (const tag of abiertos) expect(tag).not.toMatch(/\sopen[\s=>]/)
    expect(out.match(/<summary[^>]*>/g)).toHaveLength(2)
    expect(out).toMatch(/<summary[^>]*><span>Más detalle<\/span>/)
  })

  it('el summary mide 44px, es link de acento, y tiene foco visible y marcador propio', () => {
    const summary = /<summary[^>]*>/.exec(html([PADEL()]))?.[0] ?? ''
    expect(summary).toContain('min-h-[44px]')
    expect(summary).toContain('text-accent-link')
    expect(summary).toContain('font-extrabold')
    expect(summary).toContain('focus-visible:ring-2')
    // El `&` sale escapado del HTML (`&amp;`): se mira lo que sigue.
    expect(summary).toContain('::-webkit-details-marker]:hidden')
  })

  it('adentro están las filas de hoy: Pádel que rota, con "Cómo se arman las parejas" y Masters', () => {
    const padel = bloqueDe(html([PADEL(), FIFA()]), 'Pádel')
    for (const fila of ['Formato de partido', 'Cómo se arman las parejas', 'Puntos por posición', 'Orden de desempate', 'Fechas que cuentan', 'Masters']) {
      expect(padel).toContain(`>${fila}<`)
    }
  })

  it('FIFA individual no tiene ni "Cómo se arman las parejas" ni Masters', () => {
    const fifa = bloqueDe(html([PADEL(), FIFA()]), 'FIFA')
    expect(fifa).toContain('>Orden de desempate<')
    expect(fifa).not.toContain('Cómo se arman las parejas')
    expect(fifa).not.toContain('>Masters<')
  })

  it('en parejas fijas la fila "Cómo se arman las parejas" tampoco aparece', () => {
    const fijas = bloque('PADEL', 'Pádel', PADEL_CONFIG, FIJAS_SHAPE)
    const out = html([fijas])
    expect(out).toContain('Parejas fijas.')
    expect(out).toContain('>Orden de desempate<')
    expect(out).not.toContain('Cómo se arman las parejas')
  })

  it('cada fila cuenta en la unidad de SU deporte', () => {
    const pingPong = bloque('PING_PONG', 'Ping pong', { ...PADEL_CONFIG, matchFormat: SPORTS.PING_PONG.format }, FIFA_SHAPE)
    const out = html([PADEL(), FIFA(), pingPong])
    expect(bloqueDe(out, 'Pádel')).toContain('>1 set a 4 games<')
    expect(bloqueDe(out, 'FIFA')).toContain('>Marcador de goles<')
    expect(bloqueDe(out, 'Ping pong')).toContain('>mejor de 3 sets a 11 puntos<')
  })

  it('`narrateRules` recibe la unidad del bloque y su forma, con `fixedTeams`', () => {
    mockedNarrateRules.mockClear()
    html([PADEL(), FIFA()])
    expect(mockedNarrateRules).toHaveBeenCalledWith(PADEL_CONFIG, PADEL_SHAPE, 'games')
    expect(mockedNarrateRules).toHaveBeenCalledWith(FIFA_CONFIG, FIFA_SHAPE, 'goles')
  })

  /**
   * El filtro sólo perdona las secciones que `narrateRules` puede omitir por
   * diseño. Si `narrateRules` alguna vez deja de producir OTRA sección que el
   * acordeón sigue pidiendo, el `throw` de `rules-body.tsx` tiene que seguir
   * vivo: un bug de verdad no se tapa.
   */
  it('una sección realmente faltante sigue tirando el error: el filtro no la tapa', () => {
    const real = mockedNarrateRules.getMockImplementation()
    if (real === undefined) throw new Error('narrateRules no está mockeada como se esperaba')
    mockedNarrateRules.mockImplementationOnce((config, shape, unit) =>
      real(config, shape, unit).filter((section) => section.title !== 'Los puntos'),
    )
    expect(() => html([PADEL()])).toThrow(/no tiene la sección "Los puntos"/)
  })
})

describe('Reglas — las reglas de la casa, el texto libre de cada deporte', () => {
  it('sin texto no hay rótulo; con texto sale entre el reglamento y "Más detalle"', () => {
    expect(html([PADEL()])).not.toContain('Reglas de la casa')
    const out = html([PADEL('Traer pelotas nuevas.')])
    expect(out).toContain('Traer pelotas nuevas.')
    expect(out.indexOf('Gana 10')).toBeLessThan(out.indexOf('Reglas de la casa'))
    expect(out.indexOf('Reglas de la casa')).toBeLessThan(out.indexOf('<details'))
  })

  it('cada deporte muestra el suyo y nunca el del otro', () => {
    const out = html([PADEL('Traer pelotas nuevas.'), FIFA('Se juega con barro.')])
    expect(bloqueDe(out, 'Pádel')).toContain('Traer pelotas nuevas.')
    expect(bloqueDe(out, 'Pádel')).not.toContain('Se juega con barro.')
    expect(bloqueDe(out, 'FIFA')).toContain('Se juega con barro.')
    expect(bloqueDe(out, 'FIFA')).not.toContain('Traer pelotas nuevas.')
  })

  it('escapa el texto libre: un <script> no pasa', () => {
    const out = html([PADEL('<script>alert(1)</script>')])
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })
})

describe('Reglas — el acordeón de "Más detalle" sigue abriendo', () => {
  let container: HTMLDivElement | null = null
  afterEach(() => {
    container?.remove()
    container = null
  })

  it('tocar una fila abre su cuerpo, con la cláusula de invitados de las parejas', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(RulesBody, { seasonId: 's1', disciplines: [PADEL()], adminName: 'Marce', isAdmin: false }))
    })
    expect(container.textContent).not.toContain('se suma un invitado')

    const fila = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Formato de partido'))
    expect(fila).toBeDefined()
    await act(async () => fila?.click())

    expect(container.textContent).toContain('Se arman parejas con todos.')
    expect(container.textContent).toContain('se suma un invitado')
    expect(container.textContent).not.toContain('juegan todos contra todos')
    await act(async () => root.unmount())
  })
})
