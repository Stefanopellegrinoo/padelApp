// @vitest-environment jsdom
//
// Mismo motivo que `quien-juega.unit.test.ts`: `renderToStaticMarkup`
// descarta los props de evento -- un `onClick`/`onSubmit` no aparece en el
// HTML que devuelve, así que no hay forma de pinear "Deshacer llama a
// removeTeam, no a addTeam" ni "el submit arma con LOS DOS elegidos, sin
// cambiarlos de lugar" sin un DOM real.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DisciplineId } from '@/core'
import type { WriteResult } from '@/app/torneo/[id]/ajustes/actions'
import { Equipos, type EquipoMemberVM, type EquipoVM } from './equipos'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const addTeam = vi.fn(async (..._args: unknown[]): Promise<WriteResult> => ({ ok: true }))
const removeTeam = vi.fn(async (..._args: unknown[]): Promise<WriteResult> => ({ ok: true }))

vi.mock('@/app/torneo/[id]/ajustes/actions', () => ({
  addTeam: (...args: unknown[]) => addTeam(...args),
  removeTeam: (...args: unknown[]) => removeTeam(...args),
}))

const D_PADEL = 'd-padel' as DisciplineId

const TEAMS: EquipoVM[] = [{ id: 't1', aName: 'Juan', bName: 'Pedro' }]
const FREE: EquipoMemberVM[] = [
  { entryId: 'e-ana', name: 'Ana' },
  { entryId: 'e-beto', name: 'Beto' },
  { entryId: 'e-caro', name: 'Caro' },
]

// Mismo workaround que `app/amigos/[playerId]/cargar.unit.test.ts` usa para
// `<input>`, pero para `<select>`: React parchea el setter de `.value` para
// trackear el último valor "conocido", así que asignar `select.value = x`
// directo deja a React creyendo que no cambió nada y nunca dispara el
// `onChange` sintético. El setter NATIVO (tomado del prototipo antes de que
// React lo pise) sí lo hace.
const selectValueDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')
if (selectValueDescriptor?.set === undefined) {
  throw new Error('No se encontró el setter nativo de HTMLSelectElement.value.')
}
const nativeSelectValueSetter = selectValueDescriptor.set

function elegir(select: HTMLSelectElement, value: string): void {
  nativeSelectValueSetter.call(select, value)
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root !== null) act(() => root?.unmount())
  if (container !== null) container.remove()
  container = null
  root = null
  addTeam.mockClear()
  removeTeam.mockClear()
})

async function montar(teams: EquipoVM[] = TEAMS, freeMembers: EquipoMemberVM[] = FREE): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(Equipos, { seasonId: 's1', disciplineId: D_PADEL, teams, freeMembers }))
  })
  return container
}

