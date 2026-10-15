import { describe, expect, it } from 'vitest'
import { fichaSeed, type Modality, type TournamentSport } from '@/core'
import { rulesFromSeed, type DisciplineRules } from '@/app/deporte/personalizar-reglas-state'
import {
  cambiarModalidad,
  cambiarPrimeraFecha,
  cambiarReglas,
  crearPayload,
  elegirDeporte,
  cambiarParejas,
  errorDeModalidades,
  filaDestino,
  moverEnOrden,
  opcionesPrimeraFecha,
  ordenInicial,
  parejasCompletas,
  plantelCambio,
  reglasDeFicha,
  sorteaLaApp,
  sortearParejas,
  subpasos,
  tocarSortear,
  type DeporteElegido,
} from './crear-state'

/** Una tarjeta armada a mano desde la ficha, sin pasar por `elegirDeporte`: así los tests de éste no dependen de sí mismos. */
function card(kind: TournamentSport, modality: Modality, squad = 8, over: Partial<DeporteElegido> = {}): DeporteElegido {
  const seed = fichaSeed(kind, squad, modality)
  return {
    kind,
    modality,
    primeraFecha: seed.config.firstFecha ?? 'SORTEO',
    rules: rulesFromSeed(seed),
    order: [],
    pairs: [],
    ...over,
  }
}
const withConfig = (rules: DisciplineRules, patch: Partial<DisciplineRules['config']>): DisciplineRules => ({
  ...rules,
  config: { ...rules.config, ...patch },
})
const kinds = (cards: readonly DeporteElegido[]) => cards.map((c) => c.kind)
const ANA_BETO_CARLA_DANI = ['Ana', 'Beto', 'Carla', 'Dani']

describe('elegirDeporte', () => {
  it('el primer toque agrega la tarjeta con la ficha y su primera modalidad', () => {
    const [pick, ...rest] = elegirDeporte([], 'PADEL', 8)
    expect(rest).toEqual([])
    expect(pick).toEqual({
      kind: 'PADEL',
      modality: 'ROTAN',
      primeraFecha: 'NIVEL',
      rules: rulesFromSeed(fichaSeed('PADEL', 8, 'ROTAN')),
      order: [],
      pairs: [],
    })
  })

  it('las tarjetas quedan en el orden de los toques, y tocar una elegida la saca', () => {
    const padel = elegirDeporte([], 'PADEL', 8)
    const both = elegirDeporte(padel, 'FIFA', 8)
    expect(kinds(both)).toEqual(['PADEL', 'FIFA'])
    expect(kinds(elegirDeporte(both, 'PADEL', 8))).toEqual(['FIFA'])
    expect(kinds(elegirDeporte(elegirDeporte([], 'FIFA', 8), 'PADEL', 8))).toEqual(['FIFA', 'PADEL'])
  })

  it('la tarjeta nueva de FIFA arranca individual y al azar, como dice su ficha', () => {
    const [fifa] = elegirDeporte([], 'FIFA', 8)
    expect(fifa).toMatchObject({ modality: 'INDIVIDUAL', primeraFecha: 'SORTEO' })
  })

  it('al sacar la tarjeta de la que otra era "igual que", la otra vuelve al default de su ficha', () => {
    const padel = card('PADEL', 'ROTAN')
    const fifaIndividual = card('FIFA', 'INDIVIDUAL', 8, { primeraFecha: { igualQue: 'PADEL' } })
    const fifaRotan = card('FIFA', 'ROTAN', 8, { primeraFecha: { igualQue: 'PADEL' } })
    expect(elegirDeporte([padel, fifaIndividual], 'PADEL', 8)).toEqual([{ ...fifaIndividual, primeraFecha: 'SORTEO' }])
    expect(elegirDeporte([padel, fifaRotan], 'PADEL', 8)).toEqual([{ ...fifaRotan, primeraFecha: 'NIVEL' }])
  })

  it('sacar una tarjeta no toca a las que no dependían de ella', () => {
    const padel = card('PADEL', 'ROTAN', 8, { primeraFecha: 'SORTEO', order: [1, 0] })
    const fifa = card('FIFA', 'INDIVIDUAL')
    expect(elegirDeporte([padel, fifa], 'FIFA', 8)).toEqual([padel])
  })
})

