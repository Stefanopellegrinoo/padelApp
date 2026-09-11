import { describe, expect, it } from 'vitest'
import { defaultConfig, disciplineProfile, validateConfig, type MatchdayFormat, type SideSize } from '@/core'
import type { DisciplineKind } from './wizard-state'
import {
  FORMATO_DEFAULT_OPTIONS,
  STEPPERS,
  type Squad,
  addBlankSeat,
  addMySeat,
  addToOrder,
  addToOrders,
  automaticHasMasters,
  buildDisciplines,
  configFor,
  disciplinesWarning,
  editSeatState,
  effectiveFixedTeams,
  effectiveFloor,
  effectiveHasMasters,
  filledCount,
  filledSeatIndices,
  formatErrors,
  formatoDefaultKey,
  freshDisciplineConfig,
  isSameFormatoDefault,
  joinSquadState,
  moveGlobalSeatState,
  moveInOrder,
  moveSeat,
  namesAfterEdit,
  newDisciplineSpec,
  newTournamentPayload,
  removeFromOrder,
  removeFromOrders,
  removeSeatAt,
  removeSeatState,
  resizeConfig,
  resizeConfigs,
  seedOrderFrom,
  squadWarning,
  steppersFor,
  submitSeats,
  summaryOf,
  swapInOrder,
  swapInOrders,
  toggleDiscipline,
  toggleOwnOrder,
  visibleOrderPositions,
  withoutTrailingBlanks,
} from './wizard-state'

/** El default de columna (ROUND_ROBIN, 0074) para las dos disciplinas -- lo que usa cualquier test que no ejercite Masters/Formato de las fechas en sí. */
const ROUND_ROBIN_ALL: Record<DisciplineKind, MatchdayFormat> = {
  PADEL: { kind: 'ROUND_ROBIN' },
  FIFA: { kind: 'ROUND_ROBIN' },
}

/** El default del checkbox de equipos fijos (sin tocarlo) para las dos disciplinas. */
const NO_FIXED_TEAMS: Record<DisciplineKind, boolean> = { PADEL: false, FIFA: false }

/**
 * El plantel es UNO SOLO y compartido por todas las disciplinas de la
 * temporada (docs/tipos-de-torneo.md §0, "Comparten el plantel, el nombre y
 * el link de invitación"). Cada una elige su propio `pairSize`, así que el
 * piso de la pantalla del plantel tiene que ser el MÁXIMO entre las
 * elegidas: el mínimo dejaría armar un torneo cuyo pádel no puede jugar ni
 * una fecha (piso real 4, `minSquadFor(2)`, §3.3) con la excusa de que el
 * FIFA de al lado se conforma con 2.
 */
describe('effectiveFloor', () => {
  it('con pádel y FIFA juntos, manda el piso más alto', () => {
    // El plantel es compartido: si FIFA se conforma con 2 y el pádel necesita 4,
    // el plantel necesita 4. Elegir el mínimo dejaría armar un torneo cuyo pádel
    // no puede jugar una sola fecha.
    expect(effectiveFloor([1, 2])).toBe(4)
    expect(effectiveFloor([1])).toBe(2)
  })

  it('con sólo pádel, el piso también baja de 8 a 4: dos parejas ya son una fecha', () => {
    expect(effectiveFloor([2])).toBe(4)
  })
})

describe('squadWarning', () => {
  const floorPadel = effectiveFloor([2]) // 4: el piso de dos parejas, un partido.

  it('asks for the missing name when the squad is short', () => {
    const names = [...Array(3).fill('Jugador'), '']
    expect(squadWarning(names, floorPadel, true)).toBe('Falta 1 nombre. El plantel arranca en 4.')
  })

  it('counts how many are missing when it is more than one', () => {
    const names = [...Array(2).fill('Jugador'), '', '']
    expect(squadWarning(names, floorPadel, true)).toBe('Faltan 2 nombres. El plantel arranca en 4.')
  })

  it('refuses an odd squad, because pairs need an even number', () => {
    expect(squadWarning(Array(9).fill('Jugador'), floorPadel, true)).toBe(
      'Son 9. El plantel tiene que ser par para poder armar parejas.',
    )
  })

  it('says nothing for a squad that can go on', () => {
    expect(squadWarning(Array(4).fill('Jugador'), floorPadel, true)).toBeNull()
    expect(squadWarning(Array(10).fill('Jugador'), floorPadel, true)).toBeNull()
    expect(squadWarning(Array(12).fill('Jugador'), floorPadel, true)).toBeNull()
    // 14 — el primer valor que el viejo techo de 12 rechazaba (13 ya está
    // afuera por la paridad de pareja) — docs/plan-piso-y-techo-del-
    // plantel.md Task 3 lo borró: si alguien lo revive acá, esto se pone rojo.
    expect(squadWarning(Array(14).fill('Jugador'), floorPadel, true)).toBeNull()
  })

  it('ignores whitespace when counting', () => {
    expect(filledCount(['Marce', '   ', 'Nico'])).toBe(2)
  })

  // El piso real de un torneo de sólo FIFA es 2 (`minSquadFor(1)`), no un
  // plano de 8: dos amigos ya pueden jugar.
  it('a squad of only FIFA can stop at 2, the derived floor', () => {
    expect(squadWarning(Array(2).fill('Jugador'), effectiveFloor([1]), false)).toBeNull()
    expect(squadWarning(['Solo'], effectiveFloor([1]), false)).toBe('Falta 1 nombre. El plantel arranca en 2.')
  })

  // Con pádel Y FIFA marcados, el plantel compartido pide el piso más alto
  // (4), no el de FIFA solo -- el pádel de esa misma temporada lo necesita.
  it('con pádel y FIFA juntos, pide el piso más alto', () => {
    expect(squadWarning(Array(3).fill('Jugador'), effectiveFloor([1, 2]), true)).toBe(
      'Falta 1 nombre. El plantel arranca en 4.',
    )
  })

  // Important 1 del fix wave (piso-y-techo): la paridad es una regla de
  // PAREJAS, no del plantel en general. Un torneo de sólo FIFA no arma
  // parejas y no tiene por qué rechazar 3 o 13 -- exactamente lo que el plan
  // vino a destrabar ("que nadie tenga que pedir permiso para ser trece").
  // Sin el tercer parámetro, `squadWarning` exigía par SIEMPRE y esto daba
  // rojo con el mensaje de "armar parejas" en un torneo que no las arma.
  it('un plantel de sólo FIFA no exige paridad: ni 3 ni 13', () => {
    expect(squadWarning(Array(3).fill('Jugador'), effectiveFloor([1]), false)).toBeNull()
    expect(squadWarning(Array(13).fill('Jugador'), effectiveFloor([1]), false)).toBeNull()
  })

  // Y la contraparte: con pádel de por medio (solo o mezclado con FIFA) la
  // paridad se sigue exigiendo -- `needsPairs` no apaga la regla para nadie
  // que sí arme parejas.
  it('con pádel de por medio, solo o mezclado, la paridad se sigue exigiendo', () => {
    expect(squadWarning(Array(9).fill('Jugador'), effectiveFloor([2]), true)).toBe(
      'Son 9. El plantel tiene que ser par para poder armar parejas.',
    )
    expect(squadWarning(Array(9).fill('Jugador'), effectiveFloor([1, 2]), true)).toBe(
      'Son 9. El plantel tiene que ser par para poder armar parejas.',
    )
  })
})

describe('the config the wizard builds', () => {
  // Con 12 hacen falta 6 valores de puntos: si al cambiar el plantel la lista
  // no se rehace, la temporada nace inválida y createSeason la rebota.
  it('rebuilds the points list when the squad changes size', () => {
    const eight = configFor(8, 2)
    expect(eight.points).toHaveLength(4)

    const twelve = resizeConfig(eight, 12, 2)
    expect(twelve.points).toHaveLength(6)
    expect(twelve.squadSize).toBe(12)
  })

  it('leaves the config alone when the size did not change', () => {
    const config = { ...configFor(8, 2), points: [20, 10, 5, 1] }
    expect(resizeConfig(config, 8, 2)).toBe(config)
  })

  it('gives back exactly defaultConfig for every squad size', () => {
    for (const size of [8, 10, 12]) {
      expect(configFor(size, 2)).toEqual(defaultConfig(size))
    }
  })

  // S75: `configFor`/`resizeConfig` llamaban `defaultConfig(squadSize)` y
  // dejaban caer `sideSize` a su default 2 — con "Individual" elegido, la
  // curva que salía era la de parejas, no la de la decisión #3963 (#3957: se
  // pincha el ARGUMENTO, no que la función acepte el parámetro).
  it('threads sideSize into defaultConfig instead of dropping to the pairs default (S75)', () => {
    expect(configFor(8, 1)).toEqual(defaultConfig(8, 1))
    expect(configFor(8, 1).points).toEqual([10, 7, 5, 3, 2, 1, 0, 0])
  })

  it('resizeConfig keeps the sideSize curve when the squad changes size', () => {
    const eightSolo = configFor(8, 1)
    const twelveSolo = resizeConfig(eightSolo, 12, 1)
    expect(twelveSolo.points).toEqual(defaultConfig(12, 1).points)
    expect(twelveSolo.points).toEqual([10, 7, 5, 3, 2, 1, 0, 0, 0, 0, 0, 0])
  })

  // Lo que arma el wizard tiene que pasar la validación de core/, o
  // `createSeason` lo rebota en el submit y el usuario se entera al final.
  it('produces a config core accepts, for every squad size', () => {
    for (const size of [8, 10, 12]) {
      expect(validateConfig(configFor(size, 2), 2)).toEqual([])
      expect(formatErrors(configFor(size, 2), 2)).toEqual([])
    }
  })
})

/**
 * Task 5 (docs/plan-arquitectura-de-paginas.md §2.4, §6): reemplaza a
 * `configForPairSizeChange` (W83, #4026, borrada en esta Task). Aquella
 * función distinguía "una sola disciplina marcada" (rehace) de "dos o más"
 * (no toca, C29) porque una config COMPARTIDA no podía rehacerse sin
 * arriesgar la curva de la disciplina vecina. Con una config por disciplina
 * esa distinción no existe: tocar "Lados" para `kind` siempre rehace SU
 * config, sola o junto a otra.
 */
describe('freshDisciplineConfig (Task 5, reemplaza a configForPairSizeChange)', () => {
  it('rehace la curva de ESA disciplina a la del sideSize elegido', () => {
    const next = freshDisciplineConfig('FIFA', 8, 1)
    expect(next.points).toEqual([10, 7, 5, 3, 2, 1, 0, 0])
  })

  it('aplica la forma de marcador de SU kind -- FIFA nace con openScore, Pádel no', () => {
    expect(freshDisciplineConfig('FIFA', 8, 2).matchFormat.openScore).toBe(true)
    expect(freshDisciplineConfig('PADEL', 8, 2).matchFormat.openScore).toBe(false)
  })

  // Marcar la MISMA disciplina junto con otra no cambia nada: cada una vive
  // en su propia entrada, nunca hay una "compartida" que cuidar.
  it('da la misma config esté sola o junto a otra disciplina marcada', () => {
    expect(freshDisciplineConfig('FIFA', 8, 1)).toEqual(freshDisciplineConfig('FIFA', 8, 1))
  })
})

