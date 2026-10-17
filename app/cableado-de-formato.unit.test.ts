import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { defaultConfig, type DisciplineId, type MatchdayFormat, type MatchdayFormatSetting, type SeasonConfig } from '@/core'
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
 * · M-C: `reglas/page.tsx` vuelve a pasar UNA sola disciplina (o vuelve a
 *   fundir el formato de todas en una sola frase) — W64 vuelve, ahora como
 *   "le falta un bloque entero" en vez de "la frase está mal" (rebanada 3b de
 *   "reglas por disciplina": la pantalla pasó de UN bloque compartido a N
 *   bloques, uno por disciplina).
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
 *    `reglamento`, el JSX entero— corre de verdad. Esto mide COMPORTAMIENTO,
 *    no texto, así que sobrevive a que alguien refactorice el call site.
 *
 * 2. **Lo que vive detrás de un click se pincha por FUENTE.** En la suite no
 *    hay clicks, así que renderizando no se llega. Se pinchan los ARGUMENTOS
 *    del call site, no el nombre: la ronda 18 midió que un assert por nombre
 *    de función no alcanza —pasarle una copia conserva el texto intacto— y el
 *    mis-wire de M-A es exactamente eso, el mismo nombre con otro argumento.
 *    (El wizard de cinco pasos que pinchaba esto ya no existe.)
 */

/** El fuente sin comentarios de línea ni de bloque: lo que de verdad se ejecuta. */
function sinComentarios(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

const escena = vi.hoisted(() => ({
  disciplines: [] as DisciplineHeader[],
  /** `null` = nadie logueado, que es la rama pública de Reglas (S76). */
  user: { id: 'admin' } as { id: string } | null,
  // Rebanada 3a de "reglas por disciplina": `hasMasters`/`pairSize`/
  // `allowsDraw` reales (0069), mismo criterio que `disciplina()` abajo — sin
  // esto la rama anónima le pasaría `undefined` a `RulesBody.shape`.
  // Torneos-deportes, Tarea 7: Reglas lee de acá en LAS DOS ramas (con y sin
  // sesión) — es la única fuente de `fixedTeams`/`formatoDefault`/`rulesText`
  // de cada bloque; `seasonHeader` sólo aporta `isAdmin`.
  publicFormats: [] as {
    kind: string
    config: unknown
    hasMasters: boolean
    pairSize: 1 | 2
    allowsDraw: boolean
    fixedTeams: boolean
    formatoDefault: MatchdayFormatSetting
    rulesText: string
  }[],
  // El texto libre de CADA disciplina para Ajustes (`disciplineRulesOf`).
  // Reglas ya no lo lee: su texto sale de `publicFormats[].rulesText`.
  rulesByDiscipline: new Map<DisciplineId, string>(),
  // El plantel de la temporada (`seasonSquadMembersOf`) y quién juega cada disciplina
  // (`squadSeedOrder`): vacíos salvo en el aviso de puntos de Ajustes.
  squad: [] as { id: string; displayName: string; playerId: string | null }[],
  playersByDiscipline: new Map<string, string[]>(),
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
    // Rebanada 2 de "reglas por disciplina": Ajustes lee esto para armar un
    // editor por disciplina (`disciplineId -> rules_text`). Reglas, con o sin
    // sesión, lee el texto de `publicFormats` (torneos-deportes, Tarea 7).
    disciplineRulesOf: async () => escena.rulesByDiscipline,
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
    // Task 4: `AjustesPage` pasó de `matchdaysOf` (disciplina por defecto) a
    // `seasonMatchdaysOf` (temporada entera) para que `playedCount` del
    // modal de borrar cubra TODAS las disciplinas, no sólo la primera.
    seasonMatchdaysOf: async () => [],
    seasonSquadMembersOf: async () => escena.squad,
    playerNames: async () => new Map<string, string>(),
  }
})

// `fixedTeams` no viaja en `DisciplineHeader`: el panel de reglas lo lee con `disciplineConfig`
// (mismo criterio que `[disciplina]/ajustes`). El cliente de esta suite no tiene `from`, así que
// se mockea sólo ese lector y el resto de `@/db/discipline` es el de verdad.
vi.mock('@/db/discipline', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db/discipline')>()),
  disciplineConfig: async () => ({ fixedTeams: false }),
}))

vi.mock('@/db/season', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db/season')>()),
  squadSeedOrder: async (_supabase: unknown, disciplineId: string) => escena.playersByDiscipline.get(disciplineId) ?? [],
}))

const PADEL = defaultConfig(8)
const FIFA: SeasonConfig = { ...PADEL, matchFormat: { ...PADEL.matchFormat, openScore: true } }

