import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { buildFixture, defaultConfig, type DisciplineId, type MatchdayFormat, type Side } from '@/core'
import type { DisciplineHeader, MatchdaySummary, MatchWithId } from '@/db/read'
import type { PairingContext } from '@/db/matchday'

/**
 * `FechaDetailPage` entera, RENDERIZADA — no un componente suelto. Es el
 * mismo techo que `cableado-de-formato.unit.test.ts` ya usa para
 * `ReglasPage`/`AjustesPage`: server component `async`, llamado directo,
 * `@/db/read` (y acá también `@/db/season`, `@/db/server`) mockeados con
 * `vi.mock`+`importOriginal`+spread, factoría con `vi.hoisted`.
 *
 * Por qué la página entera y no `Llave`/`SelectorDeFormato` sueltos (#3957,
 * la regla de las seis veces): D2 le da su primer consumidor de producción a
 * tres cosas — `advancePhase`, el grant `update(formato)`, `suggestFormat` —
 * y el cableado de un componente suelto NO ve si `page.tsx` le pasa el
 * argumento equivocado. Acá se pincha ESO: qué llega, no que el componente
 * exista.
 *
 * Lo que NO cubre: la interacción. Esta suite renderiza, no clickea — no hay
 * runner E2E en este repo. Ver el reporte de esta rebanada para el detalle
 * de qué queda sin cubrir por esa razón.
 */

const D1 = 'd1' as DisciplineId

const escena = vi.hoisted(() => ({
  status: 'OPEN' as 'DRAFT' | 'OPEN' | 'CLOSED',
  formato: { kind: 'ROUND_ROBIN' } as MatchdayFormat,
  matches: [] as MatchWithId[],
  sides: [] as Side[],
  isAdmin: true,
  // S93/S94 (verify-report-pre-contract #4026): `discipline.pairSize` nacía
  // hardcodeado en `1` acá abajo -- para el armado de PÁDEL (sideSize=2)
  // hace falta poder tocarlo por test, mismo patrón que `status`/`formato`.
  pairSize: 1 as 1 | 2,
  // El techo de partidos de la disciplina. `undefined` = sin la clave en el
  // jsonb, o sea el default de su `sideSize` — que es como están las dos
  // configs vivas de producción.
  maxMatches: undefined as number | undefined,
  // Vacío salvo en los tests que necesitan `frozenTableRows` reordenando de
  // verdad (W70, verify-report-pr21 #4004): con el Map vacío de siempre
  // ninguna fila tiene puesto congelado, así que `tableRows` es LITERALMENTE
  // `standings` sin tocar y `orderMoved` da `false` siempre — la pie de la
  // llave (`bracketOrderNote`) nunca se podría ejercitar contra eso.
  frozenPoints: new Map<string, { position: number; points: number }>(),
  // S83 (verify-report-pr21 #4004): lo que `pairingContextFor` (`@/db/matchday`)
  // devolvería HOY — page.tsx lo usa para la vista previa del reparto en
  // grupos de una fecha DRAFT. `buildSides`/`groupSides` NO se mockean: corren
  // de verdad sobre este `input`, así que el reparto que el test ve es el
  // mismo algoritmo que `generatePairs` usaría al confirmar.
  pairingContext: {
    input: {
      present: ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8'],
      points: new Map(),
      snapshot: ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8'],
      defenders: null,
      defendersAlreadyRepeated: false,
      previousPairs: [],
      guestIds: [],
      fixedPairs: [],
    },
    pairSize: 1,
  } as unknown as PairingContext,
}))

vi.mock('@/db/matchday', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/db/matchday')>()
  return {
    ...real,
    pairingContextFor: async () => escena.pairingContext,
  }
})

vi.mock('@/db/server', () => ({
  serverClient: async () => ({}),
}))

vi.mock('@/db/season', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/db/season')>()
  return {
    ...real,
    awardsBefore: async () => new Map(),
    closedHistory: async () => null,
    frozenPointsOf: async () => escena.frozenPoints,
  }
})

vi.mock('@/db/read', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/db/read')>()
  // Función y no un const por el mismo motivo que `discipline()` de abajo:
  // `escena.maxMatches` se toca por test y tiene que leerse cuando corre.
  const config = () => ({
    ...defaultConfig(8, 1),
    matchFormat: { ...defaultConfig(8, 1).matchFormat, openScore: true },
    ...(escena.maxMatches === undefined ? {} : { maxMatches: escena.maxMatches }),
  })
  // Función, no un literal fijado al importar el mock: `escena.pairSize` se
  // toca por test (S93/S94, verify-report-pre-contract #4026), así que
  // `sideSize` tiene que leerse en el momento en que `seasonHeader` corre.
  function discipline(): DisciplineHeader {
    return { id: D1, kind: 'FIFA', config: config(), weight: 1, pairSize: escena.pairSize, hasMasters: false }
  }
  const entries = Array.from({ length: 8 }, (_, index) => ({
    id: `e${index + 1}`,
    displayName: `Jugador ${index + 1}`,
    kind: 'SQUAD' as const,
    seedPosition: index,
    playerId: null,
    matchdayId: null,
  }))

  function matchdaySummary(): MatchdaySummary {
    return {
      id: 'm1',
      number: 1,
      kind: 'REGULAR',
      status: escena.status,
      playedOn: '2026-03-05',
      disciplineId: D1,
      allowsDraw: false,
      formato: escena.formato,
    }
  }

  return {
    ...real,
    seasonHeader: async () => ({
      id: 's1',
      name: 'Torneo de prueba',
      status: 'ACTIVE',
      regularMatchdays: 10,
      isAdmin: escena.isAdmin,
      inviteToken: 'token',
      disciplines: [discipline()],
    }),
    seasonMatchdaysOf: async () => [matchdaySummary()],
    entriesOf: async () => entries,
    attendancesOf: async () => new Map(),
    pairLocksOf: async () => [],
    matchdayDetail: async () => ({
      matchday: matchdaySummary(),
      sides: escena.sides,
      matches: escena.matches,
      guestIds: [],
    }),
  }
})