/**
 * Task 5: reemplaza a `configSideSize` (corrección #4030/lección #3994,
 * borrada en esta Task). `resizeConfigs` pone al día las DOS disciplinas del
 * wizard a la vez, cada una contra SU PROPIO `pairSize` -- ya no hace falta
 * calcular un "sideSize efectivo" de una curva compartida.
 */
describe('resizeConfigs (Task 5, reemplaza a configSideSize)', () => {
  it('agrandar el plantel pone al día la curva de CADA disciplina, cada una con su propio sideSize', () => {
    const configs = { PADEL: configFor(8, 2), FIFA: configFor(8, 1) }
    const next = resizeConfigs(configs, 10, { PADEL: 2, FIFA: 1 })
    expect(next.PADEL.points).toEqual(defaultConfig(10, 2).points)
    expect(next.FIFA.points).toEqual(defaultConfig(10, 1).points)
    expect(next.PADEL.points).not.toEqual(next.FIFA.points)
  })

  it('no toca nada si el tamaño no cambió, para ninguna de las dos', () => {
    const configs = { PADEL: configFor(8, 2), FIFA: configFor(8, 1) }
    const next = resizeConfigs(configs, 8, { PADEL: 2, FIFA: 1 })
    expect(next.PADEL).toBe(configs.PADEL)
    expect(next.FIFA).toBe(configs.FIFA)
  })
})

/**
 * El automático de la decisión #4029, con el que arranca el checkbox de
 * Masters de CADA disciplina en el paso 4 (Task 5): `true` de a dos,
 * `false` de a uno -- `disciplines_has_masters_needs_pair` (0053) rechaza
 * `true` con `pairSize` 1 siempre.
 */
describe('automaticHasMasters (decisión #4029)', () => {
  it('true con pairSize 2, false con pairSize 1', () => {
    expect(automaticHasMasters(2)).toBe(true)
    expect(automaticHasMasters(1)).toBe(false)
  })
})

/**
 * La puerta de salida real de Masters (Task 5): pase lo que pase tenga
 * guardado el checkbox, una disciplina de a uno nunca manda `true` --
 * `disciplines_has_masters_needs_pair` (0053) la rechazaría en la base.
 */
describe('effectiveHasMasters', () => {
  it('fuerza false con pairSize 1, aunque el checkbox diga true', () => {
    expect(effectiveHasMasters(1, true)).toBe(false)
  })

  it('respeta lo que diga el checkbox con pairSize 2', () => {
    expect(effectiveHasMasters(2, true)).toBe(true)
    expect(effectiveHasMasters(2, false)).toBe(false)
  })
})

/**
 * Las mismas tres opciones que Ajustes (`formato-default.tsx`, §2.5):
 * ROUND_ROBIN, 2 grupos o 4 grupos, siempre `qualifiersPerGroup: 2`.
 */
describe('FORMATO_DEFAULT_OPTIONS / formatoDefaultKey / isSameFormatoDefault', () => {
  it('son las tres opciones de Ajustes, ni una más', () => {
    expect(FORMATO_DEFAULT_OPTIONS).toEqual([
      { kind: 'ROUND_ROBIN' },
      { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 },
      { kind: 'GROUPS_KNOCKOUT', groups: 4, qualifiersPerGroup: 2 },
    ])
  })

  it('formatoDefaultKey distingue las tres entre sí', () => {
    const keys = FORMATO_DEFAULT_OPTIONS.map(formatoDefaultKey)
    expect(new Set(keys).size).toBe(3)
  })

  it('isSameFormatoDefault compara por kind + groups, no por identidad de objeto', () => {
    expect(isSameFormatoDefault({ kind: 'ROUND_ROBIN' }, { kind: 'ROUND_ROBIN' })).toBe(true)
    expect(
      isSameFormatoDefault(
        { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 },
        { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 },
      ),
    ).toBe(true)
    expect(
      isSameFormatoDefault(
        { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 },
        { kind: 'GROUPS_KNOCKOUT', groups: 4, qualifiersPerGroup: 2 },
      ),
    ).toBe(false)
    expect(isSameFormatoDefault({ kind: 'ROUND_ROBIN' }, { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 })).toBe(
      false,
    )
  })
})

describe('formatErrors', () => {
  it('catches points that do not go down', () => {
    const config = { ...configFor(8, 2), points: [10, 10, 5, 3] }
    expect(formatErrors(config, 2)).toEqual([
      'Los puntos tienen que ir de mayor a menor. El único que se puede repetir es el 0.',
    ])
  })

  // Lo que el usuario quiere poder escribir: que sólo puntúen los primeros.
  it('accepts a tail of zeros, so only the first places score', () => {
    expect(formatErrors({ ...configFor(12, 2), points: [10, 6, 3, 1, 0, 0] }, 2)).toEqual([])
  })

  // Este test decía lo contrario y era el que quedaba de la regla vieja. El 0
  // pasó a ser legal en `141bbcf` —hay grupos que quieren que el último no
  // sume— y el stepper baja hasta 0 desde entonces, pero ESTA pantalla siguió
  // trabando el "Continuar". Se podía elegir un 0 y no se podía avanzar.
  it('accepts a zero as the last value, which the stepper can reach', () => {
    const config = { ...configFor(8, 2), points: [10, 6, 3, 0] }
    expect(formatErrors(config, 2)).toEqual([])
  })

  // El paso 4 ya NO tiene su propia copia de las reglas: las dos llaman a
  // `pointsErrors`. Esta prueba queda igual, como red contra que alguien vuelva
  // a duplicarlas — que es exactamente cómo se rompió la primera vez.
  it('agrees with core on every points list the stepper can produce', () => {
    const lists = [
      [10, 6, 3, 1],
      [10, 6, 3, 0],
      [10, 6, 0, 0],
      [0, 0, 0, 0],
      [10, 0, 3, 1],
      [10, 10, 5, 3],
      [1, 2, 3, 4],
      [99, 50, 2, 0],
      [4, 3, 2, 2],
    ]
    for (const points of lists) {
      const config = { ...configFor(8, 2), points }
      const coreRejects = validateConfig(config, 2).length > 0
      const wizardRejects = formatErrors(config, 2).length > 0
      expect(wizardRejects, `puntos ${points.join('·')}`).toBe(coreRejects)
    }
  })

  it('catches counting more matchdays than the season has', () => {
    const config = { ...configFor(8, 2), regularMatchdays: 10, countBestOf: 12 }
    expect(formatErrors(config, 2)).toEqual(['No pueden contar más fechas de las que se juegan.'])
  })

  it('reports both problems at once', () => {
    const config = { ...configFor(8, 2), points: [1, 2, 3, 4], regularMatchdays: 4, countBestOf: 9 }
    expect(formatErrors(config, 2)).toHaveLength(2)
  })
})

describe('summaryOf', () => {
  it('lists the six rows of the handoff, in order', () => {
    const configs = { PADEL: configFor(8, 2), FIFA: configFor(8, 2) }
    const rows = summaryOf('Los Jueves 2026', Array(8).fill('Jugador'), configs, ['PADEL'])
    expect(rows.map((row) => row.key)).toEqual([
      'Nombre',
      'Jugadores',
      'Formato',
      'Puntos',
      'Fechas',
      'Desempate',
    ])
    expect(rows[1]?.value).toBe('8')
    // Con una sola disciplina el resumen dice lo mismo de siempre, sin prefijo.
    expect(rows[2]?.value).toBe('1 set a 4 games')
    expect(rows[3]?.value).toBe('10 · 6 · 3 · 1')
    expect(rows[4]?.value).toBe('10')
  })

  // PR20 rebanada D2: con FIFA marcado, "1 set a 4 games" describe la mitad
  // pádel del torneo y MIENTE sobre la otra mitad. Es la misma clase de copy
  // que ya costó W47, W51 y W56.
  it('nombra el formato de cada disciplina cuando hay más de una', () => {
    const configs = { PADEL: configFor(8, 2), FIFA: disciplineProfile('FIFA', configFor(8, 2)).config }
    const rows = summaryOf('Los Jueves 2026', Array(8).fill('Jugador'), configs, ['PADEL', 'FIFA'])
    expect(rows[2]?.value).toBe('Pádel: 1 set a 4 games · FIFA: Marcador de goles')
  })

  it('y una liga de sólo FIFA no promete ningún set', () => {
    const configs = { PADEL: configFor(8, 2), FIFA: disciplineProfile('FIFA', configFor(8, 2)).config }
    const rows = summaryOf('Liga FIFA', Array(8).fill('Jugador'), configs, ['FIFA'])
    expect(rows[2]?.value).toBe('Marcador de goles')
  })

  /**
   * Task 5: "Puntos", "Fechas" y "Desempate" también nombran la disciplina
   * cuando hay 2+, igual que "Formato" desde W64 -- con `configs`
   * genuinamente por disciplina estos tres números pueden ser distintos
   * entre Pádel y FIFA, y mostrar sólo uno de los dos sería la misma mentira
   * que esa ronda ya cerró para "Formato".
   */
  it('Puntos, Fechas y Desempate también nombran la disciplina con 2+ marcadas', () => {
    const configs = {
      PADEL: { ...configFor(8, 2), regularMatchdays: 10 },
      FIFA: { ...disciplineProfile('FIFA', configFor(8, 2)).config, regularMatchdays: 12 },
    }
    const rows = summaryOf('Mixto', Array(8).fill('Jugador'), configs, ['PADEL', 'FIFA'])
    expect(rows[4]?.value).toBe('Pádel: 10 · FIFA: 12')
  })
})

// El asiento propio se sigue por índice sobre una lista que se reordena, se
// achica y se agranda. Cada operación que corre la lista tiene que correrlo, y
// el que no lo hace no rompe nada visible: deja al organizador atado al asiento
// de otro, y eso recién se ve cuando el torneo ya está creado.
describe('removeSeatAt', () => {
  it('leaves the organizer out when the removed seat is theirs', () => {
    const squad = { names: ['Colo', 'Nacho', 'Fede'], mySeat: 0 }
    expect(removeSeatAt(squad, 0)).toEqual({ names: ['Nacho', 'Fede'], mySeat: null })
  })

  it('shifts the organizer down when an earlier seat goes', () => {
    const squad = { names: ['Nacho', 'Fede', 'Colo'], mySeat: 2 }
    expect(removeSeatAt(squad, 0)).toEqual({ names: ['Fede', 'Colo'], mySeat: 1 })
  })

  it('does not move the organizer when a later seat goes', () => {
    const squad = { names: ['Colo', 'Nacho', 'Fede'], mySeat: 0 }
    expect(removeSeatAt(squad, 2)).toEqual({ names: ['Colo', 'Nacho'], mySeat: 0 })
  })

  it('does nothing to an organizer who is already out', () => {
    const squad = { names: ['Nacho', 'Fede'], mySeat: null }
    expect(removeSeatAt(squad, 0)).toEqual({ names: ['Fede'], mySeat: null })
  })
})

