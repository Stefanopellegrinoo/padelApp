import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { defaultConfig, type DisciplineId } from '@/core'
import type { DisciplineHeader, SquadMember } from '@/db/read'

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