function side(n: number): Side {
  return { size: 1, a: `e${n}` }
}

const ALL_SIDES = [1, 2, 3, 4, 5, 6, 7, 8].map(side)

function playedMatch(fase: MatchWithId['fase'], grupo: number, round: number, a: number, b: number): MatchWithId {
  return { id: `${fase}-${grupo}-${round}-${a}-${b}`, round, fase, grupo, sideA: side(a), sideB: side(b), sets: [{ gamesA: 3, gamesB: 1 }] }
}

function unplayedMatch(fase: MatchWithId['fase'], grupo: number, round: number, a: number, b: number): MatchWithId {
  return { id: `${fase}-${grupo}-${round}-${a}-${b}`, round, fase, grupo, sideA: side(a), sideB: side(b), sets: [] }
}

async function render(): Promise<string> {
  const { default: FechaDetailPage } = await import('./page')
  return renderToStaticMarkup(
    await FechaDetailPage({ params: Promise.resolve({ id: 's1', disciplina: 'fifa', n: '1' }) }),
  )
}

describe('el techo de partidos de la disciplina llega hasta el menú de formatos', () => {
  /**
   * Ese cableado —`page.tsx` → `Armado` → `matchdayShape` →
   * `SelectorDeFormato`— no lo cubría NADA: los unit probaban
   * `offerableFormats`, los db probaban el guard, y entre las dos puntas el
   * valor no viajaba, así que la pantalla ofrecía el techo por default y
   * `generatePairs` rechazaba después lo que la pantalla había ofrecido.
   * Lo encontró el navegador; vive acá porque acá es más barato.
   *
   * 8 presentes de a uno son 8 lados = 28 partidos de todos contra todos.
   */
  it('con un techo propio de 20, los 28 de todos contra todos no se ofrecen', async () => {
    escena.status = 'DRAFT'
    escena.isAdmin = true
    escena.pairSize = 1
    escena.maxMatches = 20

    const html = await render()

    expect(/<button[^>]*>Todos contra todos<\/button>/.test(html)).toBe(false)
    expect(html).toContain('2 grupos + llave') // 16 partidos, ése sí entra
  })

  it('no-regresión: sin techo propio rige el default de a uno (36) y sí se ofrece', async () => {
    escena.status = 'DRAFT'
    escena.isAdmin = true
    escena.pairSize = 1
    escena.maxMatches = undefined

    const html = await render()

    expect(/<button[^>]*>Todos contra todos<\/button>/.test(html)).toBe(true)
  })
})

describe('la fecha GROUPS_KNOCKOUT en juego — fase y llave (REQ-D8-1, decisión #3979)', () => {
  it('con la fase de grupos sin terminar: cuenta la fase y los grupos, sin botón de cerrar fase', async () => {
    escena.status = 'OPEN'
    escena.formato = { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 }
    escena.sides = ALL_SIDES
    escena.matches = [unplayedMatch('GRUPO', 1, 1, 1, 2), unplayedMatch('GRUPO', 2, 1, 5, 6)]

    const html = await render()

    expect(html).toContain('Fase actual: Fase de grupos')
    expect(html).toContain('Grupo 1')
    expect(html).toContain('Grupo 2')
    expect(html).not.toContain('>Cerrar fase<')
  })

  it('con la fase de grupos completa: el botón "Cerrar fase" aparece', async () => {
    escena.status = 'OPEN'
    escena.formato = { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 }
    escena.sides = ALL_SIDES
    escena.matches = [playedMatch('GRUPO', 1, 1, 1, 2), playedMatch('GRUPO', 2, 1, 5, 6)]

    const html = await render()

    expect(html).toContain('>Cerrar fase<')
  })

  /**
   * `advancePhase` tira "La llave ya llegó a la final" (db/matchday.ts) —
   * el botón se apaga ANTES de que el admin pueda pedir eso. Y el guard de
   * las decisiones #3979/#3988 se ve acá: con el tercer puesto SIN jugar,
   * "Cerrar fecha" tiene que estar HABILITADO igual — el fix de
   * `remainingMatches` es lo que hace que esto no quede roto.
   */
  it('con la final jugada: no ofrece "Cerrar fase", y "Cerrar fecha" no queda trabado por el tercer puesto sin jugar', async () => {
    escena.status = 'OPEN'
    escena.formato = { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 }
    escena.sides = ALL_SIDES
    escena.matches = [
      playedMatch('GRUPO', 1, 1, 1, 2),
      playedMatch('FINAL', 1, 1, 1, 5),
      unplayedMatch('TERCER_PUESTO', 1, 1, 2, 6),
    ]

    const html = await render()

    expect(html).not.toContain('>Cerrar fase<')
    expect(html).toContain('>Cerrar fecha<')
    expect(html).not.toContain('faltan 1 partidos')
  })
})