describe('addMySeat', () => {
  it('appends at the end, like any other added player', () => {
    const squad = { names: ['Nacho', 'Fede'], mySeat: null }
    expect(addMySeat(squad, 'Colo')).toEqual({ names: ['Nacho', 'Fede', 'Colo'], mySeat: 2 })
  })

  // Este es el caso que el navegador encontró y que la versión anterior de esta
  // función rompía: reusaba un casillero vacío en vez de agregar uno, y el
  // plantel volvía con una fila MENOS de las que tenía antes de sacarse.
  it('restores the row that removing yourself took away', () => {
    const start: Squad = { names: ['Colo', '', '', ''], mySeat: 0 }
    const out = removeSeatAt(start, 0)
    expect(out.names).toHaveLength(3)

    const back = addMySeat(out, 'Colo')
    expect(back.names).toHaveLength(start.names.length)
    expect(back.names[back.mySeat!]).toBe('Colo')
    expect(filledCount(back.names)).toBe(1)
  })
})

describe('moveSeat', () => {
  it('follows the organizer when their seat moves up', () => {
    const squad = { names: ['Nacho', 'Colo'], mySeat: 1 }
    expect(moveSeat(squad, 1, 0)).toEqual({ names: ['Colo', 'Nacho'], mySeat: 0 })
  })

  it('follows the organizer when another seat swaps into theirs', () => {
    const squad = { names: ['Nacho', 'Colo'], mySeat: 1 }
    expect(moveSeat(squad, 0, 1)).toEqual({ names: ['Colo', 'Nacho'], mySeat: 0 })
  })

  it('refuses to move past either end', () => {
    const squad = { names: ['Colo', 'Nacho'], mySeat: 0 }
    expect(moveSeat(squad, 0, -1)).toEqual(squad)
    expect(moveSeat(squad, 1, 2)).toEqual(squad)
  })
})

/**
 * WU2 (ronda 2 de revisión): los cuatro handlers que hilan `squad` y
 * `orders` a la vez (`editSeatName`/`joinSquad`/`removeSeat`/`moveGlobalSeat`,
 * `wizard.tsx`) vivían enteros adentro de `Wizard`, sin ningún test que los
 * ejercitara juntos -- esta suite no tiene runner de clicks/tecleo, así que
 * la lógica que sólo existía adentro de un handler de `.tsx` quedaba
 * estructuralmente fuera de su alcance (mismo defecto que
 * `app/cableado-de-formato.unit.test.ts` ya documenta para el paso 4).
 *
 * Reemplaza al patrón anterior (dos llamadas sueltas por handler, una a
 * `setSquad`/`setSquadState` y otra a `setOrdersState`) por UNA función pura
 * que arma las DOS mitades del estado combinado a la vez -- mismo criterio
 * que ya usa el resto de `wizard-state.ts`: la lógica vive acá, testeada sin
 * DOM, y `wizard.tsx` sólo aplica los dos setters con lo que le devuelven
 * (pin de ese cableado en `app/cableado-de-formato.unit.test.ts`).
 */
describe('editSeatState', () => {
  it('un asiento en blanco que pasa a tener contenido entra a cada orden propio que ya exista', () => {
    const squad: Squad = { names: ['Colo', ''], mySeat: 0 }
    const next = editSeatState(squad, { FIFA: [0] }, 1, 'Nacho')
    expect(next.squad.names).toEqual(['Colo', 'Nacho', ''])
    expect(next.orders).toEqual({ FIFA: [0, 1] })
  })

  it('una renombrada (la fila ya tenía nombre) no toca orders para nada', () => {
    const squad: Squad = { names: ['Colo', 'Nacho'], mySeat: 0 }
    const next = editSeatState(squad, { FIFA: [1, 0] }, 0, 'Coco')
    expect(next.squad.names).toEqual(['Coco', 'Nacho'])
    expect(next.orders).toEqual({ FIFA: [1, 0] })
  })
})

describe('joinSquadState', () => {
  it('el organizador entra en un asiento NUEVO al final, y ese índice entra a cada orden propio', () => {
    const squad: Squad = { names: ['Nacho', 'Fede'], mySeat: null }
    const next = joinSquadState(squad, { FIFA: [1, 0] }, 'Colo')
    expect(next.squad).toEqual({ names: ['Nacho', 'Fede', 'Colo'], mySeat: 2 })
    expect(next.orders).toEqual({ FIFA: [1, 0, 2] })
  })
})

describe('removeSeatState', () => {
  // El caso PELIGROSO que WU2 midió: sacar un asiento del medio sin correr
  // el orden propio deja índices viejos leídos contra un plantel corrido --
  // gente equivocada, sin ningún error, porque el guard de permutación de
  // `db/season.ts` lo sigue aceptando (misma CANTIDAD de índices, sólo que
  // corridos).
  it('sacar un asiento del medio corre los índices de más atrás del orden propio, igual que a mySeat', () => {
    const squad: Squad = { names: ['Ana', 'Beto', 'Caro', 'Dani'], mySeat: null }
    // FIFA: [1, 3, 0, 2] -- Beto, Dani, Ana, Caro. Sacamos a Ana (índice 0).
    const next = removeSeatState(squad, { FIFA: [1, 3, 0, 2] }, 0)
    expect(next.squad.names).toEqual(['Beto', 'Caro', 'Dani'])
    // Correcto: Beto, Dani, Caro -- índices [0, 2, 1] sobre el plantel nuevo.
    expect(next.orders).toEqual({ FIFA: [0, 2, 1] })
  })
})

describe('moveGlobalSeatState', () => {
  it('el swap del orden global arrastra mySeat Y corre cada orden propio', () => {
    const squad: Squad = { names: ['Nacho', 'Colo'], mySeat: 1 }
    const next = moveGlobalSeatState(squad, { FIFA: [0, 1] }, 1, 0)
    expect(next.squad).toEqual({ names: ['Colo', 'Nacho'], mySeat: 0 })
    expect(next.orders).toEqual({ FIFA: [1, 0] })
  })

  // WU5 (ronda 2 de revisión): `moveSeat` se niega a mover fuera de rango
  // (deja `squad` intacto), pero `swapInOrders` sueltas swapeaba igual --
  // las dos mitades de UNA acción de usuario en desacuerdo sobre qué es
  // "fuera de rango". Acá comparten UN solo guard: fuera de rango no toca
  // NINGUNA de las dos mitades.
  it('fuera de rango no toca ni squad ni orders -- las dos mitades comparten el mismo guard', () => {
    const squad: Squad = { names: ['Colo', 'Nacho'], mySeat: 0 }
    const orders = { FIFA: [0, 1] }
    expect(moveGlobalSeatState(squad, orders, 0, -1)).toEqual({ squad, orders })
    expect(moveGlobalSeatState(squad, orders, 1, 2)).toEqual({ squad, orders })
  })
})

/** "+ Agregar jugador" (paso 1): agrega una fila en blanco al final -- no toca `orders`, una fila en blanco todavía no es un asiento (`addToOrders` corre recién en `editSeatState`, cuando esa fila deja de estarlo). */
describe('addBlankSeat', () => {
  it('agrega una fila en blanco al final, sin tocar mySeat', () => {
    const squad: Squad = { names: ['Colo', 'Nacho'], mySeat: 0 }
    expect(addBlankSeat(squad)).toEqual({ names: ['Colo', 'Nacho', ''], mySeat: 0 })
  })
})

/**
 * F1 (dos jueces ciegos, `37b225b..d33377a`): los índices de `names` que de
 * verdad tienen alguien -- sin las filas en blanco del MEDIO
 * (`withoutTrailingBlanks` sólo saca las del final). Es lo que arranca el
 * orden propio de una disciplina (`toggleOwnOrder`, abajo).
 */
describe('filledSeatIndices', () => {
  it('sin blancos, da todos los índices', () => {
    expect(filledSeatIndices(['Colo', 'Nacho', 'Fede'])).toEqual([0, 1, 2])
  })

  // Minor de esta tarea: una fila en blanco en el MEDIO no puede colarse en
  // el orden propio -- terminaría con flechas que funcionan sobre un nombre
  // vacío y un `aria-label="Subir a  en FIFA"`.
  it('salta las filas en blanco del medio, no sólo las del final', () => {
    expect(filledSeatIndices(['Colo', '', 'Fede'])).toEqual([0, 2])
  })

  it('un espacio suelto no cuenta como cargado -- mismo criterio que filledCount', () => {
    expect(filledSeatIndices(['Colo', '   '])).toEqual([0])
  })
})

/**
 * WU3/WU4 (ronda 3 de revisión): las POSICIONES de `order` (no los `at` que
 * guarda) cuyo asiento sigue teniendo nombre -- la fila fantasma. Filtrar
 * recién en el `.map` de `wizard.tsx` (la versión de antes de esta tarea)
 * dejaba CUATRO defectos atados a la posición RAW de la fantasma: la
 * numeración saltaba (1,2,4,5 en vez de 1,2,3,4), el swap con la fantasma
 * era un no-op visible sin feedback, el `disabled` del primer/último
 * visible caía sobre la posición de la fantasma en vez de la real, y todo
 * visible de más ganaba un `border-t` de sobra.
 *
 * Reusa `filledSeatIndices` -- no una copia del mismo filtro -- aplicada a
 * los NOMBRES que `order` señala, en el orden en que `order` los trae: el
 * orden GLOBAL es, en el fondo, este mismo cálculo con un `order` implícito
 * `[0, 1, ..., n)` (`filledSeatIndices(names)` directo alcanza para ese
 * caso). Devuelve POSICIONES (índices de `order`), no los `at` que `order`
 * guarda -- lo que `onMoveGlobal`/`onMoveOwn` necesitan para swapear
 * (`moveSeat`/`moveInOrder` operan sobre posiciones, F1).
 */
