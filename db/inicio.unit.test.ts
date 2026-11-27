import { describe, expect, it, vi } from 'vitest'
import type { Client } from './client'
import { friendsOf, historyWith, torneosCompartidosCon, type CasualMatch, type Friend, type SharedMatch, type TournamentMatch } from './friends'
import { amigosDeInicio, ordenarAmigos, pedidosRecibidos, resumenAmigo } from './inicio'

vi.mock('./friends', async (importOriginal) => {
  const real = await importOriginal<typeof import('./friends')>()
  return {
    ...real,
    friendsOf: vi.fn(async () => []),
    historyWith: vi.fn(async () => []),
    torneosCompartidosCon: vi.fn(async () => new Map()),
  }
})

/**
 * Las partes puras de la lectura de Inicio (`db/inicio.ts`): el resumen de un
 * amigo -- su cara a cara y su último resultado -- sale de la lista que ya
 * devuelve `historyWith`, ordenada por fecha descendente, sin reordenarla.
 */

function torneo(over: Partial<TournamentMatch> = {}): SharedMatch {
  return {
    kind: 'tournament',
    matchId: 'm-t',
    matchdayId: 'md',
    together: false,
    playedOn: '2026-11-18',
    matchdayNumber: 8,
    sport: 'PADEL',
    seasonName: 'Los Pibes del Martes',
    outcome: 'won',
    score: { mine: 6, theirs: 4 },
    ...over,
  }
}

function casual(over: Partial<CasualMatch> = {}): SharedMatch {
  return {
    kind: 'casual',
    matchId: 'm-c',
    playedOn: '2026-11-20',
    sport: 'FIFA',
    together: false,
    partners: [],
    rivals: ['Nico'],
    outcome: 'lost',
    score: { mine: 1, theirs: 3 },
    teams: { mine: null, theirs: null },
    sets: null,
    createdBy: 'Martín',
    updatedBy: 'Martín',
    createdById: 'p1',
    updatedById: 'p1',
    ...over,
  }
}

const NICO = { playerId: 'p-nico', displayName: 'Nico Arias' }

describe('resumenAmigo', () => {
  it('sin partidos: registros en cero y sin último', () => {
    expect(resumenAmigo(NICO, [])).toEqual({
      playerId: 'p-nico',
      displayName: 'Nico Arias',
      contra: { won: 0, lost: 0, drew: 0 },
      juntos: { won: 0, lost: 0, drew: 0 },
      ultimo: null,
    })
  })

  it('cuenta enfrentados y compañeros por separado, de las dos fuentes', () => {
    const r = resumenAmigo(NICO, [
      casual({ matchId: 'a', outcome: 'lost' }),
      torneo({ matchId: 'b', outcome: 'won' }),
      torneo({ matchId: 'c', outcome: 'won' }),
      torneo({ matchId: 'd', outcome: 'drew' }),
      torneo({ matchId: 'e', together: true, outcome: 'won' }),
      casual({ matchId: 'f', together: true, outcome: 'lost' }),
    ])
    expect(r.contra).toEqual({ won: 2, lost: 1, drew: 1 })
    expect(r.juntos).toEqual({ won: 1, lost: 1, drew: 0 })
  })

  it('el último es el primero CON resultado: una fecha abierta sin cargar no cuenta', () => {
    const sinCargar = torneo({ matchId: 'abierta', playedOn: null, outcome: null, score: null })
    const jugado = casual({ matchId: 'jugado' })
    // `historyWith` deja las fechas sin `playedOn` al final; igual se saltea
    // cualquiera sin resultado, esté donde esté.
    expect(resumenAmigo(NICO, [torneo({ matchId: 'x', outcome: null, score: null }), jugado, sinCargar]).ultimo).toBe(
      jugado,
    )
    expect(resumenAmigo(NICO, [sinCargar]).ultimo).toBeNull()
    expect(resumenAmigo(NICO, [sinCargar]).contra).toEqual({ won: 0, lost: 0, drew: 0 })
  })
})

