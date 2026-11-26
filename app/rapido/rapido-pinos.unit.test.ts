import { describe, expect, it } from 'vitest'
import {
  ARMADO_INICIAL,
  DEPORTE_LABEL,
  DEPORTES,
  type Armado,
  type TorneoRapido,
  armadoWarning,
  armar,
  campeonesPinos,
  cargarPinos,
  escribirTorneo,
  leerTorneo,
  tablaPinos,
  terminado,
} from './rapido-state'

/**
 * El torneo rápido de bowling (S4): sin partidos, cada uno carga su total y el
 * ranking —con puestos compartidos— es el resultado.
 */

const bowling = (jugadores: string[]): Armado => ({ ...ARMADO_INICIAL, deporte: 'BOWLING', jugadores })
const nunca = () => {
  throw new Error('bowling no sortea nada')
}

describe('el deporte', () => {
  it('bowling es un deporte más del torneo rápido', () => {
    expect(DEPORTES).toContain('BOWLING')
    expect(DEPORTE_LABEL.BOWLING).toBe('Bowling')
  })
})

describe('armar un bowling', () => {
  it('arranca en 2 y no le importa la modalidad', () => {
    expect(armadoWarning(bowling(['Ana']))).toBe('Faltan jugadores: bowling arranca en 2.')
    expect(armadoWarning(bowling(['Ana', 'Beto']))).toBeNull()
    expect(armadoWarning({ ...bowling(['Ana', 'Beto', 'Caro']), modalidad: 'PAREJAS', modoParejas: 'FIJAS' })).toBeNull()
  })

  it('no arma partidos: cada jugador con su total vacío, y siempre individual', () => {
    const torneo = armar({ ...bowling([' Ana ', '', 'Beto', 'Caro']), modalidad: 'PAREJAS' }, nunca)
    expect(torneo.jugadores).toEqual(['Ana', 'Beto', 'Caro'])
    expect(torneo.partidos).toEqual([])
    expect(torneo.pinos).toEqual([null, null, null])
    expect(torneo.armado.modalidad).toBe('INDIVIDUAL')
  })

  it('un torneo de partidos no trae pinos', () => {
    const torneo = armar({ ...ARMADO_INICIAL, modalidad: 'INDIVIDUAL', jugadores: ['A', 'B', 'C'] }, () => 0)
    expect(torneo.pinos).toBeUndefined()
  })
})

describe('cargar pinos y el ranking', () => {
  const base = armar(bowling(['Ana', 'Beto', 'Caro', 'Dani']), nunca)

  it('cargar es inmutable y se puede corregir o borrar', () => {
    const uno = cargarPinos(base, 0, 150)
    expect(base.pinos).toEqual([null, null, null, null])
    expect(uno.pinos).toEqual([150, null, null, null])
    expect(cargarPinos(uno, 0, 160).pinos).toEqual([160, null, null, null])
    expect(cargarPinos(uno, 0, null).pinos).toEqual([null, null, null, null])
  })

  it('rechaza lo que no es un total, y un índice que no existe', () => {
    expect(() => cargarPinos(base, 0, -1)).toThrow()
    expect(() => cargarPinos(base, 0, 10000)).toThrow()
    expect(() => cargarPinos(base, 0, 1.5)).toThrow()
    expect(() => cargarPinos(base, 9, 100)).toThrow()
  })

  it('dos con 180 comparten el 2°, el siguiente es 4°, y quien no cargó va al fondo sin puesto (S4)', () => {
    let torneo = base
    torneo = cargarPinos(torneo, 0, 180)
    torneo = cargarPinos(torneo, 1, 200)
    torneo = cargarPinos(torneo, 2, 180)
    expect(tablaPinos(torneo)).toEqual([
      { clave: '1', nombre: 'Beto', pinos: 200, posicion: 1 },
      { clave: '0', nombre: 'Ana', pinos: 180, posicion: 2 },
      { clave: '2', nombre: 'Caro', pinos: 180, posicion: 2 },
      { clave: '3', nombre: 'Dani', pinos: null, posicion: null },
    ])
    expect(terminado(torneo)).toBe(false)
    expect(campeonesPinos(torneo)).toBeNull()

    torneo = cargarPinos(torneo, 3, 99)
    expect(tablaPinos(torneo).map((fila) => fila.posicion)).toEqual([1, 2, 2, 4])
    expect(terminado(torneo)).toBe(true)
    expect(campeonesPinos(torneo)).toEqual({ nombres: ['Beto'], pinos: 200 })
  })

  it('con el 1° compartido son campeones los dos', () => {
    let torneo = armar(bowling(['Ana', 'Beto']), nunca)
    torneo = cargarPinos(cargarPinos(torneo, 0, 150), 1, 150)
    expect(campeonesPinos(torneo)).toEqual({ nombres: ['Ana', 'Beto'], pinos: 150 })
  })
})

describe('guardado en el teléfono', () => {
  it('ida y vuelta: un bowling con pinos se lee igual', () => {
    const torneo = cargarPinos(armar(bowling(['Ana', 'Beto']), nunca), 1, 123)
    expect(leerTorneo(escribirTorneo(torneo))).toEqual(torneo)
  })

  it('un torneo guardado antes de bowling (sin `pinos`) se sigue leyendo', () => {
    const viejo = {
      armado: { ...ARMADO_INICIAL, modalidad: 'INDIVIDUAL', jugadores: ['A', 'B', 'C'] },
      jugadores: ['A', 'B', 'C'],
      partidos: [{ ronda: 1, a: [0], b: [1], marcador: { a: 4, b: 2 } }],
    }
    const leido = leerTorneo(JSON.stringify(viejo))
    expect(leido).not.toBeNull()
    expect(leido?.pinos).toBeUndefined()
    expect(leido?.partidos).toHaveLength(1)
  })

  it('un bowling con pinos rotos, de otro largo o con partidos se descarta', () => {
    const bien: TorneoRapido = armar(bowling(['Ana', 'Beto']), nunca)
    const roto = (patch: Record<string, unknown>) => leerTorneo(JSON.stringify({ ...bien, ...patch }))
    expect(roto({ pinos: [100] })).toBeNull()
    expect(roto({ pinos: [100, 'x'] })).toBeNull()
    expect(roto({ pinos: [100, 10000] })).toBeNull()
    expect(roto({ pinos: undefined })).toBeNull()
    expect(roto({ partidos: [{ ronda: 1, a: [0], b: [1], marcador: null }] })).toBeNull()
  })

  it('un torneo de partidos con `pinos` colados los ignora', () => {
    const torneo = armar({ ...ARMADO_INICIAL, modalidad: 'INDIVIDUAL', jugadores: ['A', 'B', 'C'] }, () => 0)
    const leido = leerTorneo(JSON.stringify({ ...torneo, pinos: [1, 2, 3] }))
    expect(leido).toEqual(torneo)
  })
})
