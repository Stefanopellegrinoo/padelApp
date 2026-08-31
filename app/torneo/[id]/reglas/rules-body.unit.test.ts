import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { defaultConfig, type DisciplineShape, type SeasonConfig } from '@/core'
import { RulesBody, type RulesBlock } from './rules-body'

// El mock envuelve la `narrateRules` real (no la reemplaza): todos los tests
// de este archivo, salvo el que arma a propósito una sección faltante (3a.9),
// corren contra el comportamiento de verdad.
vi.mock('@/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/core')>()
  return { ...real, narrateRules: vi.fn(real.narrateRules) }
})

const { narrateRules } = await import('@/core')
const mockedNarrateRules = vi.mocked(narrateRules)

/**
 * Reglas es la pantalla que se comparte con el grupo. Rebanada 3b de
 * "reglas por disciplina": `RulesBody` deja de recibir una config y un
 * `formats: FormatRow[]` compartidos, y pasa a recibir `disciplines`, un
 * bloque completo (config + shape + texto libre) por disciplina — la fila
 * "Formato de partido" que W64 encontró mintiendo ya no se arregla agrupando
 * formatos, se arregla porque cada bloque narra SU PROPIA config.
 */
const PADEL_CONFIG = defaultConfig(8)
const FIFA_CONFIG: SeasonConfig = {
  ...PADEL_CONFIG,
  matchFormat: { ...PADEL_CONFIG.matchFormat, openScore: true },
}
const TODAY_SHAPE: DisciplineShape = { hasMasters: true, pairSize: 2, allowsDraw: true }
const FIFA_SHAPE: DisciplineShape = { hasMasters: false, pairSize: 1, allowsDraw: true }

function bloque(
  label: string,
  config: SeasonConfig = PADEL_CONFIG,
  shape: DisciplineShape = TODAY_SHAPE,
  text = '',
): RulesBlock {
  return { label, config, shape, text }
}

function html(disciplines: RulesBlock[], adminName = 'Marce', isAdmin = false): string {
  return renderToStaticMarkup(
    createElement(RulesBody, { seasonId: 'season-1', disciplines, adminName, isAdmin }),
  )
}

/**
 * PIN de byte-identidad literal: capturado con `renderToStaticMarkup` contra
 * el `RulesBody` de ANTES de esta rebanada (props `config`/`shape`/`formats`
 * compartidos, un solo bloque siempre), con una sola disciplina — el caso de
 * TODOS los torneos que existen hoy. Si esta cadena cambia un solo carácter,
 * la rebanada 3b dejó de ser un cambio de pantalla puro.
 */
const SIN_TEXTO_LIBRE =
  '<div class="flex flex-col gap-4 pt-4"><h1 class="text-[26px] font-extrabold tracking-[-.03em]">Reglas</h1><p class="text-pretty text-[13.5px] leading-[1.5] font-[550] text-muted">Las reglas de este torneo, como quedaron cuando Marce lo creó.</p><div><div class="border-b border-line"><button type="button" class="flex w-full items-center justify-between gap-3 py-[15px] text-left"><span class="flex-1"><span class="block text-[14.5px] font-[750]">Formato de partido</span><span class="block text-[12.5px] font-bold text-accent-link">1 set a 4 games</span></span><span class="text-[13px] font-extrabold text-muted">+</span></button></div><div class="border-b border-line"><button type="button" class="flex w-full items-center justify-between gap-3 py-[15px] text-left"><span class="flex-1"><span class="block text-[14.5px] font-[750]">Cómo se arman las parejas</span><span class="block text-[12.5px] font-bold text-accent-link">Cruzando el orden de desempate</span></span><span class="text-[13px] font-extrabold text-muted">+</span></button></div><div class="border-b border-line"><button type="button" class="flex w-full items-center justify-between gap-3 py-[15px] text-left"><span class="flex-1"><span class="block text-[14.5px] font-[750]">Puntos por posición</span><span class="block text-[12.5px] font-bold text-accent-link">10 · 6 · 3 · 1</span></span><span class="text-[13px] font-extrabold text-muted">+</span></button></div><div class="border-b border-line"><button type="button" class="flex w-full items-center justify-between gap-3 py-[15px] text-left"><span class="flex-1"><span class="block text-[14.5px] font-[750]">Orden de desempate</span><span class="block text-[12.5px] font-bold text-accent-link">Se refresca cada 3 fechas</span></span><span class="text-[13px] font-extrabold text-muted">+</span></button></div><div class="border-b border-line"><button type="button" class="flex w-full items-center justify-between gap-3 py-[15px] text-left"><span class="flex-1"><span class="block text-[14.5px] font-[750]">Fechas que cuentan</span><span class="block text-[12.5px] font-bold text-accent-link">Las mejores 8 de 10</span></span><span class="text-[13px] font-extrabold text-muted">+</span></button></div><div class="border-b border-line"><button type="button" class="flex w-full items-center justify-between gap-3 py-[15px] text-left"><span class="flex-1"><span class="block text-[14.5px] font-[750]">Masters</span><span class="block text-[12.5px] font-bold text-accent-link">Los 4 primeros</span></span><span class="text-[13px] font-extrabold text-muted">+</span></button></div></div></div>'