describe('visibleOrderPositions', () => {
  it('sin fantasmas, da todas las posiciones', () => {
    expect(visibleOrderPositions([2, 0, 1], ['Colo', 'Nacho', 'Fede'])).toEqual([0, 1, 2])
  })

  it('salta la posición cuyo `at` señala a un nombre en blanco', () => {
    // order[1] = 2 -> names[2] = '' (Caro, vaciada a mano). Sólo esa
    // posición (1) se salta -- las demás quedan, en el mismo orden.
    expect(visibleOrderPositions([0, 2, 1, 3], ['Ana', 'Beto', '', 'Dani'])).toEqual([0, 2, 3])
  })

  it('un espacio suelto también cuenta como fantasma -- mismo criterio que filledSeatIndices', () => {
    expect(visibleOrderPositions([0, 1], ['Colo', '   '])).toEqual([0])
  })

  it('distingue POSICIÓN (índice de order) de `at` (lo que order guarda) -- una permutación NO identidad', () => {
    // order = [2, 0, 1]: posición 0 guarda at=2 (Fede), posición 1 guarda
    // at=0 (Colo). Con una identidad ([0,1,2]) las dos lecturas coinciden
    // siempre y esta prueba no podría existir.
    expect(visibleOrderPositions([2, 0, 1], ['Colo', 'Nacho', 'Fede'])).not.toEqual([2, 0, 1])
    expect(visibleOrderPositions([2, 0, 1], ['Colo', 'Nacho', 'Fede'])).toEqual([0, 1, 2])
  })
})

/**
 * El toggle "orden propio" del paso Formato (docs/tipos-de-torneo.md §3):
 * prender copia el orden GLOBAL de ESE instante a la entrada de la
 * disciplina, apagar la borra entera -- no la deja vacía, que sería un
 * `seedNames: []` que no calza con NADA de permutación (`db/season.ts`,
 * `isPermutationOf`).
 *
 * F1: la copia es de ÍNDICES (`filledSeatIndices`), no de nombres --
 * reconciliar por VALOR era exactamente lo que perdía el asiento de una
 * renombrada a mitad de tipeo (ver `describe('F1 ...')` más abajo).
 *
 * Copiar y no referenciar el array global en vivo sigue siendo la decisión:
 * una vez prendido, la lista de la disciplina se edita SOLA (`moveInOrder`,
 * más abajo) -- si el admin reordena el plantel GLOBAL después, esa edición
 * no tiene por qué pisar lo que ya se armó para esta disciplina en
 * particular.
 */
describe('toggleOwnOrder', () => {
  it('prender copia el orden global de este instante, por índice', () => {
    expect(toggleOwnOrder({}, 'FIFA', true, ['Colo', 'Nacho', 'Fede'])).toEqual({
      FIFA: [0, 1, 2],
    })
  })

  it('apagar borra la entrada entera -- no queda ni vacía', () => {
    const next = toggleOwnOrder({ FIFA: [1, 0, 2] }, 'FIFA', false, ['Colo', 'Nacho', 'Fede'])
    expect(next).toEqual({})
    expect('FIFA' in next).toBe(false)
  })

  it('no toca la entrada de la disciplina vecina', () => {
    expect(toggleOwnOrder({ PADEL: [1, 0] }, 'FIFA', true, ['Colo', 'Nacho'])).toEqual({
      PADEL: [1, 0],
      FIFA: [0, 1],
    })
  })

  it('volver a prender pisa lo que hubiera quedado, con el orden global de AHORA', () => {
    expect(toggleOwnOrder({ FIFA: [7] }, 'FIFA', true, ['Colo', 'Nacho'])).toEqual({
      FIFA: [0, 1],
    })
  })

  // Minor: una fila en blanco del medio no entra al copiar.
  it('no copia el índice de una fila en blanco del medio', () => {
    expect(toggleOwnOrder({}, 'FIFA', true, ['Colo', '', 'Fede'])).toEqual({ FIFA: [0, 2] })
  })
})

/**
 * F1: el orden propio de una disciplina, con un asiento SACADO -- misma
 * fórmula que `removeSeatAt` ya aplica a `mySeat`, generalizada a una lista
 * entera.
 */
describe('removeFromOrder / removeFromOrders', () => {
  it('el índice sacado desaparece, y los de más atrás se corren para adelante', () => {
    expect(removeFromOrder([2, 0, 3, 1], 1)).toEqual([1, 0, 2])
  })

  it('no toca los índices de más adelante del que se sacó', () => {
    expect(removeFromOrder([0, 1], 3)).toEqual([0, 1])
  })

  it('removeFromOrders sólo toca las disciplinas que tienen su propia lista', () => {
    expect(removeFromOrders({ PADEL: [2, 0, 1] }, 0)).toEqual({ PADEL: [1, 0] })
    expect(removeFromOrders({}, 0)).toEqual({})
  })
})

/**
 * F1: el orden propio de una disciplina, con un asiento NUEVO agregado al
 * final -- el lugar donde entra cualquiera que aparece (`addMySeat`, o una
 * fila que deja de estar en blanco).
 */
describe('addToOrder / addToOrders', () => {
  it('agrega el índice al final si todavía no estaba', () => {
    expect(addToOrder([1, 0], 2)).toEqual([1, 0, 2])
  })

  it('no lo duplica si ya estaba -- una renombrada no agrega nada', () => {
    expect(addToOrder([1, 0, 2], 0)).toEqual([1, 0, 2])
  })

  it('addToOrders sólo toca las disciplinas que tienen su propia lista', () => {
    expect(addToOrders({ FIFA: [0, 1] }, 2)).toEqual({ FIFA: [0, 1, 2] })
    expect(addToOrders({}, 2)).toEqual({})
  })
})

/**
 * F1: el orden propio de una disciplina, con `from`/`to` swapeados -- misma
 * fórmula que `moveSeat` usa para `mySeat`. Necesario para que el swap del
 * orden GLOBAL (`moveSeat`/`onMoveGlobal`, `wizard.tsx`) no le pise la
 * identidad a un orden propio que ya tuviera anotado alguno de los dos
 * asientos.
 */
describe('swapInOrder / swapInOrders', () => {
  it('el que apuntaba a from pasa a apuntar a to, y viceversa', () => {
    expect(swapInOrder([0, 1, 2], 0, 2)).toEqual([2, 1, 0])
  })

  it('no toca los índices que no son ni from ni to', () => {
    expect(swapInOrder([0, 1, 2], 0, 2)[1]).toBe(1)
  })

  it('swapInOrders sólo toca las disciplinas que tienen su propia lista', () => {
    expect(swapInOrders({ PADEL: [0, 1] }, 0, 1)).toEqual({ PADEL: [1, 0] })
    expect(swapInOrders({}, 0, 1)).toEqual({})
  })
})

/**
 * `seedOrderFrom` traduce los ÍNDICES CRUDOS de un orden propio (posiciones
 * sobre `squad.names`, F1) a índices sobre `squadNames` -- la lista YA
 * FILTRADA que `submitSeats`/`db/season.ts` usan como base -- una sola vez,
 * al armar el payload (`newTournamentPayload`), no mientras se edita el
 * plantel.
 *
 * WU1 (ronda 2 de revisión): reemplaza a `seedNamesFrom`, que traducía a
 * NOMBRES -- un formato que la identidad del asiento no sobrevivía cruzar:
 * `seedOrderIndices` (`db/season.ts`, borrada en esta tarea) tenía que
 * ADIVINAR cuál de dos jugadores con el MISMO nombre era, con un scan de
 * primero-libre sin forma de saber cuál arrastró el usuario. Medido:
 * `squad.names = ['Ana','Juan','Luis','Juan']`, `orders.FIFA = [3,0,1,2]`
 * (el SEGUNDO Juan arriba) cruzaba como `['Juan','Ana','Juan','Luis']` y el
 * server volvía a elegir el PRIMER Juan -- invitación y seed para la
 * persona equivocada. Con índices de punta a punta no hay nada que adivinar.
 */
describe('seedOrderFrom', () => {
  it('traduce cada índice crudo a su posición dentro de squadNames, en el orden pedido', () => {
    expect(seedOrderFrom([2, 0, 3, 1], ['Colo', 'Nacho', 'Fede', 'Marce'])).toEqual([2, 0, 3, 1])
  })

  // Con un blanco en el medio, la posición dentro de squadNames YA NO es el
  // índice crudo: squadNames = ['Colo', 'Fede'], así que el índice crudo 2
  // (Fede) traduce a la posición 1, no a la 2.
  it('con un blanco en el medio, traduce al índice REINDEXADO de squadNames', () => {
    expect(seedOrderFrom([2, 0], ['Colo', '', 'Fede'])).toEqual([1, 0])
  })

  // Un índice que ya no señala a un asiento con nombre (sacado o vaciado a
  // mano) se descarta -- red de seguridad además de `removeFromOrders`.
  it('descarta un índice que ya no tiene nombre', () => {
    expect(seedOrderFrom([0, 1, 2], ['Colo', '', 'Fede'])).toEqual([0, 1])
  })

  // Un asiento con nombre que `order` no llegó a anotar se agrega al final,
  // en el orden del plantel -- el resultado sigue siendo una permutación
  // COMPLETA de `[0, squadNames.length)`, la que exige `isIndexPermutation`
  // (`db/season.ts`).
  it('agrega al final los asientos que el orden no anotó', () => {
    expect(seedOrderFrom([2], ['Colo', 'Nacho', 'Fede'])).toEqual([2, 0, 1])
  })

  // WU5 (ronda 2 de revisión): un índice fuera de rango o negativo se
  // descarta igual que uno sin nombre -- nunca revienta ni se cuela.
  it('descarta un índice fuera de rango o negativo', () => {
    expect(seedOrderFrom([-1, 0, 99, 1], ['Colo', 'Nacho'])).toEqual([0, 1])
  })

  // F2 (dos jueces ciegos): dos asientos con el MISMO nombre son dos
  // jugadores distintos -- por índice, nunca se confunden entre sí. Acá el
  // plantel no tiene blancos, así que la posición coincide con el índice
  // crudo, pero lo que importa es que CADA índice trae SU propio asiento.
  it('nombres duplicados: cada índice trae SU propio asiento, sin mezclarse', () => {
    expect(seedOrderFrom([1, 3, 0, 2], ['Juan', 'Juan', 'Ana', 'Luis'])).toEqual([1, 3, 0, 2])
  })
})

/** Igual que `moveSeat`, pero sin `mySeat` que arrastrar: la lista propia de una disciplina es de ÍNDICES sueltos (F1). */
describe('moveInOrder', () => {
  it('sube o baja una posición', () => {
    expect(moveInOrder([0, 1], 0, 1)).toEqual([1, 0])
    expect(moveInOrder([0, 1], 1, 0)).toEqual([1, 0])
  })

  it('se niega a mover más allá de cualquiera de los dos bordes', () => {
    expect(moveInOrder([0, 1], 0, -1)).toEqual([0, 1])
    expect(moveInOrder([0, 1], 1, 2)).toEqual([0, 1])
  })

  // Minor de esta tarea: antes reimplementaba el swap de `moveSeat` a mano y
  // sólo guardaba `to` -- un `from` fuera de rango la rompía en silencio.
  it('también se niega si from cae afuera de rango', () => {
    expect(moveInOrder([0, 1], -1, 0)).toEqual([0, 1])
    expect(moveInOrder([0, 1], 2, 0)).toEqual([0, 1])
  })
})

