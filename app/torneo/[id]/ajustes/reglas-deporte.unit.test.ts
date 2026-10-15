// @vitest-environment jsdom
//
// jsdom y no `renderToStaticMarkup`: lo que importa de esta tarjeta es lo que pasa al TOCAR
// (con qué reglas abre la hoja, qué manda "Listo", qué hace si no se tocó nada), y el HTML
// estático descarta los `onClick`.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { defaultConfig, fichaSeed, type DisciplineId, type SideSize } from '@/core'
import { rulesFromSeed, type DisciplineRules } from '@/app/deporte/personalizar-reglas-state'
import type { WriteResult } from './actions'
import { ReglasDeporte } from './reglas-deporte'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const saveDisciplineRules = vi.fn(async (..._args: unknown[]): Promise<WriteResult> => ({ ok: true }))
vi.mock('./actions', () => ({
  saveDisciplineRules: (...args: unknown[]) => saveDisciplineRules(...args),
}))

// jsdom todavía no trae `showModal`: alcanza con que el diálogo exista en el DOM.
beforeAll(() => {
  if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '')
    }
  }
})

const D_PADEL = 'd-padel' as DisciplineId
const NOTE = 'Los cambios valen desde la próxima fecha. Las fechas ya jugadas quedan como se jugaron.'

/** Un Pádel de antes de la ficha: sin `firstFecha`, todos contra todos, con Masters. Lo contrario de la ficha (AUTO). */
const PADEL_GUARDADO: DisciplineRules = {
  config: defaultConfig(8),
  hasMasters: true,
  formatoDefault: { kind: 'ROUND_ROBIN' },
}

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root !== null) act(() => root?.unmount())
  container?.remove()
  container = null
  root = null
  saveDisciplineRules.mockClear()
  saveDisciplineRules.mockResolvedValue({ ok: true })
})

async function montar(
  props: Partial<{
    kind: string
    pairSize: SideSize
    fixedTeams: boolean
    allowsDraw: boolean
    rules: DisciplineRules
  }> = {},
): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      createElement(ReglasDeporte, {
        seasonId: 's1',
        disciplineId: D_PADEL,
        kind: 'PADEL',
        pairSize: 2,
        fixedTeams: false,
        allowsDraw: false,
        rules: PADEL_GUARDADO,
        ...props,
      }),
    )
  })
  return container
}

const botonDe = (dentro: ParentNode, texto: string): HTMLButtonElement => {
  const boton = [...dentro.querySelectorAll('button')].find((candidato) => candidato.textContent?.trim().startsWith(texto))
  if (boton === undefined) throw new Error(`No hay un botón "${texto}".`)
  return boton
}

async function tocar(boton: HTMLButtonElement): Promise<void> {
  await act(async () => {
    boton.click()
  })
}

describe('ReglasDeporte — la tarjeta', () => {
  it('un Pádel que ya existe: su modalidad, su reglamento y ni una palabra de una primera fecha que no guardó', async () => {
    const page = await montar()
    const text = page.textContent ?? ''

    expect(page.querySelector('[data-reglas-deporte="d-padel"]')).not.toBeNull()
    expect(text).toContain('Reglas de Pádel')
    expect(text).toContain('Parejas que rotan · se elige al crear el torneo')
    expect(text).toContain('Cada fecha, todos contra todos.')
    expect(text).toContain('Masters al final con los 4 mejores.')
    expect(text).not.toMatch(/primera fecha/i)
  })

  it('FIFA individual: "Individual", partidos a goles y sin Masters', async () => {
    const page = await montar({
      kind: 'FIFA',
      pairSize: 1,
      allowsDraw: true,
      rules: rulesFromSeed(fichaSeed('FIFA', 6, 'INDIVIDUAL')),
    })
    const text = page.textContent ?? ''

    expect(text).toContain('Reglas de FIFA')
    expect(text).toContain('Individual · se elige al crear el torneo')
    expect(text).toContain('Partidos a goles; se puede empatar.')
    expect(text).not.toContain('Masters')
  })
})

describe('ReglasDeporte — la hoja', () => {
  it('abre con lo GUARDADO del torneo, nunca con la ficha, y trae el aviso junto a "Listo"', async () => {
    const page = await montar()

    await tocar(botonDe(page, 'Personalizar reglas'))

    const hoja = page.querySelector('dialog')
    if (hoja === null) throw new Error('La hoja no abrió.')
    expect(botonDe(hoja, 'Todos contra todos').getAttribute('aria-pressed')).toBe('true')
    // La ficha de Pádel es Automático: si la hoja abriera con ella, esto estaría prendido.
    expect(botonDe(hoja, 'Automático').getAttribute('aria-pressed')).toBe('false')
    expect(hoja.textContent).toContain(NOTE)
    // La ficha sólo está a un toque explícito.
    expect(hoja.textContent).toContain('Volver a las reglas de Pádel')
  })

  it('"Listo" sin haber tocado nada sólo cierra: no escribe', async () => {
    const page = await montar()
    await tocar(botonDe(page, 'Personalizar reglas'))

    await tocar(botonDe(page, 'Listo'))

    expect(saveDisciplineRules).not.toHaveBeenCalled()
    expect(page.querySelector('dialog')).toBeNull()
  })

  it('"Listo" con un cambio manda lo guardado y lo nuevo, y cierra', async () => {
    const page = await montar()
    await tocar(botonDe(page, 'Personalizar reglas'))
    await tocar(botonDe(page, 'Automático'))

    await tocar(botonDe(page, 'Listo'))

    expect(saveDisciplineRules).toHaveBeenCalledTimes(1)
    expect(saveDisciplineRules).toHaveBeenCalledWith('s1', D_PADEL, PADEL_GUARDADO, {
      ...PADEL_GUARDADO,
      formatoDefault: { kind: 'AUTO' },
    })
    expect(page.querySelector('dialog')).toBeNull()
  })

  it('si no se pudo guardar, la hoja sigue abierta con el error', async () => {
    saveDisciplineRules.mockResolvedValue({ ok: false, error: 'No se pudo guardar el formato.' })
    const page = await montar()
    await tocar(botonDe(page, 'Personalizar reglas'))
    await tocar(botonDe(page, 'Automático'))

    await tocar(botonDe(page, 'Listo'))

    expect(page.querySelector('dialog')?.textContent).toContain('No se pudo guardar el formato.')
  })

  it('cerrar con la cruz descarta lo tocado: al volver a abrir está lo guardado', async () => {
    const page = await montar()
    await tocar(botonDe(page, 'Personalizar reglas'))
    await tocar(botonDe(page, 'Automático'))
    await tocar(page.querySelector<HTMLButtonElement>('button[aria-label="Cerrar"]')!)
    expect(page.querySelector('dialog')).toBeNull()

    await tocar(botonDe(page, 'Personalizar reglas'))

    expect(botonDe(page, 'Todos contra todos').getAttribute('aria-pressed')).toBe('true')
    expect(saveDisciplineRules).not.toHaveBeenCalled()
  })

  it('un deporte sin ficha no ofrece "Volver a las reglas de"', async () => {
    const page = await montar({ kind: 'TEJO' })

    await tocar(botonDe(page, 'Personalizar reglas'))

    expect(page.querySelector('dialog')?.textContent).not.toContain('Volver a las reglas de')
  })
})