const CON_TEXTO_LIBRE_Y_ADMIN =
  '<div class="flex flex-col gap-4 pt-4"><h1 class="text-[26px] font-extrabold tracking-[-.03em]">Reglas</h1><p class="text-pretty text-[13.5px] leading-[1.5] font-[550] text-muted">Las reglas de este torneo, como quedaron cuando Marce lo creó.</p><div><div class="border-b border-line"><button type="button" class="flex w-full items-center justify-between gap-3 py-[15px] text-left"><span class="flex-1"><span class="block text-[14.5px] font-[750]">Formato de partido</span><span class="block text-[12.5px] font-bold text-accent-link">1 set a 4 games</span></span><span class="text-[13px] font-extrabold text-muted">+</span></button></div><div class="border-b border-line"><button type="button" class="flex w-full items-center justify-between gap-3 py-[15px] text-left"><span class="flex-1"><span class="block text-[14.5px] font-[750]">Cómo se arman las parejas</span><span class="block text-[12.5px] font-bold text-accent-link">Cruzando el orden de desempate</span></span><span class="text-[13px] font-extrabold text-muted">+</span></button></div><div class="border-b border-line"><button type="button" class="flex w-full items-center justify-between gap-3 py-[15px] text-left"><span class="flex-1"><span class="block text-[14.5px] font-[750]">Puntos por posición</span><span class="block text-[12.5px] font-bold text-accent-link">10 · 6 · 3 · 1</span></span><span class="text-[13px] font-extrabold text-muted">+</span></button></div><div class="border-b border-line"><button type="button" class="flex w-full items-center justify-between gap-3 py-[15px] text-left"><span class="flex-1"><span class="block text-[14.5px] font-[750]">Orden de desempate</span><span class="block text-[12.5px] font-bold text-accent-link">Se refresca cada 3 fechas</span></span><span class="text-[13px] font-extrabold text-muted">+</span></button></div><div class="border-b border-line"><button type="button" class="flex w-full items-center justify-between gap-3 py-[15px] text-left"><span class="flex-1"><span class="block text-[14.5px] font-[750]">Fechas que cuentan</span><span class="block text-[12.5px] font-bold text-accent-link">Las mejores 8 de 10</span></span><span class="text-[13px] font-extrabold text-muted">+</span></button></div><div class="border-b border-line"><button type="button" class="flex w-full items-center justify-between gap-3 py-[15px] text-left"><span class="flex-1"><span class="block text-[14.5px] font-[750]">Masters</span><span class="block text-[12.5px] font-bold text-accent-link">Los 4 primeros</span></span><span class="text-[13px] font-extrabold text-muted">+</span></button></div></div><div class="space-y-2 text-pretty text-[13.5px] leading-[1.5] font-[550] text-text [&amp;_li]:mt-1 [&amp;_strong]:font-extrabold [&amp;_ul]:list-disc [&amp;_ul]:pl-5"><p>Traer pelotas nuevas.</p></div><a class="rounded-field border-[1.5px] border-line p-4 text-center text-[14px] font-extrabold" href="/torneo/season-1/ajustes">Editar reglas</a></div>'

describe('Reglas — con una sola disciplina, byte a byte como antes de esta rebanada (R10)', () => {
  it('sin texto libre y sin admin', () => {
    expect(html([bloque('Pádel')])).toBe(SIN_TEXTO_LIBRE)
  })

  it('con texto libre y con sesión de admin', () => {
    expect(html([bloque('Pádel', PADEL_CONFIG, TODAY_SHAPE, 'Traer pelotas nuevas.')], 'Marce', true)).toBe(
      CON_TEXTO_LIBRE_Y_ADMIN,
    )
  })
})

