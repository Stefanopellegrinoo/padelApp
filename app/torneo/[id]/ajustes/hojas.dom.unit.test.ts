// @vitest-environment jsdom
//
// Ajustes edita en hojas (`app/ui/sheet.tsx`), no en formularios sueltos en el scroll: el nombre,
// las reglas de la casa, cada asiento del plantel, el alta de un jugador, pasar la administración y
// eliminar el torneo. Lo que se mira es lo que pasa al TOCAR: qué abre, qué manda cada botón y que un
// error deje la hoja abierta con lo que se escribió.
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DisciplineId } from '@/core'
import type { WriteResult } from './actions'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ok = async (..._args: unknown[]): Promise<WriteResult> => ({ ok: true })
const actions = {
  saveRules: vi.fn(ok),
  editSeatName: vi.fn(ok),
  takeSeat: vi.fn(ok),
  unlinkSeatOwner: vi.fn(ok),
  dropSeat: vi.fn(ok),
  addSeat: vi.fn(ok),
  transferAdmin: vi.fn(ok),
  removeTournament: vi.fn(ok),
  renameTournament: vi.fn(async (_form: FormData) => {}),
}
vi.mock('./actions', () => ({
  saveRules: (...args: unknown[]) => actions.saveRules(...args),
  editSeatName: (...args: unknown[]) => actions.editSeatName(...args),
  takeSeat: (...args: unknown[]) => actions.takeSeat(...args),
  unlinkSeatOwner: (...args: unknown[]) => actions.unlinkSeatOwner(...args),
  dropSeat: (...args: unknown[]) => actions.dropSeat(...args),
  addSeat: (...args: unknown[]) => actions.addSeat(...args),
  transferAdmin: (...args: unknown[]) => actions.transferAdmin(...args),
  removeTournament: (...args: unknown[]) => actions.removeTournament(...args),
  renameTournament: (form: FormData) => actions.renameTournament(form),
}))

const { Reglas } = await import('./reglas')
const { Plantel } = await import('./plantel')
const { PasarAdmin } = await import('./pasar-admin')
const { EliminarTorneo } = await import('./eliminar')
const { NombreTorneo } = await import('./nombre')

// jsdom todavía no trae `showModal` ni `close`: lo mínimo que hace la plataforma.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  for (const action of Object.values(actions)) action.mockClear()
  actions.saveRules.mockImplementation(ok)
  actions.editSeatName.mockImplementation(ok)
  actions.addSeat.mockImplementation(ok)
  actions.transferAdmin.mockImplementation(ok)
  actions.removeTournament.mockImplementation(ok)
})

async function montar(element: ReactElement): Promise<void> {
  await act(async () => root.render(element))
}