/**
 * F1 -- el bug MEDIDO en la revisión de `37b225b..d33377a`: reconciliar el
 * orden propio por VALOR de texto (`reconcileOrder`, borrada en esta tarea)
 * perdía el asiento de una renombrada a mitad de tipeo, porque `setSquad`
 * corre en CADA tecla y el string intermedio no matcheaba contra el orden
 * viejo. Por ÍNDICE (`Squad.mySeat` ya vive de esta misma garantía) el
 * problema no puede existir: la posición de un asiento no se mueve porque
 * se lo renombre, así que no hace falta reconciliar nada por una
 * renombrada -- `orders` en `wizard.tsx` no vuelve a tocarse en absoluto
 * mientras se edita un nombre que YA tenía contenido.
 */
describe('F1 -- identidad por índice, no por nombre', () => {
  it('un asiento con orden propio no se mueve si el plantel se retipea al mismo texto', () => {
    // FIFA arrancó con [Caro, Dani, Ana, Beto] -- índices [2, 3, 0, 1] sobre
    // el plantel [Ana, Beto, Caro, Dani].
    const order = [2, 3, 0, 1]
    // Retipear CUALQUIER nombre del plantel (índice 2, "Caro") no toca
    // `order` para nada -- `wizard.tsx` ya no llama a ningún reconciliador
    // al renombrar, así que el orden por índice sigue siendo el mismo. Sin
    // blancos, la posición dentro de `squadNames` coincide con el índice crudo.
    expect(seedOrderFrom(order, ['Ana', 'Beto', 'Caro', 'Dani'])).toEqual([2, 3, 0, 1])
  })

  // F2/WU1: mySeat es uno de los duplicados -- ninguna ambigüedad por
  // índice. El caso MEDIDO en la ronda 2: dos "Juan" son dos ÍNDICES
  // distintos, y `seedOrderFrom` nunca los confunde entre sí -- a
  // diferencia de `seedNamesFrom` (borrada), que los volvía al MISMO texto
  // y le hacía perder la identidad al cruzar a `db/season.ts`.
  it('con nombres duplicados, incluso si mySeat es uno de ellos, cada índice mantiene su identidad', () => {
    const names = ['Juan', 'Juan', 'Ana', 'Luis']
    const mySeat = 1 // el SEGUNDO Juan
    const order = [3, 1, 2, 0] // Luis, mi Juan, Ana, el otro Juan
    expect(seedOrderFrom(order, names)).toEqual([3, 1, 2, 0])
    // Y el asiento propio se sigue leyendo del plantel por índice, ajeno a
    // cuál de los dos "Juan" haya en `order` -- mismo criterio que `Squad.mySeat`.
    expect(names[mySeat]).toBe('Juan')
  })

  /**
   * WU1, la prueba central: el round trip MEDIDO en la ronda 2 -- el mismo
   * escenario del docblock de `seedOrderFrom`, ahora como pin ejecutable.
   * Con `seedNamesFrom` (nombres) esto colapsaba a `['Juan','Ana','Juan','Luis']`
   * y `db/season.ts` volvía a elegir el PRIMER Juan sin importar cuál asiento
   * arrastró el usuario. Con índices de punta a punta, el resultado señala
   * exactamente al asiento 3 -- nunca al 1.
   */
  it('el round trip medido: dos Juan, se arrastra el del asiento 3, y el resultado sigue señalando al 3', () => {
    const names = ['Ana', 'Juan', 'Luis', 'Juan']
    const order = [3, 0, 1, 2] // el usuario arrastró el Juan del asiento 3 arriba de todo
    const result = seedOrderFrom(order, names)
    expect(result).toEqual([3, 0, 1, 2])
    expect(result[0]).toBe(3) // el asiento 3, no el 1 -- el OTRO Juan
  })
})

/**
 * La fila que crece sola (docs/plan-piso-y-techo-del-plantel.md): el piso
 * dejó de ser un plano de 8 para depender de la disciplina, y montar un
 * número fijo de filas es el MISMO error con otra ropa. Tipear en la ÚLTIMA
 * fila agrega la que sigue -- no hay "tamaño típico" que adivinar, la lista
 * crece con lo que hace falta.
 */
describe('namesAfterEdit', () => {
  it('agrega una fila en blanco al tipear en la última', () => {
    expect(namesAfterEdit(['Colo', ''], 1, 'Nacho')).toEqual(['Colo', 'Nacho', ''])
  })

  // La fila del medio no es la última: tipear ahí no agrega nada.
  it('no agrega nada si la fila tocada no es la última', () => {
    expect(namesAfterEdit(['Colo', '', 'Fede'], 1, 'Nacho')).toEqual(['Colo', 'Nacho', 'Fede'])
  })

  // Vaciar la última fila no la borra ni agrega otra: sólo CRECE, nunca se achica sola.
  it('vaciar la última fila no agrega ni saca nada', () => {
    expect(namesAfterEdit(['Colo', ''], 1, '')).toEqual(['Colo', ''])
  })

  // Un espacio en blanco no cuenta como cargado -- mismo criterio que
  // `filledCount`, que también usa `.trim()`.
  it('un espacio en blanco no dispara el agregado', () => {
    expect(namesAfterEdit(['Colo', ''], 1, '   ')).toEqual(['Colo', '   '])
  })

  // Autolimitado: apenas se agrega, ESA pasa a ser la última -- tipear ahí
  // agrega la que sigue, sin que haga falta un tope aparte.
  it('encadena: llenar la fila recién agregada agrega otra más', () => {
    const first = namesAfterEdit(['Colo', ''], 1, 'Nacho')
    expect(first).toEqual(['Colo', 'Nacho', ''])
    const second = namesAfterEdit(first, 2, 'Fede')
    expect(second).toEqual(['Colo', 'Nacho', 'Fede', ''])
  })

  // Rearmar `namesAfterEdit(['Colo', ''], 1, 'x')` seguido de vaciar esa MISMA
  // fila dos veces no deja dos filas en blanco: la segunda llamada opera
  // sobre la fila que ya no es la última (la de índice 1 dejó de serlo apenas
  // se agregó la de índice 2), así que no vuelve a tocar la cola.
  it('tipear y borrar en la misma fila dos veces no acumula filas de más', () => {
    const grown = namesAfterEdit(['Colo', ''], 1, 'x') // ['Colo', 'x', '']
    const cleared = namesAfterEdit(grown, 1, '') // la fila 1 ya no es la última
    expect(cleared).toEqual(['Colo', '', ''])
  })
})

/**
 * El paso 3 (orden) no dibuja casilleros vacíos: la fila que
 * `namesAfterEdit` deja creciendo sola al final no es un jugador a ordenar.
 * Corta sólo del FINAL -- una fila vacía en el medio (la deja "+ Agregar
 * jugador" o vaciarla a mano) no es el caso que resuelve esta función.
 */
describe('withoutTrailingBlanks', () => {
  it('saca la fila en blanco del final', () => {
    expect(withoutTrailingBlanks(['Colo', 'Nacho', ''])).toEqual(['Colo', 'Nacho'])
  })

  it('no toca nada si no hay nada en blanco al final', () => {
    expect(withoutTrailingBlanks(['Colo', 'Nacho'])).toEqual(['Colo', 'Nacho'])
  })

  it('saca más de una fila en blanco si hay más de una al final', () => {
    expect(withoutTrailingBlanks(['Colo', 'Nacho', '', ''])).toEqual(['Colo', 'Nacho'])
  })

  // Una fila en blanco en el MEDIO no es la que esta función resuelve: sólo
  // corta desde la cola, para no correr el índice de las filas que sobreviven.
  it('una fila en blanco en el medio no se toca', () => {
    expect(withoutTrailingBlanks(['Colo', '', 'Fede'])).toEqual(['Colo', '', 'Fede'])
  })
})

describe('toggleDiscipline', () => {
  it('adds a kind that was not picked, at the end', () => {
    expect(toggleDiscipline(['PADEL'], 'FIFA')).toEqual(['PADEL', 'FIFA'])
  })

  it('removes a kind that was already picked', () => {
    expect(toggleDiscipline(['PADEL', 'FIFA'], 'PADEL')).toEqual(['FIFA'])
  })

  // El orden de toque ES el contrato (11b/PR10): se vuelve `position` y de ahí
  // el ordinal del slug. No hay un orden "correcto" por kind.
  it('keeps the touch order, not a fixed one', () => {
    expect(toggleDiscipline(['FIFA'], 'PADEL')).toEqual(['FIFA', 'PADEL'])
  })
})

describe('disciplinesWarning', () => {
  it('asks for at least one discipline when none is picked', () => {
    expect(disciplinesWarning([])).toBe('Elegí al menos una disciplina para el torneo.')
  })

  it('says nothing once at least one is picked', () => {
    expect(disciplinesWarning(['PADEL'])).toBeNull()
    expect(disciplinesWarning(['FIFA'])).toBeNull()
  })
})

describe('buildDisciplines', () => {
  // PR20 rebanada D2: las filas ya NO comparten la config palabra por palabra
  // —comparten los puntos, las fechas y el plantel, que es lo que el paso 4
  // pregunta— pero cada una nace con la FORMA DE MARCADOR de su disciplina.
  // Antes de esto una liga de FIFA nacía siendo pádel con otro nombre: sin
  // marcador abierto y sin empates, o sea sin poder cargar un `3-1` ni un
  // `0-0`. Y `allows_draw` no se puede corregir después —`0015_disciplines.sql`
  // no lo pone en el grant de UPDATE—, así que nacer mal era para siempre.
  it('da una fila por kind marcado, con los puntos y las fechas del paso 4', () => {
    const config = configFor(8, 2)
    expect(buildDisciplines(['PADEL', 'FIFA'], config)).toEqual([
      { kind: 'PADEL', config, allowsDraw: false },
      {
        kind: 'FIFA',
        config: { ...config, matchFormat: { ...config.matchFormat, openScore: true } },
        allowsDraw: true,
      },
    ])
  })

  it('el pádel nace exactamente igual que hoy: sets, sin empates', () => {
    const config = configFor(8, 2)
    expect(buildDisciplines(['PADEL'], config)).toEqual([
      { kind: 'PADEL', config, allowsDraw: false },
    ])
  })

  // El contrato de 11b/PR10: el orden de este array ES el orden de creación,
  // que se vuelve `position` (createSeason lo escribe explícito) y de ahí el
  // ordinal del slug (padel/padel-2). Tocar FIFA antes que Pádel tiene que dar
  // FIFA primero, no importa el orden en que aparecen los checkboxes en pantalla.
  it('keeps the order the user picked, not DISCIPLINE_KINDS order', () => {
    const config = configFor(8, 2)
    expect(buildDisciplines(['FIFA', 'PADEL'], config).map((row) => row.kind)).toEqual([
      'FIFA',
      'PADEL',
    ])
  })

  it('gives back nothing for an empty pick', () => {
    expect(buildDisciplines([], configFor(8, 2))).toEqual([])
  })

  // Rebanada F: el radio "Individual" tiene que llegar hasta acá como
  // pairSize=1, y arrastrar consigo la config con la curva de la decisión
  // #3963 (no sólo la clave "pairSize" — #3957, se pinchan los argumentos).
  it('incluye pairSize en el retorno cuando se pasa 1, con la curva de #3963', () => {
    const config = configFor(8, 1)
    expect(buildDisciplines(['FIFA'], config, 1)).toEqual([
      {
        kind: 'FIFA',
        config: { ...config, matchFormat: { ...config.matchFormat, openScore: true } },
        allowsDraw: true,
        pairSize: 1,
      },
    ])
  })
})

