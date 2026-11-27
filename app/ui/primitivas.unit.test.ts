// Las primitivas de servidor del rediseño (`app/ui/`): qué estructura y qué contrato de
// accesibilidad prometen a las pantallas. Se renderizan de verdad, sin DOM.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Avatar, avatarTone, initials } from './avatar'
import { button, type ButtonVariant } from './button'
import { chip } from './chip'
import { Hero } from './hero'
import { row, rowPress } from './row'
import { Section } from './section'
import { Skeleton } from './skeleton'

const clases = (html: string, selector: RegExp) => (html.match(selector)?.[1] ?? '').split(' ')

describe('Hero', () => {
  const html = renderToStaticMarkup(
    createElement(Hero, {
      back: { href: '/torneos', label: 'Inicio' },
      kicker: 'Pádel',
      title: 'Los Pibes del Martes',
      subtitle: 'Fecha 7 de 12',
      right: createElement('span', null, '3°'),
      sport: 'FIFA',
    }),
  )

  it('es un header con el título como h1 y el Volver con su destino', () => {
    expect(html.startsWith('<header')).toBe(true)
    expect(html).toMatch(/<h1[^>]*>Los Pibes del Martes<\/h1>/)
    expect(html).toMatch(/<a[^>]*href="\/torneos"[^>]*>.*Inicio<\/a>/)
    expect(html).toContain('Pádel')
    expect(html).toContain('Fecha 7 de 12')
    expect(html).toContain('<span>3°</span>')
  })

  it('pinta el bloque con su texto, el anillo de foco claro y el deporte', () => {
    const header = clases(html, /<header[^>]*class="([^"]*)"/)
    expect(header).toContain('bg-block')
    expect(header).toContain('text-on-block')
    expect(header).toContain('[--color-focus:var(--color-on-block)]')
    expect(html).toMatch(/<header[^>]*data-deporte="FIFA"/)
  })

  it('el título de número ("Fecha 8") usa la cara condensada', () => {
    const fecha = renderToStaticMarkup(createElement(Hero, { title: 'Fecha 8', titleVariant: 'number' }))
    expect(clases(fecha, /<h1[^>]*class="([^"]*)"/)).toContain('font-cond')
    expect(fecha).not.toContain('<a')
    expect(fecha).not.toContain('data-deporte')
  })
})

describe('Hero con una acción arriba a la derecha (amigos-faciles, S2)', () => {
  it('la acción va en la misma línea que Volver, a la derecha', () => {
    const html = renderToStaticMarkup(
      createElement(Hero, {
        back: { href: '/torneo/s1/padel', label: 'Tabla' },
        action: createElement('button', { type: 'button' }, 'Agregar'),
        title: 'Nico Arias',
      }),
    )
    const fila = html.match(/<header[^>]*><div class="([^"]*)"><a[^>]*>.*?Tabla<\/a><button type="button">Agregar<\/button><\/div>/)
    expect(fila?.[1]?.split(' ')).toEqual(expect.arrayContaining(['flex', 'items-center', 'justify-between']))
  })

  it('sin acción el Hero sale igual que siempre: Volver suelto, primero del header', () => {
    const html = renderToStaticMarkup(createElement(Hero, { back: { href: '/torneos', label: 'Inicio' }, title: 'X' }))
    expect(html).toMatch(/^<header[^>]*><a /)
  })
})

describe('Hero con una acción en la línea del título (amigos-faciles, S5)', () => {
  it('la acción va al lado del título, centrada con él, y el subtítulo sigue abajo', () => {
    const html = renderToStaticMarkup(
      createElement(Hero, {
        back: { href: '/torneos', label: 'Inicio' },
        title: 'Amigos',
        subtitle: '2 amigos',
        titleAction: createElement('button', { type: 'button' }, 'Compartir mi link'),
      }),
    )
    const fila = html.match(/<div class="([^"]*)"><h1[^>]*>Amigos<\/h1><button type="button">Compartir mi link<\/button><\/div><p[^>]*>2 amigos<\/p>/)
    expect(fila?.[1]?.split(' ')).toEqual(expect.arrayContaining(['flex', 'items-center', 'justify-between']))
  })

  it('sin ella el título sale como siempre: el h1 suelto, seguido del subtítulo', () => {
    const html = renderToStaticMarkup(createElement(Hero, { title: 'Amigos', subtitle: '2 amigos' }))
    expect(html).toMatch(/<div class="min-w-0"><h1[^>]*>Amigos<\/h1><p[^>]*>2 amigos<\/p><\/div>/)
  })
})

