import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { genteDeTusTorneos, type GenteDeTorneo } from '@/db/friends'

/**
 * `/amigos/gente` (odd/tasks/amigos-faciles.md, S10): el server component lee la gente de tus
 * torneos y el `?torneo=` de la URL, así el filtro sobrevive a recargar. Llamado directo +
 * `renderToStaticMarkup`, lecturas mockeadas -- mismo patrón que `app/amigos/gente-pagina.unit.test.ts`.
 */

vi.mock('@/db/server', () => ({ serverClient: async () => ({}) }))

vi.mock('@/app/amigos/actions', () => ({ agregarAmigo: vi.fn() }))

vi.mock('next/navigation', () => ({ usePathname: () => '/amigos/gente' }))

vi.mock('@/db/friends', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/db/friends')>()
  return { ...real, genteDeTusTorneos: vi.fn(async () => []) }
})

const persona = (n: number, torneos: Array<[string, string]>): GenteDeTorneo => ({
  playerId: `p${n}`,
  displayName: `Persona ${n}`,
  seasonIds: torneos.map(([id]) => id),
  torneos: torneos.map(([, nombre]) => nombre),
  fechasJuntos: 10 - n,
})

beforeEach(() => {
  vi.mocked(genteDeTusTorneos).mockClear().mockResolvedValue([
    persona(1, [['s-martes', 'Los Pibes del Martes'], ['s-jueves', 'Copa del Jueves']]),
    persona(2, [['s-martes', 'Los Pibes del Martes']]),
    persona(3, [['s-jueves', 'Copa del Jueves']]),
  ])
})

async function render(torneo?: string | string[]): Promise<string> {
  const { default: GentePage } = await import('./page')
  return renderToStaticMarkup(await GentePage({ searchParams: Promise.resolve(torneo === undefined ? {} : { torneo }) }))
}

const pressed = (html: string) => [...html.matchAll(/aria-pressed="true"[^>]*>([^<]*)</g)].map((m) => m[1])

describe('/amigos/gente', () => {
  it('sin filtro: "Todos", las tres personas y "3 personas"', async () => {
    const html = await render()
    expect(genteDeTusTorneos).toHaveBeenCalledTimes(1)
    expect(html).toContain('href="/amigos"')
    expect(html).toMatch(/<h1[^>]*>Gente de tus torneos<\/h1>/)
    expect(html).toContain('3 personas')
    expect(pressed(html)).toEqual(['Todos'])
    expect(html).toContain('Persona 1')
    expect(html).toContain('Persona 3')
    expect(html).toContain('Los Pibes del Martes y Copa del Jueves')
  })

  it('?torneo=s-jueves: arranca filtrada por ese torneo', async () => {
    const html = await render('s-jueves')
    expect(pressed(html)).toEqual(['Copa del Jueves'])
    expect(html).toContain('2 personas')
    expect(html).toContain('Persona 1')
    expect(html).not.toContain('Persona 2')
    expect(html).toContain('Persona 3')
  })

  it('?torneo repetido: vale el primero', async () => {
    const html = await render(['s-martes', 's-jueves'])
    expect(pressed(html)).toEqual(['Los Pibes del Martes'])
  })

  it('si la lectura falla, la pantalla no se arma con datos a medias', async () => {
    const { EdgeError } = await import('@/db/errors')
    vi.mocked(genteDeTusTorneos).mockRejectedValueOnce(new EdgeError('No se pudo leer completa la gente de tus torneos (asientos). Recargá la pantalla.'))
    await expect(render()).rejects.toThrow('No se pudo leer completa la gente de tus torneos')
  })
})
