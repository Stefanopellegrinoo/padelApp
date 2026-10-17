import { describe, it, expect } from 'vitest'
import { parseLegacyFechaPath } from './legacy-fecha-redirect'

describe('parseLegacyFechaPath', () => {
  it('matches the legacy fecha detail URL (REQ-NR-5)', () => {
    expect(parseLegacyFechaPath('/torneo/abc-123/fechas/2')).toEqual({ seasonId: 'abc-123', n: '2' })
  })

  it('matches with a trailing slash', () => {
    expect(parseLegacyFechaPath('/torneo/abc-123/fechas/2/')).toEqual({ seasonId: 'abc-123', n: '2' })
  })

  it('does not match the new discipline-scoped URL — it is not legacy', () => {
    expect(parseLegacyFechaPath('/torneo/abc-123/padel/fechas/2')).toBeNull()
  })

  it('does not match the fecha list URL (no matchday number)', () => {
    expect(parseLegacyFechaPath('/torneo/abc-123/fechas')).toBeNull()
  })

  it('does not match an unrelated route', () => {
    expect(parseLegacyFechaPath('/torneo/abc-123/ajustes')).toBeNull()
  })

  //`LEGACY_FECHA_PATH` matcheaba CUALQUIER
  // segmento final, incluido "reglas" (`isPrivatePath` la trata como
  // pública) — colaba una URL pública al camino legacy con el cliente anon
  // y tiraba un 500. `n` ahora exige dígitos: esta ruta ya no es "una fecha
  // vieja" para el parser.
  it('does not match a non-numeric segment (e.g. /reglas, public) — not a matchday number', () => {
    expect(parseLegacyFechaPath('/torneo/abc-123/fechas/reglas')).toBeNull()
  })
})
