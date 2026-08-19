import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { defaultConfig, type DisciplineId, type SeasonConfig } from '@/core'
import type { DisciplineHeader } from '@/db/read'

/**
 * EL PUNTO DE UNIÓN de las tres pantallas que narran el formato del torneo.
 *
 * La ronda 21 extrajo `PasoFormato` y `RulesBody` a componentes exportados y
 * los cubrió renderizándolos. Quedaron bien cubiertos — y la ronda 22 midió
 * que el CABLEADO seguía sin nada: tres mutaciones de una línea en el punto
 * de unión pasaban `npm test` en verde (531/531) y `tsc` en 0.
 *
 * · M-A: `<PasoFormato picked={['PADEL']}>` — W63 vuelve para una liga de
 *   solo FIFA.
 * · M-B: el paso 4 se desconecta: `<PasoFormato/>` → `<p>paso 4</p>`.
 * · M-C: `reglas/page.tsx` vuelve a pasar UNA sola disciplina — W64 vuelve
 *   exacto.
 *
 * M-C es la que duele: el bug que W64 FUE vivía en `page.tsx`, no en
 * `RulesBody`, y el test del componente recibe `formats` a mano, así que
 * estructuralmente no puede verlo. Es la TERCERA vez que aparece la misma
 * lección (W59, el aviso de D1, W66): extraer a un módulo puro MUEVE el
 * riesgo al punto de unión, y ahí no queda nada.
 *
 * Este archivo cubre el punto de unión de las tres pantallas, con dos
 * herramientas distintas porque el techo de cada una es distinto:
 *
 * 1. **Las PÁGINAS se renderizan de verdad.** `ReglasPage` y `AjustesPage`
 *    son server components `async`: se los llama, se los renderiza con
 *    `renderToStaticMarkup` y se mira el HTML. Los lectores de `@/db/read`
 *    van mockeados; el resto —`primaryDiscipline`, `formatsLabel`,
 *    `steppersFor`, el JSX entero— corre de verdad. Esto mide COMPORTAMIENTO,
 *    no texto, así que sobrevive a que alguien refactorice el call site.
 *
 * 2. **El paso 4 del wizard se pincha por FUENTE.** `step` es estado interno
 *    de `Wizard` y en la suite no hay clicks, así que renderizando no se
 *    llega. Se pinchan los ARGUMENTOS del call site, no el nombre: la ronda
 *    18 midió que un assert por nombre de función no alcanza —pasarle una
 *    copia conserva el texto intacto— y el mis-wire de M-A es exactamente
 *    eso, el mismo nombre con otro argumento.
 */

/** El fuente sin comentarios de línea ni de bloque: lo que de verdad se ejecuta. */
function sinComentarios(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

const escena = vi.hoisted(() => ({ disciplines: [] as DisciplineHeader[] }))

vi.mock('@/db/server', () => ({
  serverClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'admin' } } }) },
  }),
}))

vi.mock('@/db/read', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/db/read')>()
  return {
    ...real,
    // Sólo los LECTORES: `primaryDiscipline` y `toDisciplineHeader` siguen
    // siendo los de verdad, que es la mitad que estas pantallas usan para
    // decidir de qué disciplina hablan.
    seasonHeader: async () => ({
      id: 's1',
      name: 'Torneo de prueba',
      status: 'ACTIVE',
      regularMatchdays: 10,
      isAdmin: true,
      inviteToken: 'token',
      disciplines: escena.disciplines,
    }),
    seasonRules: async () => ({ text: '', updatedAt: null }),
    seasonAdminName: async () => 'Marce',
    myEntryId: async () => null,
    matchdaysOf: async () => [],
    seasonSquadMembersOf: async () => [],
    playerNames: async () => new Map<string, string>(),
  }
})

const PADEL = defaultConfig(8)
const FIFA: SeasonConfig = { ...PADEL, matchFormat: { ...PADEL.matchFormat, openScore: true } }

function disciplina(id: string, kind: 'PADEL' | 'FIFA', config: SeasonConfig): DisciplineHeader {
  return { id: id as DisciplineId, kind, config, weight: 1, pairSize: kind === 'PADEL' ? 2 : 1 }
}

const SOLO_PADEL = [disciplina('d1', 'PADEL', PADEL)]
const PADEL_Y_FIFA = [disciplina('d1', 'PADEL', PADEL), disciplina('d2', 'FIFA', FIFA)]

