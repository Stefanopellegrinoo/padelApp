import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TOURNAMENT_SPORTS, reglamento, sportLabel } from '@/core'
import {
  cambiarModalidad,
  cambiarPrimeraFecha,
  crearPayload,
  elegirDeporte,
  opcionesPrimeraFecha,
  type DeporteElegido,
} from './crear-state'
import { PasoComoSeJuega, PasoListo, PasoNuevo, copiarLink, encabezado, volverA } from './crear'

/**
 * Los pasos del wizard nuevo, RENDERIZADOS (sin clicks no se llega a cada paso: entran con props).
 * Casi todo con Pádel + FIFA; al final, los tres (ping pong se juega en torneos desde la Tarea 19).
 */
const SEIS = { names: ['Martina', 'Fede', 'Lucas', 'Ana', 'Beto', 'Nico'], mySeat: 0 }
/** Pádel (rotan, por nivel) + FIFA (individual, al azar): las dos tal cual su ficha. */
const PADEL_FIFA = elegirDeporte(elegirDeporte([], 'PADEL', 6), 'FIFA', 6)

const textOf = (html: string) => html.replace(/<[^>]+>/g, '')
const buttons = (html: string) =>
  [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map((m) => ({ attrs: m[1] ?? '', text: textOf(m[2] ?? '') }))

function nuevo(over: Partial<ComponentProps<typeof PasoNuevo>> = {}): string {
  return renderToStaticMarkup(
    createElement(PasoNuevo, { name: '', picked: [], warning: null, onName: () => {}, onToggle: () => {}, ...over }),
  )
}

function comoSeJuega(cards: readonly DeporteElegido[], over: Partial<ComponentProps<typeof PasoComoSeJuega>> = {}): string {
  return renderToStaticMarkup(
    createElement(PasoComoSeJuega, {
      cards,
      squadSize: 6,
      error: null,
      onModality: () => {},
      onPrimeraFecha: () => {},
      onPersonalizar: () => {},
      ...over,
    }),
  )
}

function listo(cards: readonly DeporteElegido[], over: Partial<ComponentProps<typeof PasoListo>> = {}): string {
  return renderToStaticMarkup(
    createElement(PasoListo, {
      ...crearPayload('Los Jueves', SEIS, cards),
      created: null,
      pending: false,
      error: null,
      onCreate: () => {},
      ...over,
    }),
  )
}

describe('PasoNuevo', () => {
  it('un chip por deporte de torneo, en el orden del registro, y ninguno elegido de entrada', () => {
    const chips = buttons(nuevo()).filter((b) => b.attrs.includes('aria-pressed'))
    expect(chips.map((b) => b.text)).toEqual(TOURNAMENT_SPORTS.map(sportLabel))
    for (const chip of chips) expect(chip.attrs).toContain('aria-pressed="false"')
  })

  it('los chips son bloques grandes, de a tres por fila, en un grupo con título', () => {
    const html = nuevo()
    expect(html).toContain('grid grid-cols-3 gap-2')
    expect(html).toMatch(/role="group"[^>]*aria-labelledby="[^"]+"/)
    expect(html).toContain('¿A qué juegan?')
    expect(html).toContain('Podés elegir más de uno: cada uno tiene su tabla y hay una general.')
    for (const chip of buttons(html).filter((b) => b.attrs.includes('aria-pressed'))) {
      expect(Number(/min-h-\[(\d+)px\]/.exec(chip.attrs)?.[1])).toBeGreaterThanOrEqual(44)
    }
  })

  it('cada chip en el color de su deporte; el elegido, lleno, y el resto en su tinte', () => {
    const chips = buttons(nuevo({ picked: ['FIFA'] })).filter((b) => b.attrs.includes('aria-pressed'))
    for (const kind of TOURNAMENT_SPORTS) {
      expect(chips.find((b) => b.text === sportLabel(kind))?.attrs).toContain(`data-deporte="${kind}"`)
    }
    const pressed = chips.filter((b) => b.attrs.includes('aria-pressed="true"'))
    expect(pressed.map((b) => b.text)).toEqual([sportLabel('FIFA')])
    expect(pressed[0]?.attrs).toContain('bg-sport text-on-sport')
    for (const chip of chips.filter((b) => b.attrs.includes('aria-pressed="false"'))) {
      expect(chip.attrs).toContain('bg-sport-tint')
    }
  })

  it('el campo del nombre mide 16px o más (sin zoom en iOS)', () => {
    const input = /<input[^>]*>/.exec(nuevo())?.[0] ?? ''
    expect(Number(/text-\[(\d+)px\]/.exec(input)?.[1])).toBeGreaterThanOrEqual(16)
  })

  it('el nombre tiene su rótulo y el valor que viene', () => {
    const html = nuevo({ name: 'Los Jueves' })
    expect(html).toMatch(/<label[^>]*for="[^"]+"[^>]*>Nombre<\/label>/)
    expect(html).toContain('value="Los Jueves"')
  })

  it('muestra el aviso que le pasan', () => {
    expect(nuevo({ warning: 'Elegí al menos un deporte.' })).toContain('Elegí al menos un deporte.')
  })
})

describe('PasoComoSeJuega', () => {
  const sections = (html: string) => html.split('<section').slice(1)

  it('Pádel + FIFA: una tarjeta por deporte, y la segunda puede copiar el orden de Pádel', () => {
    const [padel, fifa, ...rest] = sections(comoSeJuega(PADEL_FIFA))
    expect(rest).toEqual([])
    expect(padel).toContain('Pádel')
    expect(fifa).toContain('FIFA')
    expect(fifa).toContain('Igual que Pádel')
    expect(padel).toContain('6 jugadores')
  })

  it('el aviso de modalidades va en las tarjetas de parejas, no en la individual', () => {
    const error = 'Son 5. El plantel tiene que ser par para poder armar parejas.'
    const [padel, fifa] = sections(comoSeJuega(PADEL_FIFA, { error }))
    expect(padel).toContain(error)
    expect(fifa).not.toContain(error)
  })
})

describe('PasoListo', () => {
  it('arriba, el torneo como datos: el nombre, cuántos juegan y quiénes (el tuyo marcado)', () => {
    const html = listo(PADEL_FIFA)
    expect(html).toContain('>Los Jueves<')
    expect(html).toMatch(/<span[^>]*font-cond[^>]*>6<\/span>/)
    for (const name of SEIS.names) expect(html).toContain(`>${name}<`)
    expect(html).toMatch(/<span[^>]*marca-vos[^>]*>Martina<\/span>/)
  })

  it('cada deporte en su color con su título y su reglamento; los puntos como casilleros; y "Crear torneo"', () => {
    const html = listo(PADEL_FIFA)
    const disciplines = crearPayload('Los Jueves', SEIS, PADEL_FIFA).disciplines
    for (const d of disciplines) {
      expect(html).toMatch(new RegExp(`<section[^>]*data-deporte="${d.kind}"`))
      expect(html).toContain(`>${sportLabel(d.kind)}<`)
      for (const line of reglamento(d).filter((l) => l.key !== 'puntos')) expect(html).toContain(line.text)
      expect(html).toMatch(new RegExp(`<span[^>]*font-cond[^>]*>${d.config.points[0]}</span>`))
    }
    expect(html).not.toContain('✓')
    expect(buttons(html).map((b) => b.text)).toEqual(['Crear torneo'])
  })

  it('"Crear torneo" va fijo abajo, al alcance del pulgar', () => {
    const barra = /<div[^>]*class="([^"]*)"[^>]*>(?:(?!<div).)*<button[^>]*>Crear torneo<\/button>/.exec(listo(PADEL_FIFA))?.[1] ?? ''
    expect(barra.split(' ')).toEqual(expect.arrayContaining(['fixed', 'bottom-0']))
  })

  it('la primera fecha que cuenta es la de la tarjeta, no la de la ficha', () => {
    expect(listo(PADEL_FIFA)).toContain('Parejas que rotan. La primera fecha se arma por nivel')
    const alAzar = listo(cambiarPrimeraFecha(PADEL_FIFA, 'PADEL', 'SORTEO'))
    expect(alAzar).toContain('Parejas que rotan. La primera fecha se arma al azar')
    expect(alAzar).not.toContain('por nivel')
  })

  it('"Igual que Pádel" cuenta la primera fecha de Pádel', () => {
    const html = listo(cambiarPrimeraFecha(PADEL_FIFA, 'FIFA', { igualQue: 'PADEL' }))
    expect(html).toContain('Individual. La primera fecha se arma por nivel')
  })

  it('cambiar de modalidad cambia lo que se cuenta', () => {
    const fijas = PADEL_FIFA.map((card) => (card.kind === 'PADEL' ? cambiarModalidad(card, 'FIJAS', 6) : card))
    expect(listo(fijas)).toContain('Parejas fijas. La primera fecha se arma al azar')
  })

  it('creando: el botón dice "Creando…" y está trabado', () => {
    const [crear] = buttons(listo(PADEL_FIFA, { pending: true }))
    expect(crear?.text).toBe('Creando…')
    expect(crear?.attrs).toContain('disabled=""')
  })

  it('creado: "Ir al torneo" y debajo "Copiar link de invitación"; ya no se crea de nuevo', () => {
    const html = listo(PADEL_FIFA, { created: { inviteUrl: 'http://x/unirse/abc', href: '/torneo/123' } })
    expect(html).toMatch(/<a[^>]*href="\/torneo\/123"[^>]*>Ir al torneo<\/a>/)
    expect(buttons(html).map((b) => b.text)).toEqual(['Copiar link de invitación'])
    expect(html.indexOf('Ir al torneo')).toBeLessThan(html.indexOf('Copiar link de invitación'))
  })

  it('muestra el error del servidor', () => {
    expect(listo(PADEL_FIFA, { error: 'No se pudo crear.' })).toContain('No se pudo crear.')
  })
})