describe('chip', () => {
  it('mide 34 a la vista y 44 para el dedo, y se aprieta (S6)', () => {
    for (const v of ['onBlock', 'hueca', 'claro'] as const) {
      expect(chip(v).split(' ')).toEqual(
        expect.arrayContaining(['press', 'relative', 'min-h-[34px]', 'rounded-pill', 'after:absolute', 'after:-inset-y-[5px]']),
      )
    }
  })

  it('cada variante tiene su par de colores', () => {
    expect(chip('onBlock').split(' ')).toEqual(expect.arrayContaining(['bg-on-block', 'text-block']))
    expect(chip('hueca').split(' ')).toEqual(expect.arrayContaining(['text-on-block']))
    expect(chip('claro').split(' ')).toEqual(expect.arrayContaining(['bg-opcion', 'text-accent-link']))
  })
})

describe('Section', () => {
  it('es una sección con su título h2 y la acción al lado', () => {
    const html = renderToStaticMarkup(
      createElement(Section, {
        title: 'Amigos',
        action: createElement('a', { href: '/amigos' }, 'Ver todos'),
        children: 'lista',
      }),
    )
    expect(html).toMatch(/^<section/)
    expect(html).toMatch(/<h2[^>]*>Amigos<\/h2>/)
    expect(html).toContain('<a href="/amigos">Ver todos</a>')
    expect(html).toContain('lista')
  })
})

describe('Avatar', () => {
  it('las iniciales: nombre y apellido, una sola palabra, espacios de más, vacío', () => {
    expect(initials('Nico Arias')).toBe('NA')
    expect(initials('martín')).toBe('M')
    expect(initials('  juan  pablo  ledesma ')).toBe('JP')
    expect(initials('   ')).toBe('?')
  })

  it('el tono sale del nombre: el mismo nombre, el mismo tono, siempre', () => {
    expect(avatarTone('Nico Arias')).toBe(avatarTone('Nico Arias'))
    const tonos = new Set(['Nico Arias', 'Facu Gómez', 'Juampi', 'Lucas Ferro', 'Tomi', 'Seba'].map(avatarTone))
    expect(tonos.size).toBeGreaterThan(1)
  })

  it('decorativo al lado del nombre; con label es una imagen nombrada', () => {
    const solo = renderToStaticMarkup(createElement(Avatar, { name: 'Nico Arias' }))
    expect(solo).toMatch(/aria-hidden="true"/)
    expect(solo).toContain('>NA<')
    const nombrado = renderToStaticMarkup(createElement(Avatar, { name: 'Martín Paz', label: 'Martín, tu perfil' }))
    expect(nombrado).toMatch(/role="img"/)
    expect(nombrado).toMatch(/aria-label="Martín, tu perfil"/)
    expect(nombrado).not.toContain('aria-hidden')
  })

  it('mide 44 o más en todos los tamaños', () => {
    for (const size of ['md', 'lg'] as const) {
      const html = renderToStaticMarkup(createElement(Avatar, { name: 'Nico', size }))
      expect(html).toMatch(/h-(11|14) w-(11|14)/)
    }
  })
})

describe('Skeleton', () => {
  it('es un bloque mudo que late (y deja de latir con movimiento reducido, en globals.css)', () => {
    const html = renderToStaticMarkup(createElement(Skeleton, { className: 'h-10 w-full' }))
    expect(html).toMatch(/aria-hidden="true"/)
    const c = clases(html, /class="([^"]*)"/)
    expect(c).toEqual(expect.arrayContaining(['animate-pulse', 'bg-chip', 'h-10', 'w-full']))
  })
})

describe('recetas de botón y de fila', () => {
  const variantes: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger', 'onBlock']

  it('todo botón mide 44 o más y se aprieta (también un <a>)', () => {
    for (const v of variantes) {
      expect(button(v).split(' ')).toEqual(expect.arrayContaining(['min-h-[44px]', 'press']))
      expect(button(v, { size: 'lg' }).split(' ')).toContain('min-h-[56px]')
    }
  })

  it('cada variante tiene su par de colores', () => {
    expect(button('primary').split(' ')).toEqual(expect.arrayContaining(['bg-cta', 'text-on-cta']))
    expect(button('secondary').split(' ')).toEqual(expect.arrayContaining(['bg-chip', 'text-text']))
    expect(button('ghost').split(' ')).toContain('text-accent-link')
    expect(button('danger').split(' ')).toEqual(expect.arrayContaining(['bg-live-bg', 'text-live']))
    expect(button('onBlock').split(' ')).toEqual(expect.arrayContaining(['bg-on-block', 'text-block']))
    expect(button('primary', { full: true }).split(' ')).toContain('w-full')
  })

  it('la fila mide 56 y la que se toca cambia de fondo en vez de achicarse', () => {
    expect(row.split(' ')).toContain('min-h-[56px]')
    expect(rowPress.split(' ')).toEqual(expect.arrayContaining(['min-h-[56px]', 'press-fila']))
  })
})
