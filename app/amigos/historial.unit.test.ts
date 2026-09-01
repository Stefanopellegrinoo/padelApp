import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import type { SharedMatch, TournamentMatch } from '@/db/friends'
import { matchdayDay } from '@/app/format'
import { Historial } from './historial'

// `SharedMatch` trae el detalle completo desde Task 2: fecha, torneo y
// marcador. Un fixture acá completa TODOS los campos, como cualquier caller
// real -- no hay forma corta que esconda un campo que la pantalla necesita.
// `overrides` tipado sobre `TournamentMatch` (no `SharedMatch`): este archivo
// sólo arma partidos de torneo -- el casual es Task 3, con su propia pantalla
// --, y `Partial<union>` no angosta `kind`: lo ensancha a `'tournament' |
// 'casual'` en el objeto final, rompiendo la asignación a `SharedMatch`.
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

describe('Historial', () => {
  it('lista cada partido con su fecha, su torneo y su marcador', () => {
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', partidos: [partido()] }))
    expect(html).toContain(matchdayDay('2026-08-14'))
    expect(html).toContain('Los Jueves')
    // El marcador COMO LO LEE una persona -- "6-3", no un dígito suelto que
    // matchea cualquier cosa (hasta un `text-[13.5px]` tiene un "3").
    expect(html).toContain('6-3')
  })

  it('pone el más reciente primero', () => {
    const viejo = partido({ matchId: 'v', playedOn: '2026-08-01', seasonName: 'Viejo' })
    const nuevo = partido({ matchId: 'n', playedOn: '2026-08-20', seasonName: 'Nuevo' })
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', partidos: [viejo, nuevo] }))
    expect(html.indexOf('Nuevo')).toBeLessThan(html.indexOf('Viejo'))
  })

  it('con playedOn null desempata por matchdayNumber descendente', () => {
    // Una fecha sin jugar todavía no tiene `playedOn`: el desempate tiene
    // que seguir dando un orden estable, no el orden de llegada del array.
    const numeroBajo = partido({ matchId: 'b', playedOn: null, matchdayNumber: 1, seasonName: 'Bajo' })
    const numeroAlto = partido({ matchId: 'a', playedOn: null, matchdayNumber: 5, seasonName: 'Alto' })
    const html = renderToStaticMarkup(
      Historial({ nombre: 'Juan', partidos: [numeroBajo, numeroAlto] }),
    )
    expect(html.indexOf('Alto')).toBeLessThan(html.indexOf('Bajo'))
    // Sin `playedOn` no hay fecha que mostrar -- la fila dice el número de
    // fecha en vez de inventar un día que la base no cargó.
    expect(html).toContain('Fecha 5')
    expect(html).toContain('Fecha 1')
  })

  it('una fecha jugada va siempre antes que una sin jugar, sin importar el orden de llegada', () => {
    const sinJugar = partido({ matchId: 's', playedOn: null, matchdayNumber: 99, seasonName: 'SinFecha' })
    const jugada = partido({ matchId: 'j', playedOn: '2026-01-01', seasonName: 'ConFecha' })
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', partidos: [sinJugar, jugada] }))
    expect(html.indexOf('ConFecha')).toBeLessThan(html.indexOf('SinFecha'))
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

  it('un partido sin resultado no inventa uno', () => {
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
})
