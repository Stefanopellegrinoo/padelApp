// @vitest-environment jsdom
//
// La carga de resultados de la fecha (S8e): tocar el partido abre la hoja, el último toque guarda,
// un error no borra nada, corregir viene precargado y después de guardar el siguiente queda a un
// toque. jsdom y no `renderToStaticMarkup`: todo esto pasa al TOCAR, y el HTML estático descarta los
// `onClick` y los efectos. Va aparte de `carga.unit.test.ts` porque aquel es una suite de entorno
// node y no conviene cambiarle el entorno.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MatchFormat, SetScore } from '@/core'
import type { WriteResult } from './actions'
import { CargaDeLaFecha, TarjetaPartido, type CargaContext, type PartidoVM } from './carga'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// `carga.tsx` importa las server actions, que traen la base. Acá no se guarda nada: el espía
// responde lo que cada test le diga, y por defecto que salió bien.
const saveMatchResult = vi.fn(async (..._args: unknown[]): Promise<WriteResult> => ({ ok: true }))
vi.mock('./actions', () => ({
  saveMatchResult: (...args: unknown[]) => saveMatchResult(...args),
  closeTheMatchday: vi.fn(),
  redraftTheMatchday: vi.fn(),
  reopenTheMatchday: vi.fn(),
}))
vi.mock('./borrar', () => ({ BorrarFecha: () => null }))

// jsdom todavía no trae `showModal` ni `close` (lo mismo que `app/ui/sheet.dom.unit.test.ts`).
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

const PADEL: MatchFormat = { setsToWin: 1, gamesPerSet: 4, tieBreak: true, openScore: false }
const PING_PONG: MatchFormat = { setsToWin: 2, gamesPerSet: 11, tieBreak: false, openScore: false }
const FIFA: MatchFormat = { ...PADEL, openScore: true }

const contextOf = (format: MatchFormat): CargaContext => ({
  seasonId: 's1',
  matchdayId: 'm1',
  disciplina: 'padel',
  matchdayNumber: 1,
  format,
  unit: format.openScore ? 'goles' : format.gamesPerSet === 11 ? 'puntos' : 'games',
})

function partido(matchId: string, a: string, b: string, sets: SetScore[] = []): PartidoVM {
  const [scoreA, scoreB] = sets.length === 0 ? ['–', '–'] : [String(sets[0]!.gamesA), String(sets[0]!.gamesB)]
  const winner = sets.length === 0 ? null : sets[0]!.gamesA > sets[0]!.gamesB ? 'A' : sets[0]!.gamesB > sets[0]!.gamesA ? 'B' : null
  return {
    key: matchId,
    matchId,
    seccion: 'Ronda 1',
    pairAName: a,
    pairBName: b,
    pairA: [{ name: a, vos: false }],
    pairB: [{ name: b, vos: false }],
    scoreA,
    scoreB,
    winner,
    sets,
  }
}