describe('ordenarAmigos', () => {
  const con = (displayName: string, playedOn: string | null) =>
    resumenAmigo({ playerId: displayName, displayName }, playedOn === null ? [] : [torneo({ playedOn })])

  it('primero con quien jugaste más reciente; sin partidos al final, por nombre', () => {
    const orden = ordenarAmigos([
      con('Zoe', null),
      con('Facu', '2026-10-01'),
      con('Ana', null),
      con('Nico', '2026-11-18'),
    ]).map((a) => a.displayName)
    expect(orden).toEqual(['Nico', 'Facu', 'Ana', 'Zoe'])
  })

  it('misma fecha: por nombre, sin depender del orden de entrada', () => {
    const a = con('Bruno', '2026-11-18')
    const b = con('Ale', '2026-11-18')
    expect(ordenarAmigos([a, b]).map((x) => x.displayName)).toEqual(['Ale', 'Bruno'])
    expect(ordenarAmigos([b, a]).map((x) => x.displayName)).toEqual(['Ale', 'Bruno'])
  })

  it('un último de torneo sin fecha cargada va después de los que la tienen', () => {
    const sinDia = resumenAmigo({ playerId: 's', displayName: 'Sin día' }, [torneo({ playedOn: null })])
    expect(ordenarAmigos([sinDia, con('Viejo', '2025-01-01')]).map((x) => x.displayName)).toEqual([
      'Viejo',
      'Sin día',
    ])
  })
})

// ── los pedidos de Inicio (odd/tasks/amigos-faciles.md, T3, S4) ─────────────

const cliente = {} as Client

const amistad = (over: Partial<Friend>): Friend => ({
  friendshipId: `f-${over.playerId}`,
  playerId: 'p',
  displayName: 'Alguien',
  accepted: true,
  theyAsked: false,
  createdAt: '2026-11-24T12:00:00Z',
  ...over,
})

const NICO_AMIGO = amistad({ playerId: 'p-nico', displayName: 'Nico Arias' })
const JUAMPI = amistad({ playerId: 'p-juampi', displayName: 'Juampi Ledesma', accepted: false, theyAsked: true })
const RAMA = amistad({ playerId: 'p-rama', displayName: 'Rama Benítez', accepted: false, theyAsked: true })
const TOMI = amistad({ playerId: 'p-tomi', displayName: 'Tomi Sosa', accepted: false, theyAsked: false })

describe('pedidosRecibidos', () => {
  it('sólo los pendientes que me hicieron, con los torneos que compartimos', async () => {
    vi.mocked(torneosCompartidosCon).mockResolvedValueOnce(
      new Map([
        ['p-juampi', ['Los Pibes del Martes']],
        ['p-rama', []],
      ]),
    )
    const pedidos = await pedidosRecibidos(cliente, [NICO_AMIGO, JUAMPI, TOMI, RAMA])
    expect(torneosCompartidosCon).toHaveBeenLastCalledWith(cliente, ['p-juampi', 'p-rama'])
    expect(pedidos).toEqual([
      { playerId: 'p-juampi', displayName: 'Juampi Ledesma', torneos: ['Los Pibes del Martes'] },
      { playerId: 'p-rama', displayName: 'Rama Benítez', torneos: [] },
    ])
  })

  it('sin pedidos no lee nada', async () => {
    vi.mocked(torneosCompartidosCon).mockClear()
    expect(await pedidosRecibidos(cliente, [NICO_AMIGO, TOMI])).toEqual([])
    expect(torneosCompartidosCon).not.toHaveBeenCalled()
  })
})

describe('amigosDeInicio', () => {
  it('con las amistades ya leídas no las vuelve a leer, y deja afuera las pendientes', async () => {
    vi.mocked(friendsOf).mockClear()
    vi.mocked(historyWith).mockClear()
    const amigos = await amigosDeInicio(cliente, [NICO_AMIGO, JUAMPI, TOMI])
    expect(friendsOf).not.toHaveBeenCalled()
    expect(historyWith).toHaveBeenCalledTimes(1)
    expect(amigos.map((amigo) => amigo.playerId)).toEqual(['p-nico'])
  })

  it('sin ellas, las lee como siempre', async () => {
    vi.mocked(friendsOf).mockClear().mockResolvedValueOnce([NICO_AMIGO, JUAMPI])
    const amigos = await amigosDeInicio(cliente)
    expect(friendsOf).toHaveBeenCalledWith(cliente)
    expect(amigos.map((amigo) => amigo.playerId)).toEqual(['p-nico'])
  })
})
