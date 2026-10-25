import { describe, expect, it } from 'vitest'
import { recorrido } from './historial'

/** Aplica una serie de pathnames como los ve `usePathname`, desde una pila vacía. */
function recorrer(...pathnames: string[]): string[] {
  return pathnames.reduce<string[]>(recorrido, [])
}

describe('recorrido — las pantallas de la app a las que "atrás" puede volver', () => {
  it('la primera pantalla no tiene anterior: Volver usa su destino fijo', () => {
    expect(recorrer('/torneo/s/padel/jugador/e1')).toEqual(['/torneo/s/padel/jugador/e1'])
  })

  it('cada pantalla nueva se apila', () => {
    expect(recorrer('/torneo/s/padel', '/torneo/s/padel/stats', '/torneo/s/padel/jugador/e1')).toEqual([
      '/torneo/s/padel',
      '/torneo/s/padel/stats',
      '/torneo/s/padel/jugador/e1',
    ])
  })

  it('volver a la anterior la desapila: es un "atrás"', () => {
    expect(recorrer('/torneo/s/padel/stats', '/torneo/s/padel/jugador/e1', '/torneo/s/padel/stats')).toEqual([
      '/torneo/s/padel/stats',
    ])
  })

  it('la misma pantalla otra vez (un guardado, un ?error) no apila nada', () => {
    expect(recorrer('/torneo/s/ajustes', '/torneo/s/ajustes')).toEqual(['/torneo/s/ajustes'])
  })
})
