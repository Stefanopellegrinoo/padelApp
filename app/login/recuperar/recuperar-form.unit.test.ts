import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

let query = ''
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(query) }))
vi.mock('@/app/auth/actions', () => ({ requestPasswordReset: vi.fn() }))

const { default: RecuperarForm } = await import('./recuperar-form')

function render(search: string): string {
  query = search
  return renderToStaticMarkup(createElement(RecuperarForm))
}

describe('Recuperar contraseña', () => {
  it('pide el mail para mandar el link (ya no dice "Llega pronto")', () => {
    const html = render('')

    expect(html).toContain('Recuperar contraseña')
    expect(html).toContain('type="email"')
    expect(html).toContain('Mandarme el link')
    expect(html).not.toContain('Llega pronto')
    expect(html).not.toContain('El link venció')
  })

  it('si vuelve de un link vencido, lo dice arriba del formulario', () => {
    const html = render('error=link')

    expect(html).toContain('El link venció o ya se usó. Pedí uno nuevo.')
    expect(html).toContain('Mandarme el link')
  })
})
