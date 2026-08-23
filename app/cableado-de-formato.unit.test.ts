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

const escena = vi.hoisted(() => ({
  disciplines: [] as DisciplineHeader[],
  /** `null` = nadie logueado, que es la rama pública de Reglas (S76). */
  user: { id: 'admin' } as { id: string } | null,
  publicFormats: [] as { kind: 'PADEL' | 'FIFA'; config: unknown }[],
}))

vi.mock('@/db/server', () => ({
  serverClient: async () => ({
    auth: { getUser: async () => ({ data: { user: escena.user } }) },
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
    // La rama SIN SESIÓN. `season_public_rules` (0022) devuelve la config de
    // UNA disciplina —la de por defecto— y ni su `kind`, así que sola no
    // alcanza para narrar un torneo con dos formatos: eso es S76.
    // Sin disciplinas es un link muerto, que es lo que devuelve la función
    // real cuando no encuentra temporada. Nada de `PADEL` acá: la factoría de
    // `vi.mock` se HOISTEA y esa const todavía no existe cuando corre.
    publicRules: async () => {
      const primera = escena.disciplines[0]
      if (primera === undefined) return null
      return {
        name: 'Torneo de prueba',
        config: primera.config,
        text: '',
        updatedAt: null,
        adminName: 'Marce',
      }
    },
    publicFormats: async () => escena.publicFormats,
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
  const pairSize = kind === 'PADEL' ? 2 : 1
  return { id: id as DisciplineId, kind, config, weight: 1, pairSize, hasMasters: pairSize === 2 }
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

/**
 * Los paneles que editan el formato, tal cual salen al HTML — uno POR
 * DISCIPLINA desde C36. El `id="formato"` (el ancla de la fila de arriba) se
 * mudó al contenedor: con más de una disciplina, dejarlo en cada `<section>`
 * repetía el `id` y era HTML inválido.
 */
function panelesDeFormato(html: string): string[] {
  return [...html.matchAll(/<section data-formato="[^"]*"[\s\S]*?<\/section>/g)].map((match) => match[0])
}

/** El primero, que es el de la disciplina primaria. */
function panelDeFormato(html: string): string {
  return panelesDeFormato(html)[0] ?? ''
}

describe('Ajustes — el panel de Formato dice de qué disciplina habla', () => {
  /**
   * La fila de arriba anuncia el formato de LAS DOS disciplinas y su
   * `href="#formato"` ancla a un `<Formato>` alimentado con
   * `primaryDiscipline(header)`, que edita y guarda la disciplina [0] y nada
   * más. Antes de la ronda 21 la fila y el panel decían lo mismo; nombrar los
   * dos formatos arregló la fila y dejó el CONTROL narrando otro alcance. Es
   * W64 corrido una capa para abajo.
   *
   * El arreglo es que el panel diga de cuál habla, no que la fila diga menos:
   * achicar la fila revierte W64 en Ajustes, que la ronda 22 verificó cerrado
   * en pantalla.
   *
   * C36: esa tanda cerró diciendo "y no se abre camino a la segunda
   * disciplina: eso sería superficie nueva". Ahora SÍ lo hay —hay un panel
   * por disciplina, ver el test del final del describe— y este par sigue
   * probando lo suyo: que el nombre SIGUE a la disciplina que cada panel
   * edita, mirando el primero.
   */
  it('con pádel primero nombra Pádel, y son sus cinco steppers los que dibuja', async () => {
    const panel = panelDeFormato(await ajustes(PADEL_Y_FIFA))
    expect(panel).toContain('>Formato · Pádel</h2>')
    expect(panel).toContain('Sets por partido')
  })

  /**
   * La mitad que prueba que el nombre SIGUE a la disciplina que el panel
   * edita, en vez de ser un 'Pádel' escrito a mano: con FIFA en la posición
   * [0] el panel edita FIFA, y no dibuja los steppers de sets.
   */
  it('con FIFA primero nombra FIFA, y no dibuja los steppers de sets', async () => {
    const panel = panelDeFormato(
      await ajustes([disciplina('d1', 'FIFA', FIFA), disciplina('d2', 'PADEL', PADEL)]),
    )
    expect(panel).toContain('>Formato · FIFA</h2>')
    expect(panel).not.toContain('Sets por partido')
  })

  /**
   * PIN de no-regresión: un torneo de UNA sola disciplina —o sea todos los que
   * existen hoy— no gana un sufijo. No hay de qué desambiguar.
   */
  it('con una sola disciplina el panel dice exactamente lo de siempre', async () => {
    expect(panelDeFormato(await ajustes(SOLO_PADEL))).toContain('>Formato</h2>')
  })

  /**
   * C36: hay UN panel por disciplina. Editar sólo la [0] dejaba
   * `disciplines.has_masters` de la segunda sin ninguna pantalla que lo
   * cambiara —la decisión #4029 parte 2 dice "editable en Ajustes"— y, desde
   * que cada disciplina juega su propio Masters (decisión #4035), además
   * contradecía a la pantalla de Fechas, que ya dibuja el bloque en cada una.
   */
  it('dibuja un panel por disciplina, cada uno con su nombre (C36)', async () => {
    const paneles = panelesDeFormato(await ajustes(PADEL_Y_FIFA))
    expect(paneles).toHaveLength(2)
    expect(paneles[0]).toContain('>Formato · Pádel</h2>')
    expect(paneles[1]).toContain('>Formato · FIFA</h2>')
    //Y el de FIFA es el de a UNO: su check de Masters sale deshabilitado
    // (decisión #4029 parte 3), que es justo lo que no se podía ver antes.
    expect(paneles[1]).toContain('Una disciplina de a uno no juega Masters')
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

// ── S76 / la mitad anónima de W64 ────────────────────────────────────────────
//
// Reglas es la ÚNICA pantalla pública del torneo, y hasta acá su rama sin
// sesión narraba UN SOLO formato aunque el torneo tuviera dos: medido en
// Chromium en las rondas 22 y 23, decía `1 set a 4 games` sobre un torneo de
// pádel + FIFA. La causa es de SQL, no de pantalla: `season_public_rules`
// (0022) devuelve la config de la disciplina por defecto y ni siquiera su
// `kind`, y `anon` tiene `revoke all on all tables` (0009) — medido, lee 0
// tablas y ejecuta 1 función.
//
// Estos tests montan la PÁGINA con `user: null`, que es la rama que ningún
// test tocaba nunca.
describe('Reglas SIN SESIÓN — la mitad pública, que es la que faltaba', () => {
  it('nombra el formato de CADA disciplina cuando el torneo tiene dos', async () => {
    escena.user = null
    escena.publicFormats = [
      { kind: 'PADEL', config: PADEL },
      { kind: 'FIFA', config: FIFA },
    ]
    const html = await reglas(PADEL_Y_FIFA)
    expect(html).toContain('Pádel: 1 set a 4 games')
    expect(html).toContain('FIFA: Marcador de goles')
  })

  it('y con UNA sola sigue diciendo exactamente lo de siempre, sin prefijo', async () => {
    escena.user = null
    escena.publicFormats = [{ kind: 'PADEL', config: PADEL }]
    const html = await reglas(SOLO_PADEL)
    expect(html).toContain('1 set a 4 games')
    expect(html).not.toContain('Pádel: 1 set a 4 games')
  })

  it('un link muerto sigue mostrando la frase de link muerto, no un error', async () => {
    escena.user = null
    escena.publicFormats = []
    const html = await reglas([])
    expect(html).toContain('necesitás el link que te pasó tu grupo')
  })
})