describe('newDisciplineSpec', () => {
  // El "+ Agregar disciplina" de Ajustes arma esto con el tamaño de SU
  // plantel elegido (REQ-D1-4), no el de toda la temporada.
  it('arma la config del tamaño de plantel que se le pasa', () => {
    expect(newDisciplineSpec('PADEL', 8)).toEqual({
      kind: 'PADEL',
      config: defaultConfig(8),
      allowsDraw: false,
    })
  })

  // El punto de unión del lado de Ajustes (Rebanada F): pairSize tiene que
  // llegar hasta acá Y la config.points tiene que ser la curva de la
  // decisión #3963 — no sólo que la clave `pairSize` exista (#3957).
  it('con pairSize=1 arma la curva de la decisión #3963, no la de parejas', () => {
    const spec = newDisciplineSpec('FIFA', 8, 1)
    expect(spec.pairSize).toBe(1)
    expect(spec.config.points).toEqual([10, 7, 5, 3, 2, 1, 0, 0])
    expect(spec.allowsDraw).toBe(true)
  })
})

describe('newTournamentPayload', () => {
  // Lo que arma el submit del wizard: name + submitSeats(squad) + config con
  // el squadSize REAL + buildDisciplines. Antes vivía inline adentro del
  // `startTransition` de `Wizard` — puro salvo el `await createTournament`, y
  // sin embargo intestable ahí (repite el patrón de `wizard-state.ts`,
  // `armado-state.ts`, `carga-state.ts`, `sumar-state.ts`: sacar la lógica
  // del `.tsx` para poder testearla sin DOM y sin base).
  //
  // `configs`/`pairSizes`/`hasMasters`/`formatoDefault` son OBLIGATORIOS acá
  // (a diferencia de `buildDisciplines`): el único caller (`Wizard`) siempre
  // tiene un valor por disciplina para los cuatro. Por eso el pádel de este
  // test también los pasa explícitos — la fila que sale lleva `pairSize: 2`
  // en vez de omitir la clave, y es exactamente lo mismo que escribe la base
  // (`addDiscipline`: `spec.pairSize ?? 2`).
  it('arma exactamente el payload que createTournament espera, para pádel', () => {
    const squad: Squad = { names: Array(8).fill('Jugador'), mySeat: 0 }
    const configs = { PADEL: configFor(8, 2), FIFA: configFor(8, 2) }
    const payload = newTournamentPayload(
      'Los Jueves',
      squad,
      configs,
      ['PADEL'],
      { PADEL: 2, FIFA: 2 },
      { PADEL: true, FIFA: true },
      ROUND_ROBIN_ALL,
      NO_FIXED_TEAMS,
      {},
    )
    expect(payload).toEqual({
      name: 'Los Jueves',
      squadNames: squad.names,
      mySeatIndex: 0,
      config: configs.PADEL,
      // `fixedTeams` SÍ viaja incluso con una sola disciplina marcada (a
      // diferencia de `hasMasters`/`formatoDefault`): el checkbox del paso 4
      // se dibuja siempre (docs/tipos-de-torneo.md §1), así que
      // `buildDisciplines` solo ya no alcanza para describir la fila.
      disciplines: buildDisciplines(['PADEL'], configs.PADEL, 2).map((row) => ({
        ...row,
        fixedTeams: false,
      })),
    })
  })

  // El squadSize del payload sale del plantel REALMENTE cargado al momento
  // de mandar, no del que traía la config (que puede estar desactualizada si
  // el admin agregó/sacó nombres después de tocar el paso 4). Task 5:
  // `resizeConfig` corre por disciplina en el submit mismo, así que también
  // reacomoda `points` al tamaño real -- no sólo pisa el número, como hacía
  // la versión anterior a esta Task.
  it('el squadSize del payload sale del plantel cargado, no el que traía la config', () => {
    const squad: Squad = { names: [...Array(8).fill('Jugador'), '', ''], mySeat: null }
    const configs = { PADEL: configFor(12, 2), FIFA: configFor(12, 2) }
    const payload = newTournamentPayload(
      'X',
      squad,
      configs,
      ['PADEL'],
      { PADEL: 2, FIFA: 2 },
      { PADEL: true, FIFA: true },
      ROUND_ROBIN_ALL,
      NO_FIXED_TEAMS,
      {},
    )
    expect(payload.squadNames).toHaveLength(8)
    expect(payload.config.squadSize).toBe(8)
    expect(payload.config.points).toEqual(defaultConfig(8, 2).points)
  })

  // El punto de unión de la Rebanada F, en el payload REAL que cruza al
  // server action — no sólo hasta `buildDisciplines` suelto (#3957, se
  // pinchan los argumentos, no que la función interna acepte el parámetro).
  it('con pairSize=1, las disciplines del payload salen con la curva de la decisión #3963', () => {
    const squad: Squad = { names: Array(8).fill('Jugador'), mySeat: null }
    const configs = { PADEL: configFor(8, 2), FIFA: configFor(8, 1) }
    const payload = newTournamentPayload(
      'Liga FIFA',
      squad,
      configs,
      ['FIFA'],
      { PADEL: 2, FIFA: 1 },
      { PADEL: true, FIFA: false },
      ROUND_ROBIN_ALL,
      NO_FIXED_TEAMS,
      {},
    )
    expect(payload.disciplines).toEqual([
      {
        kind: 'FIFA',
        config: { ...configs.FIFA, matchFormat: { ...configs.FIFA.matchFormat, openScore: true } },
        allowsDraw: true,
        pairSize: 1,
        fixedTeams: false,
      },
    ])
  })

  // Con UNA sola disciplina marcada, el paso 4 no dibuja Masters ni "Formato
  // de las fechas" (§5 del diseño), así que el payload tampoco las manda --
  // el torneo se crea EXACTAMENTE como antes de la Task 5, aunque el estado
  // interno del wizard tenga valores puestos (sobrante de haber tenido una
  // segunda disciplina marcada en algún momento y haberla destildado).
  it('con una sola disciplina, hasMasters y formatoDefault NO viajan en el payload', () => {
    const squad: Squad = { names: Array(8).fill('Jugador'), mySeat: null }
    const configs = { PADEL: configFor(8, 2), FIFA: configFor(8, 2) }
    const payload = newTournamentPayload(
      'Los Jueves',
      squad,
      configs,
      ['PADEL'],
      { PADEL: 2, FIFA: 2 },
      { PADEL: false, FIFA: false },
      { PADEL: { kind: 'GROUPS_KNOCKOUT', groups: 4, qualifiersPerGroup: 2 }, FIFA: { kind: 'ROUND_ROBIN' } },
      { PADEL: true, FIFA: false },
      {},
    )
    expect(payload.disciplines[0]).not.toHaveProperty('hasMasters')
    expect(payload.disciplines[0]).not.toHaveProperty('formatoDefault')
    // `fixedTeams`, al revés que las otras dos: viaja SIEMPRE, aunque haya
    // una sola disciplina marcada -- el checkbox del paso 4 se dibuja en los
    // dos casos (docs/tipos-de-torneo.md §1), a diferencia de Masters/Formato.
    expect(payload.disciplines[0]).toHaveProperty('fixedTeams', true)
  })

  /**
   * La prueba central de la Task 5 -- y el chequeo que tiene que quedar rojo
   * si alguien vuelve a aplanar (docs/plan-arquitectura-de-paginas.md §2.4,
   * §6): con Pádel Y FIFA marcados, cada fila trae SU PROPIA config,
   * genuinamente distinta de la otra en más que el `pairSize` -- puntos Y
   * fechas del año, no sólo la curva que ya forzaba `pairSize` (W76/#4017).
   * Y Masters/formato por defecto, cada uno el suyo.
   *
   * Un test que sólo mirara UNA fila no probaría la independencia entre
   * disciplinas (docs/tipos-de-torneo.md §0, "cada torneo es independiente")
   * -- hace falta ver las DOS a la vez, y que sean DISTINTAS entre sí, no
   * sólo distintas del default.
   */
  it('con Pádel Y FIFA marcados, cada uno trae SU config -- genuinamente distinta, no sólo el pairSize', () => {
    const squad: Squad = { names: Array(8).fill('Jugador'), mySeat: null }
    const configs = {
      PADEL: { ...configFor(8, 2), regularMatchdays: 10 },
      FIFA: { ...configFor(8, 1), regularMatchdays: 12 },
    }
    const payload = newTournamentPayload(
      'Mixto',
      squad,
      configs,
      ['PADEL', 'FIFA'],
      { PADEL: 2, FIFA: 1 },
      { PADEL: true, FIFA: false },
      { PADEL: { kind: 'ROUND_ROBIN' }, FIFA: { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 } },
      { PADEL: true, FIFA: false },
      {},
    )

    expect(payload.disciplines).toHaveLength(2)
    const padel = payload.disciplines.find((row) => row.kind === 'PADEL')
    const fifa = payload.disciplines.find((row) => row.kind === 'FIFA')
    expect(padel?.pairSize).toBe(2)
    expect(fifa?.pairSize).toBe(1)
    // Puntos: cada uno con SU curva (#3963: 8 lados de a uno puntúan los
    // primeros seis; 8 jugadores en parejas son 4 lados, la curva de 4).
    expect(padel?.config.points).toEqual([10, 6, 3, 1])
    expect(fifa?.config.points).toEqual([10, 7, 5, 3, 2, 1, 0, 0])
    // Fechas: genuinamente distintas ENTRE SÍ, no sólo distintas del default.
    expect(padel?.config.regularMatchdays).toBe(10)
    expect(fifa?.config.regularMatchdays).toBe(12)
    expect(padel?.config.regularMatchdays).not.toBe(fifa?.config.regularMatchdays)
    // Masters y formato por defecto: cada fila trae el suyo.
    expect(padel?.hasMasters).toBe(true)
    expect(fifa?.hasMasters).toBe(false)
    expect(padel?.formatoDefault).toEqual({ kind: 'ROUND_ROBIN' })
    expect(fifa?.formatoDefault).toEqual({ kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 })
    // Equipos fijos: cada fila trae el suyo (PADEL marcado, FIFA no) -- FIFA
    // está en pairSize 1 así que además queda clampeado, ver el test de abajo.
    expect(padel?.fixedTeams).toBe(true)
    expect(fifa?.fixedTeams).toBe(false)
  })

  /**
   * Fix round 1: la prueba de arriba pone a FIFA en `pairSize: 1`, así que
   * `effectiveHasMasters` CLAMPEA su `hasMasters` a `false` sin importar qué
   * valor se lea -- leer `hasMasters[picked[0]!]` ("PADEL", `true`) en vez
   * de `hasMasters[kind]` da el MISMO `false` para la fila FIFA, porque el
   * clamp lo pisa igual. La prueba no discriminaba la lectura de la clave;
   * discriminaba el clamp.
   *
   * Acá las DOS quedan en `pairSize: 2` -- nada clampea ninguna de las dos
   * filas -- y con `hasMasters` DISTINTO entre sí, lo único que puede dar
   * el resultado esperado es leer `hasMasters[kind]`, la clave correcta.
   */
  it('con las DOS en pairSize 2 (sin clamp), cada fila lee SU PROPIO hasMasters', () => {
    const squad: Squad = { names: Array(8).fill('Jugador'), mySeat: null }
    const configs = { PADEL: configFor(8, 2), FIFA: configFor(8, 2) }
    const payload = newTournamentPayload(
      'Mixto',
      squad,
      configs,
      ['PADEL', 'FIFA'],
      { PADEL: 2, FIFA: 2 },
      { PADEL: true, FIFA: false },
      ROUND_ROBIN_ALL,
      NO_FIXED_TEAMS,
      {},
    )
    const padel = payload.disciplines.find((row) => row.kind === 'PADEL')
    const fifa = payload.disciplines.find((row) => row.kind === 'FIFA')
    expect(padel?.hasMasters).toBe(true)
    expect(fifa?.hasMasters).toBe(false)
  })

  // Mismo caso que el de arriba, para `fixedTeams`: las DOS en `pairSize: 2`
  // (sin que `effectiveFixedTeams` clampee ninguna) y con valores DISTINTOS
  // entre sí -- el único caso capaz de cazar un `fixedTeams[kind]` leído mal
  // (p.ej. `fixedTeams.PADEL` fijo, sin importar `kind`): con una disciplina
  // en `pairSize: 1` de por medio, `effectiveFixedTeams(1, cualquiera)` da
  // siempre `false` y enmascara ese mismo mis-wire.
  it('con las DOS en pairSize 2 (sin clamp), cada fila lee SU PROPIO fixedTeams', () => {
    const squad: Squad = { names: Array(8).fill('Jugador'), mySeat: null }
    const configs = { PADEL: configFor(8, 2), FIFA: configFor(8, 2) }
    const payload = newTournamentPayload(
      'Mixto',
      squad,
      configs,
      ['PADEL', 'FIFA'],
      { PADEL: 2, FIFA: 2 },
      { PADEL: true, FIFA: false },
      ROUND_ROBIN_ALL,
      { PADEL: true, FIFA: false },
      {},
    )
    const padel = payload.disciplines.find((row) => row.kind === 'PADEL')
    const fifa = payload.disciplines.find((row) => row.kind === 'FIFA')
    expect(padel?.fixedTeams).toBe(true)
    expect(fifa?.fixedTeams).toBe(false)
  })

  // El guard vive en `newTournamentPayload`, no confía en que el checkbox
  // haya quedado deshabilitado a tiempo: `disciplines_has_masters_needs_pair`
  // (0053) rechaza `true` con `pairSize` 1 sin excepción.
  it('effectiveHasMasters se aplica en el payload real: pairSize 1 fuerza false aunque el checkbox diga true', () => {
    const squad: Squad = { names: Array(8).fill('Jugador'), mySeat: null }
    const configs = { PADEL: configFor(8, 2), FIFA: configFor(8, 1) }
    const payload = newTournamentPayload(
      'Mixto',
      squad,
      configs,
      ['PADEL', 'FIFA'],
      { PADEL: 2, FIFA: 1 },
      { PADEL: true, FIFA: true }, // FIFA en true a mano -- inválido para pairSize 1
      ROUND_ROBIN_ALL,
      NO_FIXED_TEAMS,
      {},
    )
    const fifa = payload.disciplines.find((row) => row.kind === 'FIFA')
    expect(fifa?.hasMasters).toBe(false)
  })

  // Mismo guard, para equipos fijos: `disciplines_fixed_teams_needs_pair`
  // (0077) rechaza `true` con `pairSize` 1 sin excepción, y `effectiveFixedTeams`
  // (wizard-state.ts) es la puerta de salida que lo aplica ANTES de llegar a
  // la base -- mismo criterio, verificado directo sobre la función pura.
  it('effectiveFixedTeams fuerza false con pairSize 1', () => {
    expect(effectiveFixedTeams(1, true)).toBe(false)
    expect(effectiveFixedTeams(2, true)).toBe(true)
  })

  it('effectiveFixedTeams se aplica en el payload real: pairSize 1 fuerza false aunque el checkbox diga true', () => {
    const squad: Squad = { names: Array(8).fill('Jugador'), mySeat: null }
    const configs = { PADEL: configFor(8, 2), FIFA: configFor(8, 1) }
    const payload = newTournamentPayload(
      'Mixto',
      squad,
      configs,
      ['PADEL', 'FIFA'],
      { PADEL: 2, FIFA: 1 },
      { PADEL: true, FIFA: true },
      ROUND_ROBIN_ALL,
      { PADEL: true, FIFA: true }, // FIFA en true a mano -- inválido para pairSize 1
      {},
    )
    const fifa = payload.disciplines.find((row) => row.kind === 'FIFA')
    expect(fifa?.fixedTeams).toBe(false)
  })

  // Con una config genuinamente por disciplina ya no hay una curva "legado"
  // que una edición pueda perder o heredar (C29/W83, cerrado por esta
  // Task): lo que el admin editó en `configs.FIFA` es, literal, lo que se
  // guarda -- sin `soleCurveMatches` ni ningún otro guard de forma.
  it('la curva editada a mano en UNA disciplina se guarda tal cual', () => {
    const squad: Squad = { names: Array(8).fill('Jugador'), mySeat: null }
    const edited = { ...configFor(8, 1), points: [20, 12, 6, 2, 0, 0, 0, 0] }
    const configs = { PADEL: configFor(8, 2), FIFA: edited }
    const payload = newTournamentPayload(
      'Liga FIFA',
      squad,
      configs,
      ['FIFA'],
      { PADEL: 2, FIFA: 1 },
      { PADEL: true, FIFA: false },
      ROUND_ROBIN_ALL,
      NO_FIXED_TEAMS,
      {},
    )
    expect(payload.disciplines[0]?.config.points).toEqual([20, 12, 6, 2, 0, 0, 0, 0])
  })

  it('con dos disciplinas, la curva editada de una no se filtra a la otra', () => {
    const squad: Squad = { names: Array(8).fill('Jugador'), mySeat: null }
    const configs = {
      PADEL: { ...configFor(8, 2), points: [20, 12, 6, 2] },
      FIFA: configFor(8, 1),
    }
    const payload = newTournamentPayload(
      'Mixto',
      squad,
      configs,
      ['PADEL', 'FIFA'],
      { PADEL: 2, FIFA: 1 },
      { PADEL: true, FIFA: false },
      ROUND_ROBIN_ALL,
      NO_FIXED_TEAMS,
      {},
    )
    const padel = payload.disciplines.find((row) => row.kind === 'PADEL')
    const fifa = payload.disciplines.find((row) => row.kind === 'FIFA')
    expect(padel?.config.points).toEqual([20, 12, 6, 2])
    expect(fifa?.config.points).toEqual([10, 7, 5, 3, 2, 1, 0, 0])
  })

  /**
   * Paso "Orden inicial" con orden propio (§3, Task de este slice): `orders`
   * es el noveno parámetro -- OBLIGATORIO (F8, dos jueces ciegos,
   * `37b225b..d33377a`) igual que los cuatro anteriores, pero `Partial` a
   * diferencia de ellos: "ninguna disciplina tiene orden propio" (entrada
   * ausente) es el estado normal del 100% de los torneos de hoy, no un
   * olvido. Con `{}`, ninguna fila manda `seedOrder` -- exactamente el
   * comportamiento de todos los tests de arriba, que lo pasan así.
   *
   * WU1 (ronda 2 de revisión): el campo se llama `seedOrder` y viaja como
   * ÍNDICES, no `seedNames` con nombres -- ver el docblock de `seedOrderFrom`.
   */
  it('con orders vacío, ninguna fila manda seedOrder -- comportamiento de siempre', () => {
    const squad: Squad = { names: Array(8).fill('Jugador'), mySeat: null }
    const configs = { PADEL: configFor(8, 2), FIFA: configFor(8, 2) }
    const payload = newTournamentPayload(
      'Los Jueves',
      squad,
      configs,
      ['PADEL'],
      { PADEL: 2, FIFA: 2 },
      { PADEL: true, FIFA: true },
      ROUND_ROBIN_ALL,
      NO_FIXED_TEAMS,
      {},
    )
    expect(payload.disciplines[0]).not.toHaveProperty('seedOrder')
  })

  it('una disciplina con orden propio manda seedOrder; la vecina sin toggle no manda nada', () => {
    const names = ['Colo', 'Nacho', 'Fede', 'Marce']
    const squad: Squad = { names, mySeat: null }
    const configs = { PADEL: configFor(4, 1), FIFA: configFor(4, 1) }
    const payload = newTournamentPayload(
      'Mixto',
      squad,
      configs,
      ['PADEL', 'FIFA'],
      { PADEL: 1, FIFA: 1 },
      { PADEL: false, FIFA: false },
      ROUND_ROBIN_ALL,
      NO_FIXED_TEAMS,
      // Índices (F1), no nombres: Fede=2, Marce=3, Colo=0, Nacho=1. Sin
      // blancos en el plantel, la posición dentro de squadNames coincide
      // con el índice crudo.
      { FIFA: [2, 3, 0, 1] },
    )
    const padel = payload.disciplines.find((row) => row.kind === 'PADEL')
    const fifa = payload.disciplines.find((row) => row.kind === 'FIFA')
    expect(padel).not.toHaveProperty('seedOrder')
    expect(fifa?.seedOrder).toEqual([2, 3, 0, 1])
  })

  // `seedOrderFrom` (WU1, arriba) agrega al final cualquier asiento que
  // `order` no llegó a anotar -- sin esto, un jugador agregado DESPUÉS de
  // prender el orden propio (`Marce`, acá) quedaría sin `seed_position` en
  // esa disciplina y `createSeason` lo rebotaría por el guard de
  // permutación. Con la identidad por ÍNDICE (F1), `orders` en `wizard.tsx`
  // ya llega con `Marce` sumada por `addToOrders` en cuanto aparece -- este
  // test pinea el CASO LÍMITE en que por lo que sea no llegó a sumarse.
  it('un asiento que order no anotó se agrega al final, en el orden del plantel', () => {
    const names = ['Colo', 'Nacho', 'Fede', 'Marce']
    const squad: Squad = { names, mySeat: null }
    const configs = { PADEL: configFor(4, 1), FIFA: configFor(4, 1) }
    const payload = newTournamentPayload(
      'Mixto',
      squad,
      configs,
      ['PADEL', 'FIFA'],
      { PADEL: 1, FIFA: 1 },
      { PADEL: false, FIFA: false },
      ROUND_ROBIN_ALL,
      NO_FIXED_TEAMS,
      { FIFA: [2, 0, 1] }, // Fede, Colo, Nacho -- "Marce" (índice 3) no está anotada
    )
    const fifa = payload.disciplines.find((row) => row.kind === 'FIFA')
    expect(fifa?.seedOrder).toEqual([2, 0, 1, 3])
  })

  // F3 (dos jueces ciegos): con UNA sola disciplina marcada, `seedOrder`
  // nunca viaja -- ni siquiera si `orders` trae una entrada sobrante (de
  // cuando había 2+ marcadas y se destildó la otra, o de la propia
  // disciplina si su checkbox ya no está visible). El gate es
  // `picked.length > 1`, no `ownOrder !== undefined`.
  it('con una sola disciplina, seedOrder no viaja aunque orders traiga una entrada sobrante', () => {
    const squad: Squad = { names: Array(8).fill('Jugador'), mySeat: null }
    const configs = { PADEL: configFor(8, 2), FIFA: configFor(8, 2) }
    const payload = newTournamentPayload(
      'Los Jueves',
      squad,
      configs,
      ['PADEL'],
      { PADEL: 2, FIFA: 2 },
      { PADEL: true, FIFA: true },
      ROUND_ROBIN_ALL,
      NO_FIXED_TEAMS,
      { PADEL: [3, 2, 1, 0, 4, 5, 6, 7] },
    )
    expect(payload.disciplines[0]).not.toHaveProperty('seedOrder')
  })

  /**
   * WU5 (ronda 2 de revisión): `newTournamentPayload` tiene que traducir
   * `orders[kind]` contra `squad.names` -- el plantel CRUDO, con blancos del
   * medio incluidos -- y no contra `seats.squadNames` -- la versión YA
   * reindexada que `submitSeats` produce. Mutar el segundo argumento de
   * `seedOrderFrom` de uno a otro sobrevivía 1050/1050 antes de este test:
   * con un blanco en el MEDIO (`filled === 4`, un estado normal, no un
   * error), los índices que `orders[kind]` trae son posiciones sobre el
   * plantel CRUDO -- traducirlos contra la versión ya achicada corre a cada
   * jugador un lugar de más a partir del blanco.
   */
  it('traduce el orden propio contra squad.names crudo, no contra seats.squadNames ya reindexado', () => {
    // ['Ana', '', 'Beto', 'Caro', 'Dani'] -- blanco en el MEDIO, filled === 4.
    const names = ['Ana', '', 'Beto', 'Caro', 'Dani']
    const squad: Squad = { names, mySeat: null }
    const configs = { PADEL: configFor(4, 1), FIFA: configFor(4, 1) }
    const payload = newTournamentPayload(
      'Mixto',
      squad,
      configs,
      ['PADEL', 'FIFA'],
      { PADEL: 1, FIFA: 1 },
      { PADEL: false, FIFA: false },
      ROUND_ROBIN_ALL,
      NO_FIXED_TEAMS,
      // Índices CRUDOS de squad.names: Dani(4), Ana(0), Caro(3), Beto(2).
      { FIFA: [4, 0, 3, 2] },
    )
    const fifa = payload.disciplines.find((row) => row.kind === 'FIFA')
    // squadNames real = ['Ana','Beto','Caro','Dani'] (0..3). Traducidos:
    // Dani=3, Ana=0, Caro=2, Beto=1.
    expect(fifa?.seedOrder).toEqual([3, 0, 2, 1])
  })
})

