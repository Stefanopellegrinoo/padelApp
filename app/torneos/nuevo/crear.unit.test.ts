import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TOURNAMENT_SPORTS, reglamento, sportLabel } from '@/core'
import { cambiarModalidad, cambiarPrimeraFecha, crearPayload, elegirDeporte, type DeporteElegido } from './crear-state'
import { PasoComoSeJuega, PasoListo, PasoNuevo, copiarLink, encabezado } from './crear'

/**
 * Los pasos del wizard nuevo, RENDERIZADOS (sin clicks no se llega a cada paso: entran con props).
 * Pádel + FIFA solamente: ping pong recién se juega en torneos en la Tarea 19.
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
      disciplines: crearPayload('Los Jueves', SEIS, cards).disciplines,
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

  it('los chips son grandes, de a tres por fila, en un grupo con título', () => {
    const html = nuevo()
    expect(html).toContain('grid grid-cols-3 gap-2')
    expect(html).toMatch(/role="group"[^>]*aria-labelledby="[^"]+"/)
    expect(html).toContain('¿Qué deportes?')
    expect(html).toContain('Podés elegir más de uno. Cada deporte tiene su tabla, y además hay una tabla general.')
  })

  it('el deporte elegido queda marcado, el resto no', () => {
    const pressed = buttons(nuevo({ picked: ['FIFA'] })).filter((b) => b.attrs.includes('aria-pressed="true"'))
    expect(pressed.map((b) => b.text)).toEqual([sportLabel('FIFA')])
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
  it('cada deporte con su título y cada línea de su reglamento con ✓, y "Crear torneo"', () => {
    const html = listo(PADEL_FIFA)
    const disciplines = crearPayload('Los Jueves', SEIS, PADEL_FIFA).disciplines
    const lines = disciplines.flatMap((d) => reglamento(d))
    for (const d of disciplines) expect(html).toContain(`>${sportLabel(d.kind)}<`)
    for (const line of lines) expect(html).toContain(line.text)
    expect(html.match(/✓/g)).toHaveLength(lines.length)
    expect(html).toContain('text-up')
    expect(buttons(html).map((b) => b.text)).toEqual(['Crear torneo'])
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

describe('encabezado', () => {
  it('los cuatro pasos, con su número y su título', () => {
    expect(encabezado(0)).toEqual({ paso: 0, rotulo: 'Paso 1 de 4', titulo: 'Nuevo torneo' })
    expect(encabezado(3)).toEqual({ paso: 3, rotulo: 'Paso 4 de 4', titulo: 'Listo, así se juega' })
  })

  it('los subpasos son parte del paso 3 y dicen por qué aparecen', () => {
    expect(encabezado('PAREJAS')).toEqual({
      paso: 2,
      rotulo: 'Paso 3 de 4 · Sólo si elegiste "parejas fijas"',
      titulo: 'Armá las parejas',
    })
    expect(encabezado('NIVEL')).toEqual({
      paso: 2,
      rotulo: 'Paso 3 de 4 · Sólo si elegiste "por nivel"',
      titulo: 'Ordená por nivel',
    })
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
