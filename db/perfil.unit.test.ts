import { describe, expect, it } from 'vitest'
import { torneosEnComun } from './perfil'

/**
 * Los torneos que comparten dos jugadores, como los muestra el perfil
 * (odd/tasks/amigos-faciles.md, S9, S11): sólo donde están los dos, el más
 * nuevo primero (después por nombre y por id) y con sus deportes sin repetir.
 */

const t = (id: string, name: string, created_at: string) => ({ id, name, created_at })

describe('torneosEnComun', () => {
  it('sólo los de los dos, el más nuevo primero, con los deportes en el orden del torneo', () => {
    const temporadas = [
      t('s-viejo', 'Copa del Jueves', '2026-01-01T00:00:00Z'),
      t('s-nuevo', 'Los Pibes del Martes', '2026-06-01T00:00:00Z'),
      t('s-mio', 'Solo Mío', '2026-09-01T00:00:00Z'),
    ]
    const disciplinas = [
      { season_id: 's-nuevo', kind: 'PADEL' },
      { season_id: 's-nuevo', kind: 'TENIS' },
      { season_id: 's-nuevo', kind: 'PADEL' },
      { season_id: 's-viejo', kind: 'FIFA' },
    ]
    expect(torneosEnComun(['s-viejo', 's-nuevo', 's-mio'], ['s-nuevo', 's-viejo'], temporadas, disciplinas)).toEqual([
      { seasonId: 's-nuevo', name: 'Los Pibes del Martes', sports: ['PADEL', 'TENIS'] },
      { seasonId: 's-viejo', name: 'Copa del Jueves', sports: ['FIFA'] },
    ])
  })

  it('con la misma fecha, por nombre y después por id', () => {
    const misma = '2026-06-01T00:00:00Z'
    const temporadas = [t('s-b', 'Zeta', misma), t('s-c', 'Alfa', misma), t('s-a', 'Alfa', misma)]
    const ids = ['s-a', 's-b', 's-c']
    expect(torneosEnComun(ids, ids, temporadas, []).map((x) => x.seasonId)).toEqual(['s-a', 's-c', 's-b'])
  })

  it('sin ninguno en común, vacío', () => {
    expect(torneosEnComun(['s-1'], ['s-2'], [t('s-1', 'A', '2026-01-01T00:00:00Z')], [])).toEqual([])
  })
})
