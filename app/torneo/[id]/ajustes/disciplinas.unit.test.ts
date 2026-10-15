import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { elegirDeporte } from '@/app/torneos/nuevo/crear-state'
import { NuevoDeporte, type DisciplineVM, type SquadMemberVM } from './disciplinas'

/**
 * La tarjeta de "+ Agregar un deporte" (docs/torneos-deportes.md §5), RENDERIZADA aparte de
 * `Disciplinas` por lo mismo que antes: `Disciplinas` guarda `adding` en un `useState` que arranca
 * cerrado, y sin clicks (este repo no tiene runner E2E ni React Testing Library) la suite nunca la
 * vería abierta. Acá entra ya abierta, con el estado que quiera el test.
 *
 * Mismo límite que antes: lo que NO cubre es que tocar "Agregar" dispare `addSportToSeason`; eso
 * queda para el navegador. Lo que sí está cubierto de punta a punta es lo que esa acción manda
 * (`nuevo-deporte-state.unit.test.ts`) y lo que la base hace con eso (`db/torneos-deportes.db.test.ts`).
 */
const squad: SquadMemberVM[] = [
  { entryId: 'a', name: 'Colo' },
  { entryId: 'b', name: 'Nacho' },
  { entryId: 'c', name: 'Pablo' },
  { entryId: 'd', name: 'Tomi' },
]
const padel: DisciplineVM = { id: 'p1', kind: 'PADEL', slug: 'padel' }

function html(overrides: Partial<Parameters<typeof NuevoDeporte>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(NuevoDeporte, {
      card: elegirDeporte([], 'FIFA', squad.length)[0]!,
      disciplines: [padel],
      squad,
      selected: new Set(squad.map((member) => member.entryId)),
      pending: false,
      onKind: () => {},
      onModality: () => {},
      onPrimeraFecha: () => {},
      onPersonalizar: () => {},
      onToggle: () => {},
      onSubmit: () => {},
      onCancel: () => {},
      ...overrides,
    }),
  )
}

describe('NuevoDeporte', () => {
  it('ofrece cada deporte de torneo como un chip, con el elegido marcado', () => {
    const markup = html()

    expect(markup).toMatch(/<button[^>]*aria-pressed="true"[^>]*>FIFA<\/button>/)
    expect(markup).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Pádel<\/button>/)
  })

  it('la primera fecha ofrece "Por nivel", "Al azar" e "Igual que" cada deporte que el torneo ya tiene', () => {
    const markup = html()

    expect(markup).toContain('Por nivel')
    expect(markup).toContain('el orden del torneo')
    expect(markup).toContain('Al azar')
    expect(markup).toContain('Igual que Pádel')
  })

  it('sin otro deporte en el torneo no hay "Igual que"', () => {
    expect(html({ disciplines: [] })).not.toContain('Igual que')
  })

  it('es la misma tarjeta del paso 3: modalidad de la ficha, la ficha en una línea y "Personalizar reglas"', () => {
    const markup = html({ card: elegirDeporte([], 'PADEL', squad.length)[0]! })

    expect(markup).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Parejas que rotan<\/button>/)
    expect(markup).toContain('Personalizar reglas ›')
    expect(markup).toContain('4 jugadores')
  })

  it('"Quién juega" cuenta a los tildados, y los destildados no suman', () => {
    expect(html()).toContain('Quién juega (4)')
    expect(html({ selected: new Set(['a', 'b']) })).toContain('Quién juega (2)')
  })

  it('"Agregar" no se puede tocar sin nadie ni con menos gente que el piso del deporte', () => {
    const agregar = /<button[^>]*disabled=""[^>]*>Agregar<\/button>/

    expect(html()).not.toMatch(agregar)
    expect(html({ selected: new Set() })).toMatch(agregar)
    // Pádel necesita 4; con 3 el aviso lo dice y el botón espera.
    const tres = html({ card: elegirDeporte([], 'PADEL', 3)[0]!, selected: new Set(['a', 'b', 'c']) })
    expect(tres).toMatch(agregar)
    expect(tres).toContain('Falta 1 nombre')
  })
})
