import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import type { CasualMatch, SharedMatch, TournamentMatch } from '@/db/friends'
import { matchdayDay } from '@/app/format'
import { Historial, mesDe, resumenDe } from './historial'

// `SharedMatch` trae el detalle completo desde Task 2: fecha, torneo y
// marcador. Un fixture acá completa TODOS los campos, como cualquier caller
// real -- no hay forma corta que esconda un campo que la pantalla necesita.
// `overrides` tipado sobre `TournamentMatch` (no `SharedMatch`): este helper
// sólo arma partidos de torneo, y `Partial<union>` no angosta `kind`: lo
// ensancha a `'tournament' | 'casual'` en el objeto final, rompiendo la
// asignación a `SharedMatch`.
// `sport: 'PADEL'` por default -- el ejemplo de diseño §4.4 es justo este
// partido ("14/8 · Pádel · torneo Los Jueves · ganaron 6-3"), así que el
// fixture de siempre ya es el caso que la fila tiene que dibujar.
function partido(overrides: Partial<TournamentMatch> = {}): SharedMatch {
  return {
    kind: 'tournament',
    matchId: '1',
    matchdayId: 'f1',
    together: false,
    playedOn: '2026-08-14',
    matchdayNumber: 1,
    sport: 'PADEL',
    seasonName: 'Los Jueves',
    outcome: 'won',
    score: { mine: 6, theirs: 3 },
    ...overrides,
  }
}

// El ejemplo de FIFA de diseño §4.4/§4.3: deporte, marcador, un equipo propio
// y autoría (§3.2) puestos por default, para que cada test sólo pise el campo
// que le importa a esa fila.
function partidoCasual(overrides: Partial<CasualMatch> = {}): SharedMatch {
  return {
    kind: 'casual',
    matchId: 'c1',
    playedOn: '2026-08-23',
    sport: 'FIFA',
    together: false,
    partners: [],
    rivals: [],
    sets: null,
    outcome: 'lost',
    score: { mine: 2, theirs: 1 },
    teams: { mine: 'Boca', theirs: null },
    createdBy: 'Fede',
    updatedBy: 'Fede',
    // Mismo id por default -- "cargó y editó la misma persona" (Fede) es el
    // caso de siempre. Los tests de autoría por id pisan esto explícitamente.
    createdById: 'fede-id',
    updatedById: 'fede-id',
    ...overrides,
  }
}

// Texto EXACTO de cada <p> de la tarjeta, en orden (las etiquetas de adentro,
// como la pastilla del deporte o la de cada set, se sacan): una línea de más o
// un reordenamiento rompe la comparación (un `toContain` los dejaría pasar).
// Orden de la tarjeta: fecha+deporte, titular (lado + quiénes), equipo (FIFA,
// si hay), autoría, marcador, leyenda del resultado.
const lineas = (p: SharedMatch): string[] =>
  [
    ...renderToStaticMarkup(Historial({ nombre: 'Juan', friendPlayerId: 'amigo-1', partidos: [p] })).matchAll(
      /<p [^>]*>(.*?)<\/p>/g,
    ),
  ].map((m) => (m[1] ?? '').replace(/<[^>]+>/g, ''))