describe('Reglas — la fila de formato, por bloque', () => {
  /** PIN de no-regresión: con una sola disciplina la pantalla dice EXACTAMENTE lo de siempre. */
  it('con una sola disciplina, el formato sale sin prefijo', () => {
    expect(html([bloque('Pádel')])).toContain('1 set a 4 games')
    expect(html([bloque('Pádel')])).not.toContain('Pádel: 1 set a 4 games')
  })

  /**
   * W64/rebanada 3b: ya no hay una fila compartida que agrupe formatos — cada
   * bloque tiene su PROPIA fila "Formato de partido", así que dos disciplinas
   * de formato distinto quedan una al lado de la otra, cada una con lo suyo.
   */
  it('con dos disciplinas, cada bloque nombra su PROPIO formato', () => {
    const out = html([bloque('Pádel', PADEL_CONFIG, TODAY_SHAPE), bloque('FIFA', FIFA_CONFIG, FIFA_SHAPE)])
    expect(out).toContain('1 set a 4 games')
    expect(out).toContain('Marcador de goles')
    expect(out).not.toContain('Pádel: 1 set a 4 games · FIFA: Marcador de goles')
  })

  /**
   * `formatsLabel` agrupa por FORMATO para no repetir la frase en un resumen
   * de una línea (design §Q3) — pero acá no hay una línea, hay un bloque por
   * disciplina, y ese dedup deja de tener sentido: dos disciplinas son dos
   * bloques aunque compartan formato. Invierte a propósito el test que esta
   * pantalla tenía antes de la rebanada 3b (el mismo comportamiento que sigue
   * siendo correcto en Ajustes y en el wizard, que SÍ sacan una sola línea).
   */
  it('dos disciplinas del MISMO formato ya no se funden en una frase: cada bloque repite la suya', () => {
    const out = html([bloque('Pádel', PADEL_CONFIG, TODAY_SHAPE), bloque('Pádel', PADEL_CONFIG, TODAY_SHAPE)])
    expect(out.match(/1 set a 4 games/g)).toHaveLength(2)
    expect(out.match(/>Pádel<\/h2>/g)).toHaveLength(2)
  })
})

/**
 * Tarea 3a.9 (reglas-por-disciplina): `rulesRowsOf` filtra el acordeón con el
 * MISMO predicado que `narrateRules` usa para omitir la sección (design §Q4,
 * "both, from one shared predicate") — así que las dos obligaciones (no
 * PRODUCIR la sección y no PEDIRLA) no pueden divergir. Reescrito en 3b con la
 * API de `disciplines`, mismo comportamiento.
 */
describe('Reglas — filas condicionales del acordeón', () => {
  it('sin Masters, la fila Masters no aparece y no explota', () => {
    const out = html([bloque('Pádel', PADEL_CONFIG, { hasMasters: false, pairSize: 2, allowsDraw: true })])
    expect(out).not.toContain('>Masters<')
  })

  it('con lados de uno, ni Masters ni "Cómo se arman las parejas" aparecen y no explota', () => {
    const out = html([bloque('FIFA', FIFA_CONFIG, { hasMasters: false, pairSize: 1, allowsDraw: true })])
    expect(out).not.toContain('>Masters<')
    expect(out).not.toContain('Cómo se arman las parejas')
  })

  /**
   * El filtro sólo perdona las DOS secciones que `narrateRules` puede omitir
   * por diseño. Si `narrateRules` alguna vez deja de producir OTRA sección
   * que el acordeón sigue pidiendo, el `throw` de `rules-body.tsx` tiene que
   * seguir vivo — R7, "genuine bug still caught".
   */
  it('una sección realmente faltante sigue tirando el error: el filtro no la tapa', () => {
    const real = mockedNarrateRules.getMockImplementation()
    if (real === undefined) throw new Error('narrateRules no está mockeada como se esperaba')
    mockedNarrateRules.mockImplementationOnce((config, shape) =>
      real(config, shape).filter((section) => section.title !== 'Los puntos'),
    )
    expect(() => html([bloque('Pádel')])).toThrow(/no tiene la sección "Los puntos"/)
  })
})
