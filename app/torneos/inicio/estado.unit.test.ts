import { describe, expect, it } from 'vitest'
import { defaultConfig, type DisciplineId } from '@/core'
import type { SharedMatch } from '@/db/friends'
import type { DisciplineHeader, MatchdaySummary, SeasonHeader } from '@/db/read'
import {
  diaFecha,
  faltanTexto,
  fechasVivas,
  hrefFecha,
  ordenarPorCercania,
  paraCargar,
  progresoDe,
  proximaFecha,
  tituloFecha,
  torneosALaVista,
  ultimoResultado,
  verTorneosTexto,
  type FechaViva,
} from './estado'

/**
 * Lo que decide Inicio sin dibujar nada: cuál es "la próxima fecha" del
 * bloque de arriba, qué fechas ofrece "Cargar partido" y cómo se lee el último
 * resultado con un amigo.
 */

const PADEL = 'd-padel' as DisciplineId
const FIFA = 'd-fifa' as DisciplineId

function disciplina(id: DisciplineId, kind: string): DisciplineHeader {
  return {
    id,
    kind,
    config: { ...defaultConfig(12, 2), regularMatchdays: 12 },
    weight: 1,
    pairSize: 2,
    hasMasters: false,
    allowsDraw: false,
    formatoDefault: { kind: 'ROUND_ROBIN' },
  }
}

function temporada(over: Partial<SeasonHeader> = {}): SeasonHeader {
  return {
    id: 's1',
    name: 'Los Pibes del Martes',
    status: 'ACTIVE',
    regularMatchdays: 12,
    isAdmin: false,
    playersCanScore: false,
    inviteToken: null,
    disciplines: [disciplina(PADEL, 'PADEL')],
    ...over,
  }
}

function fecha(over: Partial<MatchdaySummary> = {}): MatchdaySummary {
  return {
    id: 'md',
    number: 1,
    kind: 'REGULAR',
    status: 'CLOSED',
    playedOn: null,
    disciplineId: PADEL,
    allowsDraw: false,
    formato: { kind: 'ROUND_ROBIN' },
    matchFormat: null,
    ...over,
  }
}

function viva(over: Partial<FechaViva> = {}): FechaViva {
  return {
    id: 'md',
    seasonId: 's1',
    seasonName: 'Los Pibes del Martes',
    disciplineId: PADEL,
    slug: 'padel',
    sport: 'PADEL',
    number: 8,
    kind: 'REGULAR',
    status: 'OPEN',
    playedOn: '2026-11-18',
    puedeCargar: true,
    ...over,
  }
}

describe('fechasVivas', () => {
  it('sólo las sin cerrar, con el slug de su deporte y quién puede cargar', () => {
    const header = temporada({
      playersCanScore: true,
      disciplines: [disciplina(PADEL, 'PADEL'), disciplina(FIFA, 'FIFA')],
    })
    const vivas = fechasVivas(header, [
      fecha({ id: 'a', number: 7, status: 'CLOSED' }),
      fecha({ id: 'b', number: 8, status: 'OPEN', playedOn: '2026-11-18' }),
      fecha({ id: 'c', number: 3, status: 'DRAFT', disciplineId: FIFA }),
    ])
    expect(vivas.map((f) => [f.id, f.slug, f.sport, f.status, f.puedeCargar])).toEqual([
      ['b', 'padel', 'PADEL', 'OPEN', true],
      ['c', 'fifa', 'FIFA', 'DRAFT', true],
    ])
  })

  it('cargar es de quien organiza o de todos si el torneo lo permite', () => {
    const abierta = [fecha({ status: 'OPEN' })]
    expect(fechasVivas(temporada(), abierta)[0]?.puedeCargar).toBe(false)
    expect(fechasVivas(temporada({ isAdmin: true }), abierta)[0]?.puedeCargar).toBe(true)
    expect(fechasVivas(temporada({ playersCanScore: true }), abierta)[0]?.puedeCargar).toBe(true)
  })
})

describe('proximaFecha', () => {
  const HOY = '2026-11-25'

  it('sin fechas vivas no hay bloque', () => {
    expect(proximaFecha([], HOY)).toBeNull()
  })

  it('la más cercana a hoy, para adelante o para atrás; sin día, al final', () => {
    const vieja = viva({ id: 'vieja', playedOn: '2026-08-20' })
    const ayer = viva({ id: 'ayer', status: 'DRAFT', playedOn: '2026-11-24' })
    const sinDia = viva({ id: 'sin-dia', playedOn: null })
    const semana = viva({ id: 'semana', playedOn: '2026-12-02' })
    expect(proximaFecha([vieja, sinDia, semana, ayer], HOY)?.id).toBe('ayer')
    expect(proximaFecha([sinDia, vieja], HOY)?.id).toBe('vieja')
  })

  it('a la misma distancia gana la que está en juego', () => {
    const armando = viva({ id: 'armando', status: 'DRAFT', playedOn: '2026-11-26' })
    const enJuego = viva({ id: 'en-juego', status: 'OPEN', playedOn: '2026-11-24' })
    expect(proximaFecha([armando, enJuego], HOY)?.id).toBe('en-juego')
  })
})