describe('Historial', () => {
  // -- Torneo: "deporte-en-la-fila" (cierre de 2b) le agrega el deporte a la
  // fila -- antes de esto, la torneo era la única fila del historial que no
  // decía qué se jugó (§4.4: la casual sí lo decía desde Task 3). --

  it('no dibuja el título: el encabezado del amigo vive en la página', () => {
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', friendPlayerId: 'amigo-1', partidos: [] }))
    expect(html).not.toContain('<h1')
  })

  it('lista cada partido con su fecha, su deporte, su torneo y su marcador', () => {
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', friendPlayerId: 'amigo-1', partidos: [partido()] }))
    expect(html).toContain(matchdayDay('2026-08-14'))
    // Forma exacta del ejemplo de diseño (§4.4): fecha, deporte (label, no el
    // kind crudo) y torneo en la misma línea -- una fila de cada clase deja
    // de ser la única que se distingue por CALLAR el deporte.
    expect(lineas(partido())[0]).toBe(`${matchdayDay('2026-08-14')} Pádel torneo Los Jueves`)
    // El marcador COMO LO LEE una persona -- "6-3", no un dígito suelto que
    // matchea cualquier cosa (hasta un `text-[13.5px]` tiene un "3").
    expect(html).toContain('6-3')
  })

  it('respeta el orden en que le llegan los partidos -- no vuelve a ordenar', () => {
    // `historyWith` (`db/friends.ts`) ya entrega los partidos en orden de
    // fecha descendente; el componente sólo dibuja. Este fixture llega al
    // revés de "el más reciente primero" (viejo antes que nuevo) a propósito:
    // si el componente todavía ordenara acá, 'Nuevo' terminaría arriba.
    const viejo = partido({ matchId: 'v', playedOn: '2026-08-01', seasonName: 'Viejo' })
    const nuevo = partido({ matchId: 'n', playedOn: '2026-08-20', seasonName: 'Nuevo' })
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', friendPlayerId: 'amigo-1', partidos: [viejo, nuevo] }))
    expect(html.indexOf('Viejo')).toBeLessThan(html.indexOf('Nuevo'))
  })

  it('una fecha de torneo sin jugar muestra el número de fecha, no una inventada', () => {
    // Sin `playedOn` no hay fecha real que mostrar -- la fila dice el número
    // de fecha en vez de inventar un día. El desempate por `matchdayNumber`
    // que esto probaba en 2a se fue con el sort: ahora vive sólo en
    // `porFechaDescendente` (`db/friends.ts`), y ahí no aplica entre dos
    // fechas de torneo sin jugar todavía -- no hay nada que comparar acá.
    const numeroBajo = partido({ matchId: 'b', playedOn: null, matchdayNumber: 1, seasonName: 'Bajo' })
    const numeroAlto = partido({ matchId: 'a', playedOn: null, matchdayNumber: 5, seasonName: 'Alto' })
    const html = renderToStaticMarkup(
      Historial({ nombre: 'Juan', friendPlayerId: 'amigo-1', partidos: [numeroBajo, numeroAlto] }),
    )
    expect(html).toContain('Fecha 5')
    expect(html).toContain('Fecha 1')
  })

  it('preserva el orden aun mezclando una fecha jugada con una sin jugar', () => {
    // Antes, una fecha sin jugar quedaba siempre última sin importar el orden
    // de llegada -- lo hacía el sort del componente. Acá se le pasa PRIMERO
    // la que no tiene fecha: si algo todavía reordenara, este test lo agarra.
    const sinJugar = partido({ matchId: 's', playedOn: null, matchdayNumber: 99, seasonName: 'SinFecha' })
    const jugada = partido({ matchId: 'j', playedOn: '2026-01-01', seasonName: 'ConFecha' })
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', friendPlayerId: 'amigo-1', partidos: [sinJugar, jugada] }))
    expect(html.indexOf('SinFecha')).toBeLessThan(html.indexOf('ConFecha'))
  })

  it('dice si jugaron juntos, en cada fila', () => {
    const juntos = partido({ together: true })
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', friendPlayerId: 'amigo-1', partidos: [juntos] }))
    expect(html).toContain('Juntos')
    // De compañeros el resultado es el de LA PAREJA: "ganaron", no "ganaste".
    expect(lineas(juntos).slice(1)).toEqual(['Juntos', '6-3', 'Ganaron'])
  })

  it('dice si se enfrentaron, en cada fila, con el resultado en primera persona', () => {
    const enContra = partido({ together: false, outcome: 'lost', score: { mine: 3, theirs: 6 } })
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', friendPlayerId: 'amigo-1', partidos: [enContra] }))
    expect(html).toContain('En contra')
    expect(lineas(enContra).slice(1)).toEqual(['En contra', '3-6', 'Perdiste'])
  })

  it('un empate de compañeros dice "empataron" -- el resultado de la pareja', () => {
    const empateJuntos = partido({ together: true, outcome: 'drew', score: { mine: 2, theirs: 2 } })
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', friendPlayerId: 'amigo-1', partidos: [empateJuntos] }))
    expect(lineas(empateJuntos).slice(1)).toEqual(['Juntos', '2-2', 'Empataron'])
  })

  it('un empate enfrentados dice "empataste" -- en primera persona, no el verbo de la pareja', () => {
    // Migración 0034 (`match_sets_no_draw` condicionado por `allows_draw`):
    // un empate es un resultado real y guardable, no un caso hipotético.
    const empateContra = partido({ together: false, outcome: 'drew', score: { mine: 2, theirs: 2 } })
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', friendPlayerId: 'amigo-1', partidos: [empateContra] }))
    expect(lineas(empateContra).slice(1)).toEqual(['En contra', '2-2', 'Empataste'])
  })

  it('un partido de torneo sin resultado no inventa uno', () => {
    const sinJugar = partido({ outcome: null, score: null })
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', friendPlayerId: 'amigo-1', partidos: [sinJugar] }))
    expect(html).not.toContain('Ganaste')
    expect(html).not.toContain('Perdiste')
    expect(html).not.toContain('Ganaron')
    expect(html).not.toContain('Perdieron')
    expect(lineas(sinJugar).slice(1)).toEqual(['En contra', '–', 'Sin resultado'])
  })

  it('con un amigo sin partidos dice qué falta, no una tabla vacía', () => {
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', friendPlayerId: 'amigo-1', partidos: [] }))
    expect(html).toContain('Todavía no jugaron')
  })

  it('no suma nada a un contador -- no queda "Juntos N" ni "En contra M"', () => {
    // Regresión directa de lo que reemplaza: la vieja pantalla mostraba
    // "Juntos 3 · En contra 12". Un conteo con número al lado de la palabra
    // sería volver a eso disfrazado.
    const html = renderToStaticMarkup(
      Historial({
        nombre: 'Juan',
        friendPlayerId: 'amigo-1',
        partidos: [
          partido({ matchId: '1', together: true }),
          partido({ matchId: '2', together: true }),
          partido({ matchId: '3', together: false }),
        ],
      }),
    )
    expect(html).not.toMatch(/Juntos\s*\d/)
    expect(html).not.toMatch(/En contra\s*\d/)
  })

  // -- Casual: Task 3. --

  it('una fila de cada clase en la misma lista -- cada una con lo suyo', () => {
    const html = renderToStaticMarkup(
      Historial({ nombre: 'Juan', friendPlayerId: 'amigo-1', partidos: [partido(), partidoCasual()] }),
    )
    // Lo del torneo -- "Pádel" también, desde "deporte-en-la-fila": las dos
    // filas dicen su deporte ahora, no sólo la casual.
    expect(html).toContain('Pádel')
    expect(html).toContain('Los Jueves')
    expect(html).toContain('6-3')
    // Lo del casual -- deporte, marcador, equipo y autoría: ninguno lo tiene
    // la fila de torneo, así que si aparece es porque la casual se dibujó de
    // verdad y no quedó afuera del `.filter(esDeTorneo)` que esta tarea saca.
    expect(html).toContain('FIFA')
    expect(html).toContain('2-1')
    expect(html).toContain('Perdiste')
    expect(html).toContain('con Boca')
    expect(html).toContain('Cargó Fede')
  })

  it('el orden entre las dos clases: un casual del 23/8 va arriba de un torneo del 14/8', () => {
    const casual = partidoCasual({ playedOn: '2026-08-23' })
    const torneo = partido({ playedOn: '2026-08-14' })
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', friendPlayerId: 'amigo-1', partidos: [casual, torneo] }))
    // Las dos tienen que estar de verdad -- si una faltara, `indexOf` daría
    // -1 y "menor que" pasaría solo, sin haber probado nada sobre el orden.
    expect(html).toContain('FIFA')
    expect(html).toContain('Los Jueves')
    expect(html.indexOf('FIFA')).toBeLessThan(html.indexOf('Los Jueves'))
  })

  it('la fila casual sin marcador no inventa uno', () => {
    const sinMarcador = partidoCasual({ score: null, teams: { mine: null, theirs: null } })
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', friendPlayerId: 'amigo-1', partidos: [sinMarcador] }))
    expect(html).toContain('Perdiste')
    expect(html).toContain('>–</p>')
    expect(html).not.toContain('con Boca')
  })

  it('la fila casual editada por el otro muestra SU nombre en la autoría', () => {
    // §3.2: para que dos amigos puedan discutir un resultado tienen que poder
    // ver que alguien lo cambió. `editó Juan` sólo puede salir de la línea de
    // autoría -- el encabezado también dice "Juan", pero nunca precedido de
    // "editó ", así que esta aserción no puede pasar por casualidad.
    const editadoPorOtro = partidoCasual({
      createdBy: 'Fede',
      updatedBy: 'Juan',
      createdById: 'fede-id',
      updatedById: 'juan-id',
    })
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', friendPlayerId: 'amigo-1', partidos: [editadoPorOtro] }))
    expect(html).toContain('Cargó Fede')
    expect(html).toContain('editó Juan')
  })

  it('cuando cargó y editó la misma persona, lo dice una sola vez', () => {
    const mismaPersona = partidoCasual({
      createdBy: 'Fede',
      updatedBy: 'Fede',
      createdById: 'fede-id',
      updatedById: 'fede-id',
    })
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', friendPlayerId: 'amigo-1', partidos: [mismaPersona] }))
    expect(html).toContain('Cargó Fede')
    expect(html).not.toContain('editó')
  })

  it('dos amigos DISTINTOS con el mismo display_name no colapsan la autoría -- review final, Important 2', () => {
    // `players.display_name` es texto libre, sin `unique` (0001_schema.sql):
    // nada impide que "Fede" (quien cargó) y otro "Fede" (quien editó) sean
    // dos cuentas distintas. Comparar por NOMBRE (`createdBy === updatedBy`)
    // los confundía con "cargó y editó la misma persona" -- exactamente el
    // caso que §3.2 existe para avisar. Los ids son distintos acá aunque los
    // dos nombres sean "Fede": si `autoriaDe` volviera a comparar nombres,
    // este test es el único que lo nota.
    const mismoNombreDistintoId = partidoCasual({
      createdBy: 'Fede',
      updatedBy: 'Fede',
      createdById: 'fede-uno',
      updatedById: 'fede-dos',
    })
    const html = renderToStaticMarkup(
      Historial({ nombre: 'Juan', friendPlayerId: 'amigo-1', partidos: [mismoNombreDistintoId] }),
    )
    expect(html).toContain('Cargó Fede')
    expect(html).toContain('editó Fede')
  })

  it('un empate con ganador se dibuja como el hecho, nunca "por penales"', () => {
    // §4.3: un marcador empatado no dice quién ganó -- en FIFA puede resolverse
    // por penales, pero la app no sabe que "FIFA" es fútbol y no lo etiqueta.
    // Acá Juan (el amigo de esta pantalla) gana un partido que en el marcador
    // quedó 2-2.
    const empateConGanador = partidoCasual({ outcome: 'lost', score: { mine: 2, theirs: 2 } })
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', friendPlayerId: 'amigo-1', partidos: [empateConGanador] }))
    expect(html).toContain('2-2')
    expect(html).toContain('Ganó Juan')
    expect(html).not.toContain('penales')
  })
  // -- Casual con lados (plan amigos-deporte-y-2v2, Task 3). --
  // Texto EXACTO de cada <p> de la fila: una línea de más o un reordenamiento
  // rompe la comparación (un `toContain` los dejaría pasar).

  it('2v2 juntos con invitado: fecha y deporte, resultado, nombres, autoría', () => {
    expect(
      lineas(
        partidoCasual({
          together: true,
          outcome: 'won',
          score: { mine: 4, theirs: 2 },
          teams: { mine: null, theirs: null },
          partners: ['Juan'],
          rivals: ['Ana', 'Beto'],
        }),
      ),
    ).toEqual([
      `${matchdayDay('2026-08-23')} FIFA`,
      // Juan es el amigo de la pantalla: ya está en el encabezado, no se repite.
      'Juntos vs Ana, Beto',
      'Cargó Fede',
      '4-2',
      'Ganaron',
    ])
  })

  it('1v1 en contra FIFA con marcador empatado nombra al ganador y omite "con"', () => {
    expect(lineas(partidoCasual({ outcome: 'won', score: { mine: 2, theirs: 2 }, rivals: ['Juan'] }))).toEqual([
      `${matchdayDay('2026-08-23')} FIFA`,
      'En contra',
      'con Boca',
      'Cargó Fede',
      '2-2',
      'Ganaste',
    ])
  })

  it('2v2 en contra con marcador empatado y el otro lado ganando nombra a los dos rivales', () => {
    const l = lineas(
      partidoCasual({
        outcome: 'lost',
        score: { mine: 2, theirs: 2 },
        teams: { mine: null, theirs: null },
        partners: ['Cami'],
        rivals: ['Juan', 'Beto'],
      }),
    )
    expect(l.slice(1)).toEqual(['En contra con Cami · su pareja Beto', 'Cargó Fede', '2-2', 'Ganaron Juan, Beto'])
  })

  it('together + marcador empatado + perdieron: "Perdieron", sin "Ganó"', () => {
    const l = lineas(
      partidoCasual({
        together: true,
        outcome: 'lost',
        score: { mine: 2, theirs: 2 },
        teams: { mine: null, theirs: null },
        partners: ['Juan'],
        rivals: ['Ana', 'Beto'],
      }),
    )
    expect(l.slice(-2)).toEqual(['2-2', 'Perdieron'])
    expect(l.join('|')).not.toContain('Ganó')
  })

  it('el amigo se saca una sola vez: un invitado homónimo del otro lado sigue apareciendo', () => {
    const l = lineas(partidoCasual({ partners: ['Cami'], rivals: ['Juan', 'Juan'], teams: { mine: null, theirs: null } }))
    expect(l[1]).toBe('En contra con Cami · su pareja Juan')
  })

  it('2v2 en contra sin pareja tuya cargada nombra sólo la suya', () => {
    const l = lineas(partidoCasual({ partners: [], rivals: ['Juan', 'Nico'], teams: { mine: null, theirs: null } }))
    expect(l[1]).toBe('En contra su pareja Nico')
  })

  it('PADEL muestra el deporte y los sets en mi orientación', () => {
    expect(
      lineas(
        partidoCasual({
          sport: 'PADEL',
          outcome: 'won',
          score: null,
          teams: { mine: null, theirs: null },
          sets: [
            { mine: 6, theirs: 3 },
            { mine: 4, theirs: 6 },
            { mine: 6, theirs: 5 },
          ],
          rivals: ['Juan'],
        }),
      ),
    ).toEqual([`${matchdayDay('2026-08-23')} Pádel`, 'En contra', 'Cargó Fede', '6-3 4-6 6-5', 'Ganaste'])
  })

  it('la fila de torneo tiene la misma forma, sin nombres ni autoría', () => {
    expect(lineas(partido())).toEqual([
      `${matchdayDay('2026-08-14')} Pádel torneo Los Jueves`,
      'En contra',
      '6-3',
      'Ganaste',
    ])
  })
})

