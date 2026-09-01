import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import type { CasualMatch, SharedMatch, TournamentMatch } from '@/db/friends'
import { matchdayDay } from '@/app/format'
import { Historial } from './historial'

// `SharedMatch` trae el detalle completo desde Task 2: fecha, torneo y
// marcador. Un fixture acá completa TODOS los campos, como cualquier caller
// real -- no hay forma corta que esconda un campo que la pantalla necesita.
// `overrides` tipado sobre `TournamentMatch` (no `SharedMatch`): este helper
// sólo arma partidos de torneo, y `Partial<union>` no angosta `kind`: lo
// ensancha a `'tournament' | 'casual'` en el objeto final, rompiendo la
// asignación a `SharedMatch`.
function partido(overrides: Partial<TournamentMatch> = {}): SharedMatch {
  return {
    kind: 'tournament',
    matchId: '1',
    matchdayId: 'f1',
    together: false,
    playedOn: '2026-08-14',
    matchdayNumber: 1,
    matchdayKind: 'REGULAR',
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
    outcome: 'lost',
    score: { mine: 2, theirs: 1 },
    teams: { mine: 'Boca', theirs: null },
    createdBy: 'Fede',
    updatedBy: 'Fede',
    ...overrides,
  }
}

describe('Historial', () => {
  // -- Torneo: sin cambios (Task 3, criterio 6: "la fila de torneo no cambió"). --

  it('lista cada partido con su fecha, su torneo y su marcador', () => {
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', partidos: [partido()] }))
    expect(html).toContain(matchdayDay('2026-08-14'))
    expect(html).toContain('Los Jueves')
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
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', partidos: [viejo, nuevo] }))
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
      Historial({ nombre: 'Juan', partidos: [numeroBajo, numeroAlto] }),
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
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', partidos: [sinJugar, jugada] }))
    expect(html.indexOf('SinFecha')).toBeLessThan(html.indexOf('ConFecha'))
  })

  it('dice si jugaron juntos, en cada fila', () => {
    const juntos = partido({ together: true })
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', partidos: [juntos] }))
    expect(html).toContain('Juntos')
    // De compañeros el resultado es el de LA PAREJA: "ganaron", no "ganaste".
    expect(html).toContain('Ganaron 6-3')
  })

  it('dice si se enfrentaron, en cada fila, con el resultado en primera persona', () => {
    const enContra = partido({ together: false, outcome: 'lost', score: { mine: 3, theirs: 6 } })
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', partidos: [enContra] }))
    expect(html).toContain('En contra')
    expect(html).toContain('Perdiste 3-6')
  })

  it('un empate de compañeros dice "empataron" -- el resultado de la pareja', () => {
    const empateJuntos = partido({ together: true, outcome: 'drew', score: { mine: 2, theirs: 2 } })
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', partidos: [empateJuntos] }))
    expect(html).toContain('Juntos: Empataron 2-2')
  })

  it('un empate enfrentados dice "empataste" -- en primera persona, no el verbo de la pareja', () => {
    // Migración 0034 (`match_sets_no_draw` condicionado por `allows_draw`):
    // un empate es un resultado real y guardable, no un caso hipotético.
    const empateContra = partido({ together: false, outcome: 'drew', score: { mine: 2, theirs: 2 } })
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', partidos: [empateContra] }))
    expect(html).toContain('En contra: Empataste 2-2')
  })

  it('un partido de torneo sin resultado no inventa uno', () => {
    const sinJugar = partido({ outcome: null, score: null })
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', partidos: [sinJugar] }))
    expect(html).not.toContain('Ganaste')
    expect(html).not.toContain('Perdiste')
    expect(html).not.toContain('Ganaron')
    expect(html).not.toContain('Perdieron')
  })

  it('con un amigo sin partidos dice qué falta, no una tabla vacía', () => {
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', partidos: [] }))
    expect(html).toContain('Todavía no jugaron')
  })

  it('no suma nada a un contador -- no queda "Juntos N" ni "En contra M"', () => {
    // Regresión directa de lo que reemplaza: la vieja pantalla mostraba
    // "Juntos 3 · En contra 12". Un conteo con número al lado de la palabra
    // sería volver a eso disfrazado.
    const html = renderToStaticMarkup(
      Historial({
        nombre: 'Juan',
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
      Historial({ nombre: 'Juan', partidos: [partido(), partidoCasual()] }),
    )
    // Lo del torneo.
    expect(html).toContain('Los Jueves')
    expect(html).toContain('6-3')
    // Lo del casual -- deporte, marcador, equipo y autoría: ninguno lo tiene
    // la fila de torneo, así que si aparece es porque la casual se dibujó de
    // verdad y no quedó afuera del `.filter(esDeTorneo)` que esta tarea saca.
    expect(html).toContain('FIFA')
    expect(html).toContain('Perdiste 2-1')
    expect(html).toContain('jugaste con Boca')
    expect(html).toContain('Cargó Fede')
  })

  it('el orden entre las dos clases: un casual del 23/8 va arriba de un torneo del 14/8', () => {
    const casual = partidoCasual({ playedOn: '2026-08-23' })
    const torneo = partido({ playedOn: '2026-08-14' })
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', partidos: [casual, torneo] }))
    // Las dos tienen que estar de verdad -- si una faltara, `indexOf` daría
    // -1 y "menor que" pasaría solo, sin haber probado nada sobre el orden.
    expect(html).toContain('FIFA')
    expect(html).toContain('Los Jueves')
    expect(html.indexOf('FIFA')).toBeLessThan(html.indexOf('Los Jueves'))
  })

  it('la fila casual sin marcador no inventa uno', () => {
    const sinMarcador = partidoCasual({ score: null, teams: { mine: null, theirs: null } })
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', partidos: [sinMarcador] }))
    expect(html).toContain('Perdiste')
    expect(html).not.toMatch(/Perdiste\s*\d/)
    expect(html).not.toContain('jugaste con')
  })

  it('la fila casual editada por el otro muestra SU nombre en la autoría', () => {
    // §3.2: para que dos amigos puedan discutir un resultado tienen que poder
    // ver que alguien lo cambió. `editó Juan` sólo puede salir de la línea de
    // autoría -- el encabezado también dice "Juan", pero nunca precedido de
    // "editó ", así que esta aserción no puede pasar por casualidad.
    const editadoPorOtro = partidoCasual({ createdBy: 'Fede', updatedBy: 'Juan' })
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', partidos: [editadoPorOtro] }))
    expect(html).toContain('Cargó Fede')
    expect(html).toContain('editó Juan')
  })

  it('cuando cargó y editó la misma persona, lo dice una sola vez', () => {
    const mismaPersona = partidoCasual({ createdBy: 'Fede', updatedBy: 'Fede' })
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', partidos: [mismaPersona] }))
    expect(html).toContain('Cargó Fede')
    expect(html).not.toContain('editó')
  })

  it('un empate con ganador se dibuja como el hecho, nunca "por penales"', () => {
    // §4.3: un marcador empatado no dice quién ganó -- en FIFA puede resolverse
    // por penales, pero la app no sabe que "FIFA" es fútbol y no lo etiqueta.
    // Acá Juan (el amigo de esta pantalla) gana un partido que en el marcador
    // quedó 2-2.
    const empateConGanador = partidoCasual({ outcome: 'lost', score: { mine: 2, theirs: 2 } })
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', partidos: [empateConGanador] }))
    expect(html).toContain('2-2')
    expect(html).toContain('Ganó Juan')
    expect(html).not.toContain('penales')
  })
})