describe('submitSeats', () => {
  it('reindexes the organizer against the filled names, not the raw rows', () => {
    // Dos casilleros vacíos ARRIBA del asiento propio: mandar el índice crudo
    // ataría al organizador al asiento de otra persona.
    const squad = { names: ['', '', 'Colo', 'Nacho'], mySeat: 2 }
    expect(submitSeats(squad)).toEqual({ squadNames: ['Colo', 'Nacho'], mySeatIndex: 0 })
  })

  it('drops an organizer whose own row was left blank', () => {
    const squad = { names: ['Nacho', ''], mySeat: 1 }
    expect(submitSeats(squad)).toEqual({ squadNames: ['Nacho'], mySeatIndex: null })
  })

  it('carries a null through', () => {
    const squad = { names: ['Nacho', 'Fede'], mySeat: null }
    expect(submitSeats(squad)).toEqual({ squadNames: ['Nacho', 'Fede'], mySeatIndex: null })
  })

  it('trims the names it sends', () => {
    const squad = { names: ['  Colo  ', ' Nacho '], mySeat: 0 }
    expect(submitSeats(squad).squadNames).toEqual(['Colo', 'Nacho'])
  })
})

/**
 * W63: el paso 4 de una liga que NO tiene pádel
 * dibujaba "Sets por partido" y "Games por set", y el segundo se anuncia con
 * "A 4 games el resultado se carga en dos toques" — justo la máquina que una
 * disciplina de marcador abierto no monta.
 *
 * Antes de la Task 5 el criterio del wizard difería del de Ajustes: acá la
 * config era de la TEMPORADA y la compartían todas las marcadas, así que se
 * le pasaban los formatos de TODAS a la vez (de ahí el test "alcanza con
 * que UNA use sets", abajo). Desde la Task 5 el wizard también llama con un
 * array de UNO, por disciplina — igual que Ajustes — así que ese caso ya no
 * tiene un caller vivo, pero la función lo sigue soportando (la firma
 * genérica de `steppersFor` no cambió, y Ajustes ya llama con un array).
 */