describe('cambiarModalidad', () => {
  it('Pádel con sets y fechas tocados pasa a fijas: conserva lo tocado y reaplica la primera fecha y los Masters', () => {
    const touched = card('PADEL', 'ROTAN', 8, {
      rules: withConfig(
        { ...card('PADEL', 'ROTAN').rules, hasMasters: false },
        { matchFormat: { setsToWin: 2, gamesPerSet: 4, tieBreak: true, openScore: false }, regularMatchdays: 12 },
      ),
      primeraFecha: 'NIVEL',
      order: [1, 0, 3, 2],
      pairs: [[0, 1]],
    })
    const next = cambiarModalidad(touched, 'FIJAS', 8)
    expect(next.modality).toBe('FIJAS')
    expect(next.rules.config.matchFormat.setsToWin).toBe(2)
    expect(next.rules.config.regularMatchdays).toBe(12)
    expect(next.primeraFecha).toBe('SORTEO')
    expect(next.rules.hasMasters).toBe(true)
    expect(next.order).toEqual([])
    expect(next.pairs).toEqual([])
  })

  it('los puntos vuelven a la curva de la ficha para la modalidad nueva', () => {
    const touched = card('PADEL', 'ROTAN', 8, { rules: withConfig(card('PADEL', 'ROTAN').rules, { points: [9, 5, 2, 1] }) })
    expect(cambiarModalidad(touched, 'FIJAS', 8).rules.config.points).toEqual(fichaSeed('PADEL', 8, 'FIJAS').config.points)
  })

  it('FIFA de individual a parejas que rotan: un puesto por pareja y sin Masters', () => {
    const next = cambiarModalidad(card('FIFA', 'INDIVIDUAL'), 'ROTAN', 8)
    expect(next.rules.config.points).toHaveLength(4)
    expect(next.rules.hasMasters).toBe(false)
    expect(next.primeraFecha).toBe('NIVEL')
  })

  it('FIFA de parejas a individual: un puesto por jugador', () => {
    expect(cambiarModalidad(card('FIFA', 'ROTAN'), 'INDIVIDUAL', 8).rules.config.points).toHaveLength(8)
  })

  it('no muta la tarjeta que recibe', () => {
    const before = card('PADEL', 'ROTAN', 8, { order: [1, 0] })
    const snapshot = structuredClone(before)
    cambiarModalidad(before, 'FIJAS', 8)
    expect(before).toEqual(snapshot)
  })
})

describe('opcionesPrimeraFecha', () => {
  const POR_NIVEL = { value: 'NIVEL', label: 'Por nivel', sub: 'las ordenás vos' }
  const AL_AZAR = { value: 'SORTEO', label: 'Al azar', sub: 'sorteo' }

  it('con una sola tarjeta no hay "igual que"', () => {
    expect(opcionesPrimeraFecha([card('PADEL', 'ROTAN')], 'PADEL')).toEqual([POR_NIVEL, AL_AZAR])
  })

  it('con Pádel y FIFA, cada uno ofrece "Igual que" el otro', () => {
    const cards = [card('PADEL', 'ROTAN'), card('FIFA', 'INDIVIDUAL')]
    expect(opcionesPrimeraFecha(cards, 'FIFA')).toEqual([
      POR_NIVEL,
      AL_AZAR,
      { value: { igualQue: 'PADEL' }, label: 'Igual que Pádel', sub: null },
    ])
    expect(opcionesPrimeraFecha(cards, 'PADEL').map((o) => o.label)).toEqual(['Por nivel', 'Al azar', 'Igual que FIFA'])
  })

  it('si Pádel es "igual que" FIFA, FIFA no ofrece "igual que" Pádel (sin cadenas)', () => {
    const cards = [card('PADEL', 'ROTAN', 8, { primeraFecha: { igualQue: 'FIFA' } }), card('FIFA', 'INDIVIDUAL')]
    expect(opcionesPrimeraFecha(cards, 'FIFA')).toEqual([POR_NIVEL, AL_AZAR])
    // y Pádel sigue viendo su elección vigente entre las opciones
    expect(opcionesPrimeraFecha(cards, 'PADEL').map((o) => o.value)).toContainEqual({ igualQue: 'FIFA' })
  })

  it('con tres deportes, a la que otra copia no se le ofrece "igual que" (FIFA → Pádel → Ping pong sería una cadena)', () => {
    const cards = [
      card('PADEL', 'ROTAN'),
      card('PING_PONG', 'INDIVIDUAL'),
      card('FIFA', 'INDIVIDUAL', 8, { primeraFecha: { igualQue: 'PADEL' } }),
    ]
    expect(opcionesPrimeraFecha(cards, 'PADEL')).toEqual([POR_NIVEL, AL_AZAR])
    // Ping pong nadie la copia: puede copiar a Pádel (dos que copian a la misma no es cadena), no a FIFA.
    expect(opcionesPrimeraFecha(cards, 'PING_PONG').map((o) => o.label)).toEqual(['Por nivel', 'Al azar', 'Igual que Pádel'])
  })
})

