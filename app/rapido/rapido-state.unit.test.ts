import { describe, expect, it } from 'vitest'
import { buildFixture } from '@/core'
import {
  ARMADO_INICIAL,
  DEPORTE_LABEL,
  DEPORTE_OBJETIVO,
  DEPORTES,
  STORAGE_KEY,
  type Armado,
  type TorneoRapido,
  armadoWarning,
  armar,
  campeon,
  cargarMarcador,
  escribirTorneo,
  leerTorneo,
  tabla,
  terminado,
} from './rapido-state'

function armadoBase(overrides: Partial<Armado>): Armado {
  return { ...ARMADO_INICIAL, ...overrides }
}

/**
 * PRNG determinista para los fixtures del americano. Hace falta uno de
 * verdad — no un `() => 0` — porque con random constante el barajado nunca
 * mezcla y la elección del emparejamiento queda siempre en el primer
 * candidato, que es justo el caso donde el minimizador no se nota.
 */
function mulberry32(semilla: number): () => number {
  let t = semilla >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

/** La identidad de un lado de dos, igual que la usa el módulo: índices ordenados. */
function claveDeLado(lado: readonly number[]): string {
  return [...lado].sort((x, y) => x - y).join('-')
}

describe('constantes del deporte', () => {
  it('lista pádel y ping pong con su etiqueta y objetivo de puntos', () => {
    expect(DEPORTES).toEqual(['PADEL', 'PING_PONG'])
    expect(DEPORTE_LABEL.PADEL).toBe('Pádel')
    expect(DEPORTE_LABEL.PING_PONG).toBe('Ping pong')
    expect(DEPORTE_OBJETIVO.PADEL).toBe(4)
    expect(DEPORTE_OBJETIVO.PING_PONG).toBe(11)
  })
})

describe('armadoWarning', () => {
  it('pide más jugadores para individual por debajo de 3', () => {
    const armado = armadoBase({ modalidad: 'INDIVIDUAL', jugadores: ['A', 'B'] })
    expect(armadoWarning(armado)).not.toBeNull()
  })

  it('deja pasar individual con 3 o más', () => {
    const armado = armadoBase({ modalidad: 'INDIVIDUAL', jugadores: ['A', 'B', 'C'] })
    expect(armadoWarning(armado)).toBeNull()
  })

  it('pide más jugadores para parejas por debajo de 4', () => {
    const armado = armadoBase({
      modalidad: 'PAREJAS',
      modoParejas: 'SORTEADAS',
      jugadores: ['A', 'B', 'C'],
    })
    expect(armadoWarning(armado)).not.toBeNull()
  })

  it('ignora los nombres en blanco al contar', () => {
    const armado = armadoBase({
      modalidad: 'INDIVIDUAL',
      jugadores: ['A', 'B', '   ', ''],
    })
    expect(armadoWarning(armado)).not.toBeNull()
  })

  it('exige cantidad par en PAREJAS + SORTEADAS', () => {
    const armado = armadoBase({
      modalidad: 'PAREJAS',
      modoParejas: 'SORTEADAS',
      jugadores: ['A', 'B', 'C', 'D', 'E'],
    })
    expect(armadoWarning(armado)).not.toBeNull()
  })

  it('exige cantidad par en PAREJAS + FIJAS', () => {
    const armado = armadoBase({
      modalidad: 'PAREJAS',
      modoParejas: 'FIJAS',
      jugadores: ['A', 'B', 'C'],
      parejasManuales: [],
    })
    expect(armadoWarning(armado)).not.toBeNull()
  })

  it('permite cantidad impar en PAREJAS + ROTATIVAS: el que sobra descansa', () => {
    const armado = armadoBase({
      modalidad: 'PAREJAS',
      modoParejas: 'ROTATIVAS',
      jugadores: ['A', 'B', 'C', 'D', 'E'],
      rondas: 3,
    })
    expect(armadoWarning(armado)).toBeNull()
  })

  it('en FIJAS pide asignar a todos cuando falta alguien', () => {
    const armado = armadoBase({
      modalidad: 'PAREJAS',
      modoParejas: 'FIJAS',
      jugadores: ['A', 'B', 'C', 'D'],
      parejasManuales: [[0, 1]],
    })
    expect(armadoWarning(armado)).not.toBeNull()
  })

  it('en FIJAS pide asignar a todos cuando alguien se repite', () => {
    const armado = armadoBase({
      modalidad: 'PAREJAS',
      modoParejas: 'FIJAS',
      jugadores: ['A', 'B', 'C', 'D'],
      parejasManuales: [
        [0, 1],
        [1, 2],
      ],
    })
    expect(armadoWarning(armado)).not.toBeNull()
  })

  it('en FIJAS no avisa cuando la cobertura es exacta', () => {
    const armado = armadoBase({
      modalidad: 'PAREJAS',
      modoParejas: 'FIJAS',
      jugadores: ['A', 'B', 'C', 'D'],
      parejasManuales: [
        [1, 0],
        [2, 3],
      ],
    })
    expect(armadoWarning(armado)).toBeNull()
  })

  it('en ROTATIVAS exige rondas entre 1 y 12', () => {
    const armado = armadoBase({
      modalidad: 'PAREJAS',
      modoParejas: 'ROTATIVAS',
      jugadores: ['A', 'B', 'C', 'D'],
      rondas: 0,
    })
    expect(armadoWarning(armado)).not.toBeNull()

    const otro = armadoBase({
      modalidad: 'PAREJAS',
      modoParejas: 'ROTATIVAS',
      jugadores: ['A', 'B', 'C', 'D'],
      rondas: 13,
    })
    expect(armadoWarning(otro)).not.toBeNull()
  })

  it('frena en 12 jugadores como máximo, porque allMatchings no soporta más', () => {
    const trece = Array.from({ length: 13 }, (_, i) => `J${i}`)
    const armado = armadoBase({ modalidad: 'INDIVIDUAL', jugadores: trece })
    expect(armadoWarning(armado)).not.toBeNull()
  })
})

describe('armar', () => {
  it('INDIVIDUAL: arma un partido de a uno por índice, con buildFixture', () => {
    const armado = armadoBase({ modalidad: 'INDIVIDUAL', jugadores: ['Ana', ' Bea ', 'Cin', ''] })
    const torneo = armar(armado, () => 0)

    expect(torneo.jugadores).toEqual(['Ana', 'Bea', 'Cin'])

    const fixture = buildFixture(3)
    const esperados = fixture.flatMap((ronda, indiceRonda) =>
      ronda.map(([i, j]) => ({ ronda: indiceRonda + 1, a: [i], b: [j], marcador: null })),
    )
    expect(torneo.partidos).toEqual(esperados)
  })

  it('nunca comparte el mismo array de lado entre dos partidos', () => {
    // `partidosDesdeFixture` resolvía cada índice de lado al MISMO array de
    // `lados`, así que un jugador solo aparecía como la misma referencia en
    // todos sus partidos. Nadie muta hoy, pero la regla del repo es dura con
    // la inmutabilidad y una referencia compartida es una trampa esperando a
    // la pantalla.
    const armado = armadoBase({ modalidad: 'INDIVIDUAL', jugadores: ['Ana', 'Bea', 'Cin', 'Dan'] })

    const torneo = armar(armado, () => 0)

    const referencias = torneo.partidos.flatMap((partido) => [partido.a, partido.b])
    expect(new Set(referencias).size).toBe(referencias.length)
  })

  it('PAREJAS + FIJAS: arma los lados desde parejasManuales', () => {
    const armado = armadoBase({
      modalidad: 'PAREJAS',
      modoParejas: 'FIJAS',
      jugadores: ['A', 'B', 'C', 'D'],
      parejasManuales: [
        [1, 0],
        [2, 3],
      ],
    })
    const torneo = armar(armado, () => 0)
    // buildFixture(2) da una sola ronda: lado 0 contra lado 1.
    expect(torneo.partidos).toEqual([{ ronda: 1, a: [1, 0], b: [2, 3], marcador: null }])
  })

  it('PAREJAS + SORTEADAS: baraja con el random inyectado y arma parejas de a dos', () => {
    const armado = armadoBase({
      modalidad: 'PAREJAS',
      modoParejas: 'SORTEADAS',
      jugadores: ['A', 'B', 'C', 'D'],
    })
    // Fisher-Yates con random constante en 0 siempre elige j = 0: para
    // [0,1,2,3] termina en [1,2,3,0], agrupado de a dos: [1,2] y [3,0].
    const torneo = armar(armado, () => 0)
    expect(torneo.partidos).toEqual([{ ronda: 1, a: [1, 2], b: [3, 0], marcador: null }])
  })

  it('PAREJAS + SORTEADAS: el mismo random da siempre el mismo resultado', () => {
    const armado = armadoBase({
      modalidad: 'PAREJAS',
      modoParejas: 'SORTEADAS',
      jugadores: ['A', 'B', 'C', 'D', 'E', 'F'],
    })
    let semilla = 0
    const random = () => {
      semilla = (semilla + 0.37) % 1
      return semilla
    }
    const uno = armar(armado, random)
    semilla = 0
    const dos = armar(armado, random)
    expect(uno).toEqual(dos)
  })

  it('nunca llama a Math.random: usa siempre el random inyectado', () => {
    const espiado = { llamado: false }
    const original = Math.random
    Math.random = () => {
      espiado.llamado = true
      return original()
    }
    try {
      const armado = armadoBase({
        modalidad: 'PAREJAS',
        modoParejas: 'SORTEADAS',
        jugadores: ['A', 'B', 'C', 'D'],
      })
      armar(armado, () => 0.5)
      expect(espiado.llamado).toBe(false)
    } finally {
      Math.random = original
    }
  })

  describe('PAREJAS + ROTATIVAS (americano)', () => {
    const nombres = ['Ana', 'Bea', 'Cin', 'Dan', 'Emi']
    const armado = armadoBase({
      modalidad: 'PAREJAS',
      modoParejas: 'ROTATIVAS',
      jugadores: nombres,
      rondas: 3,
    })

    it('juega exactamente armado.rondas rondas', () => {
      const torneo = armar(armado, () => 0)
      const rondasJugadas = new Set(torneo.partidos.map((partido) => partido.ronda))
      expect(rondasJugadas).toEqual(new Set([1, 2, 3]))
    })

    it('no repite compañeros de pareja cuando se puede evitar', () => {
      const torneo = armar(armado, () => 0)
      const parejasVistas = new Set<string>()
      for (const partido of torneo.partidos) {
        for (const lado of [partido.a, partido.b]) {
          const clave = [...lado].sort((x, y) => x - y).join('-')
          expect(parejasVistas.has(clave)).toBe(false)
          parejasVistas.add(clave)
        }
      }
    })

    it('con 4 jugadores (par) nadie descansa nunca, en las 3 rondas posibles sin repetir', () => {
      const cuatro = armadoBase({
        modalidad: 'PAREJAS',
        modoParejas: 'ROTATIVAS',
        jugadores: ['Ana', 'Bea', 'Cin', 'Dan'],
        rondas: 3,
      })
      const torneo = armar(cuatro, () => 0)
      for (const partido of torneo.partidos) {
        expect(partido.a).toHaveLength(2)
        expect(partido.b).toHaveLength(2)
      }
      expect(torneo.partidos).toHaveLength(3)
    })

    it('con 6 jugadores no repite compañeros cuando hay un armado sin repetir', () => {
      // n=6 es el tamaño donde el bug vivía: `floor(6/2) = 3` parejas, IMPAR,
      // así que UNA pareja se arma y descansa cada ronda. Con n=5 y n=4 —los
      // dos fixtures que ya había— `floor(n/2)` da 2, par, y nunca sobra una
      // pareja: el defecto no podía aparecer. Los tamaños con pareja que
      // descansa son n ∈ {6,7,10,11}.
      //
      // Antes del arreglo, la pareja que descansaba igual se anotaba en el
      // historial, así que el minimizador la esquivaba como si hubiera jugado
      // y terminaba eligiendo una repetición REAL. Con semilla 2 y 4 rondas,
      // la ronda 4 repetía 4-5 (ya jugada en la ronda 2) teniendo disponible
      // [1,4]+[2,5], que no repite nada.
      const seis = armadoBase({
        modalidad: 'PAREJAS',
        modoParejas: 'ROTATIVAS',
        jugadores: ['Ana', 'Bea', 'Cin', 'Dan', 'Emi', 'Fer'],
        rondas: 4,
      })

      const torneo = armar(seis, mulberry32(2))

      const vistas = new Set<string>()
      for (const partido of torneo.partidos) {
        for (const lado of [partido.a, partido.b]) {
          const clave = claveDeLado(lado)
          expect(vistas.has(clave)).toBe(false)
          vistas.add(clave)
        }
      }
    })

    it('con 6 jugadores no anota como jugada a la pareja que se quedó afuera', () => {
      // El otro lado de la misma regla, dicho sin depender de una semilla:
      // la cantidad de parejas distintas que jugaron tiene que ser la cantidad
      // de lados que se pushearon. Si una pareja que descansó contaminara el
      // historial, el minimizador arrastraría un costo que nadie pagó.
      const seis = armadoBase({
        modalidad: 'PAREJAS',
        modoParejas: 'ROTATIVAS',
        jugadores: ['Ana', 'Bea', 'Cin', 'Dan', 'Emi', 'Fer'],
        rondas: 4,
      })

      const torneo = armar(seis, mulberry32(2))

      const lados = torneo.partidos.flatMap((partido) => [partido.a, partido.b])
      expect(new Set(lados.map(claveDeLado)).size).toBe(lados.length)
    })

    it('el descanso rota: no siempre la misma persona se queda afuera', () => {
      const torneo = armar(armado, () => 0)
      const descansos = [1, 2, 3].map((numeroRonda) => {
        const partido = torneo.partidos.find((p) => p.ronda === numeroRonda)
        const enCancha = new Set(partido ? [...partido.a, ...partido.b] : [])
        return nombres.findIndex((_, indice) => !enCancha.has(indice))
      })
      expect(new Set(descansos).size).toBeGreaterThan(1)
    })
  })
})

describe('cargarMarcador', () => {
  const armado = armadoBase({ modalidad: 'INDIVIDUAL', jugadores: ['A', 'B', 'C'] })

  it('no muta el torneo original: devuelve uno nuevo', () => {
    const original = armar(armado, () => 0)
    const copia = JSON.parse(JSON.stringify(original)) as TorneoRapido

    const actualizado = cargarMarcador(original, 0, 4, 2)

    expect(original).toEqual(copia)
    expect(actualizado).not.toBe(original)
    expect(actualizado.partidos[0]?.marcador).toEqual({ a: 4, b: 2 })
  })

  it('permite un empate', () => {
    const original = armar(armado, () => 0)
    const actualizado = cargarMarcador(original, 0, 3, 3)
    expect(actualizado.partidos[0]?.marcador).toEqual({ a: 3, b: 3 })
  })

  it('rechaza un marcador negativo', () => {
    const original = armar(armado, () => 0)
    expect(() => cargarMarcador(original, 0, -1, 2)).toThrow()
  })

  it('rechaza un marcador no entero', () => {
    const original = armar(armado, () => 0)
    expect(() => cargarMarcador(original, 0, 1.5, 2)).toThrow()
  })

  it('rechaza un índice fuera de rango', () => {
    const original = armar(armado, () => 0)
    expect(() => cargarMarcador(original, 999, 4, 2)).toThrow()
  })
})

describe('tabla — por lado (todo modo salvo PAREJAS + ROTATIVAS)', () => {
  const armado = armadoBase({ modalidad: 'INDIVIDUAL', jugadores: ['Ana', 'Bea', 'Cin'] })
  const base: TorneoRapido = {
    armado,
    jugadores: ['Ana', 'Bea', 'Cin'],
    partidos: [
      { ronda: 1, a: [0], b: [1], marcador: { a: 4, b: 2 } },
      { ronda: 2, a: [0], b: [2], marcador: { a: 4, b: 4 } },
      { ronda: 3, a: [1], b: [2], marcador: null },
    ],
  }

  it('cuenta ganados/jugados/diferencia y ordena por ganados, luego diferencia, luego nombre', () => {
    expect(tabla(base)).toEqual([
      { clave: '0', jugadores: ['Ana'], jugados: 2, ganados: 1, diferencia: 2, posicion: 1 },
      { clave: '2', jugadores: ['Cin'], jugados: 1, ganados: 0, diferencia: 0, posicion: 2 },
      { clave: '1', jugadores: ['Bea'], jugados: 1, ganados: 0, diferencia: -2, posicion: 3 },
    ])
  })

  it('ganados manda sobre diferencia: gana el que ganó más, aunque tenga peor diferencia', () => {
    // La regla primaria del orden, con un fixture que la CONTRADICE: Bea
    // tiene MEJOR diferencia que Ana (-2 contra -5) y sale DETRÁS, porque Ana
    // ganó un partido y Bea ninguno. El fixture de arriba no fija nada de
    // esto: ahí ganados y diferencia ordenan igual, así que invertir la
    // prioridad en el código no rompería nada.
    const contradictorio: TorneoRapido = {
      armado,
      jugadores: ['Ana', 'Bea', 'Cin'],
      partidos: [
        { ronda: 1, a: [0], b: [1], marcador: { a: 4, b: 2 } },
        { ronda: 2, a: [0], b: [2], marcador: { a: 1, b: 8 } },
        { ronda: 3, a: [1], b: [2], marcador: { a: 3, b: 3 } },
      ],
    }

    const filas = tabla(contradictorio)

    expect(filas.map((fila) => fila.jugadores[0])).toEqual(['Cin', 'Ana', 'Bea'])
    expect(filas[1]).toMatchObject({ jugadores: ['Ana'], ganados: 1, diferencia: -5 })
    expect(filas[2]).toMatchObject({ jugadores: ['Bea'], ganados: 0, diferencia: -2 })
  })

  it('en el empate total desempata el nombre, no el orden en que aparecieron', () => {
    // Tres empates: todos terminan 0 ganados y 0 de diferencia. Los lados se
    // descubren en el orden de los partidos (Zoe, Bea, Ana), así que si el
    // desempate por nombre no existiera el orden quedaría el de aparición.
    const todoEmpatado: TorneoRapido = {
      armado,
      jugadores: ['Zoe', 'Bea', 'Ana'],
      partidos: [
        { ronda: 1, a: [0], b: [1], marcador: { a: 2, b: 2 } },
        { ronda: 2, a: [0], b: [2], marcador: { a: 3, b: 3 } },
        { ronda: 3, a: [1], b: [2], marcador: { a: 1, b: 1 } },
      ],
    }

    const filas = tabla(todoEmpatado)

    expect(filas.map((fila) => fila.jugadores[0])).toEqual(['Ana', 'Bea', 'Zoe'])
  })

  it('la clave de un lado ordena sus índices: [1, 0] es "0-1"', () => {
    // La clave es la IDENTIDAD del lado: la misma pareja tiene que dar la
    // misma clave la escriban como la escriban. En FIJAS el usuario puede
    // haber armado la pareja al revés.
    const fijas = armadoBase({
      modalidad: 'PAREJAS',
      modoParejas: 'FIJAS',
      jugadores: ['Ana', 'Bea', 'Cin', 'Dan'],
      parejasManuales: [
        [1, 0],
        [2, 3],
      ],
    })
    const torneo = armar(fijas, () => 0)

    const filas = tabla(torneo)

    expect(filas.map((fila) => fila.clave).sort()).toEqual(['0-1', '2-3'])
  })

  it('un lado que no jugó ningún partido con marcador aparece igual, con ceros', () => {
    const sinJugar: TorneoRapido = {
      armado,
      jugadores: ['Ana', 'Bea'],
      partidos: [{ ronda: 1, a: [0], b: [1], marcador: null }],
    }
    const filas = tabla(sinJugar)
    expect(filas.map((f) => f.clave).sort()).toEqual(['0', '1'])
    for (const fila of filas) {
      expect(fila.jugados).toBe(0)
      expect(fila.ganados).toBe(0)
      expect(fila.diferencia).toBe(0)
    }
  })
})

describe('tabla — por jugador (PAREJAS + ROTATIVAS)', () => {
  it('cada jugador suma lo que ganó su lado en cada partido que jugó', () => {
    const armado = armadoBase({
      modalidad: 'PAREJAS',
      modoParejas: 'ROTATIVAS',
      jugadores: ['Ana', 'Bea', 'Cin', 'Dan'],
      rondas: 1,
    })
    const torneo: TorneoRapido = {
      armado,
      jugadores: ['Ana', 'Bea', 'Cin', 'Dan'],
      partidos: [{ ronda: 1, a: [0, 1], b: [2, 3], marcador: { a: 6, b: 3 } }],
    }
    expect(tabla(torneo)).toEqual([
      { clave: '0', jugadores: ['Ana'], jugados: 1, ganados: 1, diferencia: 3, posicion: 1 },
      { clave: '1', jugadores: ['Bea'], jugados: 1, ganados: 1, diferencia: 3, posicion: 2 },
      { clave: '2', jugadores: ['Cin'], jugados: 1, ganados: 0, diferencia: -3, posicion: 3 },
      { clave: '3', jugadores: ['Dan'], jugados: 1, ganados: 0, diferencia: -3, posicion: 4 },
    ])
  })
})

describe('terminado y campeon', () => {
  const armado = armadoBase({ modalidad: 'INDIVIDUAL', jugadores: ['Ana', 'Bea', 'Cin'] })

  it('no está terminado si falta algún marcador, y no hay campeón todavía', () => {
    const torneo: TorneoRapido = {
      armado,
      jugadores: ['Ana', 'Bea', 'Cin'],
      partidos: [{ ronda: 1, a: [0], b: [1], marcador: null }],
    }
    expect(terminado(torneo)).toBe(false)
    expect(campeon(torneo)).toBeNull()
  })

  it('cuando terminó, el campeón es la fila de posición 1', () => {
    const torneo: TorneoRapido = {
      armado,
      jugadores: ['Ana', 'Bea', 'Cin'],
      partidos: [
        { ronda: 1, a: [0], b: [1], marcador: { a: 4, b: 2 } },
        { ronda: 2, a: [0], b: [2], marcador: { a: 4, b: 1 } },
        { ronda: 3, a: [1], b: [2], marcador: { a: 3, b: 3 } },
      ],
    }
    expect(terminado(torneo)).toBe(true)
    expect(campeon(torneo)?.jugadores).toEqual(['Ana'])
  })

  it('sin partidos, terminado da true pero campeon da null si no hay filas', () => {
    const vacio: TorneoRapido = { armado, jugadores: [], partidos: [] }
    expect(terminado(vacio)).toBe(true)
    expect(campeon(vacio)).toBeNull()
  })
})

describe('leerTorneo / escribirTorneo', () => {
  const armado = armadoBase({ modalidad: 'INDIVIDUAL', jugadores: ['Ana', 'Bea', 'Cin'] })
  const torneo: TorneoRapido = {
    armado,
    jugadores: ['Ana', 'Bea', 'Cin'],
    partidos: [{ ronda: 1, a: [0], b: [1], marcador: { a: 4, b: 2 } }],
  }

  it('escribe y relee el mismo torneo', () => {
    expect(leerTorneo(escribirTorneo(torneo))).toEqual(torneo)
  })

  it('devuelve null cuando raw es null', () => {
    expect(leerTorneo(null)).toBeNull()
  })

  it('devuelve null con JSON roto', () => {
    expect(leerTorneo('{esto no es json')).toBeNull()
  })

  it('devuelve null con la forma vieja de otra versión (le falta modoParejas)', () => {
    const viejo = {
      armado: {
        nombre: '',
        deporte: 'PADEL',
        modalidad: 'INDIVIDUAL',
        jugadores: ['Ana', 'Bea', 'Cin'],
        rondas: 4,
        parejasManuales: [],
      },
      jugadores: ['Ana', 'Bea', 'Cin'],
      partidos: [],
    }
    expect(leerTorneo(JSON.stringify(viejo))).toBeNull()
  })

  it('devuelve null si deporte/modalidad/modoParejas están fuera de sus uniones', () => {
    const roto = { ...torneo, armado: { ...armado, deporte: 'TENIS' } }
    expect(leerTorneo(JSON.stringify(roto))).toBeNull()
  })

  it('devuelve null si un partido referencia un índice fuera de rango', () => {
    const roto = {
      ...torneo,
      partidos: [{ ronda: 1, a: [0], b: [99], marcador: null }],
    }
    expect(leerTorneo(JSON.stringify(roto))).toBeNull()
  })

  it('devuelve null si falta el campo jugadores', () => {
    const { jugadores: _jugadores, ...roto } = torneo
    expect(leerTorneo(JSON.stringify(roto))).toBeNull()
  })

  // ── El borde de confianza: `raw` lo pudo editar el usuario a mano ───────
  // Lo que `cargarMarcador` rechaza al ESCRIBIR tiene que rechazarlo también
  // la lectura. Si no, el camino que el usuario sí puede tocar —el
  // localStorage— es más permisivo que el que toca la app.
  it.each([
    ['negativo', { a: -1000, b: 0 }],
    ['no entero', { a: 1.5, b: 2 }],
    ['que es un string', { a: '3', b: 0 }],
  ])('devuelve null con un marcador %s', (_caso, marcador) => {
    const roto = { ...torneo, partidos: [{ ronda: 1, a: [0], b: [1], marcador }] }
    expect(leerTorneo(JSON.stringify(roto))).toBeNull()
  })

  it('acepta un marcador entero de 0 para arriba, empate incluido', () => {
    const empate = { ...torneo, partidos: [{ ronda: 1, a: [0], b: [1], marcador: { a: 0, b: 0 } }] }
    expect(leerTorneo(JSON.stringify(empate))?.partidos[0]?.marcador).toEqual({ a: 0, b: 0 })
  })

  // La regla de verdad del hallazgo: el borde es UNO SOLO. Enumerar formas
  // rechazadas envejece mal; lo que hay que fijar es que los dos caminos
  // opinen igual, sea cual sea el valor. `1e308` está en la lista a propósito:
  // hoy lo rechazan LOS DOS, y este test es el que obliga a que cualquier
  // cambio de techo se aplique a los dos caminos juntos y no a uno solo.
  it.each([-1000, -1, -0.5, 0, 1.5, 3, 1e308])(
    'la lectura acepta exactamente los mismos puntajes que la escritura (%p)',
    (puntaje) => {
      const aceptaEscritura = (): boolean => {
        try {
          cargarMarcador(torneo, 0, puntaje, 0)
          return true
        } catch {
          return false
        }
      }
      const aceptaLectura = (): boolean => {
        const candidato = {
          ...torneo,
          partidos: [{ ronda: 1, a: [0], b: [1], marcador: { a: puntaje, b: 0 } }],
        }
        return leerTorneo(JSON.stringify(candidato)) !== null
      }

      expect(aceptaLectura()).toBe(aceptaEscritura())
    },
  )

  // El techo, fijado aparte de la simetría porque son dos reglas distintas:
  // la simetría dice "los dos caminos opinan igual" y pasa igual con o sin
  // techo. 2^53 es el valor que las separa — es entero para `isInteger` y NO
  // lo es para `isSafeInteger`. Arriba de ahí la resta de `diferencia` pierde
  // precisión en silencio, y una tabla que ordena mal sin avisar es peor que
  // una que rechaza el dato. Este test existe porque se midió: sin él, volver
  // a `isInteger` deja los 457 tests en verde.
  it.each([2 ** 53, 1e308])('rechaza un puntaje que no es entero seguro (%p)', (puntaje) => {
    expect(() => cargarMarcador(torneo, 0, puntaje, 0)).toThrow()

    const candidato = {
      ...torneo,
      partidos: [{ ronda: 1, a: [0], b: [1], marcador: { a: puntaje, b: 0 } }],
    }
    expect(leerTorneo(JSON.stringify(candidato))).toBeNull()
  })

  // `rondas` acota el trabajo de `armar`: el americano corre un bucle por
  // ronda y cada uno enumera TODOS los emparejamientos del pool. La spec dice
  // 1..12 y `armadoWarning` lo respeta; la lectura tiene que respetarlo igual
  // o un `1e9` guardado a mano cuelga el main thread al rearmar.
  it.each([
    ['negativas', -5],
    ['no enteras', 3.7],
    ['absurdamente muchas', 1e9],
    ['cero', 0],
    ['trece', 13],
  ])('devuelve null con rondas %s', (_caso, rondas) => {
    const roto = { ...torneo, armado: { ...armado, rondas } }
    expect(leerTorneo(JSON.stringify(roto))).toBeNull()
  })

  it.each([1, 12])('acepta rondas en el borde del rango permitido (%i)', (rondas) => {
    const valido = { ...torneo, armado: { ...armado, rondas } }
    expect(leerTorneo(JSON.stringify(valido))?.armado.rondas).toBe(rondas)
  })

  it('devuelve null si parejasManuales apunta fuera de los jugadores filtrados', () => {
    const roto = { ...torneo, armado: { ...armado, parejasManuales: [[0, 99]] } }
    expect(leerTorneo(JSON.stringify(roto))).toBeNull()
  })

  // Un partido incoherente no explota al leerlo, explota después: con el
  // mismo jugador de los dos lados, `tabla` le suma DOS veces la misma fila
  // y le cuenta `jugados: 2` por un solo partido.
  it.each([
    ['el mismo jugador de los dos lados', { a: [0], b: [0] }],
    ['un jugador repetido dentro de un lado', { a: [0, 0], b: [1, 2] }],
    ['lados de distinto tamaño', { a: [0], b: [1, 2] }],
    ['un jugador en los dos lados de una pareja', { a: [0, 1], b: [1, 2] }],
  ])('devuelve null con %s', (_caso, lados) => {
    const roto = { ...torneo, partidos: [{ ronda: 1, ...lados, marcador: null }] }
    expect(leerTorneo(JSON.stringify(roto))).toBeNull()
  })

  it('el STORAGE_KEY es el acordado', () => {
    expect(STORAGE_KEY).toBe('padel:torneo-rapido')
  })
})