function disciplina(
  id: string,
  kind: 'PADEL' | 'FIFA',
  config: SeasonConfig,
  // §2.5, fix round 1 (HIGH 2): el default es ROUND_ROBIN para todo caller
  // que no necesita variarlo, pero NO es un adorno -- `AjustesPage` (vía
  // `FormatoDefault`) SÍ lee este campo, ver el describe "el panel de
  // FormatoDefault" más abajo. `ReglasPage` no lo toca. Es un literal
  // armado a mano: ninguna columna ni default de base participa acá.
  formatoDefault: MatchdayFormat = { kind: 'ROUND_ROBIN' },
): DisciplineHeader {
  const pairSize = kind === 'PADEL' ? 2 : 1
  // Mismo criterio que `disciplineProfile` (core/config.ts): FIFA es la
  // única disciplina de marcador abierto y la única con empate legal hoy.
  return {
    id: id as DisciplineId,
    kind,
    config,
    weight: 1,
    pairSize,
    hasMasters: pairSize === 2,
    allowsDraw: kind === 'FIFA',
    formatoDefault,
  }
}

const SOLO_PADEL = [disciplina('d1', 'PADEL', PADEL)]
const PADEL_Y_FIFA = [disciplina('d1', 'PADEL', PADEL), disciplina('d2', 'FIFA', FIFA)]

/**
 * Lo que devuelve `season_public_formats` para una disciplina: mismo criterio de
 * `hasMasters`/`allowsDraw` por `kind` que `disciplina()`, y por defecto parejas
 * que rotan con `ROUND_ROBIN` (lo de siempre). `fixedTeams` y `formatoDefault`
 * se pasan sólo cuando el test los necesita.
 */
function publicFormat(
  kind: 'PADEL' | 'FIFA' | 'PING_PONG',
  config: unknown,
  rulesText = '',
  { fixedTeams = false, formatoDefault = { kind: 'ROUND_ROBIN' } as MatchdayFormatSetting } = {},
) {
  const pairSize = kind === 'PADEL' ? (2 as const) : (1 as const)
  return { kind, config, pairSize, hasMasters: pairSize === 2, allowsDraw: kind === 'FIFA', fixedTeams, formatoDefault, rulesText }
}

/**
 * El bloque de UNA disciplina, recortado del HTML de la página entera:
 * desde su título `<h2>` (siempre aparece, uno por deporte) hasta el próximo
 * `<h2>` o el final del documento. Mismo
 * espíritu que `panelesDeFormato` de más abajo para Ajustes, pero por texto
 * de encabezado en vez de por atributo — Reglas no tiene `disciplineId` en
 * la rama SIN SESIÓN (0069 lo deja afuera a propósito), así que no hay un
 * identificador más chico que el nombre para cortar por acá.
 */