const P1 = partido('p1', 'Ana & Beto', 'Caro & Dani')
const P2 = partido('p2', 'Eli & Fede', 'Gabi & Hugo')

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  saveMatchResult.mockReset()
  saveMatchResult.mockResolvedValue({ ok: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function montar(format: MatchFormat | null, partidos: PartidoVM[] = [P1, P2]): Promise<void> {
  await act(async () => {
    root.render(
      createElement(CargaDeLaFecha, {
        context: format === null ? null : contextOf(format),
        partidos,
        children: partidos.map((p) => createElement(TarjetaPartido, { key: p.matchId, partido: p })),
      }),
    )
  })
}

const dialogo = () => host.querySelector('dialog') as HTMLDialogElement
const aviso = () => host.querySelector('[role="status"][aria-live]') as HTMLElement
const botones = (dentro: ParentNode = host) => [...dentro.querySelectorAll('button')]
const botonDe = (texto: string, dentro: ParentNode = host): HTMLButtonElement => {
  const boton = botones(dentro).find((candidato) => candidato.textContent?.trim() === texto)
  if (boton === undefined) throw new Error(`No hay un botón "${texto}".`)
  return boton
}
const botonLlamado = (nombre: string): HTMLButtonElement => {
  const boton = botones().find((candidato) => candidato.getAttribute('aria-label') === nombre)
  if (boton === undefined) throw new Error(`No hay un botón llamado "${nombre}".`)
  return boton
}
/** Las parejas de la hoja: botones con `aria-pressed`. */
const pareja = (nombre: string) =>
  botones(dialogo()).find((b) => b.hasAttribute('aria-pressed') && b.textContent?.includes(nombre)) as HTMLButtonElement
/** Un botón de games del perdedor, por su número. */
const games = (n: string) => botonDe(n, dialogo())

async function tocar(boton: HTMLElement): Promise<void> {
  await act(async () => {
    boton.click()
  })
}

/** Tipea en un campo controlado de React: hay que pasar por el setter nativo y avisar con `input`. */
async function tipear(campo: HTMLInputElement, texto: string): Promise<void> {
  await act(async () => {
    const valor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    valor?.call(campo, texto)
    campo.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('tocar el partido abre la hoja (sin el toque extra de "Cargar resultado")', () => {
  it('cada partido sin cargar es un botón que nombra a los dos lados, y abre la hoja directo', async () => {
    await montar(PADEL)
    expect(dialogo().open).toBe(false)
    expect(host.textContent).not.toContain('Cargar resultado')

    await tocar(botonLlamado('Cargar Ana & Beto contra Caro & Dani'))

    expect(dialogo().open).toBe(true)
    const titulo = document.getElementById(dialogo().getAttribute('aria-labelledby') ?? '')
    expect(titulo?.textContent).toBe('Ronda 1')
    expect(pareja('Ana & Beto').getAttribute('aria-pressed')).toBe('false')
    expect(pareja('Caro & Dani').getAttribute('aria-pressed')).toBe('false')
  })

  it('sin permiso de carga los partidos se ven pero no son botones', async () => {
    await montar(null, [P1, partido('p3', 'Ana & Beto', 'Eli & Fede', [{ gamesA: 4, gamesB: 1 }])])
    expect(botones()).toHaveLength(0)
    expect(host.textContent).toContain('Ana & Beto')
    expect(host.textContent).toContain('Eli & Fede')
  })
})

describe('pádel: el par ganador y los games del perdedor, y se guarda en el último toque', () => {
  it('antes de elegir quién ganó, los games no se pueden tocar', async () => {
    await montar(PADEL)
    await tocar(botonLlamado('Cargar Ana & Beto contra Caro & Dani'))
    expect(games('2').disabled).toBe(true)
    expect(dialogo().textContent).toContain('Tocá primero quién ganó.')
  })

  it('guarda, cierra la hoja, avisa "Guardado: …" y "Siguiente" abre el próximo sin cargar', async () => {
    await montar(PADEL)
    await tocar(botonLlamado('Cargar Ana & Beto contra Caro & Dani'))

    await tocar(pareja('Ana & Beto'))
    expect(pareja('Ana & Beto').getAttribute('aria-pressed')).toBe('true')
    expect(dialogo().textContent).toContain('Games de Caro & Dani')
    expect(dialogo().textContent).toContain('Con este toque se guarda.')
    expect(saveMatchResult).not.toHaveBeenCalled()

    await tocar(games('2'))

    expect(saveMatchResult).toHaveBeenCalledTimes(1)
    expect(saveMatchResult).toHaveBeenCalledWith('s1', 1, 'p1', [{ gamesA: 4, gamesB: 2 }])
    expect(dialogo().open).toBe(false)
    expect(aviso().textContent).toContain('Guardado: Ana & Beto 4-2')

    await tocar(botonDe('Siguiente', aviso()))
    expect(dialogo().open).toBe(true)
    expect(pareja('Eli & Fede')).toBeDefined()
    // La hoja vuelve a la tarjeta del siguiente al cerrarse: el foco no queda perdido.
    expect(document.activeElement).not.toBe(document.body)
  })

  it('el partido recién guardado destella 700 ms (el del prototipo); los demás, no', async () => {
    await montar(PADEL)
    await tocar(botonLlamado('Cargar Ana & Beto contra Caro & Dani'))
    await tocar(pareja('Ana & Beto'))
    await tocar(games('2'))

    const guardada = document.getElementById('partido-p1')!
    expect(guardada.classList.contains('destello')).toBe(true)
    expect(document.getElementById('partido-p2')!.classList.contains('destello')).toBe(false)

    await act(async () => {
      await new Promise((listo) => setTimeout(listo, 750))
    })
    expect(document.getElementById('partido-p1')!.classList.contains('destello')).toBe(false)
  })

  it('ganó B: los games van del lado de A', async () => {
    await montar(PADEL)
    await tocar(botonLlamado('Cargar Ana & Beto contra Caro & Dani'))
    await tocar(pareja('Caro & Dani'))
    expect(dialogo().textContent).toContain('Games de Ana & Beto')
    await tocar(games('0'))
    expect(saveMatchResult).toHaveBeenCalledWith('s1', 1, 'p1', [{ gamesA: 0, gamesB: 4 }])
  })

  it('a dos sets (ping pong): la hoja pasa set por set y guarda recién cuando se define', async () => {
    await montar(PING_PONG)
    await tocar(botonLlamado('Cargar Ana & Beto contra Caro & Dani'))

    await tocar(pareja('Ana & Beto'))
    await tocar(games('7'))
    expect(saveMatchResult).not.toHaveBeenCalled()
    expect(dialogo().open).toBe(true)
    expect(dialogo().textContent).toContain('Set 2')
    expect(pareja('Ana & Beto').getAttribute('aria-pressed')).toBe('false')

    await tocar(pareja('Ana & Beto'))
    await tocar(botonLlamado('12 a 10'))

    expect(saveMatchResult).toHaveBeenCalledWith('s1', 1, 'p1', [
      { gamesA: 11, gamesB: 7 },
      { gamesA: 12, gamesB: 10 },
    ])
    expect(dialogo().open).toBe(false)
    expect(aviso().textContent).toContain('Guardado: Ana & Beto 11-7 12-10')
  })

  it('mientras guarda lo dice y no deja tocar otra cosa', async () => {
    let terminar: (value: WriteResult) => void = () => {}
    saveMatchResult.mockImplementationOnce(() => new Promise<WriteResult>((resolve) => (terminar = resolve)))
    await montar(PADEL)
    await tocar(botonLlamado('Cargar Ana & Beto contra Caro & Dani'))
    await tocar(pareja('Ana & Beto'))
    await tocar(games('1'))

    expect(dialogo().open).toBe(true)
    expect(dialogo().textContent).toContain('Guardando…')
    expect(games('3').disabled).toBe(true)
    expect(pareja('Caro & Dani').disabled).toBe(true)

    await act(async () => terminar({ ok: true }))
    expect(dialogo().open).toBe(false)
  })

  it('si el guardado rebota, la hoja queda abierta con lo elegido y el error; tocar de nuevo reintenta', async () => {
    saveMatchResult.mockResolvedValueOnce({ ok: false, error: 'No se pudo guardar.' })
    await montar(PADEL)
    await tocar(botonLlamado('Cargar Ana & Beto contra Caro & Dani'))
    await tocar(pareja('Ana & Beto'))
    await tocar(games('2'))

    expect(dialogo().open).toBe(true)
    expect(dialogo().querySelector('[role="alert"]')?.textContent).toBe('No se pudo guardar.')
    expect(pareja('Ana & Beto').getAttribute('aria-pressed')).toBe('true')
    expect(games('2').getAttribute('aria-pressed')).toBe('true')
    expect(aviso().textContent).toBe('')

    await tocar(games('2'))
    expect(saveMatchResult).toHaveBeenCalledTimes(2)
    expect(saveMatchResult).toHaveBeenLastCalledWith('s1', 1, 'p1', [{ gamesA: 4, gamesB: 2 }])
    expect(dialogo().open).toBe(false)
  })

  it('sin conexión (la acción ni llega: el fetch rechaza) la hoja queda abierta con lo elegido; volver a tocar reintenta', async () => {
    saveMatchResult.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await montar(PADEL)
    await tocar(botonLlamado('Cargar Ana & Beto contra Caro & Dani'))
    await tocar(pareja('Ana & Beto'))
    await tocar(games('2'))

    expect(dialogo().open).toBe(true)
    expect(dialogo().querySelector('[role="alert"]')?.textContent).toBe('Sin conexión. Probá de nuevo.')
    expect(pareja('Ana & Beto').getAttribute('aria-pressed')).toBe('true')
    expect(games('2').getAttribute('aria-pressed')).toBe('true')
    expect(games('2').disabled).toBe(false)

    await tocar(games('2'))
    expect(saveMatchResult).toHaveBeenCalledTimes(2)
    expect(dialogo().open).toBe(false)
    expect(aviso().textContent).toContain('Guardado: Ana & Beto 4-2')
  })

  it('un partido cargado se corrige con la hoja precargada', async () => {
    const cargado = partido('p1', 'Ana & Beto', 'Caro & Dani', [{ gamesA: 4, gamesB: 2 }])
    await montar(PADEL, [cargado, P2])

    await tocar(botonLlamado('Corregir Ana & Beto 4, Caro & Dani 2'))

    expect(dialogo().open).toBe(true)
    expect(pareja('Ana & Beto').getAttribute('aria-pressed')).toBe('true')
    expect(games('2').getAttribute('aria-pressed')).toBe('true')

    await tocar(pareja('Caro & Dani'))
    await tocar(games('3'))
    expect(saveMatchResult).toHaveBeenCalledWith('s1', 1, 'p1', [{ gamesA: 3, gamesB: 4 }])
  })

  it('cancelar la cierra sin guardar, y al volver a abrir arranca de cero', async () => {
    await montar(PADEL)
    await tocar(botonLlamado('Cargar Ana & Beto contra Caro & Dani'))
    await tocar(pareja('Ana & Beto'))
    await tocar(botonDe('Cancelar', dialogo()))
    expect(dialogo().open).toBe(false)
    expect(saveMatchResult).not.toHaveBeenCalled()

    await tocar(botonLlamado('Cargar Ana & Beto contra Caro & Dani'))
    expect(pareja('Ana & Beto').getAttribute('aria-pressed')).toBe('false')
  })
})

describe('FIFA: dos campos, el primero enfocado, y el paso al segundo', () => {
  const campos = () => [...dialogo().querySelectorAll('input')] as HTMLInputElement[]

  it('el primer campo arranca enfocado, numérico y de texto (con su tope de 3 dígitos)', async () => {
    await montar(FIFA)
    await tocar(botonLlamado('Cargar Ana & Beto contra Caro & Dani'))

    const [golesA, golesB] = campos()
    expect(document.activeElement).toBe(golesA)
    for (const campo of [golesA!, golesB!]) {
      expect(campo.type).toBe('text')
      expect(campo.inputMode).toBe('numeric')
      expect(campo.maxLength).toBe(3)
    }
    expect(golesA!.getAttribute('aria-label')).toBe('Goles de Ana & Beto')
    expect(golesB!.getAttribute('aria-label')).toBe('Goles de Caro & Dani')
  })

  it('Enter en el primero pasa al segundo; Enter en el segundo guarda', async () => {
    await montar(FIFA)
    await tocar(botonLlamado('Cargar Ana & Beto contra Caro & Dani'))
    const [golesA, golesB] = campos()

    await tipear(golesA!, '3')
    expect(document.activeElement).toBe(golesA)
    await act(async () => {
      golesA!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    expect(document.activeElement).toBe(golesB)

    await tipear(golesB!, '1')
    await act(async () => {
      golesB!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    expect(saveMatchResult).toHaveBeenCalledWith('s1', 1, 'p1', [{ gamesA: 3, gamesB: 1 }])
    expect(dialogo().open).toBe(false)
    expect(aviso().textContent).toContain('Guardado: Ana & Beto 3-1')
  })

  it('con dos dígitos en el primero pasa solo al segundo', async () => {
    await montar(FIFA)
    await tocar(botonLlamado('Cargar Ana & Beto contra Caro & Dani'))
    const [golesA, golesB] = campos()
    await tipear(golesA!, '1')
    expect(document.activeElement).toBe(golesA)
    await tipear(golesA!, '10')
    expect(document.activeElement).toBe(golesB)
  })

  it('"Guardar" se apaga mientras falte un número y guarda con los dos', async () => {
    await montar(FIFA)
    await tocar(botonLlamado('Cargar Ana & Beto contra Caro & Dani'))
    const [golesA, golesB] = campos()
    expect(botonDe('Guardar', dialogo()).disabled).toBe(true)
    await tipear(golesA!, '0')
    await tipear(golesB!, '2')
    await tocar(botonDe('Guardar', dialogo()))
    expect(saveMatchResult).toHaveBeenCalledWith('s1', 1, 'p1', [{ gamesA: 0, gamesB: 2 }])
  })

  it('si el guardado rebota, la hoja queda abierta con lo tipeado y el error', async () => {
    saveMatchResult.mockResolvedValueOnce({ ok: false, error: 'Esta disciplina no admite empates.' })
    await montar(FIFA)
    await tocar(botonLlamado('Cargar Ana & Beto contra Caro & Dani'))
    const [golesA, golesB] = campos()
    await tipear(golesA!, '0')
    await tipear(golesB!, '0')
    await tocar(botonDe('Guardar', dialogo()))

    expect(dialogo().open).toBe(true)
    expect(dialogo().querySelector('[role="alert"]')?.textContent).toBe('Esta disciplina no admite empates.')
    expect(campos().map((campo) => campo.value)).toEqual(['0', '0'])
  })

  it('sin conexión la hoja queda abierta con lo tipeado, y "Guardar" reintenta', async () => {
    saveMatchResult.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await montar(FIFA)
    await tocar(botonLlamado('Cargar Ana & Beto contra Caro & Dani'))
    const [golesA, golesB] = campos()
    await tipear(golesA!, '3')
    await tipear(golesB!, '1')
    await tocar(botonDe('Guardar', dialogo()))

    expect(dialogo().open).toBe(true)
    expect(dialogo().querySelector('[role="alert"]')?.textContent).toBe('Sin conexión. Probá de nuevo.')
    expect(campos().map((campo) => campo.value)).toEqual(['3', '1'])

    await tocar(botonDe('Guardar', dialogo()))
    expect(saveMatchResult).toHaveBeenCalledTimes(2)
    expect(dialogo().open).toBe(false)
  })

  it('corregir un FIFA cargado trae los goles puestos', async () => {
    await montar(FIFA, [partido('p1', 'Ana & Beto', 'Caro & Dani', [{ gamesA: 2, gamesB: 2 }])])
    await tocar(botonLlamado('Corregir Ana & Beto 2, Caro & Dani 2'))
    expect(campos().map((campo) => campo.value)).toEqual(['2', '2'])
  })
})