describe('Pádel + Ping pong + FIFA', () => {
  const TRES = elegirDeporte(elegirDeporte(elegirDeporte([], 'PADEL', 6), 'PING_PONG', 6), 'FIFA', 6)
  const sections = (html: string) => html.split('<section').slice(1)

  it('ningún "igual que" que se ofrece arma una cadena: el paso 4 se dibuja en todos los caminos', () => {
    // Todos los estados alcanzables tocando opciones ofrecidas (4 opciones por tarjeta como mucho: 4³).
    const key = (cards: readonly DeporteElegido[]) => JSON.stringify(cards.map((c) => c.primeraFecha))
    const seen = new Map<string, readonly DeporteElegido[]>()
    const queue: (readonly DeporteElegido[])[] = [TRES]
    while (queue.length > 0) {
      const cards = queue.pop()!
      if (seen.has(key(cards))) continue
      seen.set(key(cards), cards)
      for (const { kind } of cards) {
        for (const { value } of opcionesPrimeraFecha(cards, kind)) queue.push(cambiarPrimeraFecha(cards, kind, value))
      }
    }
    // El camino que rompía: FIFA igual que Pádel, y después Pádel igual que Ping pong.
    const fifaCopiaAPadel = cambiarPrimeraFecha(TRES, 'FIFA', { igualQue: 'PADEL' })
    expect(seen.has(key(cambiarPrimeraFecha(fifaCopiaAPadel, 'PADEL', { igualQue: 'PING_PONG' })))).toBe(false)
    for (const cards of seen.values()) expect(sections(listo(cards))).toHaveLength(3)
  })

  it('el paso 4 cuenta los tres, ping pong a 11 y en su modalidad', () => {
    const [padel, pingPong, fifa] = sections(listo(TRES))
    expect(padel).toContain('>Pádel<')
    expect(pingPong).toContain('>Ping pong<')
    expect(pingPong).toContain('Individual. La primera fecha se arma al azar')
    expect(pingPong).toContain('Partidos al mejor de 3 sets de 11 puntos, se gana por 2.')
    expect(fifa).toContain('>FIFA<')
  })
})

