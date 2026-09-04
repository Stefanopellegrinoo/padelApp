import { describe, expect, it } from 'vitest'
import { currentDisciplineSlug, navTabs } from './nav-state'

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
    ['1. contenedor', `${base}`, null],
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
    const [tabla, fechas, stats] = navTabs(seasonId, defaultDisciplineSlug, `${base}`)
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
