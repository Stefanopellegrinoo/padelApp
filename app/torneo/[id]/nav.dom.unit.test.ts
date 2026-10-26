// @vitest-environment jsdom
//
// La nav de abajo recuerda el deporte: si estabas en FIFA y pasás por Reglas o Ajustes (que no
// llevan deporte en la URL), Tabla, Fechas y Stats te devuelven a FIFA, no al primer deporte.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

let pathname = ''
let search = ''
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
}))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: unknown }) => createElement('a', { href }, children as never),
  useLinkStatus: () => ({ pending: false }),
}))

const { TorneoNav } = await import('./nav')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
})

function ir(a: string) {
  ;[pathname, search = ''] = a.split('?') as [string, string?]
  act(() => root.render(createElement(TorneoNav, { seasonId: 's', defaultDisciplineSlug: 'padel' })))
}

const hrefDe = (label: string) =>
  [...host.querySelectorAll('a')].find((a) => a.textContent?.includes(label))?.getAttribute('href')

it('de FIFA a Reglas: Tabla, Fechas y Stats siguen en FIFA', () => {
  ir('/torneo/s/fifa/fechas')
  ir('/torneo/s/reglas')
  expect([hrefDe('Tabla'), hrefDe('Fechas'), hrefDe('Stats')]).toEqual([
    '/torneo/s/fifa',
    '/torneo/s/fifa/fechas',
    '/torneo/s/fifa/stats',
  ])
})

it('sin haber pasado por ningún deporte, van al primero', () => {
  ir('/torneo/s/reglas')
  expect(hrefDe('Fechas')).toBe('/torneo/s/padel/fechas')
})

it('Stats recuerda "Mías": de Stats Mías a Fechas y de vuelta, sigue en Mías', () => {
  ir('/torneo/s/padel/stats?tab=mias')
  expect(hrefDe('Stats')).toBe('/torneo/s/padel/stats?tab=mias')
  ir('/torneo/s/fifa/fechas')
  expect(hrefDe('Stats')).toBe('/torneo/s/fifa/stats?tab=mias')
  ir('/torneo/s/fifa/stats')
  expect(hrefDe('Stats')).toBe('/torneo/s/fifa/stats')
})