function bloqueDe(html: string, label: string): string {
  const re = new RegExp(`<h2[^>]*>${label}</h2>([\\s\\S]*?)(?=<h2[^>]*>|$)`)
  return re.exec(html)?.[1] ?? ''
}

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
   * M-C. Volver a construir los bloques sólo con `primaryDiscipline(header)`
   * reintroduce W64: FIFA desaparece de la pantalla entera, no sólo de una
   * frase. Con esto se pone rojo. Torneos-deportes Tarea 7: cada bloque trae
   * su reglamento arriba y su acordeón de siempre en "Más detalle".
   */
  it('dibuja un bloque por disciplina: el reglamento arriba, su acordeón en "Más detalle"', async () => {
    escena.user = { id: 'admin' }
    escena.publicFormats = [publicFormat('PADEL', PADEL), publicFormat('FIFA', FIFA)]
    const html = await reglas(PADEL_Y_FIFA)
    expect(html).toContain('>Pádel</h2>')
    expect(html).toContain('>FIFA</h2>')

    const padel = bloqueDe(html, 'Pádel')
    expect(padel).toContain('Parejas que rotan.')
    expect(padel.indexOf('Parejas que rotan.')).toBeLessThan(padel.indexOf('<details'))
    expect(padel.slice(padel.indexOf('<details'))).toContain('1 set a 4 games')

    const fifa = bloqueDe(html, 'FIFA')
    expect(fifa).toContain('Partidos a goles; se puede empatar.')
    expect(fifa.indexOf('Partidos a goles')).toBeLessThan(fifa.indexOf('<details'))
    expect(fifa.slice(fifa.indexOf('<details'))).toContain('Marcador de goles')
    // La frase combinada de antes de 3b ya no existe en ningún lado.
    expect(html).not.toContain('Pádel: 1 set a 4 games · FIFA: Marcador de goles')
  })

  /**
   * R11: el bloque de Pádel narra Masters y "Cómo se arman las parejas"
   * (`hasMasters: true, pairSize: 2`); el de FIFA (`hasMasters: false,
   * pairSize: 1`) no narra ninguna de las dos. Cada uno muestra SU PROPIO
   * texto libre y nunca el del otro.
   */
  it('cada bloque narra su propia disciplina y su propio texto libre', async () => {
    escena.user = { id: 'admin' }
    escena.publicFormats = [
      publicFormat('PADEL', PADEL, 'Traer pelotas nuevas.'),
      publicFormat('FIFA', FIFA, 'Se juega con barro.'),
    ]
    const html = await reglas(PADEL_Y_FIFA)
    const padel = bloqueDe(html, 'Pádel')
    const fifa = bloqueDe(html, 'FIFA')

    expect(padel).toContain('>Masters<')
    expect(padel).toContain('Cómo se arman las parejas')
    expect(padel).toContain('Traer pelotas nuevas.')

    expect(fifa).not.toContain('>Masters<')
    expect(fifa).not.toContain('Cómo se arman las parejas')
    expect(fifa).toContain('Se juega con barro.')
    expect(fifa).not.toContain('Traer pelotas nuevas.')
  })

  /** Las dos reglas de juego que suma `season_public_formats` (0099) llegan hasta el reglamento. */
  it('parejas fijas y fecha AUTO: el reglamento lo dice y no hay fila de armado de parejas', async () => {
    escena.user = { id: 'admin' }
    escena.publicFormats = [publicFormat('PADEL', PADEL, '', { fixedTeams: true, formatoDefault: { kind: 'AUTO' } })]
    const html = await reglas(SOLO_PADEL)
    expect(html).toContain('Parejas fijas.')
    expect(html).toContain('Cada fecha se arma sola, según cuántos vengan.')
    expect(html).not.toContain('Cómo se arman las parejas')
  })

  it('quien organiza ve "Editar reglas"; la línea fija sale una sola vez', async () => {
    escena.user = { id: 'admin' }
    escena.publicFormats = [publicFormat('PADEL', PADEL), publicFormat('FIFA', FIFA)]
    const html = await reglas(PADEL_Y_FIFA)
    expect(html).toContain('Editar reglas')
    expect(html.split('Alguna fecha puede jugarse a otra cosa: se avisa en esa fecha.')).toHaveLength(2)
  })

  /** Con una sola disciplina el título igual aparece (§6: siempre con su título). */
  it('con una sola disciplina el título también sale', async () => {
    escena.user = { id: 'admin' }
    escena.publicFormats = [publicFormat('PADEL', PADEL)]
    const html = await reglas(SOLO_PADEL)
    expect(html).toContain('>Pádel</h2>')
    expect(html).toContain('1 set a 4 games')
    expect(html).not.toContain('Pádel: 1 set a 4 games')
  })
})

/**
 * El panel que cuenta y edita las reglas de un deporte, tal cual sale al HTML. Antes de Task 4
 * (docs/plan-arquitectura-de-paginas.md) el contenedor dibujaba uno POR DISCIPLINA acá mismo
 * (C36); ahora sólo lo hace con UNA disciplina -- con 2+, este panel se mudó a
 * `[disciplina]/ajustes` (`[disciplina]/ajustes/page.unit.test.ts` prueba ese caso). El
 * `id="formato"` (el ancla de la fila de arriba) sigue en el contenedor, no en cada `<section>`.
 * Torneos-deportes, Tarea 14: el panel es `ReglasDeporte` (`data-reglas-deporte`), que reemplaza a
 * "Formato" y "Formato de las fechas".
 */
function panelDeReglas(html: string): string {
  return /<section data-reglas-deporte="[^"]*"[\s\S]*?<\/section>/.exec(html)?.[0] ?? ''
}