describe('cambiarPrimeraFecha', () => {
  it('cambia sólo la de esa tarjeta, sin mutar el arreglo ni las otras', () => {
    const padel = card('PADEL', 'ROTAN')
    const fifa = card('FIFA', 'INDIVIDUAL')
    const cards = [padel, fifa]
    const next = cambiarPrimeraFecha(cards, 'FIFA', { igualQue: 'PADEL' })
    expect(next[0]).toBe(padel)
    expect(next[1]).toEqual({ ...fifa, primeraFecha: { igualQue: 'PADEL' } })
    expect(cards).toEqual([padel, fifa])
    expect(fifa.primeraFecha).toBe('SORTEO')
  })
})

describe('cambiarReglas y reglasDeFicha', () => {
  it('cambiarReglas reemplaza las reglas de esa tarjeta y nada más', () => {
    const padel = card('PADEL', 'ROTAN')
    const fifa = card('FIFA', 'INDIVIDUAL')
    const rules = withConfig(padel.rules, { regularMatchdays: 14 })
    const next = cambiarReglas([padel, fifa], 'PADEL', rules)
    expect(next[0]?.rules).toBe(rules)
    expect(next[1]).toBe(fifa)
  })

  it('"Volver a las reglas de Pádel" devuelve las de la ficha, para el plantel de hoy', () => {
    const touched = card('PADEL', 'ROTAN', 8, { rules: withConfig(card('PADEL', 'ROTAN').rules, { regularMatchdays: 14 }) })
    expect(reglasDeFicha(touched, 8)).toEqual(rulesFromSeed(fichaSeed('PADEL', 8, 'ROTAN')))
    expect(reglasDeFicha(touched, 10).config.points).toHaveLength(5)
  })
})

describe('plantelCambio', () => {
  it('con otro plantel, los puntos van al tamaño nuevo y el orden y las parejas armados se vacían en todas', () => {
    const fijas = card('PADEL', 'FIJAS', 8, { order: [1, 0, 3, 2], pairs: [[0, 1], [2, 3], [4, 5], [6, 7]] })
    const individual = card('FIFA', 'INDIVIDUAL', 8, { order: [7, 6, 5, 4, 3, 2, 1, 0] })
    const [padel, fifa] = plantelCambio([fijas, individual], 10)
    expect(padel?.rules.config).toMatchObject({ squadSize: 10 })
    expect(padel?.rules.config.points).toHaveLength(5)
    expect(fifa?.rules.config.points).toHaveLength(10)
    expect([padel?.order, padel?.pairs, fifa?.order, fifa?.pairs]).toEqual([[], [], [], []])
  })

  it('un plantel impar da un puesto por jugador en individual', () => {
    const [fifa] = plantelCambio([card('FIFA', 'INDIVIDUAL', 8, { order: [0, 1] })], 7)
    expect(fifa?.rules.config.points).toHaveLength(7)
    expect(fifa?.order).toEqual([])
  })

  it('conserva lo que el usuario tocó en las reglas', () => {
    const touched = card('PADEL', 'ROTAN', 8, { rules: withConfig(card('PADEL', 'ROTAN').rules, { regularMatchdays: 14 }) })
    expect(plantelCambio([touched], 10)[0]?.rules.config.regularMatchdays).toBe(14)
  })
})