describe('resumenDe', () => {
  it('cuenta el cara a cara de la misma lista: juntos de la pareja, en contra el tuyo', () => {
    const resumen = resumenDe([
      partido({ matchId: '1', together: true, outcome: 'won' }),
      partido({ matchId: '2', together: true, outcome: 'lost' }),
      partido({ matchId: '3', together: false, outcome: 'won' }),
      partidoCasual({ matchId: '4', together: false, outcome: 'drew' }),
      partidoCasual({ matchId: '5', together: false, outcome: 'lost' }),
    ])
    expect(resumen).toEqual({
      total: 5,
      juntos: { won: 1, lost: 1, drew: 0 },
      enContra: { won: 1, lost: 1, drew: 1 },
    })
  })

  it('un partido de torneo sin resultado suma al total pero no a ningún lado', () => {
    expect(resumenDe([partido({ outcome: null, score: null })])).toEqual({
      total: 1,
      juntos: { won: 0, lost: 0, drew: 0 },
      enContra: { won: 0, lost: 0, drew: 0 },
    })
  })

  it('sin partidos, todo en cero', () => {
    expect(resumenDe([]).total).toBe(0)
  })
})

describe('mesDe', () => {
  it('nombra el mes y el año sin pasar por Date (sin corrimiento de huso)', () => {
    expect(mesDe('2026-10-01')).toBe('Octubre 2026')
    expect(mesDe('2026-01-31')).toBe('Enero 2026')
  })

  it('una fecha de torneo sin jugar no inventa un mes', () => {
    expect(mesDe(null)).toBe('Sin fecha')
  })

  it('agrupa por mes sin reordenar: dos meses, dos separadores, en el orden que llegan', () => {
    const html = renderToStaticMarkup(
      Historial({
        nombre: 'Juan',
        friendPlayerId: 'amigo-1',
        partidos: [
          partidoCasual({ matchId: 'a', playedOn: '2026-10-11' }),
          partidoCasual({ matchId: 'b', playedOn: '2026-10-04' }),
          partido({ matchId: 'c', playedOn: '2026-09-18' }),
        ],
      }),
    )
    expect(html.match(/<h3/g)).toHaveLength(2)
    expect(html.indexOf('Octubre 2026')).toBeLessThan(html.indexOf('Septiembre 2026'))
  })
})
