import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Desempate, type StandingsRow } from './desempate'

function row(position: number, extra: Partial<StandingsRow> = {}): StandingsRow {
  return {
    entryId: `e${position}`,
    displayName: `Jugador ${position}`,
    position,
    points: 100 - position,
    movement: 0,
    played: 3,
    isMe: false,
    tiedWithEntryId: null,
    ...extra,
  }
}

type Props = Parameters<typeof Desempate>[0]

function html(rows: StandingsRow[], extra: Partial<Props> = {}): string {
  return renderToStaticMarkup(
    createElement(Desempate, {
      base: '/torneo/s1',
      rows,
      mastersCutoff: 4,
      tiebreakOrder: [{ entryId: 'e1', displayName: 'Jugador 1' }],
      tiebreakSnapshotEvery: 3,
      asOfMatchday: null,
      nextRefreshMatchday: 3,
      ...extra,
    }),
  )
}

/** Las filas de la tabla (`<li>` con la grilla), sin el corte del Masters. */
const filas = (markup: string) => [...markup.matchAll(/<li class="[^"]*grid-cols[^"]*"[^>]*>.*?<\/li>/g)].map((m) => m[0])

/**
 * S85 (verify-report-pr21-cierre #4016): la tabla general llega a 10+ jugadores
 * sin techo propio, y una columna de puesto de 16 px recortaba "10". Ahora el
 * puesto es la primera columna de la grilla, de 40 px, en la cara condensada
 * (26 px: "10" mide ~22).
 */
describe('Desempate — el número de puesto no se recorta desde el 10 (S85)', () => {
  it('con 10 jugadores, el décimo puesto va en la columna de 40 px', () => {
    const markup = html(Array.from({ length: 10 }, (_, index) => row(index + 1)))
    const decima = filas(markup)[9] ?? ''
    expect(decima).toContain('grid-cols-[40px_')
    expect(decima).toMatch(/<span class="font-cond[^"]*">10<\/span>/)
  })
})

describe('Desempate — la fila abre el perfil del jugador', () => {
  it('con base, el nombre es un link al perfil que cubre la fila entera', () => {
    const fila = filas(html([row(1)]))[0] ?? ''
    expect(fila).toMatch(/<a [^>]*href="\/torneo\/s1\/jugador\/e1"[^>]*>Jugador 1/)
    expect(fila).toContain('after:absolute')
  })

  it('con base null, no hay link', () => {
    expect(filas(html([row(1)], { base: null }))[0]).not.toContain('<a ')
  })
})

/**
 * La Tabla de un deporte, con 2+ en la temporada, decía "Tabla general" igual
 * que la global: el título lo pone quien la dibuja, y la global queda igual.
 * El título es para el lector de pantalla: a la vista ya lo dice el encabezado.
 */
describe('Desempate — el título de la sección', () => {
  it('sin título, "Tabla general" como siempre', () => {
    expect(html([row(1)])).toContain('>Tabla general<')
  })

  it('con título, ése y no "Tabla general"', () => {
    const markup = html([row(1)], { title: 'Tabla de Pádel' })
    expect(markup).toContain('>Tabla de Pádel<')
    expect(markup).not.toContain('Tabla general')
  })
})

describe('Desempate — tu fila', () => {
  it('va marcada en amarillo (vos) y dice "vos"; las demás no', () => {
    const [mia, otra] = filas(html([row(1, { isMe: true }), row(2)]))
    expect(mia).toContain('bg-vos-fila')
    expect(mia).toContain('>vos<')
    expect(otra).not.toContain('bg-vos-fila')
    expect(otra).not.toContain('>vos<')
  })
})

describe('Desempate — el cambio de puesto', () => {
  it('sube, baja, igual o nada, con su nombre para el lector de pantalla', () => {
    const [sube, baja, igual, nada] = filas(
      html([row(1, { movement: 2 }), row(2, { movement: -1 }), row(3, { movement: 0 }), row(4, { movement: null })], {
        mastersCutoff: 99,
      }),
    )
    expect(sube).toContain('aria-label="sube 2"')
    expect(sube).toContain('text-up')
    expect(baja).toContain('aria-label="baja 1"')
    expect(baja).toContain('text-down')
    expect(igual).toContain('aria-label="igual"')
    expect(nada).not.toMatch(/aria-label="(sube|baja|igual)/)
  })
})

describe('Desempate — columnas', () => {
  it('la tabla de un deporte muestra fechas jugadas y cambio', () => {
    const markup = html([row(1, { played: 7 })])
    expect(markup).toContain('>Fechas<')
    expect(filas(markup)[0]).toContain('>7<')
  })

  it('la general (sin columnas de fecha) sólo puesto, nombre y puntos', () => {
    const markup = html([row(1, { played: null, movement: null })], { showMatchdayColumns: false })
    expect(markup).not.toContain('>Fechas<')
    expect(filas(markup)[0]).toContain('grid-cols-[40px_1fr_56px]')
  })
})

describe('Desempate — el corte del Masters', () => {
  it('va después de la fila del corte, como separador con nombre', () => {
    const markup = html([row(1), row(2), row(3), row(4), row(5)])
    expect(markup).toMatch(/<li role="separator"[^>]*>.*Clasifican al Masters/)
    expect(markup.indexOf('Jugador 4')).toBeLessThan(markup.indexOf('Clasifican al Masters'))
    expect(markup.indexOf('Clasifican al Masters')).toBeLessThan(markup.indexOf('Jugador 5'))
  })
})

/**
 * La general no tiene orden de desempate (ver `page.tsx`): antes dibujaba el
 * botón igual y abría una lista vacía. Sin orden, no hay botón.
 */
describe('Desempate — el botón del orden de desempate', () => {
  it('con orden, está', () => {
    expect(html([row(1)])).toMatch(/<button[^>]*>Orden de desempate<\/button>/)
  })

  it('sin orden (la general), no', () => {
    expect(html([row(1)], { tiebreakOrder: [] })).not.toMatch(/<button[^>]*>Orden de desempate/)
  })
})
