import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { defaultConfig, type DisciplineShape } from '@/core'
import { RulesBody } from './rules-body'

// El mock envuelve la `narrateRules` real (no la reemplaza): todos los tests
// de este archivo, salvo el que arma a propósito una sección faltante (3a.9,
// más abajo), corren contra el comportamiento de verdad.
vi.mock('@/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/core')>()
  return { ...real, narrateRules: vi.fn(real.narrateRules) }
})

const { narrateRules } = await import('@/core')
const mockedNarrateRules = vi.mocked(narrateRules)

/**
 * Reglas es la pantalla que se comparte con el grupo, y la fila "Formato de
 * partido" es la que W64 encontró mintiendo: un
 * torneo con pádel Y FIFA decía "1 set a 4 games" porque narraba
 * `primaryDiscipline(header)` y nada más.
 *
 * Se renderiza el JSX de verdad, igual que el paso 4 del wizard: la fila sale
 * del acordeón y hay que mirar el HTML para saber qué dice.
 */
const PADEL = defaultConfig(8).matchFormat
const FIFA = { ...PADEL, openScore: true }
const TODAY_SHAPE: DisciplineShape = { hasMasters: true, pairSize: 2, allowsDraw: true }

function html(
  formats: Array<{ label: string; matchFormat: typeof PADEL }>,
  shape: DisciplineShape = TODAY_SHAPE,
): string {
  return renderToStaticMarkup(
    createElement(RulesBody, {
      seasonId: 'season-1',
      config: defaultConfig(8),
      shape,
      formats,
      adminName: 'Marce',
      rulesText: '',
      isAdmin: false,
    }),
  )
}

describe('Reglas — la fila de formato', () => {
  /**
   * PIN de no-regresión: con una sola disciplina la pantalla dice EXACTAMENTE
   * lo de siempre, sin prefijo y sin nombrar a nadie. Es el caso de todos los
   * torneos que existen hoy.
   */
  it('con una sola disciplina dice lo mismo que siempre', () => {
    expect(html([{ label: 'Pádel', matchFormat: PADEL }])).toContain('1 set a 4 games')
    expect(html([{ label: 'Pádel', matchFormat: PADEL }])).not.toContain('Pádel: 1 set a 4 games')
  })

  /**
   * W64: desde PR20 rebanada D2 cada disciplina nace con la forma de marcador
   * de su kind, así que un torneo puede tener DOS formatos. Una sola línea
   * dejó de ser verdad ese día.
   */
  it('con dos formatos nombra los dos, y de quién es cada uno', () => {
    expect(
      html([
        { label: 'Pádel', matchFormat: PADEL },
        { label: 'FIFA', matchFormat: FIFA },
      ]),
    ).toContain('Pádel: 1 set a 4 games · FIFA: Marcador de goles')
  })

  /**
   * Dos disciplinas del MISMO formato no son dos cosas que nombrar: dos Pádel
   * de una misma temporada (que la app arma desde PR13) siguen leyendo como
   * hasta hoy.
   */
  it('dos disciplinas con el mismo formato no repiten la frase', () => {
    const paso = html([
      { label: 'Pádel', matchFormat: PADEL },
      { label: 'Pádel', matchFormat: PADEL },
    ])
    expect(paso).toContain('1 set a 4 games')
    expect(paso).not.toContain('Pádel: 1 set a 4 games')
  })
})

/**
 * Tarea 3a.9 (reglas-por-disciplina): `rulesRowsOf` filtra el acordeón con el
 * MISMO predicado que `narrateRules` usa para omitir la sección (design §Q4,
 * "both, from one shared predicate") — así que las dos obligaciones (no
 * PRODUCIR la sección y no PEDIRLA) no pueden divergir.
 */
describe('Reglas — filas condicionales del acordeón', () => {
  const soloUno = [{ label: 'FIFA', matchFormat: FIFA }]

  it('sin Masters, la fila Masters no aparece y no explota', () => {
    const out = html([{ label: 'Pádel', matchFormat: PADEL }], {
      hasMasters: false,
      pairSize: 2,
      allowsDraw: true,
    })
    expect(out).not.toContain('>Masters<')
  })

  it('con lados de uno, ni Masters ni "Cómo se arman las parejas" aparecen y no explota', () => {
    const out = html(soloUno, { hasMasters: false, pairSize: 1, allowsDraw: true })
    expect(out).not.toContain('>Masters<')
    expect(out).not.toContain('Cómo se arman las parejas')
  })

  /**
   * El filtro sólo perdona las DOS secciones que `narrateRules` puede omitir
   * por diseño. Si `narrateRules` alguna vez deja de producir OTRA sección
   * que el acordeón sigue pidiendo, el `throw` de `rules-body.tsx:59` tiene
   * que seguir vivo — R7, "genuine bug still caught". Se fuerza acá filtrando
   * "Los puntos" de una respuesta real, porque ningún `shape` legítimo hace
   * que `narrateRules` la omita de verdad.
   */
  it('una sección realmente faltante sigue tirando el error: el filtro no la tapa', () => {
    const real = mockedNarrateRules.getMockImplementation()
    if (real === undefined) throw new Error('narrateRules no está mockeada como se esperaba')
    mockedNarrateRules.mockImplementationOnce((config, shape) =>
      real(config, shape).filter((section) => section.title !== 'Los puntos'),
    )
    expect(() => html([{ label: 'Pádel', matchFormat: PADEL }])).toThrow(
      /no tiene la sección "Los puntos"/,
    )
  })
})
