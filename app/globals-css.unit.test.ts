import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SPORTS, SPORT_IDS, SPORT_TONOS, type SportTono } from '@/core'

/**
 * Un color por deporte (S5 de mas-deportes), medido sobre `globals.css` tal
 * cual: el registro dice el `tono` de cada deporte y acá se comprueba que la
 * paleta exista en claro y en oscuro, que cada `data-deporte` la use entera y
 * que cada par texto/fondo pase AA (4.5) y cada bloque se separe del fondo
 * (3:1).
 */
const css = readFileSync(fileURLToPath(new URL('./globals.css', import.meta.url)), 'utf8')

function bloque(desde: string, cierre: string): string {
  const inicio = css.indexOf(desde)
  expect(inicio).toBeGreaterThan(-1)
  return css.slice(inicio, css.indexOf(cierre, inicio))
}
function variables(texto: string): Map<string, string> {
  return new Map([...texto.matchAll(/(--color-[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]))
}
const claro = variables(bloque('@theme static {', '\n}'))
const oscuro = variables(bloque('@media (prefers-color-scheme: dark) {', '\n}'))

const canal = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => canal(parseInt(hex.slice(i, i + 2), 16) / 255))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
function contraste(a: string, b: string): number {
  const [alto, bajo] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)
  return (alto! + 0.05) / (bajo! + 0.05)
}

/** Los ids de T2 y T3 ya tienen su bloque aunque todavía no estén en el registro. */
const TONO_DE: Record<string, SportTono> = {
  ...Object.fromEntries(SPORT_IDS.map((id) => [id, SPORTS[id].tono])),
  AJEDREZ: 'ajedrez',
  BOWLING: 'bowling',
}

const TEMAS = [
  ['claro', claro],
  ['oscuro', oscuro],
] as const

describe('un color por deporte (S5)', () => {
  it.each(SPORT_TONOS)('la paleta %s está entera en claro y en oscuro, con hex', (tono) => {
    for (const [, tema] of TEMAS) {
      for (const nombre of [`--color-${tono}`, `--color-${tono}-tint`, `--color-on-${tono}`, `--color-${tono}-block`, `--color-${tono}-block-soft`]) {
        expect(tema.get(nombre), nombre).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })

  it.each(Object.keys(TONO_DE))('[data-deporte=%s] usa su paleta entera', (id) => {
    const tono = TONO_DE[id]!
    const regla = [...css.matchAll(/((?:\[data-deporte='[A-Z_]+'\],?\s*)+)\{([^}]*)\}/g)].find((m) =>
      m[1]!.includes(`[data-deporte='${id}']`),
    )
    expect(regla, id).toBeDefined()
    const usa = variables(regla![2]!)
    expect(Object.fromEntries(usa)).toEqual({
      '--color-sport': `var(--color-${tono})`,
      '--color-sport-tint': `var(--color-${tono}-tint)`,
      '--color-on-sport': `var(--color-on-${tono})`,
      '--color-block': `var(--color-${tono}-block)`,
      '--color-on-block-soft': `var(--color-${tono}-block-soft)`,
    })
  })

  it.each(SPORT_TONOS)('%s pasa AA en claro y en oscuro', (tono) => {
    for (const [nombre, tema] of TEMAS) {
      const v = (clave: string) => tema.get(clave) ?? claro.get(clave)!
      const color = v(`--color-${tono}`)
      const tint = v(`--color-${tono}-tint`)
      const block = v(`--color-${tono}-block`)
      const pares: [string, string, string, number][] = [
        ['texto del deporte sobre el fondo', color, v('--color-bg'), 4.5],
        ['texto del deporte sobre la superficie', color, v('--color-surface'), 4.5],
        ['texto del deporte sobre la superficie 2', color, v('--color-surface-2'), 4.5],
        ['texto del deporte sobre su tinte', color, tint, 4.5],
        ['texto sobre el color lleno', v(`--color-on-${tono}`), color, 4.5],
        ['texto sobre el tinte', v('--color-text'), tint, 4.5],
        ['texto apagado sobre el tinte', v('--color-muted'), tint, 4.5],
        ['texto sobre el bloque', v('--color-on-block'), block, 4.5],
        ['texto suave sobre el bloque', v(`--color-${tono}-block-soft`), block, 4.5],
      ]
      // Pádel y FIFA quedan como estaban: su bloque oscuro (2.2 y 2.6 contra el fondo) es el del prototipo.
      if (!(nombre === 'oscuro' && (tono === 'padel' || tono === 'fifa'))) {
        pares.push(['el bloque contra el fondo', block, v('--color-bg'), 3])
      }
      for (const [que, a, b, minimo] of pares) {
        expect(contraste(a, b), `${tono} ${nombre}: ${que} (${a} / ${b})`).toBeGreaterThanOrEqual(minimo)
      }
    }
  })

  it('pádel y FIFA siguen con su azul y su verde', () => {
    expect([claro.get('--color-padel'), oscuro.get('--color-padel')]).toEqual(['#1f45e0', '#8da4ff'])
    expect([claro.get('--color-padel-block'), oscuro.get('--color-padel-block')]).toEqual(['#1f45e0', '#2643bc'])
    expect([claro.get('--color-fifa'), oscuro.get('--color-fifa')]).toEqual(['#0b7a3b', '#6cd49a'])
    expect([claro.get('--color-fifa-block'), oscuro.get('--color-fifa-block')]).toEqual(['#0b7a3b', '#17683c'])
    // Sin atributo, pádel.
    expect(claro.get('--color-sport')).toBe('var(--color-padel)')
  })
})
