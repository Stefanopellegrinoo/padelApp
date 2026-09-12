import { afterEach, describe, expect, it } from 'vitest'
import { guardarEn, leerGuardado } from './storage'

/**
 * En Node no existe `localStorage`, así que cada test pone el suyo: uno que
 * anda, uno que tira al leer (Safari iOS con cookies bloqueadas, o un WebView
 * de Instagram), y uno que lee bien pero tira al escribir (Safari en
 * Navegación Privada, `QuotaExceededError`).
 */
function ponerLocalStorage(falso: unknown): void {
  Object.defineProperty(globalThis, 'localStorage', { value: falso, configurable: true })
}

function localStorageQueAnda(inicial: Record<string, string> = {}) {
  const datos = { ...inicial }
  return {
    getItem: (clave: string) => datos[clave] ?? null,
    setItem: (clave: string, valor: string) => {
      datos[clave] = valor
    },
    removeItem: (clave: string) => {
      delete datos[clave]
    },
    datos,
  }
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('leerGuardado', () => {
  it('devuelve lo guardado cuando el navegador deja leer', () => {
    ponerLocalStorage(localStorageQueAnda({ clave: 'valor' }))
    expect(leerGuardado('clave')).toEqual({ valor: 'valor', disponible: true })
  })

  it('distingue "no hay nada guardado" de "no se puede leer"', () => {
    ponerLocalStorage(localStorageQueAnda())
    expect(leerGuardado('clave')).toEqual({ valor: null, disponible: true })
  })

  it('no tira cuando el acceso a localStorage explota', () => {
    ponerLocalStorage({
      getItem: () => {
        throw new DOMException('acceso denegado', 'SecurityError')
      },
    })
    expect(leerGuardado('clave')).toEqual({ valor: null, disponible: false })
  })

  it('no tira cuando localStorage directamente no existe', () => {
    expect(leerGuardado('clave')).toEqual({ valor: null, disponible: false })
  })
})

describe('guardarEn', () => {
  it('escribe y avisa que pudo', () => {
    const falso = localStorageQueAnda()
    ponerLocalStorage(falso)
    expect(guardarEn('clave', 'valor')).toBe(true)
    expect(falso.datos.clave).toBe('valor')
  })

  it('borra cuando el valor es null', () => {
    const falso = localStorageQueAnda({ clave: 'valor' })
    ponerLocalStorage(falso)
    expect(guardarEn('clave', null)).toBe(true)
    expect(falso.datos.clave).toBeUndefined()
  })

  it('devuelve false cuando el navegador no deja escribir', () => {
    ponerLocalStorage({
      getItem: () => null,
      setItem: () => {
        throw new DOMException('cuota', 'QuotaExceededError')
      },
    })
    expect(guardarEn('clave', 'valor')).toBe(false)
  })

  it('devuelve false cuando el navegador no deja borrar', () => {
    ponerLocalStorage({
      removeItem: () => {
        throw new DOMException('acceso denegado', 'SecurityError')
      },
    })
    expect(guardarEn('clave', null)).toBe(false)
  })
})
