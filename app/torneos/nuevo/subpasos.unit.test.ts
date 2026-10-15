import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { cambiarModalidad, cambiarPrimeraFecha, elegirDeporte, type DeporteElegido } from './crear-state'
import { ArmarParejas, OrdenarPorNivel } from './subpasos'

/** Los subpasos del paso 3, RENDERIZADOS. Pádel + FIFA solamente (ping pong llega en la Tarea 19). */
const NOMBRES = ['Fede', 'Martina', 'Lucas', 'Ana']

const textOf = (html: string) => html.replace(/<[^>]+>/g, '').replaceAll('&amp;', '&')
const buttons = (html: string) =>
  [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map((m) => ({ attrs: m[1] ?? '', text: textOf(m[2] ?? '') }))

function tarjeta(kind: 'PADEL' | 'FIFA', modality: DeporteElegido['modality'], over: Partial<DeporteElegido> = {}): DeporteElegido {
  const [fresh] = elegirDeporte([], kind, NOMBRES.length)
  return { ...cambiarModalidad(fresh!, modality, NOMBRES.length), ...over }
}

function parejas(card: DeporteElegido, over: Partial<ComponentProps<typeof ArmarParejas>> = {}): string {
  return renderToStaticMarkup(
    createElement(ArmarParejas, { card, names: NOMBRES, pendiente: null, onTocar: () => {}, onSortear: () => {}, ...over }),
  )
}

function porNivel(card: DeporteElegido, names: readonly string[] = NOMBRES): string {
  return renderToStaticMarkup(createElement(OrdenarPorNivel, { card, names, onMover: () => {} }))
}

describe('ArmarParejas', () => {
  const unaArmada = tarjeta('PADEL', 'FIJAS', { pairs: [[0, 1]] })

  it('la pareja armada en su fila con su número; los sueltos como chips; cuántos faltan', () => {
    const html = parejas(unaArmada)
    const text = textOf(html)
    expect(text).toContain('Fede & Martina')
    expect(text).toContain('pareja 1')
    const sueltos = buttons(html).filter((b) => b.attrs.includes('aria-pressed="false"'))
    expect(sueltos.map((b) => b.text)).toEqual(['Lucas', 'Ana'])
    expect(text).toContain('Faltan emparejar 2.')
  })

  it('dice de qué deporte son y qué cambia, y ofrece sortearlas', () => {
    const html = parejas(unaArmada)
    expect(textOf(html)).toContain('Pádel · Juegan juntas todo el torneo. La tabla de Pádel va a ser por pareja.')
    expect(buttons(html).map((b) => b.text)).toContain('Sortear parejas')
  })

  it('la que espera pareja se marca', () => {
    const lucas = buttons(parejas(unaArmada, { pendiente: 2 })).find((b) => b.text.startsWith('Lucas'))
    expect(lucas?.text).toBe('Lucas · esperando')
    expect(lucas?.attrs).toContain('aria-pressed="true"')
  })

  it('con todas armadas no falta nada y no quedan chips sueltos', () => {
    const html = parejas(tarjeta('PADEL', 'FIJAS', { pairs: [[0, 1], [3, 2]] }))
    expect(textOf(html)).toContain('Ana & Lucas')
    expect(textOf(html)).toContain('pareja 2')
    expect(html).not.toContain('Faltan emparejar')
    expect(html).not.toContain('aria-pressed')
  })
})

describe('OrdenarPorNivel', () => {
  const rowsOf = (html: string) => html.split('<li').slice(1).map(textOf)

  it('las filas en el orden armado, numeradas, con iniciales; el primero no sube y el último no baja', () => {
    const fifa = tarjeta('FIFA', 'INDIVIDUAL', { primeraFecha: 'NIVEL', order: [2, 0, 1] })
    const html = porNivel(fifa, ['Fede Gómez', 'Martina', 'Lucas Paz'])
    const rows = rowsOf(html)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toContain('1LPLucas Paz')
    expect(rows[1]).toContain('2FGFede Gómez')
    expect(rows[2]).toContain('3MMartina')
    expect(html).toMatch(/<button[^>]*aria-label="Subir a Lucas Paz"[^>]*disabled=""/)
    expect(html).not.toMatch(/<button[^>]*aria-label="Subir a Fede Gómez"[^>]*disabled=""/)
    expect(html).toMatch(/<button[^>]*aria-label="Bajar a Martina"[^>]*disabled=""/)
    expect(html).not.toMatch(/<button[^>]*aria-label="Bajar a Lucas Paz"[^>]*disabled=""/)
  })

  it('cada fila tiene el asa para arrastrar, y sólo el asa frena el scroll táctil', () => {
    const html = porNivel(tarjeta('FIFA', 'INDIVIDUAL', { primeraFecha: 'NIVEL' }))
    expect(html.match(/⋮⋮/g)).toHaveLength(NOMBRES.length)
    expect(html.match(/touch-none/g)).toHaveLength(NOMBRES.length)
  })

  it('con parejas fijas cada fila es una pareja', () => {
    const fijas = tarjeta('PADEL', 'FIJAS', { primeraFecha: 'NIVEL', pairs: [[0, 1], [2, 3]], order: [1, 0] })
    const html = porNivel(fijas)
    const rows = rowsOf(html)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('Lucas & Ana')
    expect(rows[1]).toContain('Fede & Martina')
    expect(html).toContain('aria-label="Subir a Lucas &amp; Ana"')
  })

  it('individual: sólo arma la primera fecha; con parejas que rotan, las parejas de la primera fecha', () => {
    const fifa = tarjeta('FIFA', 'INDIVIDUAL', { primeraFecha: 'NIVEL' })
    expect(textOf(porNivel(fifa))).toContain(
      'FIFA · Arriba el que mejor juega. Sólo arma la primera fecha: después manda la tabla.',
    )
    const [padel] = cambiarPrimeraFecha([tarjeta('PADEL', 'ROTAN')], 'PADEL', 'NIVEL')
    expect(textOf(porNivel(padel!))).toContain(
      'Pádel · Arriba el que mejor juega. Sólo arma las parejas de la primera fecha: después manda la tabla.',
    )
  })
})