describe('la fecha GROUPS_KNOCKOUT abierta — la tabla filtra por fase (W71, design #3801 "Restricción de pureza")', () => {
  /**
   * Dos lados del MISMO grupo (1 y 2), empatados en puntos y diferencia de
   * juegos SOLO si se cuenta la llave — el mano a mano de GRUPO dice 1, el
   * de la FINAL dice 2 (lo contrario). `headToHead` (core/standings.ts)
   * devuelve el PRIMER partido que encuentra que los conecta, así que el
   * partido de la FINAL va PRIMERO en el array a propósito: sin filtrar por
   * fase, `computeStandings` lo encuentra antes que el de grupo y el 2
   * termina arriba del 1 — exactamente el riesgo que el design (#3801,
   * PUNTO 6) advierte: "el headToHead de dos lados del mismo grupo puede
   * quedar decidido por una semifinal [o cualquier partido de la llave]".
   */
  it('el mano a mano del grupo decide, no un partido de la llave entre los mismos dos lados', async () => {
    escena.status = 'OPEN'
    escena.formato = { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 }
    escena.sides = [1, 2, 3, 4].map(side)
    escena.matches = [
      playedMatch('FINAL', 1, 1, 2, 1), // side2 le gana a side1 — CONTRADICE el de grupo
      playedMatch('GRUPO', 1, 1, 1, 2), // side1 le gana a side2 — el resultado real del grupo
      playedMatch('GRUPO', 1, 1, 1, 3),
      playedMatch('GRUPO', 1, 1, 1, 4),
      playedMatch('GRUPO', 1, 1, 2, 3),
      playedMatch('GRUPO', 1, 1, 2, 4),
      playedMatch('GRUPO', 1, 1, 3, 4),
    ]

    const html = await render()

    // `Llave` (arriba) también nombra a los dos lados en la fila del partido
    // de GRUPO, así que buscar en la página entera encontraría "Jugador 1"
    // antes de tiempo sin decir nada del ORDEN de la tabla. Recortar desde
    // el título de la tabla aísla la sección que sí importa acá.
    const tabla = html.slice(html.indexOf('Tabla de la fecha'))
    expect(tabla.indexOf('Jugador 1')).toBeLessThan(tabla.indexOf('Jugador 2'))
  })
})

describe('la fecha GROUPS_KNOCKOUT abierta — la tabla del día separa por grupo (S82, verify-report-pr21 #4004)', () => {
  /**
   * 8 lados en 2 grupos de 4 (1-4 en el grupo 1, 5-8 en el grupo 2, dato de
   * los propios `match.grupo` — no depende de `groupSides`, que es cosa de
   * S83). Antes del fix, "Tabla de la fecha" era UNA tabla con las 8 filas
   * mezcladas: la pregunta del admin ("¿quién clasifica de MI grupo?") no
   * tenía respuesta. El test recorta desde "Tabla de la fecha" para no
   * confundirse con los "Grupo 1"/"Grupo 2" que `Llave` ya dibuja arriba.
   */
  it('dibuja una tabla por grupo, y cada lado aparece SÓLO en la suya', async () => {
    escena.status = 'OPEN'
    escena.formato = { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 }
    escena.sides = [1, 2, 3, 4, 5, 6, 7, 8].map(side)
    escena.matches = [
      playedMatch('GRUPO', 1, 1, 1, 2),
      playedMatch('GRUPO', 1, 1, 3, 4),
      playedMatch('GRUPO', 1, 2, 1, 3),
      playedMatch('GRUPO', 1, 2, 2, 4),
      playedMatch('GRUPO', 1, 3, 1, 4),
      playedMatch('GRUPO', 1, 3, 2, 3),
      playedMatch('GRUPO', 2, 1, 5, 6),
      playedMatch('GRUPO', 2, 1, 7, 8),
      playedMatch('GRUPO', 2, 2, 5, 7),
      playedMatch('GRUPO', 2, 2, 6, 8),
      playedMatch('GRUPO', 2, 3, 5, 8),
      playedMatch('GRUPO', 2, 3, 6, 7),
    ]

    const html = await render()

    const inicio = html.indexOf('Tabla de la fecha')
    expect(inicio).toBeGreaterThan(-1)
    const tabla = html.slice(inicio)
    const g1 = tabla.indexOf('Grupo 1')
    const g2 = tabla.indexOf('Grupo 2')
    expect(g1).toBeGreaterThan(-1)
    expect(g2).toBeGreaterThan(g1)

    const tablaGrupo1 = tabla.slice(g1, g2)
    const tablaGrupo2 = tabla.slice(g2)
    expect(tablaGrupo1).toContain('Jugador 1')
    expect(tablaGrupo1).toContain('Jugador 4')
    expect(tablaGrupo1).not.toContain('Jugador 5')
    expect(tablaGrupo1).not.toContain('Jugador 8')
    expect(tablaGrupo2).toContain('Jugador 5')
    expect(tablaGrupo2).toContain('Jugador 8')
    expect(tablaGrupo2).not.toContain('Jugador 1')
    expect(tablaGrupo2).not.toContain('Jugador 4')
  })
})