describe('encabezado', () => {
  it('los cuatro pasos, con su número y su título (una pregunta por paso)', () => {
    expect(encabezado(0)).toEqual({ paso: 0, rotulo: 'Paso 1 de 4', titulo: 'Nuevo torneo', motivo: null })
    expect(encabezado(1)).toEqual({ paso: 1, rotulo: 'Paso 2 de 4', titulo: '¿Quiénes juegan?', motivo: null })
    expect(encabezado(2)).toEqual({ paso: 2, rotulo: 'Paso 3 de 4', titulo: '¿Cómo se juega?', motivo: null })
    expect(encabezado(3)).toEqual({ paso: 3, rotulo: 'Paso 4 de 4', titulo: 'Así queda', motivo: null })
  })

  it('los subpasos son parte del paso 3 y dicen por qué aparecen, aparte del número', () => {
    expect(encabezado('PAREJAS')).toEqual({
      paso: 2,
      rotulo: 'Paso 3 de 4',
      titulo: 'Armá las parejas',
      motivo: 'Porque elegiste parejas fijas',
    })
    expect(encabezado('NIVEL')).toEqual({
      paso: 2,
      rotulo: 'Paso 3 de 4',
      titulo: 'Ordená por nivel',
      motivo: 'Porque elegiste por nivel',
    })
  })
})

describe('volverA', () => {
  it('"Volver" nombra la pantalla de antes; en la primera no hay pantalla de antes', () => {
    const secuencia = [0, 1, 2, 'PAREJAS', 'NIVEL', 3] as const
    expect(volverA(secuencia, 0)).toBeNull()
    expect(volverA(secuencia, 1)).toBe('Nuevo torneo')
    expect(volverA(secuencia, 2)).toBe('Jugadores')
    expect(volverA(secuencia, 'PAREJAS')).toBe('Cómo se juega')
    expect(volverA(secuencia, 'NIVEL')).toBe('Parejas')
    expect(volverA(secuencia, 3)).toBe('Orden')
    expect(volverA([0, 1, 2, 3], 3)).toBe('Cómo se juega')
  })
})

describe('copiarLink', () => {
  it('copia el link y dice que pudo', async () => {
    const copied: string[] = []
    const ok = await copiarLink('http://x/unirse/abc', {
      writeText: async (text) => {
        copied.push(text)
      },
    })
    expect(ok).toBe(true)
    expect(copied).toEqual(['http://x/unirse/abc'])
  })

  it('si el portapapeles rechaza, o no hay portapapeles, dice que no pudo', async () => {
    expect(await copiarLink('http://x', { writeText: () => Promise.reject(new Error('NotAllowedError')) })).toBe(false)
    expect(await copiarLink('http://x', undefined)).toBe(false)
  })
})