describe('Ajustes — la página entera', () => {
  /** PIN de no-regresión: con una sola disciplina la fila dice lo de siempre. */
  it('con una sola disciplina la fila dice exactamente lo de siempre', async () => {
    const html = await ajustes(SOLO_PADEL)
    expect(html).toContain('1 set a 4 games ›')
    expect(html).not.toContain('Pádel: 1 set a 4 games')
  })

  /**
   * PIN de no-regresión: un torneo de UNA sola disciplina —o sea todos los
   * que existen hoy— sigue mostrando el panel de reglas inline, sin sufijo.
   * Es la propiedad que Task 4 exige para el caso simple (§5 del diseño).
   *
   * Este `it` sólo fija el título y que el panel exista, no el documento
   * entero -- no es el chequeo byte-a-byte. Ese diff (versión de antes de
   * la Task contra la de después) se hizo a mano una vez, sin harness en el
   * repo para volver a correrlo.
   */
  it('con una sola disciplina el panel de reglas sigue inline, sin sufijo', async () => {
    expect(panelDeReglas(await ajustes(SOLO_PADEL))).toContain('Reglas de Pádel')
  })

  /**
   * Task 4: con 2+ disciplinas, la fila "Formato" y el panel que edita ya no
   * viven en el contenedor -- se mudaron a `[disciplina]/ajustes`. Antes de
   * esta Task la fila combinaba los dos formatos
   * ("Pádel: 1 set a 4 games · FIFA: Marcador de goles"); ahora directamente
   * no se dibuja, en vez de quedar apuntando a un `#formato` que ya no
   * existe acá (el defecto medido: el ancla siempre caía en la [0]).
   */
  it('con 2+ disciplinas la fila y el panel de reglas desaparecen del contenedor', async () => {
    const html = await ajustes(PADEL_Y_FIFA)
    expect(html).not.toContain('Formato')
    expect(panelDeReglas(html)).toBe('')
  })

  /**
   * Task 4 (docs/plan-arquitectura-de-paginas.md): con 2+ disciplinas la
   * lista de `Disciplinas` es la única forma de llegar a los ajustes de una
   * en particular, así que cada fila entra ahí, no a la tabla.
   */
  it('con 2+ disciplinas la lista de Disciplinas linkea a los ajustes de cada una', async () => {
    const html = await ajustes(PADEL_Y_FIFA)
    expect(html).toContain('href="/torneo/s1/padel/ajustes"')
    expect(html).toContain('href="/torneo/s1/fifa/ajustes"')
  })

  /** Con una sola, el link de siempre a la tabla -- no hay una segunda pantalla de ajustes a la que apuntar. */
  it('con una sola disciplina la lista de Disciplinas linkea a la tabla, sin cambio', async () => {
    const html = await ajustes(SOLO_PADEL)
    expect(html).toContain('href="/torneo/s1/padel"')
    expect(html).not.toContain('href="/torneo/s1/padel/ajustes"')
  })
})