describe('la fecha GROUPS_KNOCKOUT abierta — un lado sin partidos de grupo NO desaparece (W82, verify-report-pr21-cierre #4016)', () => {
  /**
   * `formatoAbierto.groups` (2) promete dos grupos, pero `standingsMatches`
   * sólo tiene partidos del grupo 1 — el fixture real de C32 (cambiar el
   * formato después de sortear sin volver a sortear) deja exactamente esta
   * forma: `matchday.formato` dice una cosa, `matches.grupo` dice otra. Antes
   * del fix, `groupedStandings` armaba igual los 2 bloques que `formatoAbierto`
   * pedía, y el lado 5-8 —sin ninguna fila en `groupOfSide`— no entraba en
   * NINGÚN filtro: "GRUPO 2" salía con el título y cero filas, y esos cuatro
   * lados no aparecían en ningún otro lugar de la pantalla.
   *
   * Decisión (W82): en vez de partir con bloques huérfanos, la pantalla NO
   * separa por grupo cuando hay un lado sin partido de grupo — cae a la
   * MISMA tabla única que ya usa CLOSED/ROUND_ROBIN (así nadie desaparece,
   * los ocho lados que sí tienen resultado se ven ahí) — y agrega una nota
   * explícita diciendo por qué esta fecha no se puede partir todavía. Elegida
   * sobre inventar un grupo "sin asignar": la pantalla no puede saber en qué
   * grupo cae el lado que falta (esa es la pregunta que el propio C32 deja
   * sin responder), así que separarlo iría a adivinar.
   */
  it('con un lado sin partidos de grupo, la tabla NO parte en bloques huérfanos: los ocho siguen visibles y hay una nota', async () => {
    escena.status = 'OPEN'
    escena.formato = { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 }
    escena.sides = [1, 2, 3, 4, 5, 6, 7, 8].map(side)
    // Sólo el grupo 1 tiene partidos -- 5, 6, 7, 8 no aparecen en ningún
    // `match.grupo`, exactamente el fixture roto de C32.
    escena.matches = [
      playedMatch('GRUPO', 1, 1, 1, 2),
      playedMatch('GRUPO', 1, 1, 3, 4),
      playedMatch('GRUPO', 1, 2, 1, 3),
      playedMatch('GRUPO', 1, 2, 2, 4),
      playedMatch('GRUPO', 1, 3, 1, 4),
      playedMatch('GRUPO', 1, 3, 2, 3),
    ]

    const html = await render()

    const inicio = html.indexOf('Tabla de la fecha')
    expect(inicio).toBeGreaterThan(-1)
    const tabla = html.slice(inicio)

    // Nadie desaparece: los ocho lados siguen en la tabla, no sólo los cuatro
    // del grupo 1 con partidos.
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(tabla).toContain(`Jugador ${n}`)
    }
    // No se dibuja un bloque "Grupo 2" vacío -- ni ningún bloque partido: cae
    // a la tabla única.
    expect(tabla).not.toContain('Grupo 1')
    expect(tabla).not.toContain('Grupo 2')
    // Y dice por qué.
    expect(tabla).toContain(
      'El formato cambió después de sortear: esta tabla no se puede partir por grupo todavía. Volvé al armado y sorteá de nuevo.',
    )
  })
})

describe('la fecha GROUPS_KNOCKOUT abierta — el fixture REAL de C32 tampoco desaparece a nadie (W86, verify-report-pre-contract #4026)', () => {
  /**
   * W82 se declaró cerrado con un fixture SINTÉTICO: cuatro lados sin NINGÚN
   * partido de grupo, un estado que C32 nunca produce (mutar el guard viejo
   * hacía caer ese test, pero el bug seguía vivo en pantalla — lección
   * #4025, "mutar prueba que el test fija el código, NO que el código cubra
   * el escenario real"). El fixture REAL de C32 es sortear ROUND_ROBIN
   * (`buildFixture`, la MISMA función que `db/matchday.ts` corre en
   * `roundRobinMatches`) y DESPUÉS cambiar el formato a grupos sin volver a
   * sortear: los 28 partidos quedan con `fase='GRUPO', grupo=1` (el default
   * de columna que `roundRobinMatches` deja sin tocar, `0039`), así que
   * TODOS los lados SÍ están en `groupOfSide` — el guard viejo
   * (`allSidesGrouped`) daba `true` y partía igual, dibujando "Grupo 2" con
   * encabezado y cero filas (medido en Chromium, verify-report #4026).
   */
  it('con el fixture real de C32 (round robin completo, todo grupo=1), no dibuja un "Grupo 2" vacío', async () => {
    escena.status = 'OPEN'
    escena.formato = { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 }
    escena.sides = ALL_SIDES
    // El sorteo REAL: `buildFixture(8)` es exactamente lo que
    // `roundRobinMatches` corre, y cada partido nace fase='GRUPO'/grupo=1
    // (default de columna) porque nadie los re-sorteó tras cambiar el
    // formato — no un fixture inventado a mano.
    escena.matches = buildFixture(8).flatMap((round, roundIndex) =>
      round.map(([a, b]) => playedMatch('GRUPO', 1, roundIndex + 1, a + 1, b + 1)),
    )
    expect(escena.matches).toHaveLength(28)

    const html = await render()

    const inicio = html.indexOf('Tabla de la fecha')
    expect(inicio).toBeGreaterThan(-1)
    const tabla = html.slice(inicio)

    // Nadie desaparece: los ocho lados siguen en la tabla.
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(tabla).toContain(`Jugador ${n}`)
    }
    // No se dibuja "Grupo 2" con encabezado y cero filas -- ni ningún bloque
    // partido: cae a la tabla única.
    expect(tabla).not.toContain('Grupo 1')
    expect(tabla).not.toContain('Grupo 2')
    // Y dice por qué.
    expect(tabla).toContain(
      'El formato cambió después de sortear: esta tabla no se puede partir por grupo todavía. Volvé al armado y sorteá de nuevo.',
    )
  })
})