const botones = (dentro: ParentNode = host) => [...dentro.querySelectorAll('button')]
function boton(texto: string | RegExp, dentro: ParentNode = host): HTMLButtonElement {
  const hit = botones(dentro).find((b) =>
    typeof texto === 'string' ? b.textContent?.trim() === texto : texto.test(b.textContent ?? ''),
  )
  if (hit === undefined) throw new Error(`No hay un botón "${texto}".`)
  return hit
}
async function tocar(target: HTMLElement): Promise<void> {
  await act(async () => target.click())
}
/** La hoja abierta (un `<dialog open>`), o `null`. */
const hoja = (): HTMLDialogElement | null => host.querySelector('dialog[open]')
function hojaAbierta(): HTMLDialogElement {
  const dialog = hoja()
  if (dialog === null) throw new Error('No hay una hoja abierta.')
  return dialog
}
/** Escribir en un campo controlado de React: el setter nativo y un `input`. */
async function escribir(field: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const D1 = 'd1' as DisciplineId

describe('Reglas de la casa — se leen en la pantalla y se editan en una hoja', () => {
  const montarReglas = (text: string) =>
    montar(createElement(Reglas, { seasonId: 's1', disciplineId: D1, text, disciplineLabel: null }))

  it('muestra el texto ya formateado y nada abierto', async () => {
    await montarReglas('Traer **pelotas** nuevas.')

    expect(host.querySelector('strong')?.textContent).toBe('pelotas')
    expect(hoja()).toBeNull()
    expect(actions.saveRules).not.toHaveBeenCalled()
  })

  it('sin texto lo dice, y "Editar" abre la hoja con el campo', async () => {
    await montarReglas('')

    expect(host.textContent).toContain('Sin reglas de la casa')
    await tocar(boton('Editar'))

    expect(hojaAbierta().querySelector('textarea')?.value).toBe('')
  })

  it('"Guardar" manda lo escrito, cierra la hoja y deja el texto nuevo a la vista', async () => {
    await montarReglas('Viejo.')
    await tocar(boton('Editar'))
    await escribir(hojaAbierta().querySelector('textarea')!, 'Nuevo.')

    await tocar(boton('Guardar', hojaAbierta()))

    expect(actions.saveRules).toHaveBeenCalledExactlyOnceWith('s1', D1, 'Nuevo.')
    expect(hoja()).toBeNull()
    expect(host.textContent).toContain('Nuevo.')
  })

  it('"Guardar" sin cambios no escribe nada y cierra', async () => {
    await montarReglas('Igual.')
    await tocar(boton('Editar'))

    await tocar(boton('Guardar', hojaAbierta()))

    expect(actions.saveRules).not.toHaveBeenCalled()
    expect(hoja()).toBeNull()
  })

  it('si no se pudo guardar, la hoja sigue abierta con lo escrito y el error', async () => {
    actions.saveRules.mockResolvedValue({ ok: false, error: 'No se pudieron guardar las reglas.' })
    await montarReglas('Viejo.')
    await tocar(boton('Editar'))
    await escribir(hojaAbierta().querySelector('textarea')!, 'Nuevo.')

    await tocar(boton('Guardar', hojaAbierta()))

    expect(hojaAbierta().textContent).toContain('No se pudieron guardar las reglas.')
    expect(hojaAbierta().querySelector('textarea')?.value).toBe('Nuevo.')
  })

  it('"Cancelar" descarta lo escrito: al volver a abrir está lo guardado', async () => {
    await montarReglas('Viejo.')
    await tocar(boton('Editar'))
    await escribir(hojaAbierta().querySelector('textarea')!, 'Nuevo.')

    await tocar(boton('Cancelar', hojaAbierta()))
    expect(hoja()).toBeNull()
    await tocar(boton('Editar'))

    expect(hojaAbierta().querySelector('textarea')?.value).toBe('Viejo.')
    expect(actions.saveRules).not.toHaveBeenCalled()
  })
})

describe('Plantel — cada asiento se edita en su hoja', () => {
  const seats = [
    { entryId: 'e1', name: 'Martín', ownerName: 'Martín Pérez' },
    { entryId: 'e2', name: 'Tomi', ownerName: null },
  ]
  const montarPlantel = (canTakeSeat = false) =>
    montar(createElement(Plantel, { seasonId: 's1', seats, canTakeSeat }))

  it('la lista muestra a cada uno con quién lo reclamó, sin acciones sueltas', async () => {
    await montarPlantel()

    expect(host.textContent).toContain('Martín Pérez')
    expect(host.textContent).toContain('Sin dueño')
    expect(botones().some((b) => b.textContent?.trim() === 'Sacar')).toBe(false)
  })

  it('tocar un asiento abre su hoja con el nombre para editar y sus acciones', async () => {
    await montarPlantel()

    await tocar(boton(/Martín/))

    const dialog = hojaAbierta()
    expect(dialog.querySelector<HTMLInputElement>('input[name="nombre"]')?.value).toBe('Martín')
    expect(botones(dialog).map((b) => b.textContent?.trim())).toEqual(
      expect.arrayContaining(['Guardar', 'Desvincular', 'Sacar']),
    )
    expect(dialog.textContent).not.toContain('Este soy yo')
  })

  it('"Este soy yo" sólo en un asiento libre y si quien organiza no tiene uno', async () => {
    await montarPlantel(true)

    await tocar(boton(/Tomi/))
    await tocar(boton('Este soy yo', hojaAbierta()))

    expect(actions.takeSeat).toHaveBeenCalledExactlyOnceWith('s1', 'e2')
  })

  it('"Guardar" con otro nombre lo renombra y cierra', async () => {
    await montarPlantel()
    await tocar(boton(/Martín/))
    await escribir(hojaAbierta().querySelector('input[name="nombre"]')!, 'Martu')

    await tocar(boton('Guardar', hojaAbierta()))

    expect(actions.editSeatName).toHaveBeenCalledExactlyOnceWith('s1', 'e1', 'Martu')
    expect(hoja()).toBeNull()
  })

  it('"Sacar" lo saca del plantel; si rebota, la hoja sigue abierta con el motivo', async () => {
    actions.dropSeat.mockResolvedValueOnce({ ok: false, error: 'Martín ya jugó: no se puede sacar.' })
    await montarPlantel()
    await tocar(boton(/Martín/))

    await tocar(boton('Sacar', hojaAbierta()))

    expect(actions.dropSeat).toHaveBeenCalledExactlyOnceWith('s1', 'e1')
    expect(hojaAbierta().textContent).toContain('Martín ya jugó: no se puede sacar.')
  })

  it('"Agregar jugador" abre una hoja con nombre y posición, y "Agregar" lo suma', async () => {
    await montarPlantel()

    await tocar(boton(/Agregar jugador/))
    const dialog = hojaAbierta()
    expect(boton('Agregar', dialog).disabled).toBe(true)
    await escribir(dialog.querySelector('input[name="nuevo"]')!, 'Juampi')
    await tocar(boton('Agregar', dialog))

    expect(actions.addSeat).toHaveBeenCalledExactlyOnceWith('s1', 'Juampi', null)
    expect(hoja()).toBeNull()
  })
})

describe('Pasar la administración — una hoja con quién puede recibirla', () => {
  const candidates = [
    { entryId: 'e2', name: 'Nico' },
    { entryId: 'e3', name: 'Tomi' },
  ]

  it('sin nadie con cuenta a quien pasarla, sólo dice que organizás vos', async () => {
    await montar(createElement(PasarAdmin, { seasonId: 's1', candidates: [] }))

    expect(host.textContent).toContain('Organizás vos')
    expect(botones()).toHaveLength(0)
  })

  it('"Pasar" abre la hoja con una fila por candidato', async () => {
    await montar(createElement(PasarAdmin, { seasonId: 's1', candidates }))

    await tocar(boton('Pasar'))

    expect(hojaAbierta().textContent).toContain('Nico')
    expect(hojaAbierta().textContent).toContain('Tomi')
  })

  it('elegir a alguien pide confirmación; cancelada, no pasa nada', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await montar(createElement(PasarAdmin, { seasonId: 's1', candidates }))
    await tocar(boton('Pasar'))

    await tocar(boton(/Nico/, hojaAbierta()))

    expect(confirm).toHaveBeenCalledWith('¿Pasarle la administración a Nico? Vas a dejar de poder editar este torneo.')
    expect(actions.transferAdmin).not.toHaveBeenCalled()
  })

  it('confirmada, se la pasa; si falla, el error queda en la hoja', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    actions.transferAdmin.mockResolvedValue({ ok: false, error: 'No se pudo pasar la administración.' })
    await montar(createElement(PasarAdmin, { seasonId: 's1', candidates }))
    await tocar(boton('Pasar'))

    await tocar(boton(/Tomi/, hojaAbierta()))

    expect(actions.transferAdmin).toHaveBeenCalledExactlyOnceWith('s1', 'e3')
    expect(hojaAbierta().textContent).toContain('No se pudo pasar la administración.')
  })
})

