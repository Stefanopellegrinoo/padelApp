import { describe, expect, it } from 'vitest'
import { defaultConfig, validateConfig } from '@/core'
import {
  STEPPERS,
  type Squad,
  addMySeat,
  buildDisciplines,
  configFor,
  disciplinesWarning,
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

describe('squadWarning', () => {
  it('asks for the missing name when the squad is short', () => {
    const names = [...Array(7).fill('Jugador'), '']
    expect(squadWarning(names)).toBe('Falta 1 nombre. El plantel arranca en 8.')
  })

  it('counts how many are missing when it is more than one', () => {
    const names = [...Array(6).fill('Jugador'), '', '']
    expect(squadWarning(names)).toBe('Faltan 2 nombres. El plantel arranca en 8.')
  })

  it('refuses an odd squad, because pairs need an even number', () => {
    expect(squadWarning(Array(9).fill('Jugador'))).toBe(
      'Son 9. El plantel tiene que ser par para poder armar parejas.',
    )
  })

  it('says nothing for a squad that can go on', () => {
    expect(squadWarning(Array(8).fill('Jugador'))).toBeNull()
    expect(squadWarning(Array(10).fill('Jugador'))).toBeNull()
    expect(squadWarning(Array(12).fill('Jugador'))).toBeNull()
  })

  it('ignores whitespace when counting', () => {
    expect(filledCount(['Marce', '   ', 'Nico'])).toBe(2)
  })
})

describe('the config the wizard builds', () => {
  // Con 12 hacen falta 6 valores de puntos: si al cambiar el plantel la lista
  // no se rehace, la temporada nace inválida y createSeason la rebota.
  it('rebuilds the points list when the squad changes size', () => {
    const eight = configFor(8)
    expect(eight.points).toHaveLength(4)

    const twelve = resizeConfig(eight, 12)
    expect(twelve.points).toHaveLength(6)
    expect(twelve.squadSize).toBe(12)
  })

  it('leaves the config alone when the size did not change', () => {
    const config = { ...configFor(8), points: [20, 10, 5, 1] }
    expect(resizeConfig(config, 8)).toBe(config)
  })

  it('gives back exactly defaultConfig for every squad size', () => {
    for (const size of [8, 10, 12]) {
      expect(configFor(size)).toEqual(defaultConfig(size))
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
      expect(validateConfig(configFor(size), 2)).toEqual([])
      expect(formatErrors(configFor(size))).toEqual([])
    }
  })
})

describe('formatErrors', () => {
  it('catches points that do not go down', () => {
    const config = { ...configFor(8), points: [10, 10, 5, 3] }
    expect(formatErrors(config)).toEqual([
      'Los puntos tienen que ir de mayor a menor. El único que se puede repetir es el 0.',
    ])
  })

  // Lo que el usuario quiere poder escribir: que sólo puntúen los primeros.
  it('accepts a tail of zeros, so only the first places score', () => {
    expect(formatErrors({ ...configFor(12), points: [10, 6, 3, 1, 0, 0] })).toEqual([])
  })

  // Este test decía lo contrario y era el que quedaba de la regla vieja. El 0
  // pasó a ser legal en `141bbcf` —hay grupos que quieren que el último no
  // sume— y el stepper baja hasta 0 desde entonces, pero ESTA pantalla siguió
  // trabando el "Continuar". Se podía elegir un 0 y no se podía avanzar.
  it('accepts a zero as the last value, which the stepper can reach', () => {
    const config = { ...configFor(8), points: [10, 6, 3, 0] }
    expect(formatErrors(config)).toEqual([])
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
      const config = { ...configFor(8), points }
      const coreRejects = validateConfig(config, 2).length > 0
      const wizardRejects = formatErrors(config).length > 0
      expect(wizardRejects, `puntos ${points.join('·')}`).toBe(coreRejects)
    }
  })

  it('catches counting more matchdays than the season has', () => {
    const config = { ...configFor(8), regularMatchdays: 10, countBestOf: 12 }
    expect(formatErrors(config)).toEqual(['No pueden contar más fechas de las que se juegan.'])
  })

  it('reports both problems at once', () => {
    const config = { ...configFor(8), points: [1, 2, 3, 4], regularMatchdays: 4, countBestOf: 9 }
    expect(formatErrors(config)).toHaveLength(2)
  })
})

describe('summaryOf', () => {
  it('lists the six rows of the handoff, in order', () => {
    const rows = summaryOf('Los Jueves 2026', Array(8).fill('Jugador'), configFor(8), ['PADEL'])
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
  //Que ya costó W47, W51 y W56.
  it('nombra el formato de cada disciplina cuando hay más de una', () => {
    const rows = summaryOf('Los Jueves 2026', Array(8).fill('Jugador'), configFor(8), [
      'PADEL',
      'FIFA',
    ])
    expect(rows[2]?.value).toBe('Pádel: 1 set a 4 games · FIFA: Marcador de goles')
  })

  it('y una liga de sólo FIFA no promete ningún set', () => {
    const rows = summaryOf('Liga FIFA', Array(8).fill('Jugador'), configFor(8), ['FIFA'])
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

  //El orden de toque ES el contrato (11b/PR10): se vuelve `position` y de ahí
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
    const config = configFor(8)
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
    const config = configFor(8)
    expect(buildDisciplines(['PADEL'], config)).toEqual([
      { kind: 'PADEL', config, allowsDraw: false },
    ])
  })

  //El contrato de 11b/PR10: el orden de este array ES el orden de creación,
  // que se vuelve `position` (createSeason lo escribe explícito) y de ahí el
  // ordinal del slug (padel/padel-2). Tocar FIFA antes que Pádel tiene que dar
  // FIFA primero, no importa el orden en que aparecen los checkboxes en pantalla.
  it('keeps the order the user picked, not DISCIPLINE_KINDS order', () => {
    const config = configFor(8)
    expect(buildDisciplines(['FIFA', 'PADEL'], config).map((row) => row.kind)).toEqual([
      'FIFA',
      'PADEL',
    ])
  })

  it('gives back nothing for an empty pick', () => {
    expect(buildDisciplines([], configFor(8))).toEqual([])
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
    const config = configFor(8)
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
    const staleConfig = configFor(12)
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
    const config = configFor(8)
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
  const PADEL = configFor(8).matchFormat
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