describe('la fecha GROUPS_KNOCKOUT cerrada — sigue con UNA sola tabla (decisión #3962, no se toca)', () => {
  it('no separa por grupo: el orden cruza los grupos a propósito', async () => {
    escena.status = 'CLOSED'
    escena.formato = { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 }
    escena.sides = [1, 2, 3, 4, 5, 6, 7, 8].map(side)
    escena.matches = [
      playedMatch('GRUPO', 1, 1, 1, 2),
      playedMatch('GRUPO', 1, 1, 3, 4),
      playedMatch('GRUPO', 1, 2, 1, 3),
      playedMatch('GRUPO', 1, 2, 2, 4),
      playedMatch('GRUPO', 1, 3, 1, 4),
      playedMatch('GRUPO', 1, 3, 2, 3),
      playedMatch('GRUPO', 2, 1, 5, 6),
      playedMatch('GRUPO', 2, 1, 7, 8),
      playedMatch('GRUPO', 2, 2, 5, 7),
      playedMatch('GRUPO', 2, 2, 6, 8),
      playedMatch('GRUPO', 2, 3, 5, 8),
      playedMatch('GRUPO', 2, 3, 6, 7),
      playedMatch('SEMI', 1, 1, 1, 6),
      playedMatch('SEMI', 1, 1, 5, 4),
      playedMatch('FINAL', 1, 1, 1, 5),
      unplayedMatch('TERCER_PUESTO', 1, 1, 6, 4),
    ]

    const html = await render()

    const inicio = html.indexOf('Tabla de la fecha')
    expect(inicio).toBeGreaterThan(-1)
    const tabla = html.slice(inicio)
    // Ni una sección "Grupo N" en la tabla del día CERRADA: el título de arriba
    // ("Tabla de la fecha") no se parte, aunque `Llave` (más arriba en la
    // página, fuera del recorte) siga mostrando "Grupo 1"/"Grupo 2" en su
    // propia sección de partidos.
    expect(tabla).not.toContain('Grupo 1')
    expect(tabla).not.toContain('Grupo 2')
  })
})

describe('la fecha GROUPS_KNOCKOUT cerrada — la línea de relato (decisión #3990)', () => {
  it('cuenta que el tercer puesto se definió por la tabla cuando no se jugó', async () => {
    escena.status = 'CLOSED'
    escena.isAdmin = true
    escena.formato = { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 }
    escena.sides = ALL_SIDES
    escena.matches = [
      playedMatch('GRUPO', 1, 1, 1, 2),
      playedMatch('GRUPO', 1, 2, 3, 4),
      playedMatch('GRUPO', 2, 1, 5, 6),
      playedMatch('GRUPO', 2, 2, 7, 8),
      playedMatch('SEMI', 1, 1, 1, 6),
      playedMatch('SEMI', 1, 1, 5, 2),
      playedMatch('FINAL', 1, 1, 1, 5),
      unplayedMatch('TERCER_PUESTO', 1, 1, 6, 2),
    ]

    const html = await render()

    expect(html).toContain('El tercer puesto se definió por la tabla de grupos: no se jugó el partido.')
  })

  it('no dice nada cuando el tercer puesto se jugó de verdad', async () => {
    escena.status = 'CLOSED'
    escena.formato = { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 }
    escena.sides = ALL_SIDES
    escena.matches = [
      playedMatch('GRUPO', 1, 1, 1, 2),
      playedMatch('SEMI', 1, 1, 1, 6),
      playedMatch('SEMI', 1, 1, 5, 2),
      playedMatch('FINAL', 1, 1, 1, 5),
      playedMatch('TERCER_PUESTO', 1, 1, 6, 2),
    ]

    const html = await render()

    expect(html).not.toContain('El tercer puesto se definió por la tabla de grupos')
  })
})