describe('errorDeModalidades', () => {
  const siete = ['Ana', 'Beto', 'Carla', 'Dani', 'Eva', 'Fede', 'Gus']

  it('plantel impar con parejas: el aviso de siempre', () => {
    expect(errorDeModalidades([card('PADEL', 'ROTAN')], siete)).toBe(
      'Son 7. El plantel tiene que ser par para poder armar parejas.',
    )
    expect(errorDeModalidades([card('PADEL', 'FIJAS')], siete)).toBe(
      'Son 7. El plantel tiene que ser par para poder armar parejas.',
    )
  })

  it('con alguna modalidad de parejas alcanza, aunque otra sea individual', () => {
    expect(errorDeModalidades([card('FIFA', 'INDIVIDUAL'), card('PADEL', 'ROTAN')], siete)).not.toBeNull()
  })

  it('FIFA individual acepta un plantel impar', () => {
    expect(errorDeModalidades([card('FIFA', 'INDIVIDUAL')], siete)).toBeNull()
  })

  it('pasar a parejas en el paso 3 sube el piso: dos amigos de FIFA no alcanzan para parejas', () => {
    expect(errorDeModalidades([card('FIFA', 'INDIVIDUAL', 2)], ['Ana', 'Beto'])).toBeNull()
    expect(errorDeModalidades([card('FIFA', 'ROTAN', 2)], ['Ana', 'Beto'])).toBe('Faltan 2 nombres. El plantel arranca en 4.')
  })

  it('un plantel par con parejas está bien, y las filas en blanco no cuentan', () => {
    expect(errorDeModalidades([card('PADEL', 'ROTAN')], [...ANA_BETO_CARLA_DANI, '', '  '])).toBeNull()
    expect(errorDeModalidades([card('PADEL', 'ROTAN')], [...siete, ''])).not.toBeNull()
  })
})

describe('subpasos', () => {
  it('parejas fijas pide armar parejas y por nivel pide ordenar, en ese orden', () => {
    const cards = [card('PADEL', 'FIJAS'), card('FIFA', 'INDIVIDUAL', 8, { primeraFecha: 'NIVEL' })]
    expect(subpasos(cards)).toEqual(['PAREJAS', 'NIVEL'])
  })

  it('FIFA al azar no necesita ningún subpaso', () => {
    expect(subpasos([card('FIFA', 'INDIVIDUAL')])).toEqual([])
  })

  it('Pádel que rota va por nivel: sólo ordenar', () => {
    expect(subpasos([card('PADEL', 'ROTAN')])).toEqual(['NIVEL'])
  })

  it('"igual que" no pide un subpaso propio', () => {
    const cards = [card('PADEL', 'FIJAS'), card('FIFA', 'INDIVIDUAL', 8, { primeraFecha: { igualQue: 'PADEL' } })]
    expect(subpasos(cards)).toEqual(['PAREJAS'])
  })
})

