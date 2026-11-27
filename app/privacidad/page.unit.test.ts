// @vitest-environment jsdom
//
// La política de privacidad con la cara del prototipo: el título en el bloque de arriba y el texto
// largo a 17 px. Su "Volver" sigue sin destino fijo: desanda a donde estabas (el registro, el menú
// de tu cuenta) y, si entraste directo, va a `/`.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import PrivacidadPage from './page'

function pantalla(): HTMLElement {
  const main = document.createElement('div')
  main.innerHTML = renderToStaticMarkup(PrivacidadPage())
  return main
}

describe('/privacidad', () => {
  it('el título va en el bloque de arriba, con el Volver que desanda', () => {
    const header = pantalla().querySelector('header')!
    expect(header.querySelector('h1')?.textContent).toBe('Política de privacidad')
    const volver = header.querySelector('a')!
    expect(volver.getAttribute('href')).toBe('/')
    expect(volver.textContent).toBe('Volver')
  })

  it('las cuatro partes, en texto de 17 px, y el link a borrar la cuenta', () => {
    const page = pantalla()
    expect([...page.querySelectorAll('h2')].map((h2) => h2.textContent)).toEqual([
      'Qué datos guardamos',
      'Para qué',
      'Quién los ve',
      'Borrar tu cuenta',
    ])
    for (const lista of page.querySelectorAll('ul')) expect(lista.className).toContain('text-[17px]')
    expect(page.querySelector('a[href="/cuenta/borrar"]')?.textContent).toBe('Borrar cuenta')
  })

  it('quien tenga tu link de amistad ve tu nombre, y el link se puede cambiar', () => {
    expect(pantalla().textContent).toContain(
      'Quien tenga tu link de amistad ve tu nombre. Si lo cambiás, el de antes deja de andar.',
    )
  })
})