describe('la fecha GROUPS_KNOCKOUT cerrada — la llave no se pierde al cerrar (W70, verify-report-pr21 #4004)', () => {
  /**
   * Mismo dataset en los tres tests de esta tanda: 2 grupos de 4, semis
   * cruzadas, side1 campeón (gana grupo, semi y final), side5 finalista,
   * tercer puesto SIN jugar (decisión #3979) entre los dos perdedores de
   * semi (6 y 2).
   */
  function bracketMatches(): MatchWithId[] {
    return [
      playedMatch('GRUPO', 1, 1, 1, 2),
      playedMatch('GRUPO', 1, 2, 3, 4),
      playedMatch('GRUPO', 2, 1, 5, 6),
      playedMatch('GRUPO', 2, 2, 7, 8),
      playedMatch('SEMI', 1, 1, 1, 6),
      playedMatch('SEMI', 1, 1, 5, 2),
      playedMatch('FINAL', 1, 1, 1, 5),
      unplayedMatch('TERCER_PUESTO', 1, 1, 6, 2),
    ]
  }

  /**
   * Los puestos que `knockoutPositions` (core/knockout.ts) arma de verdad para
   * `bracketMatches()`: 1º y 2º de la final (1, 5), 3º/4º de la tabla de
   * grupos porque el tercer puesto no se jugó (6, 2 — perdedores de semi
   * ordenados por su puesto de grupo), y de ahí para abajo la tabla de grupos
   * combinada de los dos grupos (3, 7, 4, 8). Calculado a mano y verificado
   * contra `core/knockout.test.ts`, no inventado para que el test cierre.
   */
  function bracketFrozenPoints(): Map<string, { position: number; points: number }> {
    return new Map([
      ['e1', { position: 1, points: 10 }],
      ['e5', { position: 2, points: 7 }],
      ['e2', { position: 3, points: 5 }],
      ['e6', { position: 4, points: 3 }],
      ['e3', { position: 5, points: 2 }],
      ['e7', { position: 6, points: 1 }],
      ['e4', { position: 7, points: 0 }],
      ['e8', { position: 8, points: 0 }],
    ])
  }

  it('dibuja la llave por fases (Semifinal, Final), no el acordeón de Rondas mezclando todo bajo "Ronda 1"', async () => {
    escena.status = 'CLOSED'
    escena.isAdmin = true
    escena.formato = { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 }
    escena.sides = ALL_SIDES
    escena.matches = bracketMatches()
    escena.frozenPoints = bracketFrozenPoints()

    const html = await render()

    expect(html).toContain('Semifinal')
    expect(html).toContain('Final')
    expect(html).not.toMatch(/Ronda \d+ de/)
  })

  it('el PG de la tabla cuenta sólo los partidos de grupo — la misma tabla que decidió los puntos (standingsFromBracket, D1)', async () => {
    escena.status = 'CLOSED'
    escena.isAdmin = true
    escena.formato = { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 }
    escena.sides = ALL_SIDES
    escena.matches = bracketMatches()
    escena.frozenPoints = bracketFrozenPoints()

    const html = await render()

    const tabla = html.slice(html.indexOf('Tabla de la fecha'))
    const fila = /Jugador 1<\/span><span[^>]*>(\d+)<\/span>/.exec(tabla)
    // Side1 ganó 1 partido de GRUPO, 1 de SEMI y la FINAL — 3 en total —, pero
    // `standingsFromBracket` calculó su award con SÓLO el partido de grupo: el
    // PG que se dibuja tiene que decir lo mismo que la tabla que pagó.
    expect(fila?.[1]).toBe('1')
  })

  it('explica el orden cuando el resultado de la llave lo mueve y tiebreakNote se apaga por orderMoved', async () => {
    escena.status = 'CLOSED'
    escena.isAdmin = true
    escena.formato = { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 }
    escena.sides = ALL_SIDES
    escena.matches = bracketMatches()
    escena.frozenPoints = bracketFrozenPoints()

    const html = await render()

    // La disciplina de este archivo es FIFA (`openScore: true`, línea 51): el
    // pie tiene que decir "diferencia de GOL", no "de games" — un `toContain`
    // que sólo mirara el prefijo pasaría igual con "games" hardcodeado.
    expect(html).toContain(
      'El orden sale del resultado de la llave, no sólo de la fase de grupos: por eso puede haber lados con el mismo PG y la misma diferencia de gol en un orden distinto.',
    )
    expect(html).not.toContain('diferencia de games en un orden distinto')
  })
})

describe('no-regresión — una fecha ROUND_ROBIN sigue viendo exactamente lo de siempre (REQ-D7-1)', () => {
  it('sin "Fase actual", con el acordeón de Rondas de siempre', async () => {
    escena.status = 'OPEN'
    escena.formato = { kind: 'ROUND_ROBIN' }
    escena.sides = [1, 2, 3, 4].map(side)
    escena.matches = [
      unplayedMatch('GRUPO', 1, 1, 1, 2),
      unplayedMatch('GRUPO', 1, 1, 3, 4),
      unplayedMatch('GRUPO', 1, 2, 1, 3),
      unplayedMatch('GRUPO', 1, 2, 2, 4),
    ]

    const html = await render()

    expect(html).not.toContain('Fase actual:')
    expect(html).not.toContain('>Cerrar fase<')
    expect(html).toContain('Ronda 1 de')
  })
})

describe('el armado — el selector de formato pasa el `formato` guardado, no un valor fijo', () => {
  /**
   * S84 (verify-report-pr21-cierre #4016): este test seguía decidiendo "cuál
   * botón está marcado" con `bg-accent`, la clase de Tailwind — sin ninguna
   * señal semántica, así que un cambio de estilo (o un lector de pantalla)
   * no tenía forma de confiar en esto. `armado.unit.test.ts` ya había
   * migrado a `aria-checked` (S81) el mismo día que este archivo, gemelo,
   * recibió +305 líneas y se pasó por al lado. `SelectorDeFormato`
   * (`armado.tsx`) ya dibuja `role="radio"` + `aria-checked` por botón desde
   * S81 — acá no cambia una línea de producción, sólo lo que el test mira.
   */
  it('con GROUPS_KNOCKOUT ya elegido, el botón marcado es el de grupos', async () => {
    escena.status = 'DRAFT'
    escena.isAdmin = true
    escena.formato = { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 }
    escena.sides = []
    escena.matches = []

    const html = await render()

    const btnGrupos = /<button[^>]*>2 grupos \+ llave<\/button>/.exec(html)?.[0] ?? ''
    const btnTodos = /<button[^>]*>Todos contra todos<\/button>/.exec(html)?.[0] ?? ''
    expect(btnGrupos).toContain('aria-checked="true"')
    expect(btnTodos).toContain('aria-checked="false"')
  })
})