describe('Eliminar torneo — la hoja que pide escribir el nombre', () => {
  it('no borra hasta que el nombre coincide, y después llama a la acción', async () => {
    await montar(createElement(EliminarTorneo, { seasonId: 's1', name: 'Los Pibes', playedCount: 7 }))

    await tocar(boton('Eliminar torneo'))
    const dialog = hojaAbierta()
    expect(dialog.textContent).toContain('las 7 fechas jugadas')
    const eliminar = boton('Eliminar para siempre', dialog)
    expect(eliminar.disabled).toBe(true)

    await escribir(dialog.querySelector('input')!, 'Los Pibes')
    await tocar(boton('Eliminar para siempre', dialog))

    expect(actions.removeTournament).toHaveBeenCalledExactlyOnceWith('s1')
  })

  it('"Cancelar" cierra sin borrar', async () => {
    await montar(createElement(EliminarTorneo, { seasonId: 's1', name: 'Los Pibes', playedCount: 0 }))
    await tocar(boton('Eliminar torneo'))

    await tocar(boton('Cancelar', hojaAbierta()))

    expect(hoja()).toBeNull()
    expect(actions.removeTournament).not.toHaveBeenCalled()
  })
})

describe('Nombre del torneo — fila que abre la hoja con el formulario', () => {
  it('la fila muestra el nombre; tocarla abre la hoja con el campo lleno', async () => {
    await montar(createElement(NombreTorneo, { seasonId: 's1', name: 'Los Pibes', error: undefined }))

    expect(hoja()).toBeNull()
    await tocar(boton(/Los Pibes/))

    const dialog = hojaAbierta()
    expect(dialog.querySelector<HTMLInputElement>('input[name="name"]')?.value).toBe('Los Pibes')
    expect(dialog.querySelector<HTMLInputElement>('input[name="seasonId"]')?.value).toBe('s1')
    expect(boton('Guardar', dialog).type).toBe('submit')
  })

  it('si el guardado volvió con error, la hoja arranca abierta y lo dice', async () => {
    await montar(createElement(NombreTorneo, { seasonId: 's1', name: 'Los Pibes', error: 'El nombre no puede quedar vacío.' }))

    expect(hojaAbierta().textContent).toContain('El nombre no puede quedar vacío.')
  })
})