describe('sortearParejas', () => {
  const flat = (pairs: Array<[number, number]>) => pairs.flat().sort((a, b) => a - b)

  it('arma de a dos, disjuntas, cubriendo todos los asientos', () => {
    const pairs = sortearParejas(6, () => 0)
    expect(pairs).toHaveLength(3)
    expect(flat(pairs)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('usa el random que le dan', () => {
    const noSwaps = sortearParejas(6, () => 0.999)
    expect(noSwaps).toEqual([[0, 1], [2, 3], [4, 5]])
    expect(sortearParejas(6, () => 0)).not.toEqual(noSwaps)
  })

  it('con un plantel impar tira', () => {
    expect(() => sortearParejas(5, () => 0)).toThrow('Sortear parejas necesita un plantel par.')
  })
})

describe('parejasCompletas', () => {
  const fijas = (pairs: Array<[number, number]>) => card('PADEL', 'FIJAS', 4, { pairs })

  it('completas: cada asiento en una pareja', () => {
    expect(parejasCompletas(fijas([[0, 3], [1, 2]]), 4)).toBe(true)
  })

  it('faltan parejas', () => {
    expect(parejasCompletas(fijas([]), 4)).toBe(false)
    expect(parejasCompletas(fijas([[0, 3]]), 4)).toBe(false)
  })

  it('alguien repetido o un asiento que no existe no cuenta', () => {
    expect(parejasCompletas(fijas([[0, 1], [1, 2]]), 4)).toBe(false)
    expect(parejasCompletas(fijas([[0, 1], [2, 4]]), 4)).toBe(false)
  })

  it('sin parejas fijas no hay nada que armar', () => {
    expect(parejasCompletas(card('PADEL', 'ROTAN', 4), 4)).toBe(true)
  })
})

describe('crearPayload', () => {
  const squad = { names: [...ANA_BETO_CARLA_DANI], mySeat: 0 }

  it('Pádel por nivel manda su orden; FIFA "igual que Pádel" manda el índice de esa tarjeta y el mismo modo', () => {
    const padel = card('PADEL', 'ROTAN', 4, { primeraFecha: 'NIVEL', order: [2, 0, 1, 3] })
    const fifa = card('FIFA', 'INDIVIDUAL', 4, { primeraFecha: { igualQue: 'PADEL' } })
    const [d0, d1] = crearPayload('Liga', squad, [padel, fifa]).disciplines
    expect(d0).toMatchObject({ kind: 'PADEL', seedOrder: [2, 0, 1, 3], config: { firstFecha: 'NIVEL' } })
    expect(d0).not.toHaveProperty('shuffle')
    expect(d0).not.toHaveProperty('sameOrderAs')
    expect(d1).toMatchObject({ kind: 'FIFA', sameOrderAs: 0, config: { firstFecha: 'NIVEL' } })
    expect(d1).not.toHaveProperty('seedOrder')
    expect(d1).not.toHaveProperty('shuffle')
  })

  it('"igual que" copia el modo de la otra tarjeta también cuando es al azar', () => {
    const padel = card('PADEL', 'ROTAN', 4, { primeraFecha: 'SORTEO' })
    const fifa = card('FIFA', 'INDIVIDUAL', 4, { primeraFecha: { igualQue: 'PADEL' } })
    const [d0, d1] = crearPayload('Liga', squad, [padel, fifa]).disciplines
    expect(d0).toMatchObject({ shuffle: true, config: { firstFecha: 'SORTEO' } })
    expect(d1).toMatchObject({ sameOrderAs: 0, config: { firstFecha: 'SORTEO' } })
  })

  it('parejas fijas por nivel: teams tal cual y el orden de parejas aplanado', () => {
    const padel = card('PADEL', 'FIJAS', 4, { primeraFecha: 'NIVEL', pairs: [[0, 3], [1, 2]], order: [1, 0] })
    const [d] = crearPayload('Liga', squad, [padel]).disciplines
    expect(d).toMatchObject({
      pairSize: 2,
      fixedTeams: true,
      teams: [[0, 3], [1, 2]],
      seedOrder: [1, 2, 0, 3],
    })
  })

  it('parejas fijas por nivel sin tocar el orden: manda el que se mostró (el de las parejas), no el del plantel', () => {
    const padel = card('PADEL', 'FIJAS', 4, { primeraFecha: 'NIVEL', pairs: [[0, 3], [1, 2]], order: [] })
    const [d] = crearPayload('Liga', squad, [padel]).disciplines
    expect(ordenInicial(padel, 4)).toEqual([0, 1])
    expect(d).toMatchObject({ teams: [[0, 3], [1, 2]], seedOrder: [0, 3, 1, 2] })
  })

  it('parejas fijas al azar: manda las parejas y el sorteo, y ningún orden', () => {
    const padel = card('PADEL', 'FIJAS', 4, { primeraFecha: 'SORTEO', pairs: [[0, 3], [1, 2]] })
    const [d] = crearPayload('Liga', squad, [padel]).disciplines
    expect(d).toMatchObject({ shuffle: true, teams: [[0, 3], [1, 2]] })
    expect(d).not.toHaveProperty('seedOrder')
  })

  it('FIFA al azar: shuffle y ningún seedOrder', () => {
    const [d] = crearPayload('Liga', squad, [card('FIFA', 'INDIVIDUAL', 4)]).disciplines
    expect(d).toMatchObject({ kind: 'FIFA', shuffle: true, pairSize: 1, fixedTeams: false, config: { firstFecha: 'SORTEO' } })
    expect(d).not.toHaveProperty('seedOrder')
    expect(d).not.toHaveProperty('teams')
    expect(d).not.toHaveProperty('sameOrderAs')
  })

  it('por nivel sin haber ordenado: sigue el orden del plantel (sin seedOrder)', () => {
    const [d] = crearPayload('Liga', squad, [card('PADEL', 'ROTAN', 4)]).disciplines
    expect(d).toMatchObject({ config: { firstFecha: 'NIVEL' } })
    expect(d).not.toHaveProperty('seedOrder')
    expect(d).not.toHaveProperty('shuffle')
  })

  it('los nombres van sin filas en blanco y el asiento propio se recalcula sobre esa lista', () => {
    const payload = crearPayload('Liga', { names: ['', 'Ana', 'Beto', '', 'Carla', 'Dani'], mySeat: 4 }, [card('PADEL', 'ROTAN', 4)])
    expect(payload.name).toBe('Liga')
    expect(payload.squadNames).toEqual(['Ana', 'Beto', 'Carla', 'Dani'])
    expect(payload.mySeatIndex).toBe(2)
    expect(crearPayload('Liga', { names: [...ANA_BETO_CARLA_DANI], mySeat: null }, [card('PADEL', 'ROTAN', 4)]).mySeatIndex).toBeNull()
  })

  it('la config se pone al día con el plantel real, no con el de cuando se armó la tarjeta', () => {
    const [d] = crearPayload('Liga', squad, [card('FIFA', 'INDIVIDUAL', 8)]).disciplines
    expect(d?.config.squadSize).toBe(4)
    expect(d?.config.points).toHaveLength(4)
  })

  it('lo de la ficha viaja: empates, Masters, formato por defecto y reglas tocadas', () => {
    const padel = card('PADEL', 'ROTAN', 4, { rules: withConfig(card('PADEL', 'ROTAN', 4).rules, { regularMatchdays: 14 }) })
    const [dPadel, dFifa] = crearPayload('Liga', squad, [padel, card('FIFA', 'INDIVIDUAL', 4)]).disciplines
    expect(dPadel).toMatchObject({ allowsDraw: false, hasMasters: true, formatoDefault: { kind: 'AUTO' }, config: { regularMatchdays: 14 } })
    expect(dFifa).toMatchObject({ allowsDraw: true, hasMasters: false, formatoDefault: { kind: 'AUTO' } })
  })

  it('de a uno nunca hay Masters, aunque las reglas lo dijeran', () => {
    const fifa = card('FIFA', 'INDIVIDUAL', 4, { rules: { ...card('FIFA', 'INDIVIDUAL', 4).rules, hasMasters: true } })
    expect(crearPayload('Liga', squad, [fifa]).disciplines[0]?.hasMasters).toBe(false)
  })

  it('el config legado es el de la primera tarjeta', () => {
    const payload = crearPayload('Liga', squad, [card('FIFA', 'INDIVIDUAL', 4), card('PADEL', 'ROTAN', 4)])
    expect(payload.config).toBe(payload.disciplines[0]?.config)
    expect(payload.disciplines.map((d) => d.kind)).toEqual(['FIFA', 'PADEL'])
  })

  it('sin deportes tira, y un "igual que" que no está en el torneo también', () => {
    expect(() => crearPayload('Liga', squad, [])).toThrow('Elegí al menos un deporte.')
    const huerfana = card('FIFA', 'INDIVIDUAL', 4, { primeraFecha: { igualQue: 'PADEL' } })
    expect(() => crearPayload('Liga', squad, [huerfana])).toThrow('"Igual que" tiene que apuntar a otro deporte del torneo.')
  })

  it('no comparte arreglos con la tarjeta: el orden y las parejas son copias', () => {
    const order = [1, 0]
    const pairs: Array<[number, number]> = [[0, 3], [1, 2]]
    const padel = card('PADEL', 'FIJAS', 4, { primeraFecha: 'SORTEO', pairs })
    const rotan = card('PADEL', 'ROTAN', 4, { primeraFecha: 'NIVEL', order })
    expect(crearPayload('Liga', squad, [padel]).disciplines[0]?.teams).not.toBe(pairs)
    expect(crearPayload('Liga', squad, [rotan]).disciplines[0]?.seedOrder).not.toBe(order)
  })
})

describe('moverEnOrden', () => {
  it('mueve, no intercambia: el último al primer lugar corre a los demás un lugar', () => {
    expect(moverEnOrden([0, 1, 2, 3], 3, 0)).toEqual([3, 0, 1, 2])
  })

  it('hacia abajo también, sin mutar el que recibe', () => {
    const order = [0, 1, 2, 3]
    expect(moverEnOrden(order, 0, 2)).toEqual([1, 2, 0, 3])
    expect(order).toEqual([0, 1, 2, 3])
  })
})

describe('ordenInicial', () => {
  it('sin orden armado, el del plantel: una persona por asiento', () => {
    expect(ordenInicial(card('FIFA', 'INDIVIDUAL', 4), 4)).toEqual([0, 1, 2, 3])
  })

  it('con parejas fijas el orden es de parejas', () => {
    expect(ordenInicial(card('PADEL', 'FIJAS', 4, { pairs: [[0, 3], [1, 2]] }), 4)).toEqual([0, 1])
  })

  it('el orden ya armado manda', () => {
    expect(ordenInicial(card('FIFA', 'INDIVIDUAL', 3, { order: [2, 0, 1] }), 3)).toEqual([2, 0, 1])
  })
})

describe('cambiarParejas', () => {
  it('rearmar las parejas vacía el orden de esa tarjeta (era de parejas) y no toca las otras', () => {
    const padel = card('PADEL', 'FIJAS', 4, { primeraFecha: 'NIVEL', pairs: [[0, 3], [1, 2]], order: [1, 0] })
    const fifa = card('FIFA', 'INDIVIDUAL', 4, { primeraFecha: 'NIVEL', order: [3, 2, 1, 0] })
    const [nextPadel, nextFifa] = cambiarParejas([padel, fifa], 'PADEL', [[0, 1]])
    expect(nextPadel).toMatchObject({ pairs: [[0, 1]], order: [] })
    expect(nextFifa).toBe(fifa)
    expect(padel.order).toEqual([1, 0])
  })
})

describe('tocarSortear', () => {
  const flat = (pairs: Array<[number, number]>) => pairs.flat().sort((a, b) => a - b)

  it('sin nada armado sortea a todos', () => {
    expect(tocarSortear([], 6, () => 0)).toEqual(sortearParejas(6, () => 0))
  })

  it('deja las parejas armadas a mano y sortea sólo a los sueltos', () => {
    const pairs = tocarSortear([[0, 3], [1, 5]], 6, () => 0)
    expect(pairs.slice(0, 2)).toEqual([[0, 3], [1, 5]])
    expect(pairs).toHaveLength(3)
    expect(flat(pairs.slice(2))).toEqual([2, 4])
  })

  it('con todas armadas, sortea todo de nuevo', () => {
    expect(tocarSortear([[0, 1], [2, 3], [4, 5]], 6, () => 0)).toEqual(sortearParejas(6, () => 0))
  })
})

describe('sorteaLaApp', () => {
  it('"Mejor que lo sortee la app": las que iban por nivel pasan a al azar, las otras quedan como estaban', () => {
    const padel = card('PADEL', 'ROTAN', 4, { primeraFecha: 'NIVEL' })
    const fifa = card('FIFA', 'INDIVIDUAL', 4, { primeraFecha: { igualQue: 'PADEL' } })
    const [nextPadel, nextFifa] = sorteaLaApp([padel, fifa])
    expect(nextPadel?.primeraFecha).toBe('SORTEO')
    expect(nextFifa).toBe(fifa)
    expect(subpasos([nextPadel!, nextFifa!])).toEqual([])
  })
})

describe('filaDestino', () => {
  // Filas de 52px cada 60px: las mitades caen en 26, 86, 146 y 206.
  const rows = [0, 1, 2, 3].map((at) => ({ top: at * 60, height: 52 }))

  it('el último soltado arriba de la mitad del primero queda primero', () => {
    expect(filaDestino(rows, 3, 10)).toBe(0)
  })

  it('sin pasar la mitad de la vecina no se mueve', () => {
    expect(filaDestino(rows, 1, 100)).toBe(1)
    expect(filaDestino(rows, 1, 30)).toBe(1)
    expect(filaDestino(rows, 1, 20)).toBe(0)
  })

  it('el primero bajado más allá de la mitad del tercero queda tercero, y más abajo de todo, último', () => {
    expect(filaDestino(rows, 0, 150)).toBe(2)
    expect(filaDestino(rows, 0, 999)).toBe(3)
  })
})