describe('el armado en DRAFT — la nota del reparto coincide con el formato elegido (W80, verify-report-pr21-cierre #4016)', () => {
  /**
   * `drawNote` (`armado.tsx`, dentro de `words(sideSize)`) dependía SÓLO del
   * tamaño del lado y nunca del `formato` — con "4 grupos + llave" elegido,
   * "Cómo quedan los grupos" (S83) dibujaba arriba un reparto en grupos y,
   * dos pantallazos más abajo, la nota seguía prometiendo "todos contra
   * todos": la misma contradicción que W55-W57 (comportamiento y relato
   * dichos por dos caminos que dejaron de estar de acuerdo).
   */
  it('con grupos elegidos, la nota describe grupos + llave, no "todos contra todos"', async () => {
    escena.status = 'DRAFT'
    escena.isAdmin = true
    escena.pairSize = 1
    escena.formato = { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 }
    escena.sides = ALL_SIDES
    // S94 (verify-report-pre-contract #4026): el fixture tiene que CUBRIR de
    // verdad los 2 grupos que `formato` declara -- `matches = []` (como
    // decía este test antes de S94) ahora es exactamente el estado
    // DIVERGIDO que ese hallazgo agarra, y produciría la nota de drift, no
    // ésta. Grupo 1 = lados 1-4, grupo 2 = lados 5-8: alcanza con cubrir,
    // la partición concreta no importa para esta pregunta.
    escena.matches = [
      playedMatch('GRUPO', 1, 1, 1, 2),
      playedMatch('GRUPO', 1, 1, 3, 4),
      playedMatch('GRUPO', 2, 1, 5, 6),
      playedMatch('GRUPO', 2, 1, 7, 8),
    ]

    const html = await render()

    expect(html).not.toContain('Juegan todos contra todos, en el orden de la tabla.')
    expect(html).toContain(
      'Juegan por grupos: todos contra todos adentro de cada grupo, y los 2 primeros de cada uno pasan a la llave.',
    )
  })

  it('no-regresión: con "todos contra todos" elegido, la nota sigue siendo la de siempre', async () => {
    escena.status = 'DRAFT'
    escena.isAdmin = true
    escena.pairSize = 1
    escena.formato = { kind: 'ROUND_ROBIN' }
    escena.sides = [1, 2, 3, 4].map(side)
    escena.matches = []

    const html = await render()

    expect(html).toContain('Juegan todos contra todos, en el orden de la tabla.')
  })
})

describe('el armado en DRAFT — la nota no promete grupos sobre un fixture que no se volvió a sortear (S94, verify-report-pre-contract #4026)', () => {
  /**
   * Mismo estado divergido que C32/W86: `changeMatchdayFormat` puede tocar
   * `formato` DESPUÉS de que `generatePairs` ya armó el fixture con el
   * viejo, sin volver a sortear. El fixture REAL (no uno sintético, lección
   * #4025/W86) es sortear ROUND_ROBIN (`buildFixture`, la MISMA función que
   * corre `db/matchday.ts`) y DESPUÉS cambiar el formato a grupos: los 28
   * partidos quedan con `fase='GRUPO', grupo=1` (default de columna, 0039).
   */
  it('con el fixture real de C32 (round robin completo, todo grupo=1), la nota NO promete grupos', async () => {
    escena.status = 'DRAFT'
    escena.isAdmin = true
    escena.pairSize = 1
    escena.formato = { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 }
    escena.sides = ALL_SIDES
    escena.matches = buildFixture(8).flatMap((round, roundIndex) =>
      round.map(([a, b]) => playedMatch('GRUPO', 1, roundIndex + 1, a + 1, b + 1)),
    )
    expect(escena.matches).toHaveLength(28)

    const html = await render()

    expect(html).not.toContain('Juegan por grupos: todos contra todos adentro de cada grupo')
    expect(html).toContain('El formato cambió después de sortear')
  })

  it('no-regresión: con grupos elegidos y el fixture que sí los cubre, sigue prometiendo grupos', async () => {
    escena.status = 'DRAFT'
    escena.isAdmin = true
    escena.pairSize = 1
    escena.formato = { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 }
    escena.sides = ALL_SIDES
    escena.matches = [
      playedMatch('GRUPO', 1, 1, 1, 2),
      playedMatch('GRUPO', 1, 1, 3, 4),
      playedMatch('GRUPO', 2, 1, 5, 6),
      playedMatch('GRUPO', 2, 1, 7, 8),
    ]

    const html = await render()

    expect(html).toContain('Juegan por grupos: todos contra todos adentro de cada grupo')
    expect(html).not.toContain('El formato cambió después de sortear')
  })
})