describe('steppersFor', () => {
  const PADEL = configFor(8, 2).matchFormat
  const FIFA = { ...PADEL, openScore: true }

  it('con sets dibuja los cinco', () => {
    expect(steppersFor([PADEL]).map((row) => row.key)).toEqual(STEPPERS.map((row) => row.key))
  })

  it('sin sets se van los dos que no gobiernan nada', () => {
    expect(steppersFor([FIFA]).map((row) => row.key)).toEqual([
      'regularMatchdays',
      'countBestOf',
      'tiebreakSnapshotEvery',
    ])
  })

  it('alcanza con que UNA use sets para que sigan estando', () => {
    expect(steppersFor([PADEL, FIFA]).map((row) => row.key)).toEqual(STEPPERS.map((row) => row.key))
  })

  it('sin disciplinas no saca nada: no hay "nadie usa sets" sin nadie', () => {
    expect(steppersFor([])).toEqual(STEPPERS)
  })
})

/**
 * W88 y W90 (`verify-report-go-no-go`, #4034) eran la cuarta y la quinta
 * puerta de la familia C29 → W69 → W76 → W83: `config` era UNA curva
 * compartida por el paso 4, y destildar o volver a tildar una disciplina
 * podía dejarla con una CANTIDAD de valores que ya no correspondía, sin que
 * nada lo avisara. La Task 5 (docs/plan-arquitectura-de-paginas.md) cierra
 * la familia entera: con `configs` genuinamente por disciplina no existe
 * una curva compartida que un toggle pueda desactualizar — cada disciplina
 * mantiene la suya, y `changePairSize`/`freshDisciplineConfig`
 * (`wizard.tsx`/`wizard-state.ts`) la rehacen siempre que cambia SU
 * `pairSize`. Los dos escenarios textuales de esos informes ya no son
 * alcanzables, así que sus tests (que llamaban a `configSideSize`/
 * `configForPairSizeChange`, las dos borradas en esta Task) se van con
 * ellos. Lo que queda, y sigue siendo válido, es el PIN de no-regresión de
 * abajo.
 */
describe('formatErrors', () => {
  // PIN de no-regresión: el caso de siempre —una curva que SÍ corresponde—
  // sigue sin errores. Es el 100% de los torneos que existen hoy.
  it('no inventa un error cuando la curva corresponde', () => {
    expect(formatErrors(configFor(8, 2), 2)).toEqual([])
    expect(formatErrors(configFor(8, 1), 1)).toEqual([])
    expect(formatErrors(configFor(12, 2), 2)).toEqual([])
  })

  // Task 5: con una config por disciplina, cambiar cuántas marcadas hay NO
  // puede dejar a la que sobrevive con una cantidad de puntos que no le
  // corresponde -- `freshDisciplineConfig` la rehace siempre que cambia SU
  // `pairSize`, así que el escenario que medían W88/W90 (una curva
  // compartida desactualizada) ya no es alcanzable.
  it('freshDisciplineConfig nunca deja una cantidad de puntos que no corresponda', () => {
    const config = freshDisciplineConfig('FIFA', 8, 1)
    expect(formatErrors(config, 1)).toEqual([])
  })
})

// ── El torneo de un día (docs/tipos-de-torneo.md §2.1) ──────────────────────
//
// `core/config.ts:227` valida `regularMatchdays >= 1` desde siempre: el modelo
// nunca prohibió un torneo de una sola fecha. El único que lo prohibía era el
// stepper del paso 4, con un `min: 4` que no protegía nada — no hay ninguna
// regla del dominio detrás de ese 4.
//
// Este bloque es el PIN: si alguien vuelve a subir el mínimo, el torneo de un
// día se muere otra vez en silencio, sin que ningún otro test se entere.
describe('un torneo de una sola fecha', () => {
  it('el stepper de fechas baja hasta 1', () => {
    expect(STEPPERS.find((row) => row.key === 'regularMatchdays')?.min).toBe(1)
  })

  it('con una fecha y contando una, el paso 4 no protesta', () => {
    const config = { ...configFor(8, 2), regularMatchdays: 1, countBestOf: 1 }
    expect(formatErrors(config, 2)).toEqual([])
    expect(validateConfig(config, 2)).toEqual([])
  })

  // El descarte de las peores no existe con una sola fecha, y el aviso que ya
  // había es el que lo dice. No hace falta clamp: el paso 4 no deja seguir.
  it('con una fecha y contando más de una, avisa con el error que ya existía', () => {
    const config = { ...configFor(8, 2), regularMatchdays: 1, countBestOf: 8 }
    expect(formatErrors(config, 2)).toEqual(['No pueden contar más fechas de las que se juegan.'])
  })
})
