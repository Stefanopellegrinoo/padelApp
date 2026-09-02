import { describe, expect, it } from 'vitest'
import { defaultConfig, validateConfig, type SideSize } from '@/core'
import type { DisciplineKind } from './wizard-state'
import {
  STEPPERS,
  type Squad,
  addMySeat,
  buildDisciplines,
  configFor,
  configForPairSizeChange,
  configSideSize,
  disciplinesWarning,
  effectiveFloor,
  filledCount,
  formatErrors,
  moveSeat,
  newDisciplineSpec,
  newTournamentPayload,
  removeSeatAt,
  resizeConfig,
  squadWarning,
  steppersFor,
  submitSeats,
  summaryOf,
  toggleDiscipline,
} from './wizard-state'

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
 * W83 (verify-report-pre-contract, #4026), tercera vez de la familia
 * W69 → W76 → W83: con UNA sola disciplina marcada, tocar "Lados" tiene que
 * rehacer `config` a la curva de la disciplina que queda — exactamente lo
 * que `wizard.tsx` hacía antes de `fe44255` y dejó de hacer al cerrar W76.
 * Con dos o más marcadas, `config` se queda con la curva legado de a dos
 * (C29) sin que "Lados" la mueva, que es lo que #4017 arregló.
 */
describe('configForPairSizeChange (W83, #4026)', () => {
  it('con una sola disciplina, rehace la curva a la del sideSize elegido', () => {
    const config = configFor(8, 2) // curva de a dos, 4 valores
    const next = configForPairSizeChange(config, 8, ['FIFA'], 1)
    expect(next.points).toEqual([10, 7, 5, 3, 2, 1, 0, 0])
  })

  it('con dos o más disciplinas marcadas, deja `config` sin tocar -- #4017 sigue dueño de esa curva', () => {
    const config = configFor(8, 2)
    const next = configForPairSizeChange(config, 8, ['PADEL', 'FIFA'], 1)
    expect(next).toBe(config)
  })
})

/**
 * Corrección #4030 sobre W83: `sideSize` era OPCIONAL en `configFor` y
 * `resizeConfig` (lección #3994 -- un parámetro opcional es invisible para
 * el compilador Y para los tests, porque el default suele coincidir con el
 * caso feliz). `wizard.tsx` tenía TRES call sites que lo olvidaban -- el
 * estado inicial de `config`, `setSquad` (agrandar/achicar el plantel) y
 * "Usar los defaults" -- y sólo UNO de los tres (`changePairSize`, W83) se
 * había medido. `configSideSize` es la respuesta única a la pregunta que
 * los tres necesitan.
 */
describe('configSideSize (corrección #4030, lección #3994)', () => {
  it('con una sola disciplina, es SU pairSize', () => {
    expect(configSideSize(['FIFA'], { PADEL: 2, FIFA: 1 })).toBe(1)
  })

  it('con dos o más disciplinas, es la curva legado de a dos (C29)', () => {
    expect(configSideSize(['PADEL', 'FIFA'], { PADEL: 2, FIFA: 1 })).toBe(2)
  })

  it('sin ninguna marcada (arranque del wizard), es 2 -- el default de siempre', () => {
    expect(configSideSize([], { PADEL: 2, FIFA: 2 })).toBe(2)
  })
})

/**
 * Los call sites de `wizard.tsx:411` (`setSquad`) y `:681` ("Usar los
 * defaults") armados acá tal cual los arma la pantalla, con
 * `configSideSize` de por medio. El test tiene que DISTINGUIR: con la única
 * disciplina en "Individual", disparar ese camino tiene que dar la curva de
 * la decisión #3963 -- NO la de parejas, que es lo que daban antes de esta
 * corrección (`resizeConfig`/`configFor` sin tercer argumento caían en
 * `sideSize=2` en silencio).
 */
describe('los call sites de wizard.tsx que #4030 corrigió', () => {
  it('agrandar el plantel con la única disciplina en Individual sigue en la curva de #3963, no la de parejas (:411)', () => {
    // Estado de pantalla: FIFA marcado solo, "Individual" elegido -- config
    // ya en la forma de #3963 para 8 (lo que dejó `changePairSize`, W83).
    const config = configFor(8, 1)
    const picked = ['FIFA'] as const
    const pairSizes = { PADEL: 2, FIFA: 1 } as const

    // El admin agrega jugadores: el plantel pasa a 10. Exactamente lo que
    // `setSquad` hace en `wizard.tsx:411`.
    const next = resizeConfig(config, 10, configSideSize(picked, pairSizes))

    expect(next.points).toEqual(defaultConfig(10, 1).points)
    expect(next.points).not.toEqual(defaultConfig(10, 2).points)
  })

  it('"Usar los defaults" con la única disciplina en Individual da la curva de #3963, no la de parejas (:681)', () => {
    const picked = ['FIFA'] as const
    const pairSizes = { PADEL: 2, FIFA: 1 } as const

    // Exactamente lo que el botón hace en `wizard.tsx:681`.
    const next = configFor(8, configSideSize(picked, pairSizes))

    expect(next.points).toEqual(defaultConfig(8, 1).points)
    expect(next.points).not.toEqual(defaultConfig(8, 2).points)
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
    const rows = summaryOf('Los Jueves 2026', Array(8).fill('Jugador'), configFor(8, 2), ['PADEL'])
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
  })

  // PR20 rebanada D2: con FIFA marcado, "1 set a 4 games" describe la mitad
  // pádel del torneo y MIENTE sobre la otra mitad. Es la misma clase de copy
  // que ya costó W47, W51 y W56.
  it('nombra el formato de cada disciplina cuando hay más de una', () => {
    const rows = summaryOf('Los Jueves 2026', Array(8).fill('Jugador'), configFor(8, 2), [
      'PADEL',
      'FIFA',
    ])
    expect(rows[2]?.value).toBe('Pádel: 1 set a 4 games · FIFA: Marcador de goles')
  })

  it('y una liga de sólo FIFA no promete ningún set', () => {
    const rows = summaryOf('Liga FIFA', Array(8).fill('Jugador'), configFor(8, 2), ['FIFA'])
    expect(rows[2]?.value).toBe('Marcador de goles')
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
  // `pairSizes` es OBLIGATORIO acá (a diferencia de `buildDisciplines`): el
  // único caller (`Wizard`) siempre tiene uno por disciplina, `useState`
  // nace en `{ PADEL: 2, FIFA: 2 }`. Por eso el pádel de este test también lo
  // pasa explícito — la fila que sale lleva `pairSize: 2` en vez de omitir
  // la clave, y es exactamente lo mismo que escribe la base
  // (`addDiscipline`: `spec.pairSize ?? 2`).
  it('arma exactamente el payload que createTournament espera, para pádel', () => {
    const squad: Squad = { names: Array(8).fill('Jugador'), mySeat: 0 }
    const config = configFor(8, 2)
    expect(newTournamentPayload('Los Jueves', squad, config, ['PADEL'], { PADEL: 2, FIFA: 2 })).toEqual({
      name: 'Los Jueves',
      squadNames: squad.names,
      mySeatIndex: 0,
      config,
      disciplines: buildDisciplines(['PADEL'], config, 2),
    })
  })

  // El squadSize del payload sale del plantel REALMENTE cargado al momento
  // de mandar, no del que traía la config (que puede estar desactualizada si
  // el admin agregó/sacó nombres después de tocar el paso 4).
  it('el squadSize del payload sale del plantel cargado, no el que traía la config', () => {
    const squad: Squad = { names: [...Array(8).fill('Jugador'), '', ''], mySeat: null }
    const staleConfig = configFor(12, 2)
    const payload = newTournamentPayload('X', squad, staleConfig, ['PADEL'], { PADEL: 2, FIFA: 2 })
    expect(payload.squadNames).toHaveLength(8)
    expect(payload.config.squadSize).toBe(8)
  })

  // El punto de unión de la Rebanada F, en el payload REAL que cruza al
  // server action — no sólo hasta `buildDisciplines` suelto (#3957, se
  // pinchan los argumentos, no que la función interna acepte el parámetro).
  it('con pairSize=1, las disciplines del payload salen con la curva de la decisión #3963', () => {
    const squad: Squad = { names: Array(8).fill('Jugador'), mySeat: null }
    const config = configFor(8, 1)
    const payload = newTournamentPayload('Liga FIFA', squad, config, ['FIFA'], { PADEL: 2, FIFA: 1 })
    expect(payload.disciplines).toEqual([
      {
        kind: 'FIFA',
        config: { ...config, matchFormat: { ...config.matchFormat, openScore: true } },
        allowsDraw: true,
        pairSize: 1,
      },
    ])
  })

  /**
   * W76 (verify-report-pr21-cierre, #4016) + decisión #4017: "Lados" ya NO
   * es un solo control para todas las disciplinas marcadas — cada una trae
   * el suyo. Con Pádel Y FIFA marcados y SÓLO FIFA en "Individual", el
   * payload tiene que traer las DOS filas con su `pairSize` PROPIO — ni
   * las dos en 2 (el bug de W69/W76: "Individual" se ignoraba en silencio)
   * ni las dos en 1 (herencia cruzada, exactamente lo que W69 cerró y que
   * REQ-D2-1 prohíbe).
   *
   * Un test que sólo mirara UNA fila no probaría la ausencia de herencia
   * cruzada en ningún sentido — hace falta ver las DOS a la vez.
   */
  it('con Pádel Y FIFA marcados, cada uno trae SU pairSize -- sin herencia cruzada en ningún sentido (W76, #4017)', () => {
    const squad: Squad = { names: Array(8).fill('Jugador'), mySeat: null }
    const config = configFor(8, 2)
    const payload = newTournamentPayload('Mixto', squad, config, ['PADEL', 'FIFA'], { PADEL: 2, FIFA: 1 })

    expect(payload.disciplines).toHaveLength(2)
    const padel = payload.disciplines.find((row) => row.kind === 'PADEL')
    const fifa = payload.disciplines.find((row) => row.kind === 'FIFA')
    expect(padel?.pairSize).toBe(2)
    expect(fifa?.pairSize).toBe(1)
    // Cada uno con SU curva (#3963: 8 lados de a uno puntúan los primeros
    // seis; 8 jugadores en parejas son 4 lados, la curva de 4).
    expect(padel?.config.points).toEqual([10, 6, 3, 1])
    expect(fifa?.config.points).toEqual([10, 7, 5, 3, 2, 1, 0, 0])
  })

  /**
   * W83 (verify-report-pre-contract, #4026): el test de arriba ("con
   * pairSize=1, las disciplines... salen con la curva de #3963") entra con
   * `config = configFor(8, 1)` -- la curva de a uno YA armada -- así que no
   * puede distinguir "respetó lo que le pasaron" de "lo tiró y usó el
   * default": las dos dan el mismo resultado. Éste SÍ distingue: la curva
   * que llega acá está EDITADA a mano (valores que #3963 nunca produce), y
   * tiene que ser la que se guarda -- no el default.
   */
  it('con una sola disciplina, la curva EDITADA a mano es la que se guarda -- no el default de #3963 (W83)', () => {
    const squad: Squad = { names: Array(8).fill('Jugador'), mySeat: null }
    const edited = { ...configFor(8, 1), points: [20, 12, 6, 2, 0, 0, 0, 0] }
    const payload = newTournamentPayload('Liga FIFA', squad, edited, ['FIFA'], { PADEL: 2, FIFA: 1 })
    expect(payload.disciplines[0]?.config.points).toEqual([20, 12, 6, 2, 0, 0, 0, 0])
  })

  /**
   * El mismo distingo, con DOS disciplinas: la curva editada en pantalla es
   * SIEMPRE la legado de a dos (C29, W76/#4017) -- acá tiene que quedar en
   * PADEL (pairSize=2), tal cual se editó, y FIFA (pairSize=1) se queda con
   * el default de #3963, sin heredar la edición de PADEL ni perder la suya.
   */
  it('con dos disciplinas, la curva editada es SOLO para la de a dos -- FIFA de a uno sigue con el default de #3963', () => {
    const squad: Squad = { names: Array(8).fill('Jugador'), mySeat: null }
    const edited = { ...configFor(8, 2), points: [20, 12, 6, 2] }
    const payload = newTournamentPayload('Mixto', squad, edited, ['PADEL', 'FIFA'], { PADEL: 2, FIFA: 1 })
    const padel = payload.disciplines.find((row) => row.kind === 'PADEL')
    const fifa = payload.disciplines.find((row) => row.kind === 'FIFA')
    expect(padel?.config.points).toEqual([20, 12, 6, 2])
    expect(fifa?.config.points).toEqual([10, 7, 5, 3, 2, 1, 0, 0])
  })

  /**
   * El guard de forma (`soleCurveMatches`): si `config` quedó con la curva
   * legado de a dos (4 valores, por ejemplo porque el admin destildó una
   * segunda disciplina sin volver a tocar "Lados") y la única disciplina que
   * sobrevive es de a uno, el LARGO no coincide con lo que esa disciplina
   * necesita (8) -- confiar en `builtConfig` ahí guardaría un `points`
   * inválido. Tiene que caer al default seguro, igual que si nunca se
   * hubiera editado nada.
   */
  it('con una sola disciplina pero una curva de forma vieja (largo de a dos), usa el default -- no arriesga un largo inválido', () => {
    const squad: Squad = { names: Array(8).fill('Jugador'), mySeat: null }
    const stale = configFor(8, 2) // 4 valores, la forma de a dos
    const payload = newTournamentPayload('Liga FIFA', squad, stale, ['FIFA'], { PADEL: 2, FIFA: 1 })
    expect(payload.disciplines[0]?.config.points).toEqual([10, 7, 5, 3, 2, 1, 0, 0])
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
 * El criterio NO es el de Ajustes. Allá la config es de UNA disciplina y
 * alcanza con `openScore`; acá es de la TEMPORADA y la comparten todas las
 * marcadas, así que los steppers se van sólo cuando NINGUNA usa sets.
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

// ── W88 y W90: la CUARTA y la QUINTA puerta de la familia W69 → W76 → W83 ───
//
// Las dos son el mismo defecto de raíz, medido por `verify-report-go-no-go`
// (#4034): `config` es UNA curva compartida por el paso 4 (C29), y su
// `sideSize` efectivo lo contesta `configSideSize(picked, pairSizes)` — pero
// `formatErrors` nunca miró ese número. Validaba los VALORES de `points`
// (`pointsErrors`) y no su CANTIDAD, que es lo único que cambia cuando el
// admin toca las disciplinas marcadas.
//
// `onToggle` (`wizard.tsx:519`) no rehace `config` a propósito: con 2+
// disciplinas no debe (C29/W76). Lo que faltaba no era rehacerla, era AVISAR
// cuando dejó de corresponder — y "Usar los defaults" (`wizard.tsx:698`) ya
// era la salida, sólo que nada le decía al admin que la necesitaba.
describe('formatErrors mira el sideSize efectivo (W88, W90)', () => {
  // W88, textual del informe: la pantalla mostraba [20,12,6,2] y la base
  // guardaba [10,7,5,3,2,1,0,0]. Las ediciones del admin se descartaban SIN
  // UN AVISO, que es exactamente la pregunta con la que se decidió #4017.
  it('W88 · destildar hasta UNA sola disciplina de a uno deja de pasar en silencio', () => {
    // Paso 1: Pádel + FIFA, FIFA en "Individual" -> config es la curva legado
    // de a dos, 4 filas (C29: con 2+ marcadas nadie la mueve).
    const pairSizes = { PADEL: 2 as SideSize, FIFA: 1 as SideSize }
    const editada = { ...configFor(8, 2), points: [20, 12, 6, 2] }

    // Paso 3: destilda Pádel. Queda sólo FIFA, de a uno: 8 lados, 8 valores.
    const picked: DisciplineKind[] = ['FIFA']
    const sideSize = configSideSize(picked, pairSizes)
    expect(sideSize).toBe(1)

    // El paso 4 tiene que decir que esa curva ya no corresponde, con el MISMO
    // mensaje que `validateConfig` — no uno propio que pueda divergir.
    expect(formatErrors(editada, sideSize)).toEqual(
      validateConfig(editada, sideSize).filter((error) => error.includes('valores de puntos')),
    )
    expect(formatErrors(editada, sideSize)).toContain(
      'Con un plantel de 8 hacen falta 8 valores de puntos, no 4.',
    )
  })

  // W90, textual del informe: dejar SÓLO FIFA en "Individual" (config pasa a 8
  // filas) y volver a tildar Pádel. `configForPairSizeChange` es no-op con 2+
  // marcadas (C29), así que tocar "Lados" de nuevo NO lo saca — y el submit
  // moría en el último paso con un mensaje que no nombra la disciplina.
  it('W90 · volver a tildar la segunda disciplina se avisa en el paso 4, no en el submit', () => {
    const pairSizes = { PADEL: 2 as SideSize, FIFA: 1 as SideSize }
    // Sólo FIFA de a uno: `configForPairSizeChange` SÍ rehace -> 8 filas.
    const config = configForPairSizeChange(configFor(8, 2), 8, ['FIFA'], 1)
    expect(config.points).toHaveLength(8)

    // Se vuelve a tildar Pádel: dos marcadas, la curva compartida vuelve a
    // ser la de a dos (4 filas) y las 8 que quedaron ya no corresponden.
    const picked: DisciplineKind[] = ['FIFA', 'PADEL']
    expect(configForPairSizeChange(config, 8, picked, 1)).toEqual(config) // sigue siendo no-op (C29)
    const sideSize = configSideSize(picked, pairSizes)
    expect(sideSize).toBe(2)

    expect(formatErrors(config, sideSize)).toContain(
      'Con un plantel de 8 hacen falta 4 valores de puntos, no 8.',
    )

    // Y es el MISMO error con el que moría el submit: `createSeason` corre
    // `assertValidConfig(config, 2)` sobre esa curva.
    expect(validateConfig(config, 2)).toContain(
      'Con un plantel de 8 hacen falta 4 valores de puntos, no 8.',
    )
  })

  // PIN de no-regresión: el caso de siempre —una curva que SÍ corresponde—
  // sigue sin errores. Es el 100% de los torneos que existen hoy.
  it('no inventa un error cuando la curva corresponde', () => {
    expect(formatErrors(configFor(8, 2), 2)).toEqual([])
    expect(formatErrors(configFor(8, 1), 1)).toEqual([])
    expect(formatErrors(configFor(12, 2), 2)).toEqual([])
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
