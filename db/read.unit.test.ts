import { describe, expect, it } from 'vitest'
import { toDisciplineHeader } from './read'

/**
 * PR12 gotcha (tasks): `disciplines.weight` es `numeric(4,2)` y PostgREST lo
 * devuelve como STRING, no como number. `Number(weight)` tiene que pasar en
 * este único lugar — el resto de `core`/`app` recibe ya un `number` limpio.
 *
 * weight=1 no serviría para probar esto: `puntos * '1'` coerciona igual a
 * `puntos * 1` (el `*` de JS siempre convierte), así que la multiplicación
 * "se cura sola" para CUALQUIER weight bajo `*` — el bug real no es la
 * multiplicación, es una comparación estricta (`toBe`) o una suma (`+`) de
 * dos weights, donde un string sin convertir CONCATENA en vez de sumar. 0.5
 * (el mismo valor que usa el ejemplo de REQ-D9-1) alcanza para probarlo.
 */
describe('toDisciplineHeader', () => {
  it('converts disciplines.weight from the PostgREST string to a real number', () => {
    const header = toDisciplineHeader({
      id: 'd1',
      season_id: 's1',
      kind: 'FIFA',
      config: {},
      // Tal cual sale de PostgREST para `numeric(4,2)`: string, no number.
      weight: '0.50' as unknown as number,
    })
    expect(header.weight).toBe(0.5)
    // Bajo el bug (weight sigue siendo la string '0.50'), esta suma
    // concatenaría ('0.500.50') en vez de dar 1 — la prueba que pide el brief.
    expect(header.weight + header.weight).toBe(1)
  })

  it('leaves an already-numeric weight (e.g. the DB default of 1) untouched', () => {
    const header = toDisciplineHeader({ id: 'd1', season_id: 's1', kind: 'PADEL', config: {}, weight: 1 })
    expect(header.weight).toBe(1)
  })
})
