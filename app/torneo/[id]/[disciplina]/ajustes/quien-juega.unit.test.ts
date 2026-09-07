// @vitest-environment jsdom
//
// Segundo archivo de este repo en jsdom (el primero es
// `app/amigos/[playerId]/cargar.unit.test.ts`) — mismo motivo que ahí:
// `renderToStaticMarkup` (lo que usa el resto de la suite, incluida
// `page.unit.test.ts` de esta misma carpeta) DESCARTA los props de evento —
// un `onClick` no aparece en el HTML que devuelve, así que no hay forma de
// pinear "el botón 'Sacar' llama a `dropDisciplineMember`, no a
// `addDisciplineMember`" sin disparar un click de verdad contra un DOM real.
//
// Bloqueada por un review a ciegas (ronda de fix): con `renderToStaticMarkup`
// solo, invertir los dos `onClick` de `quien-juega.tsx` daba `9 passed (9)`
// en `page.unit.test.ts` — el markup estático es IDÉNTICO con las dos
// acciones cambiadas de lugar, porque lo único que cambia es a qué función
// apunta el handler.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DisciplineId } from '@/core'
import type { WriteResult } from '@/app/torneo/[id]/ajustes/actions'
import { QuienJuega, type QuienJuegaMemberVM } from './quien-juega'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const addDisciplineMember = vi.fn(async (..._args: unknown[]): Promise<WriteResult> => ({ ok: true }))
const dropDisciplineMember = vi.fn(async (..._args: unknown[]): Promise<WriteResult> => ({ ok: true }))

vi.mock('@/app/torneo/[id]/ajustes/actions', () => ({
  addDisciplineMember: (...args: unknown[]) => addDisciplineMember(...args),
  dropDisciplineMember: (...args: unknown[]) => dropDisciplineMember(...args),
}))

const D_PADEL = 'd-padel' as DisciplineId

const MEMBERS: QuienJuegaMemberVM[] = [
  { entryId: 'e-juega', name: 'Juega Pádel', playsDiscipline: true },
  { entryId: 'e-no-juega', name: 'No juega Pádel', playsDiscipline: false },
]

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root !== null) act(() => root?.unmount())
  if (container !== null) container.remove()
  container = null
  root = null
  addDisciplineMember.mockClear()
  dropDisciplineMember.mockClear()
})

async function montar(): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      createElement(QuienJuega, {
        seasonId: 's1',
        disciplineId: D_PADEL,
        disciplineLabel: 'Pádel',
        members: MEMBERS,
      }),
    )
  })
  return container
}

describe('QuienJuega — cada botón llama a SU acción, con los argumentos correctos', () => {
  it('"Sacar" en quien juega llama a dropDisciplineMember, nunca a addDisciplineMember', async () => {
    const el = await montar()
    const botones = [...el.querySelectorAll('button')]
    const sacar = botones.find((button) => button.textContent === 'Sacar')
    if (sacar === undefined) throw new Error('No se encontró el botón "Sacar".')

    await act(async () => {
      sacar.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(dropDisciplineMember).toHaveBeenCalledWith('s1', D_PADEL, 'e-juega', 'Pádel')
    expect(addDisciplineMember).not.toHaveBeenCalled()
  })

  it('"Agregar" en quien no juega llama a addDisciplineMember, nunca a dropDisciplineMember', async () => {
    const el = await montar()
    const botones = [...el.querySelectorAll('button')]
    const agregar = botones.find((button) => button.textContent === 'Agregar')
    if (agregar === undefined) throw new Error('No se encontró el botón "Agregar".')

    await act(async () => {
      agregar.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(addDisciplineMember).toHaveBeenCalledWith('s1', D_PADEL, 'e-no-juega')
    expect(dropDisciplineMember).not.toHaveBeenCalled()
  })
})

/**
 * Ronda de fix 2 (BLOQUEA 2): que la acción se llame con los argumentos
 * correctos no alcanza si el `WriteResult` que devuelve se descarta -- las
 * TRES guardas nuevas de `removeFromDiscipline` (ya jugó, pareja fija,
 * presentismo) no tienen otra superficie que este `<p>` de error. Sin este
 * test, `run` podía quedar en `await work()` a secas (sin mirar
 * `result.ok`) y toda la suite de acá arriba seguía en verde: llama a la
 * función correcta con los argumentos correctos, y no le importa qué
 * devuelve.
 *
 * Mutación probada a mano (revertida después, confirmando rojo → verde):
 * reemplazar el cuerpo de `run` en `quien-juega.tsx` por
 * `startTransition(async () => { await work() })` (sin el `if (!result.ok)
 * setError(...)`) → este test da ROJO (el texto del error nunca aparece en
 * el DOM); los dos de arriba siguen en VERDE.
 */
describe('QuienJuega — el error de la acción llega a la pantalla', () => {
  it('si "Sacar" rebota, el mensaje de dropDisciplineMember se dibuja', async () => {
    dropDisciplineMember.mockResolvedValueOnce({ ok: false, error: 'Pádel: ya jugó, no se puede sacar.' })
    const el = await montar()
    const sacar = [...el.querySelectorAll('button')].find((button) => button.textContent === 'Sacar')
    if (sacar === undefined) throw new Error('No se encontró el botón "Sacar".')

    await act(async () => {
      sacar.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(el.textContent).toContain('Pádel: ya jugó, no se puede sacar.')
  })
})
