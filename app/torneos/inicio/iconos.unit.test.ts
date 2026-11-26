import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SPORTS, SPORT_IDS } from '@/core'
import { IconoDeporte } from './iconos'

const trazo = (kind: string) => /<path d="([^"]+)"/.exec(renderToStaticMarkup(createElement(IconoDeporte, { kind })))?.[1]

describe('IconoDeporte: un ícono por deporte (S5)', () => {
  it('cada deporte del registro dibuja el suyo, y no hay dos iguales', () => {
    const trazos = SPORT_IDS.map(trazo)
    for (const d of trazos) expect(d).toBeTruthy()
    expect(new Set(trazos).size).toBe(SPORT_IDS.length)
  })

  it('pádel sigue con su paleta y FIFA con el joystick', () => {
    expect(SPORTS.PADEL.icono).toBe('padel')
    expect(SPORTS.FIFA.icono).toBe('pad')
    expect(trazo('PADEL')).toMatch(/^M9\.2 14\.8/)
    expect(trazo('FIFA')).toMatch(/^M7 8h10/)
  })

  it('ajedrez y bowling ya tienen el suyo; un id que no se conoce cae en la paleta, sin tirar', () => {
    const conocidos = new Set(SPORT_IDS.map(trazo))
    expect(conocidos.has(trazo('AJEDREZ'))).toBe(false)
    expect(conocidos.has(trazo('BOWLING'))).toBe(false)
    expect(trazo('AJEDREZ')).not.toBe(trazo('BOWLING'))
    expect(trazo('TEJO')).toBe(trazo('PADEL'))
  })

  it('es decorativo y toma el color de alrededor', () => {
    const html = renderToStaticMarkup(createElement(IconoDeporte, { kind: 'TENIS' }))
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('stroke-current')
  })
})