describe('Ajustes — el conteo del modal de borrar cubre la temporada entera', () => {
  /**
   * Task 4: `playedCount` alimentaba a `EliminarTorneo` con `matchdaysOf`
   * (la disciplina por defecto), y con 2+ disciplinas subestimaba lo que en
   * realidad se pierde -- borrar el torneo se lleva las fechas de TODAS.
   *
   * El pin es de FUENTE, no de render: el texto que muestra `playedCount`
   * vive detrás de `{open && ...}` en `eliminar.tsx` (`useState` interno,
   * arranca cerrado), así que un render estático -- sin clicks, este repo no
   * tiene runner E2E -- no lo alcanza. Mismo techo que el punto 2 de
   * la cabecera: `seasonMatchdaysOf` y `matchdaysOf` son identificadores
   * DISTINTOS (mayúscula/minúscula en la M), así que el mis-wire que este
   * test tiene que agarrar no cambia ningún texto visible -- cambia CUÁL
   * lectura corre, y eso sólo se ve en el call site.
   */
  const fuente = sinComentarios(
    readFileSync(join(process.cwd(), 'app/torneo/[id]/ajustes/page.tsx'), 'utf8'),
  )

  it('playedCount sale de seasonMatchdaysOf (temporada entera), no de matchdaysOf (disciplina por defecto)', () => {
    expect(fuente).toMatch(/\bseasonMatchdaysOf\(supabase, seasonId\)/)
    expect(fuente).not.toMatch(/\bmatchdaysOf\(supabase, seasonId\)/)
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
  it('dibuja un bloque por disciplina: el reglamento arriba, su acordeón en "Más detalle"', async () => {
    escena.user = null
    escena.publicFormats = [publicFormat('PADEL', PADEL), publicFormat('FIFA', FIFA)]
    const html = await reglas(PADEL_Y_FIFA)
    const padel = bloqueDe(html, 'Pádel')
    const fifa = bloqueDe(html, 'FIFA')
    expect(padel.indexOf('Parejas que rotan.')).toBeLessThan(padel.indexOf('<details'))
    expect(padel.slice(padel.indexOf('<details'))).toContain('1 set a 4 games')
    expect(fifa.indexOf('Partidos a goles')).toBeLessThan(fifa.indexOf('<details'))
    expect(fifa.slice(fifa.indexOf('<details'))).toContain('Marcador de goles')
    expect(html).not.toContain('Pádel: 1 set a 4 games · FIFA: Marcador de goles')
    expect(html).not.toContain('Editar reglas')
  })

  /** R11, rama anónima: mismo criterio que la rama con sesión — cada bloque narra su propia disciplina y su propio texto. */
  it('cada bloque narra su propia disciplina y su propio texto libre', async () => {
    escena.user = null
    escena.publicFormats = [
      publicFormat('PADEL', PADEL, 'Traer pelotas nuevas.'),
      publicFormat('FIFA', FIFA, 'Se juega con barro.'),
    ]
    const html = await reglas(PADEL_Y_FIFA)
    const padel = bloqueDe(html, 'Pádel')
    const fifa = bloqueDe(html, 'FIFA')

    expect(padel).toContain('>Masters<')
    expect(padel).toContain('Traer pelotas nuevas.')
    expect(fifa).not.toContain('>Masters<')
    expect(fifa).toContain('Se juega con barro.')
    expect(fifa).not.toContain('Traer pelotas nuevas.')
  })

  it('parejas fijas y fecha AUTO llegan al reglamento también sin sesión', async () => {
    escena.user = null
    escena.publicFormats = [publicFormat('PADEL', PADEL, '', { fixedTeams: true, formatoDefault: { kind: 'AUTO' } })]
    const html = await reglas(SOLO_PADEL)
    expect(html).toContain('Parejas fijas.')
    expect(html).toContain('Cada fecha se arma sola, según cuántos vengan.')
    expect(html).not.toContain('Cómo se arman las parejas')
  })

  /** La unidad sale del deporte (`unitOf`), no de un "games" fijo: el ping pong se juega a puntos, en el reglamento Y en el detalle. */
  it('cada bloque cuenta en la unidad de SU deporte: el ping pong, a puntos', async () => {
    escena.user = null
    const pingPong = { ...PADEL, matchFormat: { setsToWin: 2, gamesPerSet: 11, tieBreak: false, openScore: false } }
    escena.publicFormats = [publicFormat('PADEL', PADEL), publicFormat('PING_PONG', pingPong)]
    const html = await reglas(PADEL_Y_FIFA)
    const padel = bloqueDe(html, 'Pádel')
    const ping = bloqueDe(html, 'Ping pong')
    expect(padel).toContain('de 4 games')
    expect(ping).toContain('de 11 puntos')
    expect(ping.slice(ping.indexOf('<details'))).toContain('mejor de 3 sets a 11 puntos')
    expect(ping).not.toContain('games')
  })

  it('y con UNA sola sigue diciendo lo de siempre, con su título', async () => {
    escena.user = null
    escena.publicFormats = [publicFormat('PADEL', PADEL)]
    const html = await reglas(SOLO_PADEL)
    expect(html).toContain('>Pádel</h2>')
    expect(html).toContain('1 set a 4 games')
    expect(html).not.toContain('Pádel: 1 set a 4 games')
    expect(html).toContain('Ir al inicio')
  })

  it('un link muerto sigue mostrando la frase de link muerto, no un error', async () => {
    escena.user = null
    escena.publicFormats = []
    const html = await reglas([])
    expect(html).toContain('necesitás el link que te pasó tu grupo')
  })
})

describe('Ajustes — el aviso de puntos cuenta los asientos de CADA deporte, no el plantel entero', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, index) => `e${index + 1}`)
  const PADEL_6 = disciplina('d1', 'PADEL', defaultConfig(6))
  const fifa = (squadSize: number) =>
    disciplina('d2', 'FIFA', { ...defaultConfig(squadSize, 1), matchFormat: { ...PADEL.matchFormat, openScore: true } })

  function plantel(seats: number, players: Record<string, number>): void {
    escena.squad = ids(seats).map((id) => ({ id, displayName: id, playerId: null }))
    escena.playersByDiscipline = new Map(Object.entries(players).map(([id, n]) => [id, ids(n)]))
  }

  it('un deporte que juegan 5 de los 6 del plantel, con 5 valores de puntos: sin aviso', async () => {
    plantel(6, { d1: 6, d2: 5 })

    const html = await ajustes([PADEL_6, fifa(5)])

    expect(html).not.toContain('hacen falta')
  })

  it('un desajuste de verdad (lo juegan 4 y hay 5 valores de puntos) se sigue avisando', async () => {
    plantel(6, { d1: 6, d2: 4 })

    const html = await ajustes([PADEL_6, fifa(5)])

    expect(html).toContain('FIFA: Con un plantel de 4 hacen falta 4 valores de puntos, no 5.')
    expect(html).not.toContain('Pádel:')
  })
})
