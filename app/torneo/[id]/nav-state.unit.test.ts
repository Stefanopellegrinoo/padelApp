import { describe, expect, it } from 'vitest'
import type { DisciplineId } from '@/core'
import { currentDisciplineSlug, navTabs, sportChips, sportsOf } from './nav-state'

const seasonId = 's1'
const base = `/torneo/${seasonId}`
const defaultDisciplineSlug = 'padel'

/** La pestaña encendida, o `null` si ninguna lo está — a lo sumo una (assert abajo). */
function litLabel(pathname: string): string | null {
  const tabs = navTabs(seasonId, defaultDisciplineSlug, pathname)
  const lit = tabs.filter((tab) => tab.isActive)
  expect(lit.length).toBeLessThanOrEqual(1)
  return lit[0]?.label ?? null
}

/**
 * Las once rutas reales de esta sección (`docs/plan-arquitectura-de-paginas.md`
 * Task 3) contra la pestaña que se espera encendida — `null` es una
 * respuesta deliberada, no una omisión. Los tres redirects de compatibilidad
 * (7, 8, 9) nunca se observan de verdad desde el cliente porque `redirect()`
 * los resuelve en el servidor antes de que `TorneoNav` se monte con esa URL;
 * se testean igual para que la lógica no dependa de ese hecho para ser
 * correcta.
 */
describe('navTabs — qué pestaña enciende cada ruta', () => {
  it.each([
    ['1. tabla general', `${base}`, 'Tabla'],
    ['2. tabla de una disciplina', `${base}/padel`, 'Tabla'],
    ['3. fechas de una disciplina', `${base}/padel/fechas`, 'Fechas'],
    ['4. una fecha puntual', `${base}/padel/fechas/3`, 'Fechas'],
    ['5. stats de una disciplina', `${base}/padel/stats`, 'Stats'],
    ['6. perfil de jugador', `${base}/padel/jugador/e1`, null],
    ['7. redirect de stats sin disciplina', `${base}/stats`, 'Stats'],
    ['8. redirect de jugador sin disciplina', `${base}/jugador/e1`, null],
    ['9. redirect de fechas sin disciplina', `${base}/fechas`, 'Fechas'],
    ['10. reglas', `${base}/reglas`, 'Reglas'],
    ['11. ajustes', `${base}/ajustes`, null],
  ])('%s (%s) → %s', (_case, pathname, expected) => {
    expect(litLabel(pathname)).toBe(expected)
  })
})

describe('navTabs — Tabla, Fechas y Stats llevan la disciplina en el href', () => {
  it('sin disciplina en la URL, caen a la [0] de la temporada', () => {
    const [tabla, fechas, stats] = navTabs(seasonId, defaultDisciplineSlug, `${base}/reglas`)
    expect(tabla?.href).toBe(`${base}/padel`)
    expect(fechas?.href).toBe(`${base}/padel/fechas`)
    expect(stats?.href).toBe(`${base}/padel/stats`)
  })

  it('con disciplina en la URL, la siguen — no la [0]', () => {
    const [tabla, fechas, stats] = navTabs(seasonId, defaultDisciplineSlug, `${base}/fifa-2/fechas/5`)
    expect(tabla?.href).toBe(`${base}/fifa-2`)
    expect(fechas?.href).toBe(`${base}/fifa-2/fechas`)
    expect(stats?.href).toBe(`${base}/fifa-2/stats`)
  })

  it('Tabla apunta directo a la disciplina, no al contenedor — sin el redirect de una sola disciplina', () => {
    const [tabla] = navTabs(seasonId, defaultDisciplineSlug, `${base}/padel`)
    expect(tabla?.href).not.toBe(base)
  })

  it('en la tabla general, Tabla se queda ahí: tocarla de nuevo no te mueve', () => {
    const [tabla] = navTabs(seasonId, defaultDisciplineSlug, `${base}`)
    expect(tabla?.href).toBe(base)
  })
})

describe('navTabs — desde Ajustes la pestaña reemplaza la entrada del historial', () => {
  it.each([`${base}/ajustes`, `${base}/padel/ajustes`])('en %s todas reemplazan: atrás vuelve a la Tabla, no a Ajustes', (pathname) => {
    expect(navTabs(seasonId, defaultDisciplineSlug, pathname).every((tab) => tab.replace)).toBe(true)
  })

  it.each([`${base}/padel`, `${base}/padel/fechas/3`, `${base}/reglas`])('fuera de Ajustes (%s) apilan como siempre', (pathname) => {
    expect(navTabs(seasonId, defaultDisciplineSlug, pathname).some((tab) => tab.replace)).toBe(false)
  })
})

describe('navTabs — Reglas queda apuntando al contenedor siempre', () => {
  it('no lleva disciplina, ni con una en la URL actual', () => {
    const reglas = navTabs(seasonId, defaultDisciplineSlug, `${base}/fifa/fechas/2`).find(
      (tab) => tab.label === 'Reglas',
    )
    expect(reglas?.href).toBe(`${base}/reglas`)
  })
})

describe('currentDisciplineSlug', () => {
  it('null en el contenedor', () => {
    expect(currentDisciplineSlug(base, base)).toBeNull()
  })

  it('el slug en cualquier ruta por-disciplina, sin importar lo que siga', () => {
    expect(currentDisciplineSlug(base, `${base}/fifa-2`)).toBe('fifa-2')
    expect(currentDisciplineSlug(base, `${base}/fifa-2/fechas/9`)).toBe('fifa-2')
    expect(currentDisciplineSlug(base, `${base}/fifa-2/stats`)).toBe('fifa-2')
    expect(currentDisciplineSlug(base, `${base}/fifa-2/jugador/e1`)).toBe('fifa-2')
  })

  it('null en los segmentos que no son disciplina', () => {
    expect(currentDisciplineSlug(base, `${base}/reglas`)).toBeNull()
    expect(currentDisciplineSlug(base, `${base}/ajustes`)).toBeNull()
    expect(currentDisciplineSlug(base, `${base}/stats`)).toBeNull()
    expect(currentDisciplineSlug(base, `${base}/fechas`)).toBeNull()
    expect(currentDisciplineSlug(base, `${base}/jugador/e1`)).toBeNull()
  })
})