describe('paraCargar', () => {
  it('las en juego donde podés cargar, la más cercana primero', () => {
    const fechas = [
      viva({ id: 'lejos', playedOn: '2026-10-01' }),
      viva({ id: 'armando', status: 'DRAFT', playedOn: '2026-11-25' }),
      viva({ id: 'sin-permiso', puedeCargar: false, playedOn: '2026-11-25' }),
      viva({ id: 'cerca', playedOn: '2026-11-24' }),
    ]
    expect(paraCargar(fechas, '2026-11-25').map((f) => f.id)).toEqual(['cerca', 'lejos'])
  })
})

describe('ordenarPorCercania', () => {
  it('los torneos con fecha cercana primero; sin fecha viva, al final y en su orden', () => {
    const cards = [
      { id: 'sin-1', proxima: null },
      { id: 'lejos', proxima: viva({ playedOn: '2026-09-01' }) },
      { id: 'sin-2', proxima: null },
      { id: 'cerca', proxima: viva({ playedOn: '2026-11-26' }) },
    ]
    expect(ordenarPorCercania(cards, '2026-11-25').map((c) => c.id)).toEqual(['cerca', 'lejos', 'sin-1', 'sin-2'])
  })
})

describe('textos de la fecha', () => {
  it('el link va a la fecha de su deporte', () => {
    expect(hrefFecha(viva({ seasonId: 'abc', slug: 'fifa', number: 3 }))).toBe('/torneo/abc/fifa/fechas/3')
  })

  it('el título: "Fecha 8", o "Masters"', () => {
    expect(tituloFecha(viva({ number: 8 }))).toBe('Fecha 8')
    expect(tituloFecha(viva({ number: 13, kind: 'MASTERS' }))).toBe('Masters')
  })

  it('el día con mayúscula, o nada si no se cargó', () => {
    expect(diaFecha('2026-11-18')).toBe('Miércoles 18 nov')
    expect(diaFecha(null)).toBeNull()
  })

  it('cuántos partidos faltan', () => {
    expect(faltanTexto(3)).toBe('Faltan 3 partidos')
    expect(faltanTexto(1)).toBe('Falta 1 partido')
    expect(faltanTexto(0)).toBe('Todos cargados')
  })

  it('el progreso del torneo, como la Tabla: la fecha en juego de las que tiene', () => {
    const header = temporada()
    const cerradas = [1, 2, 3, 4, 5, 6, 7].map((n) => fecha({ id: `c${n}`, number: n }))
    expect(progresoDe(header, cerradas)).toBe('Fecha 8 de 12')
    expect(progresoDe(temporada({ status: 'SETUP' }), [])).toBe('Sin empezar')
    expect(progresoDe(temporada({ status: 'FINISHED' }), cerradas)).toBe('Terminado')
    // El Masters no cuenta como fecha del campeonato, y con todas jugadas no pasa de 12.
    const todas = Array.from({ length: 12 }, (_, i) => fecha({ id: `t${i}`, number: i + 1 }))
    expect(progresoDe(header, [...todas, fecha({ id: 'm', number: 13, kind: 'MASTERS' })])).toBe('Fecha 12 de 12')
  })
})