async function reglas(disciplines: DisciplineHeader[]): Promise<string> {
  escena.disciplines = disciplines
  const { default: ReglasPage } = await import('@/app/torneo/[id]/reglas/page')
  return renderToStaticMarkup(await ReglasPage({ params: Promise.resolve({ id: 's1' }) }))
}

async function ajustes(disciplines: DisciplineHeader[]): Promise<string> {
  escena.disciplines = disciplines
  const { default: AjustesPage } = await import('@/app/torneo/[id]/ajustes/page')
  return renderToStaticMarkup(
    await AjustesPage({ params: Promise.resolve({ id: 's1' }), searchParams: Promise.resolve({}) }),
  )
}

describe('Reglas con sesión — la página entera, no el componente suelto', () => {
  /**
   * M-C. Volver a `formats={[{ label: '', matchFormat: primaryDiscipline(
   * header).config.matchFormat }]}` reintroduce W64 tal cual era, y con esto
   * se pone rojo.
   */
  it('nombra el formato de CADA disciplina del torneo', async () => {
    expect(await reglas(PADEL_Y_FIFA)).toContain('Pádel: 1 set a 4 games · FIFA: Marcador de goles')
  })

  /** PIN de no-regresión: un torneo de una sola disciplina dice lo de siempre. */
  it('con una sola disciplina dice exactamente lo de siempre', async () => {
    const html = await reglas(SOLO_PADEL)
    expect(html).toContain('1 set a 4 games')
    expect(html).not.toContain('Pádel: 1 set a 4 games')
  })
})

describe('Ajustes — la página entera', () => {
  it('la fila Formato nombra el de cada disciplina', async () => {
    expect(await ajustes(PADEL_Y_FIFA)).toContain(
      'Pádel: 1 set a 4 games · FIFA: Marcador de goles',
    )
  })

  /** PIN de no-regresión: con una sola disciplina la fila dice lo de siempre. */
  it('con una sola disciplina la fila dice exactamente lo de siempre', async () => {
    const html = await ajustes(SOLO_PADEL)
    expect(html).toContain('1 set a 4 games ›')
    expect(html).not.toContain('Pádel: 1 set a 4 games')
  })
})

describe('el paso 4 del wizard — el cableado que ningún render alcanza', () => {
  const fuente = sinComentarios(
    readFileSync(join(process.cwd(), 'app/torneos/nuevo/wizard.tsx'), 'utf8'),
  )
  /**
   * El call site entero, como lo escribe el fuente. El techo es un falso
   * POSITIVO —un prop con una arrow function adentro corta el `[^>]*`— que es
   * el lado correcto del que equivocarse: el test se pone rojo y se lee este
   * comentario.
   */
  const llamada = /<PasoFormato\b[^>]*\/>/.exec(fuente)?.[0] ?? ''

  /** M-B: el paso 4 desconectado deja esto en vacío. */
  it('el paso 4 monta PasoFormato', () => {
    expect(llamada).not.toBe('')
  })

  /**
   * M-A. `picked` es el argumento del que depende W63: con una lista fija el
   * paso 4 vuelve a ofrecer sets y games en una liga de solo FIFA, y los
   * cuatro tests de `steppersFor` y los tres de `PasoFormato` siguen verdes
   * porque el módulo está bien y lo que está mal es lo que le entra.
   */
  it('le pasa las disciplinas MARCADAS, la config viva y el setter', () => {
    expect(llamada).toMatch(/\bpicked=\{disciplines\}/)
    expect(llamada).toMatch(/\bconfig=\{config\}/)
    expect(llamada).toMatch(/\bonChange=\{setConfig\}/)
  })

  /**
   * Que el pin sea del ARGUMENTO y no del NOMBRE es la lección de la ronda
   * 18: un mis-wire conserva el nombre intacto. Esta mitad falla contra
   * cualquier versión de este chequeo que sólo mire `<PasoFormato`.
   */
  it('un mis-wire con el mismo nombre no lo satisface', () => {
    const misWire = `<PasoFormato config={config} picked={['PADEL']} errors={errors} onChange={setConfig} />`
    expect(misWire).toMatch(/<PasoFormato\b/)
    expect(/<PasoFormato\b[^>]*\/>/.exec(misWire)?.[0] ?? '').not.toMatch(
      /\bpicked=\{disciplines\}/,
    )
  })
})