describe('el armado en DRAFT — la nota de pádel no pierde cómo se armaron las parejas al elegir grupos (S93, verify-report-pre-contract #4026)', () => {
  /**
   * W80 REEMPLAZABA `drawNote` entero al elegir grupos: para PÁDEL
   * (sideSize=2) eso se llevaba puesta la única explicación de CÓMO se
   * armaron las parejas de la lista de arriba ("Los defensores quedan
   * fijos..."), que es una pregunta distinta de CÓMO se van a jugar. Las
   * dos tienen que convivir.
   */
  it('con pádel, grupos elegidos y un fixture que los cubre, la nota dice cómo se armaron las parejas Y cómo se juega', async () => {
    escena.status = 'DRAFT'
    escena.isAdmin = true
    escena.pairSize = 2
    escena.formato = { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 }
    escena.sides = ALL_SIDES
    escena.matches = [
      playedMatch('GRUPO', 1, 1, 1, 2),
      playedMatch('GRUPO', 1, 1, 3, 4),
      playedMatch('GRUPO', 2, 1, 5, 6),
      playedMatch('GRUPO', 2, 1, 7, 8),
    ]

    const html = await render()

    expect(html).toContain(
      'Los defensores quedan fijos. El resto se arma cruzando la tabla: 1° con último, 2° con anteúltimo, y así.',
    )
    expect(html).toContain(
      'Juegan por grupos: todos contra todos adentro de cada grupo, y los 2 primeros de cada uno pasan a la llave.',
    )
  })

  it('con pádel y el fixture real de C32 sin re-sortear, sigue diciendo cómo se armaron las parejas pero no promete grupos', async () => {
    escena.status = 'DRAFT'
    escena.isAdmin = true
    escena.pairSize = 2
    escena.formato = { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 }
    escena.sides = ALL_SIDES
    escena.matches = buildFixture(8).flatMap((round, roundIndex) =>
      round.map(([a, b]) => playedMatch('GRUPO', 1, roundIndex + 1, a + 1, b + 1)),
    )

    const html = await render()

    expect(html).toContain(
      'Los defensores quedan fijos. El resto se arma cruzando la tabla: 1° con último, 2° con anteúltimo, y así.',
    )
    expect(html).not.toContain('Juegan por grupos: todos contra todos adentro de cada grupo')
    expect(html).toContain('El formato cambió después de sortear')
  })
})

describe('el armado en DRAFT — vista previa del reparto en grupos (S83, verify-report-pr21 #4004)', () => {
  /**
   * `pairingContextFor` está mockeado (arriba, `escena.pairingContext`) pero
   * `buildSides`/`groupSides` NO — corren de verdad. Con `points` vacío y
   * `snapshot` en el mismo orden que `present` (e1..e8), `orderPool` no
   * reordena nada, así que el reparto de `groupSides` sobre e1..e8 en 2
   * grupos es el de LA SERPENTINA: grupo 1 = e1,e4,e5,e8 · grupo 2 =
   * e2,e3,e6,e7 (calculado a mano trazando `groupSides`, `core/knockout.ts`).
   * Un reparto en TAJADAS (1-4 / 5-8) pondría a e2 y e3 en el grupo 1 — el
   * `not.toContain` de abajo lo distingue.
   */
  it('con "2 grupos + llave" elegido, muestra el reparto en SERPENTINA — no en tajadas', async () => {
    escena.status = 'DRAFT'
    escena.isAdmin = true
    escena.pairSize = 1
    escena.formato = { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 }
    escena.sides = []
    escena.matches = []

    const html = await render()

    const inicio = html.indexOf('Cómo quedan los grupos')
    expect(inicio).toBeGreaterThan(-1)
    const preview = html.slice(inicio)
    const g1 = preview.indexOf('Grupo 1')
    const g2 = preview.indexOf('Grupo 2')
    expect(g1).toBeGreaterThan(-1)
    expect(g2).toBeGreaterThan(g1)

    const seccionGrupo1 = preview.slice(g1, g2)
    expect(seccionGrupo1).toContain('Jugador 1')
    expect(seccionGrupo1).toContain('Jugador 4')
    expect(seccionGrupo1).toContain('Jugador 5')
    expect(seccionGrupo1).toContain('Jugador 8')
    expect(seccionGrupo1).not.toContain('Jugador 2')
    expect(seccionGrupo1).not.toContain('Jugador 3')
  })

  it('con "todos contra todos" elegido, no muestra ninguna vista previa de grupos', async () => {
    escena.status = 'DRAFT'
    escena.isAdmin = true
    escena.pairSize = 1
    escena.formato = { kind: 'ROUND_ROBIN' }
    escena.sides = []
    escena.matches = []

    const html = await render()

    expect(html).not.toContain('Cómo quedan los grupos')
  })
})

describe('el armado en DRAFT — el número de asiento no se recorta desde el 10 (S85, verify-report-pr21-cierre #4016)', () => {
  /**
   * `w-4` (16px) más `text-[14px] font-extrabold` mide 18px para "10"/"11" —
   * medido con Chromium real (Archivo 800, ver apply-progress de esta
   * tanda): `scrollWidth 18 > clientWidth 16`. Acá no hay layout real
   * (`renderToStaticMarkup`), así que lo que se pincha es la CLASE — `w-5`
   * (20px) es la que la medición real confirmó sin overflow.
   */
  it('con 10 lados, el décimo asiento usa w-5, no w-4', async () => {
    escena.status = 'DRAFT'
    escena.isAdmin = true
    escena.pairSize = 1
    escena.formato = { kind: 'ROUND_ROBIN' }
    escena.sides = Array.from({ length: 10 }, (_, index) => side(index + 1))
    escena.matches = []

    const html = await render()

    const orden = html.slice(html.indexOf('Orden de la fecha'))
    const decimo = /<span class="[^"]*">10<\/span>/.exec(orden)?.[0] ?? ''
    expect(decimo).toContain('w-5')
    expect(decimo).not.toContain('w-4')
  })
})