const sports = [
  { slug: 'padel', label: 'Pádel' },
  { slug: 'fifa', label: 'FIFA' },
]

describe('sportChips — cuándo se muestran', () => {
  it('con un solo deporte no hay nada que elegir', () => {
    expect(sportChips(seasonId, [{ slug: 'padel', label: 'Pádel' }], `${base}/padel`)).toEqual([])
  })

  it.each([
    ['tabla', `${base}/padel`, 3],
    ['la tabla general', `${base}`, 3],
    ['fechas', `${base}/padel/fechas`, 2],
    ['stats', `${base}/padel/stats`, 2],
  ])('en %s (%s) hay un chip por deporte, más "General" en las tablas', (_section, pathname, count) => {
    expect(sportChips(seasonId, sports, pathname)).toHaveLength(count)
  })

  it.each([
    ['una fecha puntual', `${base}/padel/fechas/3`],
    ['perfil de jugador', `${base}/padel/jugador/x`],
    ['ajustes del deporte', `${base}/padel/ajustes`],
    ['reglas', `${base}/reglas`],
    ['ajustes del torneo', `${base}/ajustes`],
    ['un slug que no es de la temporada', `${base}/basquet/fechas`],
    ['otra sección de otro torneo', '/torneo/s2/padel'],
  ])('en %s (%s) no se muestran', (_case, pathname) => {
    expect(sportChips(seasonId, sports, pathname)).toEqual([])
  })
})

describe('sportChips — a dónde apunta cada chip', () => {
  it('en Tabla cambia sólo el deporte, con "General" primero para volver a la tabla general', () => {
    expect(sportChips(seasonId, sports, `${base}/padel`).map((chip) => chip.href)).toEqual([
      base,
      `${base}/padel`,
      `${base}/fifa`,
    ])
  })

  it('en la tabla general: "General" encendido y un chip por deporte', () => {
    expect(sportChips(seasonId, sports, base).map((chip) => [chip.label, chip.href, chip.isActive])).toEqual([
      ['General', base, true],
      ['Pádel', `${base}/padel`, false],
      ['FIFA', `${base}/fifa`, false],
    ])
  })

  it('en Fechas se queda en Fechas', () => {
    expect(sportChips(seasonId, sports, `${base}/padel/fechas`).map((chip) => chip.href)).toEqual([
      `${base}/padel/fechas`,
      `${base}/fifa/fechas`,
    ])
  })

  it('en Stats se queda en Stats', () => {
    expect(sportChips(seasonId, sports, `${base}/fifa/stats`).map((chip) => chip.href)).toEqual([
      `${base}/padel/stats`,
      `${base}/fifa/stats`,
    ])
  })
})

describe('sportChips — el chip encendido y el orden', () => {
  it('se enciende el deporte de la URL, y sólo ése', () => {
    const chips = sportChips(seasonId, sports, `${base}/fifa/fechas`)
    expect(chips.map((chip) => [chip.label, chip.isActive])).toEqual([
      ['Pádel', false],
      ['FIFA', true],
    ])
  })

  it('respeta el orden que llega, sin reordenar por el deporte actual', () => {
    const three = [
      { slug: 'padel', label: 'Pádel' },
      { slug: 'padel-2', label: 'Pádel 2' },
      { slug: 'fifa', label: 'FIFA' },
    ]
    expect(sportChips(seasonId, three, `${base}/fifa`).map((chip) => chip.label)).toEqual([
      'General',
      'Pádel',
      'Pádel 2',
      'FIFA',
    ])
  })

  it('en el deporte repetido se enciende sólo ése, no el primero del mismo kind', () => {
    const three = [
      { slug: 'padel', label: 'Pádel' },
      { slug: 'padel-2', label: 'Pádel 2' },
      { slug: 'fifa', label: 'FIFA' },
    ]
    const chips = sportChips(seasonId, three, `${base}/padel-2/fechas`)
    expect(chips.map((chip) => [chip.href, chip.isActive])).toEqual([
      [`${base}/padel/fechas`, false],
      [`${base}/padel-2/fechas`, true],
      [`${base}/fifa/fechas`, false],
    ])
  })
})

describe('sportsOf — el slug y el nombre de cada deporte', () => {
  const discipline = (id: string, kind: string) => ({ id: id as DisciplineId, kind })

  it('en el orden que llega, con el slug de URL y el nombre del registro', () => {
    expect(sportsOf([discipline('d1', 'PADEL'), discipline('d2', 'PING_PONG')])).toEqual([
      { slug: 'padel', label: 'Pádel' },
      { slug: 'ping-pong', label: 'Ping pong' },
    ])
  })

  it('un mismo deporte dos veces se numera como el slug: el primero pelado, el segundo con " 2"', () => {
    expect(sportsOf([discipline('d1', 'PADEL'), discipline('d2', 'FIFA'), discipline('d3', 'PADEL')])).toEqual([
      { slug: 'padel', label: 'Pádel' },
      { slug: 'fifa', label: 'FIFA' },
      { slug: 'padel-2', label: 'Pádel 2' },
    ])
  })
})