describe('ultimoResultado', () => {
  const base = {
    matchId: 'm',
    playedOn: '2026-11-18',
    together: false,
    outcome: 'won' as const,
  }
  const torneo = (over: object = {}): SharedMatch => ({
    kind: 'tournament',
    ...base,
    matchdayId: 'md',
    matchdayNumber: 8,
    sport: 'PADEL',
    seasonName: 'Los Pibes',
    score: { mine: 6, theirs: 4 },
    ...over,
  })
  const casual = (over: object = {}): SharedMatch => ({
    kind: 'casual',
    ...base,
    sport: 'PADEL',
    partners: [],
    rivals: ['Nico'],
    score: null,
    teams: { mine: null, theirs: null },
    sets: [
      { mine: 6, theirs: 4 },
      { mine: 6, theirs: 3 },
    ],
    createdBy: 'M',
    updatedBy: 'M',
    createdById: 'p',
    updatedById: 'p',
    ...over,
  })

  it('enfrentados es tuyo ("Ganaste"); de compañeros, de la pareja ("Ganaron")', () => {
    expect(ultimoResultado(torneo()).verbo).toBe('Ganaste')
    expect(ultimoResultado(torneo({ outcome: 'lost' })).verbo).toBe('Perdiste')
    expect(ultimoResultado(torneo({ outcome: 'drew' })).verbo).toBe('Empataste')
    expect(ultimoResultado(torneo({ together: true })).verbo).toBe('Ganaron')
    expect(ultimoResultado(casual({ together: true, outcome: 'lost' })).verbo).toBe('Perdieron')
  })

  it('el marcador: los sets de un casual, los goles, los games del torneo', () => {
    expect(ultimoResultado(casual()).marcador).toBe('6-4 6-3')
    expect(ultimoResultado(casual({ sets: null, score: { mine: 1, theirs: 3 }, sport: 'FIFA' })).marcador).toBe('1-3')
    expect(ultimoResultado(torneo()).marcador).toBe('6-4')
    expect(ultimoResultado(casual({ sets: null, score: null })).marcador).toBeNull()
  })

  // Ajedrez (odd/tasks/mas-deportes.md, S3): como en el historial, el empate son tablas y la partida
  // se anota 1-0, 0-1 o ½-½.
  it('una partida de ajedrez se lee como en el historial: Tablas ½-½, Ganaste 1-0', () => {
    expect(ultimoResultado(torneo({ sport: 'AJEDREZ', outcome: 'drew', score: { mine: 0, theirs: 0 } }))).toMatchObject({
      verbo: 'Tablas',
      marcador: '½-½',
      gano: false,
    })
    expect(ultimoResultado(casual({ sport: 'AJEDREZ', outcome: 'drew', sets: null, together: true })).verbo).toBe('Tablas')
    expect(ultimoResultado(casual({ sport: 'AJEDREZ', outcome: 'won', sets: null }))).toMatchObject({ verbo: 'Ganaste', marcador: '1-0' })
    expect(ultimoResultado(torneo({ sport: 'AJEDREZ', outcome: 'lost', score: { mine: 0, theirs: 1 } })).marcador).toBe('0-1')
    // Un empate de FIFA sigue siendo "Empataste".
    expect(ultimoResultado(torneo({ sport: 'FIFA', outcome: 'drew', score: { mine: 2, theirs: 2 } }))).toMatchObject({
      verbo: 'Empataste',
      marcador: '2-2',
    })
  })

  it('el día, y si ganó tu lado', () => {
    const r = ultimoResultado(torneo())
    expect(r.dia).toBe('mié 18 nov')
    expect(r.gano).toBe(true)
    expect(ultimoResultado(torneo({ playedOn: null })).dia).toBeNull()
    expect(ultimoResultado(torneo({ outcome: 'lost' })).gano).toBe(false)
  })
})

// La grilla de "Tus torneos" (S4): dos filas a la vista —de dos en el teléfono, de tres en pantalla
// ancha— y el resto detrás de "Ver los N torneos", sin esconder cuántos son.
describe('torneosALaVista', () => {
  it('hasta cuatro, todos a la vista y sin botón', () => {
    expect(torneosALaVista(0)).toEqual({ vistas: [], boton: 'nunca' })
    expect(torneosALaVista(4)).toEqual({ vistas: ['siempre', 'siempre', 'siempre', 'siempre'], boton: 'nunca' })
  })

  it('el quinto y el sexto se ven de entrada sólo en pantalla ancha: el botón, sólo en el teléfono', () => {
    expect(torneosALaVista(6)).toEqual({
      vistas: ['siempre', 'siempre', 'siempre', 'siempre', 'ancho', 'ancho'],
      boton: 'telefono',
    })
    expect(torneosALaVista(5).boton).toBe('telefono')
  })

  it('del séptimo en adelante, sólo con la grilla abierta, y el botón en todos los anchos', () => {
    const { vistas, boton } = torneosALaVista(20)
    expect(vistas).toHaveLength(20)
    expect(vistas.slice(0, 4)).toEqual(['siempre', 'siempre', 'siempre', 'siempre'])
    expect(vistas.slice(4, 6)).toEqual(['ancho', 'ancho'])
    expect(vistas.slice(6).every((vista) => vista === 'abierta')).toBe(true)
    expect(boton).toBe('siempre')
  })
})

describe('verTorneosTexto', () => {
  it('cerrada dice cuántos son; abierta, cómo volver', () => {
    expect(verTorneosTexto(20, false)).toBe('Ver los 20 torneos')
    expect(verTorneosTexto(5, false)).toBe('Ver los 5 torneos')
    expect(verTorneosTexto(20, true)).toBe('Ver menos')
  })
})
