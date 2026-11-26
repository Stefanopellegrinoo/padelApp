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

  it('ajedrez dibuja su peón y bowling su bolo, desde el registro; un id que no se conoce cae en la paleta', () => {
    expect(SPORTS.AJEDREZ.icono).toBe('peon')
    expect(SPORTS.BOWLING.icono).toBe('bolo')
    expect(trazo('AJEDREZ')).toMatch(/^M14\.5 5\.5/)
    expect(trazo('BOWLING')).toMatch(/^M12 2c1\.4/)
    expect(trazo('TEJO')).toBe(trazo('PADEL'))
  })

  it('es decorativo y toma el color de alrededor', () => {
    const html = renderToStaticMarkup(createElement(IconoDeporte, { kind: 'TENIS' }))
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('stroke-current')
  })
})
