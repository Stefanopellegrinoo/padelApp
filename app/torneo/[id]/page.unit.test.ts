import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { defaultConfig, type Award, type DisciplineId } from '@/core'
import { seasonAwardsOf, seasonSquadMembersOf, type DisciplineHeader, type SquadMember } from '@/db/read'

/**
 * Fix round 2 (jd-judge): el test de `desempate.unit.test.ts` renderiza
 * `Desempate` AISLADO con un `base` que le pasa el test mismo — nunca toca
 * `page.tsx`, así que no agarra si el call site real vuelve a pasar
 * `base={`/torneo/${seasonId}`}` en vez de `base={null}`. Esta suite
 * renderiza `TablaGlobalPage` completa (mismo patrón que
 * `[disciplina]/jugador/[entryId]/page.unit.test.ts`: server component
 * `async` llamado directo + `renderToStaticMarkup`, reads mockeadas).
 *
 * DOS disciplinas en el fixture a propósito: con una sola,
 * `singleDisciplineRedirect` (`tabla-state.ts`) redirige antes de llegar a
 * este JSX — el camino bajo prueba sólo existe con 2+.
 *
 * UNA reversión puntual tiene que romper esta suite — verificado corriendo
 * la mutación (fix round 2, jd-judge):
 *
 * 1. `page.tsx` vuelve a pasarle a `Desempate` `base={`/torneo/${seasonId}`}`
 *    en vez de `base={null}` — la fila recupera `cursor-pointer` y el test
 *    de abajo se pone en ROJO.
 */

const D_PADEL = 'd-padel' as DisciplineId
const D_FIFA = 'd-fifa' as DisciplineId

function header(): DisciplineHeader[] {
  const shape = {
    weight: 1,
    pairSize: 1 as const,
    hasMasters: false,
    allowsDraw: false,
    formatoDefault: { kind: 'ROUND_ROBIN' as const },
  }
  return [
    { id: D_PADEL, kind: 'PADEL', config: defaultConfig(2, 1), ...shape },
    { id: D_FIFA, kind: 'FIFA', config: defaultConfig(2, 1), ...shape },
  ]
}

function squad(): SquadMember[] {
  return [{ id: 'e1', displayName: 'Jugador Uno', playerId: null }]
}

function tiedSquad(): SquadMember[] {
  return [
    { id: 'e1', displayName: 'Jugador Uno', playerId: null },
    { id: 'e2', displayName: 'Jugador Dos', playerId: null },
  ]
}

function freshSquad(): SquadMember[] {
  return [
    { id: 'e1', displayName: 'Jugador Uno', playerId: null },
    { id: 'e2', displayName: 'Jugador Dos', playerId: null },
    { id: 'e3', displayName: 'Jugador Tres', playerId: null },
  ]
}

function award(entryId: string, points: number): Award {
  return { entryId, position: 1, points, lines: [] }
}

// `Desempate` llama `useRouter` en cada render (`router.push` al tocar una
// fila clickeable) — sin esto `renderToStaticMarkup` tira fuera de un árbol
// de Next real. Mismo mock que `desempate.unit.test.ts`.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
}))

vi.mock('@/db/server', () => ({
  serverClient: async () => ({}),
}))

vi.mock('@/db/read', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/db/read')>()
  return {
    ...real,
    seasonHeader: vi.fn(async () => ({
      id: 's1',
      name: 'Torneo de prueba',
      status: 'ACTIVE',
      regularMatchdays: 10,
      isAdmin: false,
      inviteToken: 'token',
      disciplines: header(),
    })),
    seasonMatchdaysOf: vi.fn(async () => []),
    seasonSquadMembersOf: vi.fn(async () => squad()),
    seasonAwardsOf: vi.fn(async () => new Map()),
  }
})

async function render(): Promise<string> {
  const { default: TablaGlobalPage } = await import('./page')
  return renderToStaticMarkup(await TablaGlobalPage({ params: Promise.resolve({ id: 's1' }) }))
}

describe('Tabla global (2+ disciplinas) — la fila no es clickeable', () => {
  it('con 2 disciplinas, la fila de la tabla global no lleva cursor-pointer', async () => {
    const html = await render()

    expect(html).toContain('Jugador Uno')
    const fila = /<div class="[^"]*rounded-field p-3[^"]*"/.exec(html)?.[0] ?? ''
    expect(fila).not.toContain('cursor-pointer')
  })
})

/**
 * docs/tipos-de-torneo.md §2.4: la global comparte `position` entre
 * empatados (numeración de competencia) en vez de derivarlo del índice de
 * la fila. Regresión puntual: `page.tsx` volviendo a `position: index + 1`
 * hace que este test se ponga en ROJO — verificado corriendo la mutación
 * (ver reporte de la tarea).
 */
describe('Tabla global — dos empatados en puntos comparten el mismo puesto', () => {
  it('con e1 y e2 en 5 puntos, ambas filas muestran el puesto 1', async () => {
    vi.mocked(seasonSquadMembersOf).mockResolvedValueOnce(tiedSquad())
    vi.mocked(seasonAwardsOf).mockResolvedValueOnce(
      new Map([[D_PADEL, new Map([[1, [award('e1', 5), award('e2', 5)]]])]]),
    )

    const html = await render()

    const positions = [...html.matchAll(/<span class="w-5 shrink-0[^"]*">(\d+)<\/span>/g)].map((m) => m[1])
    expect(positions).toEqual(['1', '1'])
  })
})

/**
 * BLOQUEA (review a ciegas): un torneo recién creado con 2+ disciplinas y
 * ninguna fecha cerrada tiene a TODO el plantel en 0 puntos — con `position`
 * compartido (§2.4) eso los empata a todos en el puesto 1, y `Desempate`
 * resalta `row.position === 1` con `bg-accent` (avatar) + `bg-chip` (fila)
 * como si hubiera un líder. Antes del fix (`highlightLeader`), medido
 * renderizando de verdad: 3 jugadores sin awards -> las 3 filas resaltadas.
 * Mismo criterio que ya usa `app/torneos/page.tsx` (`anyClosed`): sin
 * ninguna fecha cerrada no hay líder que mostrar.
 */
describe('Tabla global — sin ninguna fecha cerrada, nadie se resalta como líder', () => {
  it('con 3 jugadores en 0 puntos, ninguna fila lleva el resaltado de líder', async () => {
    vi.mocked(seasonSquadMembersOf).mockResolvedValueOnce(freshSquad())
    // `seasonMatchdaysOf`/`seasonAwardsOf` quedan en su default (`[]` / Map
    // vacío): ninguna fecha cerrada todavía, en ninguna disciplina.

    const html = await render()

    const positions = [...html.matchAll(/<span class="w-5 shrink-0[^"]*">(\d+)<\/span>/g)].map((m) => m[1])
    expect(positions).toEqual(['1', '1', '1']) // los tres, tied en 0 puntos

    const leaderAvatars = html.match(/bg-accent text-accent-text/g) ?? []
    expect(leaderAvatars).toHaveLength(0)
  })
})