describe('Equipos — "Deshacer" llama a removeTeam, nunca a addTeam', () => {
  it('el botón de la fila llama a removeTeam con (seasonId, teamId)', async () => {
    const el = await montar()
    const deshacer = [...el.querySelectorAll('button')].find((button) => button.textContent === 'Deshacer')
    if (deshacer === undefined) throw new Error('No se encontró el botón "Deshacer".')

    await act(async () => {
      deshacer.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(removeTeam).toHaveBeenCalledWith('s1', 't1')
    expect(addTeam).not.toHaveBeenCalled()
  })
})

describe('Equipos — "Armar equipo" llama a addTeam con los DOS elegidos, sin cambiarlos de lugar', () => {
  it('arma con (seasonId, disciplineId, el del primer select, el del segundo)', async () => {
    const el = await montar()
    const [selectA, selectB] = [...el.querySelectorAll('select')]
    if (selectA === undefined || selectB === undefined) throw new Error('Faltan los dos <select>.')

    await act(async () => {
      elegir(selectA, 'e-beto')
      elegir(selectB, 'e-ana')
    })

    const form = el.querySelector('form')
    if (form === null) throw new Error('No se encontró el <form>.')
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    // Pin: si `page.tsx`/`equipos.tsx` invirtieran qué select alimenta a
    // `entryA` y cuál a `entryB`, esta aserción exacta lo nota -- una
    // aserción "llamó con {e-beto, e-ana} en algún orden" no lo haría.
    expect(addTeam).toHaveBeenCalledWith('s1', D_PADEL, 'e-beto', 'e-ana')
    expect(removeTeam).not.toHaveBeenCalled()
  })

  it('con los dos <select> en la MISMA persona, el submit no llama a addTeam', async () => {
    const el = await montar()
    const [selectA, selectB] = [...el.querySelectorAll('select')]
    if (selectA === undefined || selectB === undefined) throw new Error('Faltan los dos <select>.')

    await act(async () => {
      elegir(selectA, 'e-ana')
      elegir(selectB, 'e-ana')
    })

    const form = el.querySelector('form')
    if (form === null) throw new Error('No se encontró el <form>.')
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(addTeam).not.toHaveBeenCalled()
  })

  it('con un <select> todavía sin elegir, el submit no llama a addTeam', async () => {
    const el = await montar()
    const [selectA] = [...el.querySelectorAll('select')]
    if (selectA === undefined) throw new Error('Falta el primer <select>.')

    await act(async () => {
      elegir(selectA, 'e-ana')
    })

    const form = el.querySelector('form')
    if (form === null) throw new Error('No se encontró el <form>.')
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(addTeam).not.toHaveBeenCalled()
  })
})

/**
 * Mismo criterio que `quien-juega.unit.test.ts` (ronda de fix 2, BLOQUEA 2):
 * llamar a la acción correcta con los argumentos correctos no alcanza si el
 * `WriteResult` que devuelve se descarta -- las guardas de `createTeam`/
 * `deleteTeam` (`db/discipline-teams.ts`) no tienen otra superficie que este
 * `<p>` de error.
 */
describe('Equipos — el error de la acción llega a la pantalla', () => {
  it('si "Deshacer" rebota, el mensaje de removeTeam se dibuja', async () => {
    removeTeam.mockResolvedValueOnce({ ok: false, error: 'No se pudo deshacer el equipo: sólo puede hacerlo quien organiza.' })
    const el = await montar()
    const deshacer = [...el.querySelectorAll('button')].find((button) => button.textContent === 'Deshacer')
    if (deshacer === undefined) throw new Error('No se encontró el botón "Deshacer".')

    await act(async () => {
      deshacer.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(el.textContent).toContain('No se pudo deshacer el equipo: sólo puede hacerlo quien organiza.')
  })

  it('si "Armar equipo" rebota, el mensaje de addTeam se dibuja', async () => {
    addTeam.mockResolvedValueOnce({ ok: false, error: 'Alguien de los dos ya tiene equipo en esta disciplina.' })
    const el = await montar()
    const [selectA, selectB] = [...el.querySelectorAll('select')]
    if (selectA === undefined || selectB === undefined) throw new Error('Faltan los dos <select>.')

    await act(async () => {
      elegir(selectA, 'e-ana')
      elegir(selectB, 'e-beto')
    })
    const form = el.querySelector('form')
    if (form === null) throw new Error('No se encontró el <form>.')
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(el.textContent).toContain('Alguien de los dos ya tiene equipo en esta disciplina.')
  })
})

describe('Equipos — equipos parciales: sin 2 libres, no se dibuja el form de armar', () => {
  it('con menos de dos en freeMembers, no hay <select> ni "Armar equipo"', async () => {
    const el = await montar(TEAMS, [{ entryId: 'e-ana', name: 'Ana' }])
    expect(el.querySelectorAll('select')).toHaveLength(0)
    expect([...el.querySelectorAll('button')].some((button) => button.textContent === 'Armar equipo')).toBe(false)
  })

  it('sin ningún equipo armado, no se dibuja la lista ni "Deshacer"', async () => {
    const el = await montar([], FREE)
    expect([...el.querySelectorAll('button')].some((button) => button.textContent === 'Deshacer')).toBe(false)
  })
})
