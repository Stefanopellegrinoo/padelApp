import { describe, expect, it } from 'vitest'
import { afterLogin, safeNextPath } from './next-path'

// Este módulo no tenía tests, y es el que decide a dónde va alguien con una
// sesión recién creada. Se equivoca de dos maneras: mandándolo afuera de la app
// (redirector abierto) o dejándolo en la pantalla del que no tiene cuenta.

describe('safeNextPath', () => {
  it('deja pasar una ruta de la propia app', () => {
    expect(safeNextPath('/torneo/abc')).toBe('/torneo/abc')
    expect(safeNextPath('/unirse/token123')).toBe('/unirse/token123')
  })

  it('rechaza una URL absoluta a otro sitio', () => {
    expect(safeNextPath('https://el-atacante.com/robo')).toBe('/')
  })

  // El caso que parece una ruta y no lo es: el navegador resuelve `//host` como
  // `https://host`, así que sin esta guarda el login es un redirector abierto.
  it('rechaza el protocol-relative, que parece una ruta', () => {
    expect(safeNextPath('//el-atacante.com/robo')).toBe('/')
  })

  it('rechaza lo que no es un string', () => {
    expect(safeNextPath(null)).toBe('/')
    expect(safeNextPath(undefined)).toBe('/')
  })
})

describe('afterLogin', () => {
  // El defecto que lo trajo: entrar con Google desde `/login` dejaba en la
  // landing, que es la pantalla para el que TODAVÍA NO tiene cuenta. El login
  // con contraseña ya hacía lo correcto; el callback de OAuth no, y nadie lo
  // vio porque sin credenciales de Google ese camino no se podía recorrer.
  it('manda a Mis torneos cuando no hay destino', () => {
    expect(afterLogin('/')).toBe('/torneos')
    expect(afterLogin(null)).toBe('/torneos')
    expect(afterLogin('')).toBe('/torneos')
  })

  // Quien llega por un link de invitación tiene que volver a la invitación: si
  // no, entra y queda varado sin haber reclamado su lugar.
  it('respeta el destino de un link de invitación', () => {
    expect(afterLogin('/unirse/token123')).toBe('/unirse/token123')
  })

  it('manda a Mis torneos, no afuera, cuando el destino es hostil', () => {
    expect(afterLogin('https://el-atacante.com/robo')).toBe('/torneos')
    expect(afterLogin('//el-atacante.com/robo')).toBe('/torneos')
  })
})
